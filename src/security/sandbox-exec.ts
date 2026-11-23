/**
 * 在主进程侧拉起「沙箱包裹 + 宿主执行」短命子进程（ADR-0014）。
 *
 * 主进程不再初始化 `SandboxManager`：相关全局状态全部留在子进程内，随其退出回收，
 * 因此不需要包裹串行锁、不需要 `reset()`、也不需要为挂起准备兜底超时。
 *
 * 失败分层：
 * - 子进程自身被杀死 / 输出不可解析 / 回传缺字段 → 工装故障，抛 `SandboxExecHarnessError`；
 * - 宿主正常启动但以非 0 退出 → 只是观测结果，不在这里判定对错。
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { Socket, createServer } from 'node:net';
import type { Readable } from 'node:stream';
import { SANDBOX_EXEC_CHILD_ENTRY } from './sandbox-exec-child.ts';
import type {
  SandboxExecFailureStage,
  SandboxExecReply,
  SandboxExecRequest,
  SandboxExecResult,
} from './sandbox-exec-child.ts';

export interface SandboxExecOutcome {
  status: number | null;
  signal: NodeJS.Signals | null;
  error: NodeJS.ErrnoException | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdioDestroyed: boolean;
  /** 结果管道在本进程结算前断开：宿主被连带杀死，本次观测作废（见 `SandboxExecResult.pipeBroken`）。 */
  pipeBroken: boolean;
}

/** 包裹层自身故障：由上层按 HARNESS 归因，不得计入被测系统缺陷。 */
export type SandboxExecHarnessStage = SandboxExecFailureStage | 'protocol';

export class SandboxExecHarnessError extends Error {
  readonly stage: SandboxExecHarnessStage;

  constructor(stage: SandboxExecHarnessStage, message: string) {
    super(message);
    this.name = 'SandboxExecHarnessError';
    this.stage = stage;
  }
}

export interface SandboxExecInput {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  allowedWrite: string[];
  allowedDomains: string[];
  timeoutMs: number;
  /** 旁路诊断：只跳过包裹，仍在子进程内执行。 */
  sandboxBypass?: boolean;
}

/**
 * 子进程引导余量：宿主自身的 deadline 之外，再给「起进程 + 包裹 + 回帧」的额外时间。
 * 不能写成固定值——题目 deadline 可能是 900s，固定 120s 会把正常慢题判成工装故障。
 */
const CHILD_BOOTSTRAP_MARGIN_MS = 120_000;

/**
 * 结算之后等子进程自己退出的宽限：超过就直接杀掉。
 *
 * 正常路径是「写出帧 → flush → `process.exit(0)`」，几十毫秒内就退；
 * 卡住的是包裹层里的同步调用（回到 JS 之前既不跑宿主也不写帧）。
 * 这个值只影响「另起一次观测」的快慢，不影响已落地结论的正确性。
 */
const CHILD_SETTLE_GRACE_MS = 2_000;

/** 结果管道收齐（stdout `'end'`）之后等子进程退出的上限：过了就按已收的帧结算。 */
const CHILD_EXIT_GRACE_MS = 5_000;

/**
 * 在短命子进程内执行「包裹 + 启动宿主 + 收集观测」。
 *
 * @param input 与原先 `wrapHostCommand` + `runHostedWithReap` 的入参一致
 * @param childEntry 子进程入口脚本路径（测试可替换为受控替身）
 */
export async function runSandboxedHostInChild(
  input: SandboxExecInput,
  childEntry: string = SANDBOX_EXEC_CHILD_ENTRY,
): Promise<SandboxExecOutcome> {
  const request: SandboxExecRequest = {
    bin: input.bin,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    allowedWrite: input.allowedWrite,
    allowedDomains: input.allowedDomains,
    timeoutMs: input.timeoutMs,
    ...(input.sandboxBypass === true ? { sandboxBypass: true } : {}),
  };

  // 生命期探针（fd 4）：一条本进程建的已连接 socket，本进程留一端、子进程拿另一端。
  // 子进程只负责读它：父进程死（含 SIGKILL）或主动关掉自己那份时读端立刻 EOF，
  // 这是「对端是否还活着」唯一能直接回答的一路（见 `createLivenessProbe`）。
  // 建通道要等一次回环连接（毫秒级），取不到时返回 null，主判据（心跳确认）照常工作。
  const { liveness, spawnChild } = await childSpawnPlan(childEntry);
  const baseStdio: Array<'pipe' | 'inherit' | number> = ['pipe', 'pipe', 'inherit', 'pipe'];
  // `stdio[4]` 交的是子进程那端 socket 的原生 fd（见 `createLivenessChannel`）。
  const stdio: Array<'pipe' | 'inherit' | number> =
    liveness === null ? baseStdio : [...baseStdio, liveness.fd];
  // stdin 只用来交请求与确认；stdout 只用来收结果帧；stderr 透传到引擎日志便于排障。
  const child = spawnChild(stdio);
  return new Promise((resolve, reject) => {
    // 子进程已经拿着 fd 了：本进程立刻释放自己那份句柄副本，只留 `keepOpen`（父进程活着 = 通道开着）。
    liveness?.releaseWrite();
    liveness?.dispose();
    // 探针读端：本进程读到一拍心跳就回一个确认世代，子进程据此确认「对端真的在读」。
    // 本进程消失时两条通道一起断，子进程的确认世代随之停滞，据此带走宿主进程树。
    // 结算时主动关掉：结果帧到手后本进程可能继续跑后面的题，留着读端等于对子进程说
    // 「我还看着你」，宿主若仍未收干净就再也没人接手了。
    //
    // 刻意不用 `resume()` + `'readable'` 的流式读取：`'readable'` 只在流被显式恢复后
    // 才会有序触发，在 `readable` 里调 `read()` 会自锁（事件永不触发）。
    // 这里用 `'data'` 事件：它本身就把流置为流动，读到的字节直接丢弃，只用来回确认。
    // `'data'` 走的是流内已有的读取，不额外占用 libuv 线程池，不会拖住 process.exit。
    const probeReader = probeReadable(child);
    // 本端读到的拍数：每读一拍心跳加一。回传给子进程，让它知道「对端真在读」。
    let readCount = 0;
    // 读到的最后一拍心跳上带的序号（子进程每拍写一行 `<写入序号>:<它看到的确认>`）。
    let lastSeen = 0;
    // stdin 上一次 `write()` 的结果：`false` 表示背压，必须等 `'drain'` 才继续写确认。
    let stdinWritable = true;
    child.stdin?.on('drain', () => {
      stdinWritable = true;
    });
    // 回一拍确认（`<我读到第几拍>:<那一拍上的序号>`）。只在心跳有进展时调用，见下方。
    const sendAck = () => {
      const stdin = child.stdin;
      if (!stdinWritable || stdin === null || stdin.writableEnded || stdin.destroyed) return;
      try {
        stdinWritable = stdin.write(`${readCount}:${lastSeen}\n`);
      } catch {
        /* 子进程已收场：没有确认的必要 */
      }
    };
    probeReader?.on('error', () => undefined);
    // 半行心跳（写端一次短写、或组包边界落在行中）绝不能被当成「一拍」：那样会给子进程
    // 回一个不存在的序号，还会让读次数虚高、把「对端跟上了」判错。只认证完整行。
    let probeLine = '';
    probeReader?.on('data', (chunk: Buffer) => {
      try {
        const pending = probeLine + chunk.toString('utf8');
        const lastBreak = pending.lastIndexOf('\n');
        if (lastBreak < 0) {
          probeLine = pending;
          return;
        }
        probeLine = pending.slice(lastBreak + 1);
        // 一拍心跳可能被组包成多行：逐行计数，每行回传一次确认。
        let progressed = false;
        for (const line of pending.slice(0, lastBreak).split('\n')) {
          const trimmed = line.trim();
          if (trimmed === '') continue;
          readCount += 1;
          progressed = true;
          // 只认 `<写入序号>`；`Number.parseInt('12abc')` 会悄悄给出 12，这里要整段是数字。
          const [seenRaw] = trimmed.split(':');
          const seen = Number(seenRaw);
          if (Number.isInteger(seen) && seen > lastSeen) lastSeen = seen;
        }
        // 只在**真的读到了新心跳**时回确认：这不是为了省字节，而是为了让「确认停滞」
        // 成为一条有方向的判据——子进程停发心跳（卡死换代码/宿主退出）时本进程不再回
        // 任何确认，子进程侧的判死才能真正成立；定时回拍会把「子进程卡住」伪装成「对端正常」。
        if (progressed) sendAck();
      } catch {
        /* 子进程已收场：没有确认的必要 */
      }
    });
    probeReader?.resume();

    let buffer = '';
    let settled = false;
    // 结算时解析出的结果帧：失败/timedOut 的帧也要据此回收宿主进程组，故缓存在外层。
    let settledReply: SandboxExecReply | null = null;
    // 引导预算 = 宿主 deadline + 包裹/回帧余量。子进程内部的 deadline 会先到期并回收
    // 进程树，这里的定时器只在「子进程自己卡死/被杀」时才触发。
    const bootstrapTimeoutMs = Math.max(
      1,
      (Number.isFinite(input.timeoutMs) ? input.timeoutMs : 60_000) + CHILD_BOOTSTRAP_MARGIN_MS,
    );
    // 子进程「主动收场」的退出时限：结算之后我们不再等它自己走完，
    // 超过这个时限就直接杀掉（见 `settle`）。
    const childExitTimer: { handle?: ReturnType<typeof setTimeout> } = {};
    const timer = setTimeout(() => {
      settle(() => {
        reject(
          new SandboxExecHarnessError(
            'protocol',
            `沙箱执行子进程 ${bootstrapTimeoutMs}ms 内没有回传结果，已判定为工装故障`,
          ),
        );
      });
    }, bootstrapTimeoutMs);
    timer.unref();

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 兜底回收必须在释放句柄**之前**做：子进程可能在帧交出之后才被杀掉，
      // 那时结果帧里登记的 hostPid 是唯一能带走宿主进程组的线索。
      settledReply = parseReply(buffer);
      if (settledReply !== null) reapHostAfterSettlement(settledReply);
      probeReader?.destroy();
      // 请求与确认都走 stdin：结算后不再需要它，留着会让子进程以为本进程还在。
      child.stdin?.destroy();
      // 生命期通道同时关掉：结果帧已经到手，本进程不再「看着」子进程；
      // 子进程若还有未收干净的宿主进程树，它读 fd 4 立刻 EOF，据此自行带走。
      liveness?.keepOpen.close();
      // 结算即放弃：子进程此刻若还没退出（例如卡在包裹层的同步操作里，既没跑宿主
      // 也没写帧），它的探针/确认通道已经全被本端关掉，留给它的只有「迟早判死」；
      // 不等它自己走完，给一个宽限后直接杀掉，另起一次观测。
      if (child.exitCode === null && child.signalCode === null) {
        childExitTimer.handle = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* 已经退出 */
          }
        }, CHILD_SETTLE_GRACE_MS);
        childExitTimer.handle.unref();
      }
      fn();
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      settle(() =>
        reject(new SandboxExecHarnessError('spawn', `沙箱执行子进程启动失败：${err.message}`)),
      );
    });

    // 只挂 exit 但不单独结算：帧要等 close 之后才完整（stdout 尾字节可能还在管道里）。
    // 这里的作用是「进程没了就立刻断掉探针与 stdin」，不给子进程留下「父进程还在读」的假象。
    child.on('exit', () => {
      probeReader?.destroy();
      if (settled) clearTimeout(childExitTimer.handle);
    });

    // 只有 stdout **真正结束**（全部字节已收到）才算收齐结果。
    //
    // 不能直接用 `'close'` 结算：孙进程继承并占着子进程的管道时，`'close'` 会被推到
    // 那些写端全关之后——子进程早已写出结果帧并退出，本端却还空等到引导预算。
    // 这里的 `'end'` 之后 `'close'` 必然紧随（真没有时由兜底定时器收口）。
    child.stdout?.on('end', () => {
      waitForChildExit(() => finalize('eof'));
    });
    child.on('close', (code, signal) => {
      waitForChildExit(() => finalize(`${String(code)}/${String(signal)}`));
    });
    // 结算路径：帧在 stdout `'end'`（字节收齐）或 `'close'`（进程与管道都结束）时落地。
    // 收齐帧就立刻结算，不再等队列里的其它事件：结论只取决于帧本身。
    // `finalize` 的入参只用于「没有帧」时的故障描述，方便排障。
    const finalize = (exitNote: string) => {
      settle(() => {
        const reply = settledReply;
        if (reply === null) {
          reject(
            new SandboxExecHarnessError(
              'protocol',
              `沙箱执行子进程未回传可解析结果（exit=${exitNote}）`,
            ),
          );
          return;
        }
        if (!reply.ok) {
          reject(new SandboxExecHarnessError(reply.stage, reply.message));
          return;
        }
        if (reply.pipeBroken === true) {
          // 宿主是被「上层提前关掉结果管道」连带杀死的，退出码与输出都不代表被测任务。
          reject(
            new SandboxExecHarnessError(
              'protocol',
              '结果管道在宿主结束前断开，宿主已被连带终止，本次观测作废',
            ),
          );
          return;
        }
        resolve(toOutcome(reply));
      });
    };

    child.stdin?.on('error', () => {
      /* 子进程提前退出时写管道会报 EPIPE；真正的判据是 close 里有没有结果帧。 */
    });
    // 请求整整一行（子进程按首行解析）；之后**不 end**：stdin 还要继续承载心跳确认。
    child.stdin?.write(`${JSON.stringify(request)}\n`);

    /**
     * 等子进程**退出之后**再落地结论（而不是等它的管道全部关闭）。
     *
     * 结果帧写出就代表观测完成；子进程随后 `process.exit(0)`。它的管道可能被子孙
     * 进程继承并继续占着（探针 fd 就故意不读、也不关），`'close'` 因此会被拖到那些
     * 写端都消失为止。所以这里只等 `'exit'`；子进程迟迟不退（卡在包裹层的同步调用里）
     * 就按 `CHILD_BOOTSTRAP_MARGIN_MS` 的收尾宽限强杀，宁可重新起一次也不挂死。
     */
    const waitForChildExit = (fn: () => void) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        fn();
        return;
      }
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        clearTimeout(forceTimer);
        fn();
      };
      const forceTimer = setTimeout(() => {
        // 子进程还在跑：结论只能用已收到的帧；没有帧就是工装故障。
        try {
          child.kill('SIGKILL');
        } catch {
          /* 已经退出 */
        }
        once();
      }, CHILD_EXIT_GRACE_MS);
      forceTimer.unref();
      child.once('exit', once);
    };
  });
}

/**
 * 生命期探针通道：一条已连接的 TCP socket 对——本进程留一端，子进程拿另一端当 fd 4。
 *
 * 为什么不能直接把 socket 的一端当 `stdio[4]`：父进程被 SIGKILL 之后，它那一端的句柄
 * 会被宿主进程组里的外逃进程继承，内核看来「还有人持有」，子进程读 fd 4 永远等不到 EOF，
 * 判死永远不成立。FIFO 也不行：写端的 open 要等读者，本机 macOS 实测会同步卡死在 `openSync`。
 *
 * 所以用「先建 socket、再只交一个 fd」：
 * 1. `createSocketPair` 在本进程建一条临时 loopback 连接（监听随即关闭，不占固定端口），
 *    两端都已连接后才返回；`childEnd` 是**子进程要读的那一端**，`keepEnd` 是本进程的对手端；
 * 2. 只把 `childEnd` 的**原生 fd** 交给 `spawn` 当 fd 4；本进程**保留** `childEnd` 的句柄，
 *    因为只销毁句柄会让内核把这条连接放进 CLOSE_WAIT——子进程读 fd 4 看到的是「对端关了写、
 *    还没断」，`end` 永远等不到；
 * 3. 子进程以只读 socket 接管 fd 4（见 `openLivenessStream`）。
 *
 * 于是「本进程手里的两个句柄还在不在」成为唯一决定因素：本进程死、被 SIGKILL（句柄由内核
 * 一并回收）、或结算时 `keepOpen.close()` 一起关掉两端，子进程读 fd 4 立即 EOF。
 * `releaseWrite()` 只做 `unref`（让事件循环不为它常驻），**不断连**；真正断连只有
 * `keepOpen.close()` 与进程消亡两条路。取不到通道时返回 null，子进程按「没有这一路」处理，
 * 主判据（心跳确认）照常工作。
 */
async function createLivenessChannel(): Promise<LivenessChannel | null> {
  if (process.platform === 'win32') return null;
  try {
    const pair = await createSocketPair();
    if (pair === null) return null;
    const [childEnd, keepEnd] = pair;
    const fd = (childEnd as unknown as { _handle?: { fd?: number } })._handle?.fd;
    if (typeof fd !== 'number' || fd <= 0) {
      childEnd.destroy();
      keepEnd.destroy();
      return null;
    }
    // 本进程留两端：`keepEnd` 是对手端，`childEnd` 的句柄只为撑住连接（见上方注释）。
    return {
      fd,
      keepOpen: {
        close: () => {
          childEnd.destroy();
          keepEnd.destroy();
        },
      },
      // 本进程不应再持有 `childEnd` 的活跃引用：`unref()` 让事件循环不因它而挂着，
      // 句柄本身交给 `keepOpenHandle` 一直持有到结算（不能提前 destroy）。
      releaseWrite: () => childEnd.unref(),
      keepOpenHandle: childEnd,
      dispose: () => undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 一条已连接的 socket 对：`listen(127.0.0.1:0)` 拿临时端口、`connect` 连上自己，
 * 再等 `connection` 事件拿到另一端。全程异步，所以调用方必须先 `await` 再 `spawn`。
 *
 * 不用 `spawnSync` 绕路：它会把本进程的事件循环整段堵死，回环连接的另一端永远收不到
 * `connection`。监听在拿到两端后立刻关闭，端口不对外保留。
 */
function createSocketPair(): Promise<[Socket, Socket] | null> {
  return new Promise((resolve) => {
    const server = createServer();
    const client = new Socket();
    let settled = false;
    const finish = (value: [Socket, Socket] | null) => {
      if (settled) return;
      settled = true;
      server.close();
      if (value === null) client.destroy();
      resolve(value);
    };
    server.on('error', () => finish(null));
    server.on('connection', (peer) => {
      peer.on('error', () => undefined);
      peer.pause();
      finish([peer, client]);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      if (port <= 0) {
        finish(null);
        return;
      }
      client.once('error', () => finish(null));
      client.connect(port, '127.0.0.1');
    });
  });
}

/**
 * 「建通道 → 拉起子进程」收成一步：通道要先 `await` 拿到 fd，`spawn` 只能等它就绪后再发生。
 *
 * 刻意不改 `spawn` 的调用参数与相对顺序（stdin 仍是请求通道、fd 3 仍是心跳探针、
 * stderr 仍然透传），只把 stdio 数组与通道可用性一起交出去。
 */
async function childSpawnPlan(childEntry: string): Promise<{
  liveness: LivenessChannel | null;
  spawnChild: (stdio: Array<'pipe' | 'inherit' | number>) => ChildProcess;
}> {
  const liveness = await createLivenessChannel();
  const spawnChild = (stdio: Array<'pipe' | 'inherit' | number>): ChildProcess =>
    spawn(process.execPath, execArgs(childEntry), {
      stdio,
      // 子进程不能继承宿主的沙箱代理变量，否则它会去连一个尚未存在的端口。
      // 标记：入口脚本被静态 import 时不会自己执行，只有带上该标记才启动 main。
      env: { ...childEnv(process.env), SRT_ISOLATION_CHILD_ENTRY: '1' },
    });
  return { liveness, spawnChild };
}

/** 生命期通道：`fd` 交给子进程当 fd 4，`keepOpen` 留在本进程（它一关，子进程立刻 EOF）。 */
interface LivenessChannel {
  /** 交给子进程当 fd 4 的原生描述符（已连接 socket 的一端）。 */
  fd: number;
  /** 本进程持有的另一端：它活着，子进程读 fd 4 就不会 EOF。 */
  keepOpen: { close: () => void };
  /** 交给子进程那一端的句柄本身（见 `createLivenessChannel`，不可提前销毁）。 */
  keepOpenHandle: Socket;
  /** 子进程拿到 fd 之后释放本进程多余的引用（不关闭连接本体，见 `createLivenessChannel`）。 */
  releaseWrite(): void;
  /** 通道建好后没有需要清理的临时资源（保留接口，失败路径统一处理）。 */
  dispose(): void;
}

/**
 * 子进程启动参数：源码入口要开类型剥离，构建产物（.js）不需要。
 * 用入口自身的扩展名判断：在 `dist` 下带 `--experimental-strip-types` 会多一条无用告警。
 */
function execArgs(entry: string): string[] {
  return entry.endsWith('.ts') ? ['--experimental-strip-types', entry] : [entry];
}

/**
 * 取探针管道读端（子进程 fd 3）。
 *
 * `stdio[3] = 'pipe'` 建出的本端必然是 Readable，但 `ChildProcess.stdio` 的类型是
 * Readable/Writable 联合，这里按 `on`/`resume` 是否可用来收窄；拿不到就返回 undefined，
 * 退化成「没有探针通道」——只少了提前感知，不影响结果正确性。
 */
function probeReadable(child: ChildProcess): Readable | undefined {
  const stream = child.stdio[3];
  if (stream === null || stream === undefined) return undefined;
  const candidate = stream as Readable;
  if (typeof candidate.on !== 'function' || typeof candidate.resume !== 'function')
    return undefined;
  return candidate;
}

/**
 * 子进程环境：剥掉两类变量。
 *
 * - 继承来的代理变量：避免它连上尚未启动的代理端口。
 * - 本进程专属的入口/调试开关（`SRT_ISOLATION_CHILD_ENTRY`、`SR_SPAWN_CHILD`、
 *   `SRT_WATCHDOG_DEBUG`）：它们只描述「当前这个进程该怎么跑」。父进程若恰好带着它们
 *   （例如引擎本身就跑在沙箱门内），交出去会让子进程一启动就切到替身/调试语义，
 *   观测被静默改写、stderr 还会被 `PEERDBG` 污染。入口标记由调用点显式重新设置。
 */
const CHILD_STRIPPED_ENV =
  /^(https?_proxy|all_proxy|no_proxy|SRT_ISOLATION_CHILD_ENTRY|SR_SPAWN_CHILD|SRT_WATCHDOG_DEBUG)$/i;

function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(out)) {
    if (CHILD_STRIPPED_ENV.test(key)) delete out[key];
  }
  return out;
}

/**
 * 解析结果帧：取**第一行**合法帧，而不是最后一行。
 *
 * 子进程把宿主的 stdout/stderr 收进结果字段，正常情况下 stdout 只有一帧；
 * 但异常路径（未捕获异常打栈、句柄告警）可能追加文本，其中某行恰好是 JSON。
 * 取最后一行会被这类尾部输出劫持成「结果」，取首帧才是入口主动写出的那一份。
 */
function parseReply(buffer: string): SandboxExecReply | null {
  for (const raw of buffer.split('\n')) {
    const line = raw.trim();
    if (line === '' || !line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as SandboxExecReply;
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.ok !== 'boolean') continue;
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function toOutcome(reply: SandboxExecResult): SandboxExecOutcome {
  let error: NodeJS.ErrnoException | null = null;
  if (reply.errorCode !== null) {
    error = Object.assign(new Error(reply.errorMessage ?? reply.errorCode), {
      code: reply.errorCode,
    });
  }
  return {
    status: reply.status,
    signal: reply.signal,
    error,
    stdout: reply.stdout,
    stderr: reply.stderr,
    timedOut: reply.timedOut,
    stdioDestroyed: reply.stdioDestroyed,
    pipeBroken: reply.pipeBroken === true,
  };
}

/**
 * 结算后回收宿主进程组（子进程已退出或即将退出）。
 *
 * 为什么不能只靠子进程自己杀：结果帧写出之后，我们随时会关读端，子进程的下一次写
 * 就是 EPIPE 直接终止，`process.on('exit')` 里的补刀来不及执行。宿主若此刻仍在跑
 * （例如被测命令还没结束、或后台孙进程仍在），只能由读端这一侧按 pid 带走。
 *
 * 只发 SIGKILL：结算之后这次观测已经作废，没有「让它优雅收尾」的必要。
 * `-pid` 指向结算时刻仍存活的进程组，成员必属本次宿主树；组长退出后进程组号由系统回收。
 */
function reapHostAfterSettlement(reply: SandboxExecReply): void {
  if (!('hostPid' in reply)) return;
  const pid = reply.hostPid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  if (process.platform === 'win32') return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // 不按单 pid 再补一刀：组长已退出时该 pid 可能已被系统复用，按 pid 杀会误伤无关进程；
    // 残留组员由子进程侧的逐层回收负责。
  }
}

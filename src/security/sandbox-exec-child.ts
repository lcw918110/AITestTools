/**
 * 沙箱包裹 + 宿主执行的短命子进程（ADR-0014）。
 *
 * 为什么必须独立成进程：`@anthropic-ai/sandbox-runtime` 的 `SandboxManager` 是进程级
 * 单例，`initialize()` 遇到已存在的初始化会静默忽略新配置；其本机代理也在该进程内
 * 起停，`wrapWithSandboxArgv` 返回的环境里写死 `HTTP_PROXY=localhost:<port>`。
 * 代理与被包裹进程必须同生共死，因此在子进程内连宿主一起启动。
 *
 * 进程边界：主进程经 stdin 交一份请求（首行 JSON），本进程在 stdout 只写**一帧**结果 JSON。
 * 宿主的 stdout/stderr 不经过本进程的 stdout（否则会污染结果帧），只计入结果字段。
 * fd 3 是本进程私有的探针通道，用来感知「父进程还在不在读」。
 */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { wrapHostCommand } from './sandbox-runtime.ts';

export interface SandboxExecRequest {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  allowedWrite: string[];
  allowedDomains: string[];
  timeoutMs: number;
  /** 旁路诊断：只跳过包裹，仍在子进程内执行（进程边界不变）。 */
  sandboxBypass?: boolean;
}

export interface SandboxExecResult {
  ok: true;
  status: number | null;
  signal: NodeJS.Signals | null;
  /** 平台错误码（如 ENOENT / ETIMEDOUT）；无错误为 null。 */
  errorCode: string | null;
  errorMessage: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdioDestroyed: boolean;
  /** 结果管道在宿主结束前断开：宿主被连带杀死，本次观测作废（见 `planPipeBroken`）。 */
  pipeBroken: boolean;
  /**
   * 宿主的进程组 id（即宿主 pid，宿主是独立进程组的组长）。
   * 结算之后父进程若发现它仍在，就按进程组回收——这是「子进程已退出」之后的唯一兜底。
   */
  hostPid: number | null;
}

/** 包裹层自身故障（包裹失败、请求不可解析等）：不是被测系统的失败。 */
export interface SandboxExecFailure {
  ok: false;
  stage: SandboxExecFailureStage;
  message: string;
}

export type SandboxExecFailureStage = 'request' | 'wrap' | 'spawn' | 'protocol';

export type SandboxExecReply = SandboxExecResult | SandboxExecFailure;

/** 宿主 stdout/stderr 的采集上限：防止被子进程无限输出撑爆内存后再序列化。 */
const MAX_STREAM_CHARS = 32 * 1024 * 1024;

/**
 * 控制通道读流：入口一加载就绑定 `process.stdin`（进程内唯一的 fd 0 读流）。
 *
 * 必须声明在**所有调用点之前**：入口在模块求值中途就同步 `void main()`，走到 `readRequest`
 * 时若这个 `const` 还没初始化就是 TDZ 报错（之前那段代码就是这么挂的）。
 */
const derivedStdin: Readable = process.stdin;

/** exit 后等待 pipe 关闭的宽限期；与主进程原实现的 STDIO_GRACE_MS 保持一致。 */
const STDIO_GRACE_MS = 500;

/**
 * 结果管道探针间隔：判定「上层已放弃读取」的时间分辨率。
 *
 * Node 的 stdout 是 socket：主进程读端消失后，下一次写会以 **EPIPE 同步抛错杀死本进程**，
 * 事件监听拦不住 JSON 序列化与心跳写里的 EPIPE。因此从启动起就用「探针 + 确认」探测对端：
 * 健康管道上心跳立刻被读走、确认立刻回传，对端一旦消失，确认世代就会停摆。
 */
const PIPE_WATCHDOG_MS = 200;

/**
 * 确认世代停滞多久判死：`PIPE_WATCHDOG_MS × 该倍数`（默认 1s）。
 *
 * 父进程读一拍回一拍，正常延迟远小于这个值；取 1s 既容得下事件循环被占住，
 * 又远小于宿主 deadline，父进程一旦消失就能及时回收宿主。
 */
const PROBE_STALL_FACTOR = 5;

/**
 * 结果管道「集群式排空但零字节」持续多久判死：`PIPE_WATCHDOG_MS × 该倍数`（默认 10s）。
 *
 * 写端在本进程**退出后**由内核继续排空——只要读端还在（哪怕只是被子孙继承），
 * 已写进内核缓冲的字节就都算 `sent`；读端一旦全部消失，内核把缓冲直接丢弃，
 * 此后 `sent` 涨、`acked` 却一个字节也不涨。所以「排空额在涨、却始终零字节回读」
 * 就是「对端没人收了」的实证，不依赖对端回力，确认链路失真时靠它兜底。
 * 取 10s：正常对端读到心跳就回放确认，那一路本该先判死；这一路只兜
 * 「确认被吃掉」（子孙继承 stdin、读端 SIGSTOP 后又恢复）。
 * 取不到套接字统计的平台（读不到就不判）保持原有语义，不做推测。
 */
const DRAIN_STALL_FACTOR = 50;

/**
 * 心跳「落地」停滞多久判死：`PIPE_WATCHDOG_MS × 该倍数`（默认 5s）。
 *
 * `'drain'` 只在写缓冲被读空时触发，比单拍粗得多（空闲管道里往往几拍才来一次），
 * 所以它只用来兜住「对端根本没人读」这种长时间沉默，不能按确认的宽限尺度去卡；
 * 反过来也不能放太宽，否则读端早死、心跳早就堵住，宿主仍要陪着跑到 deadline；
 * 5s 是权衡：确认链路正常时根本用不到这一路，只有「读端在、却始终不回放」才靠它兜底。
 */
const LANDED_STALL_FACTOR = 25;

/** 守夜进程拉起失败时的重试间隔：外部兜底缺席期间，进程内判据必须能持续重试补位。 */
const GUARD_RETRY_MS = 1_000;

/**
 * 帧写出后强制退出的上限：只等 flush 回调可能永远等不到（对端不收），
 * 越过这个上限就直接退出，避免子进程变成僵尸。
 */
const EMIT_EXIT_GRACE_MS = 1_000;

/**
 * 探针专用文件描述符：父进程给它一条只写不读的管道。
 * 父进程一旦放弃读结果并关闭这段管道，探针写就会 EPIPE —— 这是提前感知
 * 「上层跑掉了」的信号，且完全不触碰结果通道。
 */
const PROBE_FD = 3;

/**
 * 生命期探针的读端：由**父进程**建好并交进来，读端全在父进程一侧（它自己那份 + 宿主
 * 进程组继承的那些），本进程只负责读空。见 `createLivenessProbe`。
 */
const LIVENESS_FD = 4;

/** 对端状态监视：上层一旦放弃读取结果管道，就随即把宿主进程树带走。 */
interface PeerWatchdog {
  /** 上层是否已经关闭了结果管道（监视期间发现）。 */
  readonly broken: boolean;
  /** 登记回调：发现管道断开时立刻执行（用来回收宿主进程树）。 */
  onBroken(handler: () => void): void;
  /**
   * 上报宿主最后的 pid，作为「本进程被 EPIPE 同步杀死」时留给退出钩子的回收线索。
   */
  setHostPid(pid: number | undefined): void;
  /** 登记父进程的心跳确认：`read` 是它读到第几拍，`seen` 是那一拍上带的心跳序号。 */
  noteAck(read: number, seen: number): void;
  /**
   * 同步剥掉 stdin 里**已经到达**的确认行，返回其中最大的世代。
   *
   * 父进程的事件循环与子进程彼此独立：确认可能在两次心跳之间就写进了管道，
   * 若只等 `'data'` 回调，判死计时会在「确认到了但还没派发」的窗口误触发。
   * 结算前用它把已到的确认一次性入账，避免把正常观测误判成断管。
   */
  drainStdin(): number;
  /**
   * stdin 是否已经 EOF（父进程的写端已关）。它是确认之外的第二条存活判据。
   *
   * 父进程被 SIGKILL 时 stdin 也会 EOF，所以 EOF 之后仍然判死；
   * 它真正的作用是**承认**父进程「先关探针读端、再关 stdin」的正常收尾顺序——
   * 那段时间确认先停，不能把它当成断管，否则正常观测会被作废。
   */
  stdinClosed(): boolean;
  /** 登记 stdin EOF（由请求读循环在 `'end'` 时上报）。 */
  noteStdinClosed(): void;
  /** stdin 上有任何字节到达（含非确认行）：对端仍在写的最低限度证据。 */
  noteStdinData(): void;
  /**
   * 读守夜进程的存活脉搏与宿主 pid（见 `startGuard`）。
   *
   * 父进程自己死掉时本进程也没了事件循环，`emit` 要靠它写出「宿主可能还在跑」的兜底帧。
   * 守夜进程不存在（Windows / 起不来）时返回空串，调用方按「不知道」处理。
   */
  readBeat(): { beat: string; host: string };
  /**
   * 守夜进程是否已经判死（父进程不再读心跳）。判死之后宿主已被它回收，
   * 本进程应立即结算收场（见 `runAndReap` 的 `settleOnDeny` 与 `emit`）。
   */
  didDeny(): boolean;
  /** 守夜进程是否已经判死（不改判结论，只用来补刀宿主进程组）。 */
  readDeny(): boolean;
  /** 结果帧是否已经交给上层（交出去之后的判死一律不再改判）。 */
  readonly emitted: boolean;
  /** 登记结果帧即将交出（`emit` 写帧之前调用）。 */
  markEmitted(): void;
  stop(): void;
}

/**
 * 管道断开时本进程可能立刻被 EPIPE 杀死，所以：
 * 1. `process.on('exit')` 是最后兜底：无论因为什么退出，都按记录的宿主 pid 补刀。
 *    这是唯一不依赖事件循环继续运转的路径——**结算之后**（结果帧已写、监视已停）
 *    父进程若在读完前关管道，同步 EPIPE 会直接杀死本进程，任何 error 监听都拦不住，
 *    只有退出钩子能保证宿主进程树被带走。
 * 2. 监视期间发现断开（确认迟迟不动）就立刻回收，不等宿主自行退出。
 *
 * 探针只在**本进程私有**的 `probeFd` 上做，绝不写结果管道：结果管道上多写任何一个
 * 字节都会让父进程的帧解析落空（父进程按标记行切分结果与输出）。
 */
function createPeerWatchdog(probeFd: number): PeerWatchdog {
  let broken = false;
  let hostPid: number | undefined;
  let handler: (() => void) | undefined;
  let stdinClosed = false;
  /** 结果帧是否已经交出去（`emit` 写出前登记，见 `PeerWatchdog.emitted`）。 */
  let replyEmitted = false;
  /**
   * 兜底核死令：与节点事件循环**完全无关**的一路判死。
   *
   * 上面的定时器判死有两层前提，父进程消失时恰恰都可能不成立：
   * ①定时器要能被调度——事件循环被同步阻塞（包裹层的同步调用、GC、CPU 饥饿）就停摆；
   * ②确认世代要清零——父进程的读端被子孙继承（结果/probe 两个 fd 都可能）时，
   * 内核缓冲能让心跳「看起来还在动」，一跑就是数小时。
   *
   * 所以另起一个系统 `sh` 守夜进程，只做不依赖 JS 的事：用 `ps` 盯住本进程是否还活、
   * 每拍读一眼确认世代；本进程一死、或确认连续停滞到宽限，就按状态文件里登记的
   * 宿主 pid 回收宿主进程组（连同本进程自己的进程组）。
   *
   * 状态全部走文件（`ack` / `host` / `beat` / `term`），脚本只用系统命令：
   * 本进程卡死时它照常工作；本进程正常退出时它读到 `term` 就安静收工（见 `emit`）。
   */
  let guardState: GuardState | null = null;
  let guardRetryAt = 0;
  /** 显式停过（结算后 `stop()`）：之后不再拉起新守夜进程，只把目录清理留给旧进程自理。 */
  let guardStopped = false;
  /**
   * 本进程**此刻实际持有**的守夜状态目录；`stop()` 交出去、退出钩子兜底后清空。
   *
   * 与模块级 `staleGuardDir`（「上一次没拉起来」的目录）分开记：那个变量只服务于
   * 「下一次拉起前先作废」，本进程一退出它就不再代表任何活着的认领者。退出钩子必须按这个
   * 变量收尾，否则「拉起成功后、`stop()` 之前被直接杀掉」这种断档里目录无人负责。
   */
  let liveGuardDir: string | null = null;
  /** 当前守夜进程的 pid（`stopGuard` 补信号用；`-1` 表示没有可用的守夜进程）。 */
  let guardPid = -1;
  /**
   * 已经写 `term`、正等旧守夜进程自行收工的目录。
   *
   * 它们不再有「活着的句柄」（`guardState` 已清），但仍归本进程所有：定时器到点删一次，
   * 每拍 `ensureGuard` 再同步核一次，`stopGuard` 收尾时最后再核一次。三处都在是为了
   * 「何时机退出」都不能成为漏删的理由。
   */
  const pendingGuardDirs = new Map<string, { pid: number; ino: number }>();
  /** 拉起守夜进程；失败时按 `GUARD_RETRY_MS` 限频重试，不让一次失败变成永久失效。 */
  const ensureGuard = () => {
    if (guardStopped) return;
    // 先处理「交给定时器/旧进程自理」的目录：`live` 一旦被下面置空（重建或失败），
    // 它就只剩这一份登记，不在这里同步核对就会被漏在临时目录里。
    drainPendingGuardDirs();
    if (guardState !== null) return;
    const now = Date.now();
    if (now < guardRetryAt) return;
    guardRetryAt = now + GUARD_RETRY_MS;
    // 上一次拉起留下的状态目录必须先作废：否则旧守夜进程仍在按旧 `ack` 计时，
    // 到点就往旧目录写 `deny`（本进程已经不看了），变成两个守夜进程互相打架。
    discardGuardDir(staleGuardDir, false, notePending);
    staleGuardDir = null;
    // 上一个守夜进程可能已经自行退出：目录仍归本进程所有，重建前先清掉，别让它漏在临时目录里。
    discardGuardDir(liveGuardDir, false, notePending, guardPid);
    liveGuardDir = null;
    guardPid = -1;
    const next = startGuard(process.pid);
    guardState = next;
    if (next === null) {
      // 没起来：把这次失败的目录留给下一次「先作废」，本进程「持有」保持为空。
      staleGuardDir = lastFailedGuardDir();
      return;
    }
    liveGuardDir = next.dir;
    guardPid = next.pid;

    // 守夜进程自己先退出（`sleep` 会话被终端收割等）：目录仍归本进程所有，`stopGuard`
    // 与退出钩子要照常删它。这里只清「活着的句柄」，不动 `liveGuardDir`。
    next.proc.on('exit', () => {
      if (guardState !== null && guardState.pid === next.pid) guardState = null;
    });
  };

  /**
   * 把「已经交给定时器」的目录再同步核一次：定时器不一定来得及跑（事件循环可能先空、
   * 进程可能在 `stop()` 前被收走）。只删仍是登记时那个 inode 的目录，避免同名复用误删；
   * 删不掉就保留登记，等下一拍或 `stopGuard` 再试。
   */
  function drainPendingGuardDirs(): void {
    for (const [dir, entry] of [...pendingGuardDirs]) {
      if (removeGuardDirIfSame(dir, entry.ino)) pendingGuardDirs.delete(dir);
      // 删不掉（守夜进程还没退出）就留着：定时器与 `stopGuard` 会再试。
    }
  }

  /** 登记一个「已写 `term`、等旧守夜进程自行收工」的目录（`discardGuardDir` 的回调）。 */
  const notePending = (dir: string, pid: number): void => {
    let ino = -1;
    try {
      ino = statSync(dir).ino;
    } catch {
      /* 已经不在了 */
    }
    pendingGuardDirs.set(dir, { pid, ino });
  };

  /** 收掉所有待清理目录（`stopGuard` 用：此刻本进程是唯一还能删它们的地方）。 */
  function flushPendingGuardDirs(): void {
    for (const [dir, entry] of [...pendingGuardDirs]) {
      pendingGuardDirs.delete(dir);
      if (removeGuardDirIfSame(dir, entry.ino)) continue;
      reapAndRemoveGuardDir(dir, entry.pid);
    }
  }

  const markBroken = () => {
    if (broken) return;
    broken = true;
    handler?.();
  };

  /**
   * 退出钩子的兜底收尾（同步、不依赖事件循环）：
   * - 宿主进程组按登记的 pid 补刀，不留孤儿；
   * - 守夜状态目录当场删掉，不在临时目录里留空目录。
   *
   * 为什么目录也必须在这里收：正常路径（`stop()`）已经自己删过一遍，但 `spawn` 之后、
   * `stop()` 之前本进程可能被直接杀掉（父进程的超时收场会 `SIGKILL` 子进程），那时
   * 没有任何 JavaScript 会再跑，只有退出钩子还活着。删除幂等，多删一次没有副作用。
   */
  process.on('exit', () => {
    if (hostPid !== undefined && hostPid > 1) {
      try {
        process.kill(-hostPid, 'SIGKILL');
      } catch {
        /* 组长已消失（ESRCH）时组员可能仍在，交给下面的清理进程 */
      }
      spawnCleanup(hostPid);
    }
    // 退出时事件循环不再转：同步删掉本进程持有的全部目录（`live` + 待清理），
    // 删不掉的（极小概率占用）才交给脱离的 `sh`。守夜进程发现 `ppid` 为 1 也会自行收工。
    const held = [liveGuardDir, ...pendingGuardDirs.keys()].filter(
      (d): d is string => d !== null,
    );
    liveGuardDir = null;
    pendingGuardDirs.clear();
    for (const stale of held) {
      if (removeGuardDirSync(stale)) continue;
      discardGuardDir(stale, true);
    }
  });

  // 探针 fd 上的 EPIPE 说明父进程已放弃读结果：回收宿主，按「管道断开」结算。
  // 不重抛——重抛会跳过结算，把真正的结论丢掉。
  // 非 EPIPE 一律当作「探针通道本身坏了」直接放过：它只承担断管感知，
  // 让它把整个进程带崩，等于让一个可选的心跳通道决定任务成败。
  process.on('uncaughtException', (err) => {
    if (!isEpipe(err)) throw err;
    markBroken();
  });
  process.stdout.on('error', (err) => {
    if (!isEpipe(err)) return;
    // 「上一次写之后才报 EPIPE」与「写时同步抛 EPIPE」是两件事：
    // - `writableLength === 0`：本进程没有在途字节，说明已发出的字节早被内核收下、
    //   对端是在那之后关的读端（典型是「读到帧就关」，属于正常收尾）；
    // - 否则在途字节被丢弃，对端根本没读，这才是真的断管。
    // 不能一律记成断管：结算之后本进程随时可能被这一步打断，不能让它改判完整观测。
    if (process.stdout.writableLength === 0) {
      stdoutGone = true;
      return;
    }
    markBroken();
  });

  // 心跳协议：本进程每拍往探针 fd 写一拍心跳，父进程每读一拍就回一个确认世代。
  //
  // 只靠「写 EPIPE」不够：父进程被 SIGKILL 后，若它的探针读端仍被某个子孙继承持有，
  // 内核缓冲能把心跳吞掉很久（每拍 1 字节 × 64KB 缓冲 ≈ 数小时），期间宿主无人回收。
  // 所以真正当作存活证据的只有「确认世代在推进」：世代停滞即判死。
  // 确认从 stdin 读循环里入账（与请求同一通道，见 readRequest），不另开常驻读流——
  // 另开的读流会派到 libuv 线程池，把 process.exit 卡住；读流本身必须就是 `process.stdin`，
  // 见 `openControlStdin`：现建一个 `tty.ReadStream(0)` 在部分环境下根本收不到数据。
  let probeGeneration = 0;
  let ackedGeneration = 0;
  /** 父进程回传的「读次数」：每读到一拍心跳就加一，是「对端真在读」的直接证据。 */
  let readGeneration = 0;
  let lastAckAt = Date.now();
  // 心跳「落地」= 父进程回传的读次数在涨，且它读到的就是本进程**最新**发出的那一拍
  // （`probeGeneration - 读到的那一拍 ≤ 1`）：对端没有积压、跟得上心跳节拍。
  // 不依赖 `'drain'`——短写几乎不触发 `'drain'`，用它会把正常对端误判成死亡。
  let pendingSince = 0;
  let probeLandedAt = Date.now();
  let lastProbeAt = 0;
  // 最近一次「确认」与「stdin 有字节」的时刻；判死用多路信号合并判断（见 `isPeerGone`）。
  let lastStdinAt = Date.now();
  // 结果管道已确认写给一个**没有读端**的对端：那是真正的断管，不必再等心跳。
  let stdoutGone = false;

  // 落定探针：结果通道与心跳通道都是普通流，**不感知读端是否还在**——读端关掉之后，
  // Node 照样把字节写进内核缓冲，`write()` 恒为 true、`'drain'` 也照样来，本进程完全看不出
  // 差别。所以改看「读端自己还在不在」：父进程把它那份读端交给子进程的 fd 4（见
  // `sandbox-exec.ts`），子进程只负责读空它；所有读端都没了（父进程死、它手里那份关掉），
  // 读就返回 EOF，这一路才第一次、也是唯一一次能直接回答「对端还在不在」。
  const settleWatch = createLivenessProbe(openLivenessStream(LIVENESS_FD));
  // 观测到「对端读端全部消失」的时刻；0 表示还没看到。
  let drainGoneSince = 0;

  const probe = createWriteStream('', { fd: probeFd, autoClose: false });
  // 每拍心跳带上「本进程已发出几拍」与「看到的最新一代确认」：
  // 父进程读到一拍，就把这两个数字连同自己的读次数回传到 stdin（见 sandbox-exec.ts）。
  // 子进程据此判断「父进程刚才读到的是不是最新一帧」，不依赖 `'drain'`——
  // `'drain'` 要等写缓冲被读空才触发，短写场景几乎永远等不到（实测空闲管道里一次也不来）。
  probe.on('error', onProbeError);

  /**
   * 心跳落地：父进程回传「我读到第 N 拍」（`read`）与「读到它时它已经看到了第 k 代确认」。
   *
   * 判定「对端跟上」只需两条：读次数在涨、**有一拍刚发出去就被读走**。
   * 第二条不看 `'drain'`（短写不触发），而是看读次数与已发出拍数的差值是否在 2 拍以内：
   * 对端真在读，差值就稳定在 ±1；对端卡死，差值会一路涨上去。
   */
  function noteProbeRead(read: number, seen: number): void {
    if (!Number.isInteger(read) || read <= readGeneration) return;
    readGeneration = read;
    // 父进程读到时看到的心跳序号 ≤ 已发出拍数：差值就是它读到时的积压量。
    if (Number.isInteger(seen) && seen > ackedGeneration) {
      // 对端确实读到了这一拍：确认世代单调推进，沿用最大者。
      ackedGeneration = seen;
      lastAckAt = Date.now();
      writeState('ack', `${ackedGeneration}:${lastAckAt}`);
    }
    if (probeGeneration - read <= 2) probeLandedAt = Date.now();
    lastStdinAt = Date.now();
  }

  function onProbeError(err: unknown): void {
    // 写成功后才会出 EPIPE：父进程刚走，这是最可靠的断管信号。
    if (isEpipe(err)) {
      markBroken();
      return;
    }
    // 其它错误只说明这一笔没写出去（如空闲时 EBADF）：探针不是结论通道，下一拍重试即可，
    // 绝不能让一个可选心跳把整个进程带崩。既然这一拍没出去，也谈不上「对端跟上了」。
    pendingSince = Date.now();
  }

  /** 把各路的「最后时刻」换算成相对 `now` 的年龄，交给纯判据。 */
  function peerSignals(now: number) {
    // 落定探针：读端 EOF = 父进程手里那份读端也没了，这是唯一直接证据。
    // 取不到（没有 fd 4、Windows）返回 undefined，主判据不据此下判断。
    const liveness = settleWatch.probe.closed();
    if (liveness === true) {
      if (drainGoneSince === 0) drainGoneSince = now;
    } else {
      drainGoneSince = 0;
    }
    const signals = {
      ackAge: now - lastAckAt,
      probeAge: now - lastProbeAt,
      stdinAge: now - lastStdinAt,
      stdinClosed,
      writeStuckAge: pendingSince === 0 ? 0 : now - pendingSince,
      landedAge: now - probeLandedAt,
      graceMs: PIPE_WATCHDOG_MS * PROBE_STALL_FACTOR,
      peerReaderGone: liveness === true,
      readerGoneAge: drainGoneSince === 0 ? 0 : now - drainGoneSince,
      drainGraceMs: PIPE_WATCHDOG_MS * DRAIN_STALL_FACTOR,
    };
    if (process.env.SRT_WATCHDOG_DEBUG === '1') {
      process.stderr.write(
        `PEERDBG ${JSON.stringify({ ...signals, stdoutGone, ackedGeneration, probeGeneration })}\n`,
      );
    }
    return signals;
  }

  function stopProbe(): void {
    clearInterval(timer);
    probe.destroy();
    settleWatch.stop();
  }

  const timer = setInterval(() => {
    if (broken) return;
    // 守夜进程没起来就再试一次：外部兜底不能因为一次失败永久缺席。
    ensureGuard();
    if (probe.writableEnded) {
      markBroken();
      return;
    }
    // 主动 `destroy()` 是本进程收工时干的（stopProbe），不是对端断开：绝不能据此改判。
    if (probe.destroyed) return;
    // 先看一眼 stdin：确认可能已到内核缓冲，但 `'data'` 还没派发。
    notePendingAcks();
    // 把本轮看到的最新确认同步给守夜进程：它只读文件，看不到就等于确认一直没动。
    if (!stdinClosed) writeState('ack', `${ackedGeneration}:${lastAckAt}`);
    const now = Date.now();
    // 背压：上一拍还压在缓冲里没写出去，就别再堆一拍——堆积只会让「写不出去」
    // 变成一个越滚越大的数字，掩盖掉真正的时刻。记下最早一拍的发出时刻交给 `writeStuckAge`。
    if (probe.writableNeedDrain) {
      if (pendingSince === 0) pendingSince = now;
    } else {
      probeGeneration += 1;
      lastProbeAt = now;
      // 心跳载荷 = 已发出拍数 : 已看到的确认世代。父进程每读一拍都会把这个读数连同自己的
      // 读次数回传到 stdin；子进程看到「读次数在涨、读到的就是刚发出的这一拍」，
      // 才算「对端跟上了」。这比 `'drain'` 可靠：`'drain'` 在空闲管道里几乎不触发。
      try {
        const stuck = probe.write(`${probeGeneration}:${ackedGeneration}\n`, (err) => {
          if (err) onProbeError(err);
        });
        if (!stuck) pendingSince = now;
      } catch (err) {
        onProbeError(err);
      }
    }
    // 判死放在发心跳之后：`probeAge` / `landedAge` 都以「这一拍已经发出」为前提，
    // 提前判断会让第一拍把「还没发过心跳」当成「对端不读了」。
    const signals = peerSignals(Date.now());
    const gone = isPeerGone({ ...signals, stdoutGone });
    if (gone) markBroken();
  }, PIPE_WATCHDOG_MS);
  timer.unref();

  /**
   * 兜底核死令的状态与操作：与节点事件循环**完全无关**的那一路（见 `startGuard`）。
   * 状态全部走文件，脚本只用系统命令：本进程卡死时它照常工作；
   * 本进程正常退出时它读到 `term` 就安静收工。
   */
  function writeState(name: GuardStateFile, text: string): void {
    if (guardState === null) return;
    try {
      writeFileSync(join(guardState.dir, name), text);
    } catch {
      /* 状态文件写不进去只影响外部兜底，不影响主判据 */
    }
  }

  /**
   * 守夜进程收工：写 `term` 后**当场**删掉它的状态目录，再给旧进程补一刀信号。
   *
   * 为什么不再「先等它退出、再删」：本进程紧接着就要 `process.exit`（`emit → exit`），
   * 等退出只能交给脱离的 `sh`，而这条回收链任何一环（信号、调度、认领）出问题都会在
   * 临时目录里永久留一个目录——实测就漏了。现在的做法对这类故障都成立：
   * - 目录先删掉：旧脚本下一拍只是读不到文件（`test -f` / `cat` 都无害），写 `beat`
   *   失败也被吞掉，发现 `ppid` 为 1 后自行退出；
   * - `term` 通过**写完就关**的文件描述符写入，删目录不会让这次写入反过来失败；
   * - 删不掉（极小概率的占用竞态）时交给 `sh` 稍后补删并补信号。
   *
   * 不设「认领文件」：目录由本进程创建、本进程直接删，唯一性天然成立，不需要两个进程协商。
   *
   * 看的是 `liveGuardDir` 而不是 `guardState`：守夜进程**自己**先退出时（`sleep` 会话被
   * 终端收割等），`guardState` 已被 `startGuard` 里的 `'exit'` 监听清空，但目录仍然存在、
   * 仍然归本进程所有。只认 `guardState` 就会把它漏在临时目录里——实测漏掉的正是这一个。
   */
  function stopGuard(): void {

    guardStopped = true;

    // 先收「交给定时器」的旧目录：本进程即将退出或重建，它们的定时器不一定会再跑。
    // 强删而不是只核对：此刻本进程是唯一还能删它们的地方。
    flushPendingGuardDirs();
    const dir = liveGuardDir;
    guardState = null;
    // 回收权归本进程：退出钩子不必也不能再交一次。
    liveGuardDir = null;
    if (dir === null) return;
    const pid = guardPid;
    guardPid = -1;
    // 先写 `term` 再删目录：脚本若恰好在两拍之间读到它，会自己走「正常收工」分支。
    try {
      // 用 `open` + `close` 而不是 `writeFileSync(path)`：写完立刻关闭描述符，
      // 目录随后被删也不会让这次写入反过来变成失败。
      const term = openSync(join(dir, 'term'), 'w');
      try {
        writeSync(term, '1');
      } finally {
        closeSync(term);
      }
    } catch {
      /* 目录已不在（或不可写）：删目录与兜底回收都会按「不存在」处理 */
    }
    reapAndRemoveGuardDir(dir, pid);
  }

  /**
   * 删掉守夜状态目录，并让旧守夜进程尽快退出。
   *
   * 先同步删（本进程还在跑，`fs` 的删除重试比 shell 可靠）；删不掉再交给脱离的 `sh` 补删。
   * `pid <= 0` 说明进程从来没起来过（`spawn` 没给出 pid），不需要再补信号。
   */
  function reapAndRemoveGuardDir(dir: string, pid: number): void {
    if (removeGuardDirSync(dir)) return;
    // 删不掉时**不能**`kill -9` 守夜进程：它收到 TERM 后会自己执行 `trap drop`
    // （见 `startGuard`），先杀它反而让「谁删目录」落空。留一拍给它。
    if (Number.isInteger(pid) && pid > 1) {
      try {
        process.kill(pid, 'TERM');
      } catch {
        /* 已经退出：交给下面的脱离 `sh` */
      }
    }
    try {
      spawn(
        'sh',
        ['-c', 'sleep 1; cleanup --claim "$1"', 'sh', dir],
        {
          stdio: 'ignore',
          detached: true,
          env: { ...process.env, PATH: guardLibPath(process.env.PATH) },
        },
      ).unref();
    } catch {
      /* 兜底失败只留一个空目录 */
    }
  }

  return {
    get broken() {
      return broken;
    },
    onBroken(next) {
      handler = next;
      if (broken) next();
    },
    get emitted() {
      return replyEmitted;
    },
    markEmitted() {
      replyEmitted = true;
    },
    setHostPid(pid) {
      hostPid = pid;
      ensureGuard();
      writeState('host', pid === undefined ? '' : `${pid}:${process.pid}`);
    },
    noteAck(read, seen) {
      noteProbeRead(read, seen);
    },
    drainStdin() {
      notePendingAcks();
      // 同步读到的确认也要让守夜进程看见：它只读文件，读不到 `ack` 就只会一直等。
      writeState('ack', `${ackedGeneration}:${lastAckAt}`);
      return ackedGeneration;
    },
    stdinClosed() {
      return stdinClosed;
    },
    noteStdinClosed() {
      stdinClosed = true;
    },
    noteStdinData() {
      lastStdinAt = Date.now();
    },
    readBeat() {
      if (guardState === null) return { beat: '', host: '' };
      return {
        beat: readGuardFile(guardState.dir, 'beat'),
        host: readGuardFile(guardState.dir, 'host'),
      };
    },
    readDeny() {
      // 结算之后守夜进程可能仍会写下 `deny`：`didDeny` 那时已经按「帧已交出」拒绝改判，
      // 所以单独开这一路，只用来在结论定格之前补一刀带走宿主进程组（见 `settleOnDeny`）。
      if (guardState === null) return false;
      return readGuardFile(guardState.dir, 'deny') !== '';
    },
    didDeny() {
      // 守夜进程判死后会写 `deny` 再退出；`dead` 是它发现本进程已死、父进程也没了的标记。
      if (guardState === null) return false;
      if (readGuardFile(guardState.dir, 'deny') === '') return false;
      // 三种情况下本进程已经（或即将）自己给出结论，守夜进程的判死不能再改判：
      // - `broken`：本进程已自行判死（探针 EPIPE、确认停摆），结论由本进程给出；
      // - `stdoutGone`：结果管道没人读，断管结论本来就该由本进程按 `pipeBroken` 给；
      // - `replyEmitted`：帧已经交出去了，迟到的判死只会把完整观测打成作废。
      if (broken || stdoutGone || replyEmitted) return false;
      // 判死必须属于**本进程当前这一次观测**：状态目录里若有替身（测试用桩）预先写入的
      // `deny`，而本进程还没发过一拍心跳，那就不是写给本进程的。真正的守夜进程要
      // 连续 `stallLimit` 拍（≥500ms）确认不动才写 `deny`，期间本进程早该发出第一拍；
      // 一发都没有说明事件循环还没跑起来——这种「判死」和心跳链路无关，不能据此收走
      // 宿主（那时它可能刚被拉起，收走就等于把一次正常观测判死）。
      if (lastProbeAt === 0) return false;
      return true;
    },
    stop() {
      stopGuard();
      stopProbe();
    },
  };

  /**
   * 推进「最后确认时刻」：同步看一眼 stdin 里已到的确认，再并入世代计数。
   *
   * 判死只看时间戳、不看 `'data'` 派发先后：父进程读一拍回一拍是异步的，
   * 确认可能已躺在管道缓冲里而回调尚未跑；只认回调会把「活着但慢了一拍」误判成已死。
   * 派发之后 `'data'` 仍会照常解析（世代只增不减，重复入账无副作用）。
   */
  function notePendingAcks(): void {
    if (stdinClosed) return;
    const pending = readPendingAcks();
    if (pending === null) return;
    noteProbeRead(pending.read, pending.seen);
    lastAckAt = Math.max(lastAckAt, pending.lastAt);
    lastStdinAt = Math.max(lastStdinAt, pending.lastAt);
    // 刚同步读到的确认也要让守夜进程看见（它只读文件）。
    writeState('ack', `${ackedGeneration}:${lastAckAt}`);
  }
}

/**
 * 守夜进程持有的状态目录与 pid（不依赖事件循环的那一路兜底，见 `createPeerWatchdog`）。
 * 状态文件名固定，脚本直接读。
 */
type GuardStateFile = 'ack' | 'host' | 'beat' | 'term' | 'deny' | 'dead';

/** 父进程需要按守夜进程的 `deny` 标记收尾的壳进程标记（见 `runAndReap` 的守护壳）。 */

interface GuardState {
  dir: string;
  pid: number;
  /**
   * 守夜进程句柄：工厂里注册 `'exit'`，进程自己先退出时只清「活着的句柄」，
   * 状态目录照旧归子进程所有、由 `stopGuard` / 退出钩子删除。
   */
  proc: ChildProcess;
}

/**
 * 拉起守夜进程。任何一步失败都只是「少一路兜底」：返回 null，主判据照常工作。
 *
 * 脚本要点（每拍 `sleep` 之后立刻检查，所以本进程一退出、判死一成立，一拍内就动手）：
 * - 读到 `term` → 本进程是正常收工，删掉自己的状态目录后安静退出，绝不误杀；
 * - `ps -o ppid= -p <本进程>` 看不到这一行 → 本进程已死（父进程也没了）。先写 `deny`
 *   再回收宿主进程组；宿主那边的子进程会用这份 `deny` 写出「宿主仍在跑」的兜底帧；
 * - 确认世代连续 `stallLimit` 拍不动 → 判死（父进程还活着但已不读了）；
 * - 其余情况把停滞拍数写进 `beat`，让父进程据此判断「守夜进程自己是否也失效了」。
 *
 * 它自己 `detached`，不继承本进程的 stdout/stderr（结果通道必须纯净）。
 * 状态目录必须有人删，否则每次观测都会在临时目录里留一个：正常收工由它自己删（`term`
 * 分支），主进程主动停它时由 `stopGuard` 直接删（见那里的顺序说明）。删除动作统一走
 * `purgeGuardDir`（`cleanup` 子命令），病态文件名也能删干净。
 */
function startGuard(selfPid: number): GuardState | null {
  if (process.platform === 'win32') return null;
  // 脚本用 `PATH` 找 `cleanup`（本 shim，见 `guardLibPath`）。写绝对路径而不是相对名：
  // `-c` 起来的脚本工作目录不确定。
  const script = String.raw`self=$1; root=$2; stallMs=$3; stallLimit=$4; log=$5; last=; m=0
# 收到 TERM/INT/HUP（多半来自主进程收尾或终端收割）：本进程是目录的「暂管者」，
# 主人已经不要这次观测了，顺手删掉目录再退出。删除幂等，主人删过也没关系。
#
# 删目录先用内建 sh 的 rm（不额外起进程，测试框架清理进程组时也不会被连带杀掉），
# 再走 cleanup 兜底病态文件名并留痕。
drop() {
rm -rf "$root" 2>/dev/null
cleanup --claim "$root" --log "$log"
}
trap 'drop' TERM INT HUP
while :; do
sleep $stallMs
if [ -f "$root/term" ]; then
drop
exit 0
fi
ppid=$(ps -o ppid= -p $self 2>/dev/null | tr -d ' ')
if [ -z "$ppid" ]; then
: > "$root/dead" 2>/dev/null
drop
exit 0
fi
# 主人已死（ppid 被收养为 1）：没有活着的人再需要这个目录，判死标记先写，
# 目录也由这里收尾——主人不存在时，删除只能由本进程完成。
if [ "$ppid" = "1" ]; then
: > "$root/dead" 2>/dev/null
: > "$root/deny" 2>/dev/null
drop
exit 0
fi
ack=$(cat "$root/ack" 2>/dev/null)
if [ "$ack" = "$last" ]; then m=$((m+1)); else last=$ack; m=0; fi
echo $m > "$root/beat" 2>/dev/null
if [ $m -ge $stallLimit ]; then
: > "$root/deny" 2>/dev/null
drop
exit 0
fi
done
`;
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'srt-guard-'));
    if (process.env.SRT_GUARD_DEBUG === '1') process.stderr.write(`GUARD-DIR ${dir}\n`);
    // 状态文件必须先存在，守夜脚本才会按「当前状态」判断；`deny` / `dead` 由脚本创建。
    writeFileSync(join(dir, 'ack'), '0');
    writeFileSync(join(dir, 'host'), '');
    writeFileSync(join(dir, 'beat'), '0');
    const stalls = Math.ceil((PIPE_WATCHDOG_MS * PROBE_STALL_FACTOR) / PIPE_WATCHDOG_MS);
    // `stdio: 'ignore'`：结果通道必须纯净，守夜脚本不许往子进程的 stderr 里写东西。
    const guard = spawn(
      'sh',
      [
        '-c',
        script,
        'sh',
        String(selfPid),
        dir,
        String(PIPE_WATCHDOG_MS / 1000),
        String(Math.max(2, stalls)),
        // 删除留痕文件的路径：守夜进程正常收工时会自己删目录，并往这里记一行。
        guardCleanupLog(),
      ],
      {
        stdio: 'ignore',
        detached: true,
        env: { ...process.env, PATH: guardLibPath(process.env.PATH) },
      },
    );
    guard.on('error', () => undefined);
    guard.unref();
    if (typeof guard.pid !== 'number') {
      // `spawn` 没给出 pid：进程根本没起来，目录里没有任何认领者，直接作废并留痕给下一次。
      failedGuardDirCache = dir;
      discardGuardDir(dir);
      return null;
    }
    return { dir, pid: guard.pid, proc: guard };
  } catch {
    // 建目录之后的任何一步失败（写状态文件、`spawn` 抛错）：目录已经落在临时目录里，
    // 没有任何认领者会被创建，必须当场同步删掉，否则每次失败都留一个。
    if (dir !== null) removeGuardDirSync(dir);
    return null;
  }
}

/** 上一次拉起失败、还没被下一次作废的守夜目录（只由 `startGuard` 的失败分支写入）。 */
let staleGuardDir: string | null = null;
/** 最近一次没拉起来的守夜目录：交给下一次 `ensureGuard` 先作废。 */
let failedGuardDirCache: string | null = null;

/** 取出并清空「最近一次失败」的守夜目录（只认一次）。 */
function lastFailedGuardDir(): string | null {
  const dir = failedGuardDirCache;
  failedGuardDirCache = null;
  return dir;
}

/**
 * 起一个延迟后执行的目录删除（`discardGuardDir` 的定时器被调度后调用）。
 *
 * 顶层函数而不是闭包：定时器回调一来就执行，不依赖 `createPeerWatchdog` 的任何局部状态。
 * 走 `cleanup`（而非 `rm -rf`）：那条路上有病态文件名的重试，单一实现。
 */
function scheduleGuardDirRemoval(dir: string, pid = -1): void {
  try {
    // 先等一拍：守夜进程若还活着，读到 `term` 会自己走 `trap drop` 清掉，随后这条
    // `cleanup` 只是幂等补删。`pid` 有效时补一发 TERM（不是 KILL）：`trap` 只在 shell
    // 回到主循环时执行，KILL 会让它连自删的机会都没有，反倒把目录留成无主。
    // 只接受整数 pid（来自 `child.pid`），避免把它拼进 `sh -c` 时带上奇怪内容。
    const safePid = Number.isInteger(pid) && pid > 1 ? String(pid) : '';
    const kill = safePid === '' ? '' : `kill -TERM ${safePid} 2>/dev/null; `;
    spawn('sh', ['-c', `sleep 1; ${kill}cleanup --claim "$1"`, 'sh', dir], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, PATH: guardLibPath(process.env.PATH) },
    }).unref();
  } catch {
    /* 删不掉只留一个空目录 */
  }
}

/**
 * 作废一个守夜状态目录（重建前的旧目录、退出钩子里还没人接手的目录）。
 *
 * 必须**先写 `term` 再删**：`term` 的作用是让旧守夜进程自己走「正常收工」那条路（它只会
 * 删一个已经不存在的目录，无害），避免它在目录消失后继续按旧 `ack` 计时、把 `deny`
 * 写进新观测。
 *
 * `force` 为真时（本进程马上就退出）不等定时器：退出后定时器不会再被调度，只能交给脱离
 * 的 `sh`；非 `force` 场景本进程还活着，等四拍（≥800ms）让旧脚本读到 `term` 再核。
 *
 * 定时器**不能** `unref()`：一起 `unref`，事件循环一空（子进程已经结算、只剩一个定时器）
 * 进程就会先退出，删除动作根本不会被执行——实测残留目录全是这一种。
 *
 * 定时器到点也**不能**直接删：目录可能已被守夜进程自己删掉、又被 `mkdtemp` 复用到新观测上，
 * 无差别删除等于误删别人的目录。这里记下创建时的 inode，到点只在「仍是同一个目录」时才删。
 */
function discardGuardDir(
  dir: string | null,
  force = false,
  onPending?: (pending: string, pendingPid: number) => void,
  pid = -1,
): void {
  if (dir === null) return;
  let ino = -1;
  try {
    ino = statSync(dir).ino;
  } catch {
    /* 已经不在了：下面写 `term` 会失败，删目录也按「不存在」处理 */
  }
  try {
    writeFileSync(join(dir, 'term'), '1');
  } catch {
    /* 不可写就直接尝试删除 */
  }
  if (force) {
    // 本进程正在退出，事件循环不会再转：只能交给脱离的 `sh`（它先等一下，让守夜进程
    // 读到 `term` 自己收工；删不动再补信号强删）。
    scheduleGuardDirRemoval(dir, pid);
    return;
  }
  // 非退出路径：先让守夜进程自己删（它读到 `term` 会在下一拍内删掉），本进程只登记；
  // 宽限过后仍未消失，再由 `drainPendingGuardDirs` / `stopGuard` 清理（它们带 pid，能补信号）。
  onPending?.(dir, pid);
  setTimeout(() => {
    // 只删「仍是创建时那个目录」的路径：同名被 `mkdtemp` 复用给新观测时不能误删。
    removeGuardDirIfSame(dir, ino);
  }, PIPE_WATCHDOG_MS * 4);
}

/**
 * 只在「路径仍指向同一个目录」（inode 相同）时删除。
 *
 * 延迟清理的窗口里，原目录可能已被守夜进程删掉、又被 `mkdtemp` 复用成新观测的状态目录；
 * 那时按路径无差别删除就等于删别人的目录。`ino` 为 -1（创建时取不到）时只做存在性删除。
 */
function removeGuardDirIfSame(dir: string, ino: number): boolean {
  try {
    if (ino >= 0 && statSync(dir).ino !== ino) return false;
  } catch {
    return true; // 已经不在了：目标达成
  }
  return removeGuardDirSync(dir);
}

/**
 * 目录清理的留痕文件：`<临时目录>/srt-guard-cleanup.log`，每次成功删除追加一行。
 *
 * 专门用来回答「有没有漏删」：临时目录里一个 `srt-guard-*` 目录，要么还在被某个活着的
 * 认领者使用，要么这里应该有一条对应的删除记录。失败时写不进去只少一条记录。
 */
function guardCleanupLog(): string {
  return join(tmpdir(), 'srt-guard-cleanup.log');
}

/** 读守夜进程的状态文件（不存在或不可读一律当作「不知道」）。 */
function readGuardFile(dir: string, name: GuardStateFile): string {
  try {
    return readFileSync(join(dir, name), 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * stdin 确认流的残行缓冲：异步派发（`'data'`）与同步兜底（`read()`）共用同一份。
 *
 * 父进程一行写一个世代，但管道不保证按行切块：直接对每个 chunk 做 `split('\n')`
 * 会把半行「1」当成世代 1，而真正的世代是 12——入账被拉回旧世代，时间戳却照旧推进。
 * 所以只认「完整行」，尾巴留到下一个 chunk 再拼。
 */
let ackTail = '';

/** 把一段字节按整行切出来：完整行交给 `onLine`，尾巴留进共享的 `ackTail`。 */
function splitStreamLines(chunk: string, onLine: (line: string) => void): void {
  const pending = ackTail + chunk;
  const lastBreak = pending.lastIndexOf('\n');
  if (lastBreak < 0) {
    ackTail = pending;
    return;
  }
  ackTail = pending.slice(lastBreak + 1);
  for (const raw of pending.slice(0, lastBreak).split('\n')) {
    const line = raw.trim();
    if (line !== '') onLine(line);
  }
}

/** 解析一段确认字节：完整行立即入账，残行留给下一次。 */
function noteAckChunk(chunk: string, onAck: (read: number, seen: number) => void): void {
  splitStreamLines(chunk, (line) => {
    // 确认行格式：`读次数:读到的心跳序号`（`generation` 旧格式也兼容：只有读次数）。
    const [readRaw, seenRaw] = line.split(':');
    const read = Number(readRaw);
    if (!Number.isInteger(read) || read <= 0) return;
    const seen = Number(seenRaw);
    onAck(read, Number.isInteger(seen) ? seen : 0);
  });
}

/**
 * 把 stdin 里**已经到达**的确认行同步入账，返回记录到的最大世代与最后到达时刻。
 *
 * 关键约束：只在不干扰事件驱动读取时动手。`'data'` 已挂上且流处于流动模式时，
 * 数据由 Node 自己派发，此时调 `read()` 会把字节从派发路径上偷走；那种情况返回 null，
 * 交给 `'data'` 回调正常入账（它同样更新 `lastAckAt`）。
 * 未挂监听（`'end'` 之后、空闲）时同步读是安全的：`read()` 无数据立即返回 null，不阻塞。
 */
function readPendingAcks(): { read: number; seen: number; lastAt: number } | null {
  const stdin = derivedStdin;
  if (!stdin.readable || stdin.readableEnded || stdin.destroyed) return null;
  if (stdin.listenerCount('data') > 0 && !stdin.isPaused()) return null;
  let read = 0;
  let seen = 0;
  let lastAt = 0;
  let drained = false;
  while (true) {
    const chunk = stdin.read() as Buffer | string | null;
    if (chunk === null) break;
    drained = true;
    noteAckChunk(String(chunk), (chunkRead, chunkSeen) => {
      read = Math.max(read, chunkRead);
      seen = Math.max(seen, chunkSeen);
      lastAt = Date.now();
    });
  }
  // 读到过数据：放回流动模式，让后续确认继续走 `'data'`。
  if (drained) stdin.resume();
  return read === 0 ? null : { read, seen, lastAt };
}

/**
 * 断管判据（纯函数，便于单独验证时序）。
 *
 * - 宿主按 deadline 被我们主动收场：结论是 `timedOut`，连带终止不是「观测作废」，算断管。
 * - 结果帧已交出：父进程读到它要的那一行就关读端（本仓既定收尾方式），
 *   探针读端随之关闭、确认停摆——这是「读者读完就走」，一次完整观测不能被打成断管。
 * - 其余情况（帧交出前上层中途消失、宿主被连带杀死）：真断管，观测作废。
 */
export function planPipeBroken(
  observed: boolean,
  replyEmitted: boolean,
  timedOut: boolean,
): boolean {
  if (timedOut) return false;
  return observed && !replyEmitted;
}

/**
 * 对端（父进程）是否已经不在了。纯函数，便于单独验证时序。
 *
 * 判据：
 * - `stdinClosed`：stdin EOF，父进程写端已关，立即判死；
 * - `stdoutGone`：结果管道已确认「写了没人读」，立即判死；
 * - `writeStuckAge`：某一拍心跳发出后迟迟写不进管道（背压超宽限），对端没人在消费；
 * - `landedAge`：长时间没有一拍心跳被读走（写流 `'drain'`）。它是心跳通道自身的
 *   「有没有读者」实证，不依赖确认世代——确认经 stdin 回传，可能被继承读端的无关进程
 *   读到（绕道），也可能在父进程读状态异常时被静默丢弃；
 * - `peerReaderGone` + `readerGoneAge`：落定探针里只负责读空的旁路进程退出了——
 *   本进程那侧读端一个都不剩（两条既有通道对读端消失都无感，这一路是唯一直接证据）；
 * - 三路同时静默：确认停了、心跳发过、stdin 也没字节。
 *
 * 任何一路还在动都说明对端可能只是慢了一拍，不能判死——误判的代价是把一次完整观测
 * 打成工装故障。`landedAge` 之所以用更长的 `LANDED_STALL_FACTOR`：`'drain'` 本身带
 * 背压延迟（写缓冲被读空才触发，空闲管道里往往两三拍才来一次），按单拍卡会误杀正常对端。
 */
export function isPeerGone(input: {
  ackAge: number;
  probeAge: number;
  stdinAge: number;
  stdinClosed: boolean;
  /** 最近一拍心跳发出后已过多久（0 表示没有待落地的心跳）。 */
  writeStuckAge: number;
  /** 最近一次心跳被读走（写流 `'drain'`）距今多久。 */
  landedAge: number;
  /**
   * 结果管道已确认「对端没有读端」（写了但没人在读）。
   *
   * 与心跳确认是两条互相独立、覆盖不同故障面的证据：确认管的是「父进程还在读探针」，
   * 它管的是「父进程还在读结果」。父进程若只死了一半（或结果管道被提前关掉），
   * 心跳仍可能被别处继承的读端回放——那时只有这一路能判死。
   */
  stdoutGone?: boolean;
  graceMs: number;
  /**
   * 落定探针的最新结论：`true` = 旁路读进程还在（对端读端没全没）；`false` = 已退出。
   * 退出后还要静默 `drainGraceMs` 才判死——「帧交出去、对端读完就关」是正常收尾。
   * 缺省（未提供）表示没有这一路，不参与判断。
   */
  peerReaderGone?: boolean;
  /** 旁路读进程退出距今多久（仅 `peerReaderGone` 为真时有意义）。 */
  readerGoneAge?: number;
  /** 旁路读进程退出后等多久仍无其它存活证据才判死。 */
  drainGraceMs?: number;
}): boolean {
  const { ackAge, probeAge, stdinAge, stdinClosed, writeStuckAge, landedAge, graceMs } = input;
  if (stdinClosed) return true;
  if (input.stdoutGone === true) return true;
  if (writeStuckAge >= graceMs) return true;
  if (landedAge >= graceMs * LANDED_STALL_FACTOR) return true;
  if (input.peerReaderGone === true) {
    // 读端全没了：确认即使还在回放（被继承者读走）也不代表父进程还在管。过了宽限就判死。
    return (input.readerGoneAge ?? 0) >= (input.drainGraceMs ?? graceMs);
  }
  return ackAge >= graceMs && probeAge >= graceMs && stdinAge >= graceMs;
}

function isEpipe(err: unknown): boolean {
  // Node 把管道对端关闭报成 EPIPE；macOS 上写 socket 侧的探针 fd 也可能是 ECONNRESET。
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EPIPE' || code === 'ECONNRESET';
}

/** 独立进程补刀：本进程被 EPIPE 杀死时，宿主进程组可能还没杀干净。 */
function spawnCleanup(hostPid: number): void {
  try {
    spawn('sh', ['-c', `kill -9 -${hostPid} 2>/dev/null; pkill -9 -P ${hostPid} 2>/dev/null`], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  } catch {
    /* 兜底动作失败也只能留给上层超时回收 */
  }
}

/**
 * 生命期探针（读端一侧）：只回答一个问题——「父进程那侧的这个读端还在不在」。
 *
 * 为什么需要它：父进程被 SIGSTOP / SIGKILL 之后，若它给子进程的 fd 4 写端被宿主进程组
 * 里的某个外逃进程继承，心跳与结果两条通道都「看起来正常」——内核照样收字节。只有
 * **读端**能直接回答：读端全部消失（父进程死、继承者全退）时 `read` 才返回 EOF，
 * 写端永远不知道对端有没有在读。
 *
 * 对外只在 EOF 之后给出 `closed() === true`；拿不到读流时恒为 `undefined`（不据此判断）。
 */
function createLivenessProbe(readable: Readable | null): { probe: LivenessProbe; stop(): void } {
  if (readable === null) {
    // 父进程没给这一路：正常没降级。给了但本进程接不起来（见 `openLivenessStream`）
    // 是**真实降级**，那里已经写了一条 stderr，排障时能区分「无通道」与「有通道但失效」。
    return { probe: { closed: () => undefined }, stop: () => undefined };
  }
  let closed = false;
  const done = () => {
    closed = true;
  };
  readable.on('end', done);
  readable.on('close', done);
  readable.on('error', done);
  readable.resume();
  (readable as unknown as { unref?: () => void }).unref?.();
  return { probe: { closed: () => closed }, stop: () => undefined };
}

/**
 * 从 `fd 4` 起读的生命期探针读端；父进程没给这条通道时为 null。
 *
 * fd 4 是父进程交来的一条**已连接 socket**（见 `sandbox-exec.ts` 的 `createLivenessChannel`）。
 * 本进程只以只读方式接管它：父进程把手里那端关掉、或它整体消失（含 SIGKILL）之后，
 * 这里读到的就是 EOF——这是「对端真的不在了」唯一能直接回答的一路。
 *
 * 读到 EOF **或** 连接被重置（`ECONNRESET` 等）都按「读端没了」处理：两种情况都说明
 * 对手端不会再有任何心跳确认，继续等只会让宿主陪着跑到 deadline。这条判据只决定
 * 「对端还看不看得到」，不区分断开方式，注释与实现口径一致。
 */
function openLivenessStream(fd: number): Readable | null {
  if (!Number.isInteger(fd) || fd <= 0) return null;
  try {
    // fd 4 是父进程交来的**已连接 socket**：按只读 socket 接管，写方向天然不存在。
    // 用 `net.Socket` 而不是 `fs` 读流的原因见 `sandbox-exec.ts` 的 `createLivenessChannel`。
    const stream = new Socket({ fd, readable: true, writable: false }) as unknown as Readable;
    (stream as unknown as { unref?: () => void }).unref?.();
    return stream;
  } catch (err) {
    // 有 fd 4 却接不起来：生命期判据退化成只靠心跳确认（父进程读端被子孙继承时会误判存活）。
    // 不中断观测，但必须留下痕迹，不能与「父进程本来就没给这一路」混为一谈。
    process.stderr.write(`liveness fd ${fd} 接管失败，本进程退回心跳确认判据：${errorText(err)}\n`);
    return null;
  }
}

/** 落定探针的对外形态：`closed()` 为 `undefined` 表示这一路不可用（不据此判断）。 */
interface LivenessProbe {
  closed(): boolean | undefined;
}

/**
 * 守夜 shim 所在的临时目录（`srt-guard-bin`）：守夜脚本用 `PATH` 找 `cleanup`。
 *
 * 目录只建一次；建不出来时 `guardLibPath` 退回原 `PATH`，`cleanup` 找不到也只等于
 * 「目录没删掉」，不影响判死。目录本身放在临时目录里，`srt-guard-*` 前缀与状态目录一族。
 */
const GUARD_BIN_DIR = join(tmpdir(), 'srt-guard-bin');
/**
 * 守夜脚本调用的删除入口名。刻意不叫 `rm`：覆盖系统删除命令会让任何依赖它的脚本行为改变，
 * 而这里只需要一个「我们自己的」删除动作。
 */
const GUARD_CLEANUP_CMD = 'cleanup';

/**
 * 把守夜 shim 目录拼到 `PATH` 最前面，返回新的 `PATH`；拼不上时原样返回。
 *
 * shim 内容是 `#!/bin/sh\nexec <node> <本入口> "$@"`：`cleanup` 最终调起本文件的
 * `purgeGuardDir`（见那里的注释），删除重试只有这一份实现。
 * 写失败不抛：少一个 shim 只影响目录清理，不影响判死。
 */
function guardLibPath(current: string | undefined): string {
  try {
    mkdirSync(GUARD_BIN_DIR, { recursive: true });
    const file = join(GUARD_BIN_DIR, GUARD_CLEANUP_CMD);
    const entry = process.argv[1] ?? '';
    if (entry === '') return current ?? '';
    const body = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(entry)} "$@"\n`;
    // 先读后写：每次观测都会走到这里，内容不变就不动文件，避免 shim 频繁换 inode。
    let existing = '';
    try {
      existing = readFileSync(file, 'utf8');
    } catch {
      /* 第一次写 */
    }
    if (existing !== body) {
      writeFileSync(file, body, { mode: 0o755 });
    }
    const dirs = (current ?? '').split(':').filter((dir) => dir !== GUARD_BIN_DIR);
    return [GUARD_BIN_DIR, ...dirs].join(':');
  } catch {
    return current ?? '';
  }
}

/**
 * POSIX shell 单引号转义。shim 里要写的是路径（`/Applications/... (x)/node`），
 * 直接拼会因空格与括号被 `sh` 拆开。
 */
function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * `rm -rf` 失败时最多再试几次：临时目录里的「病态文件名」（超长、深嵌套）需要先重命名
 * 再删，这一步只有 Node 的 `fs` 能做（逐级较短前缀、sh 的 `${x:0:n}` 非法时会整体报错）。
 * 充其量几个目录，不会拖住守夜进程。
 */
const GUARD_RM_ATTEMPTS = 3;

/**
 * 删掉一个守夜状态目录 `p`，返回是否已删干净。
 *
 * 与删除相关的怪状态都在这里收口：`rm` 报错先重试；仍失败就把目录改成一个极短的名字
 * 再删（路径长度本身会在某些文件名异常时报 ENAMETOOLONG）；改名也失败就当它已被别人删掉。
 */
function removeGuardDirSync(p: string): boolean {
  for (let attempt = 0; attempt < GUARD_RM_ATTEMPTS; attempt += 1) {
    try {
      rmSync(p, { recursive: true, force: true });
      return true;
    } catch {
      /* 下一轮换个办法 */
      /* 下一轮换个办法 */
    }
    try {
      renameSync(p, join(dirname(p), `sg${process.pid}${attempt}`));
    } catch {
      /* 已经被删掉或本来就改名失败 */
    }
  }
  return false;
}

/**
 * 删除调用（`cleanup --claim <dir> [--log <file>]`，见 `guardLibPath`）：删掉守夜状态目录，
 * 成功时向日志追加一行记录，返回进程退出码。
 *
 * 守夜进程与主进程的回收脚本都会走到这里，同一份删除重试（`removeGuardDirSync`）只有
 * 一个实现。`--claim` 只是语义标注（调用方已经认领了这个目录），不改变删除动作；日志缺省
 * 不写。
 */
function purgeGuardDir(argv: string[]): number {
  let target = '';
  let log = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--claim') continue;
    if (arg === '--log') {
      log = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (target === '') target = arg ?? '';
  }
  if (target === '') return 2;
  const ok = removeGuardDirSync(target);
  if (ok && log !== '') {
    // 只追加一行：调用方可能并发写同一个日志文件。记录失败只说明留痕没写成，
    // 不影响目录已经删掉这一事实。
    try {
      mkdirSync(dirname(log), { recursive: true });
      appendFileSync(
        log,
        `${JSON.stringify({ event: 'guard.dir.removed', dir: target, at: new Date().toISOString() })}\n`,
      );
    } catch {
      /* 记录写不进去就算了 */
    }
  }
  return ok ? 0 : 1;
}

/**
 * 走到这里的唯一入口：`cleanup --claim <目录>` 是守夜进程/回收脚本调起的「删目录」任务，
 * 其余情况才是真正的沙箱子进程（由父进程用 spawn 拉起并带上 `SRT_ISOLATION_CHILD_ENTRY`）。
 *
 * 必须先分流再 `main()`：删目录的调用不带 stdin/stdout 协议，让它在 `main()` 里等首行请求
 * 只会挂着不退出。判定只看第一个参数：只有我们自己写的调用会传 `--claim`。
 */
function isGuardCleanupInvocation(argv: string[]): boolean {
  return argv[0] === '--claim';
}

if (process.env.SRT_ISOLATION_CHILD_ENTRY === '1') {
  void main();
} else {
  const argv = process.argv.slice(2);
  if (isGuardCleanupInvocation(argv)) {
    // 删除是纯同步动作：删完立即退出，绝不留事件循环让这次调用挂成常驻进程。
    process.exit(purgeGuardDir(argv));
  }
}

async function main(): Promise<void> {
  // 从这一刻起就盯着结果管道：入口越早退出，宿主越早可能成为孤儿。
  // 探针走独立的 fd 3，结果通道因此保持纯净；心跳确认经 stdin 回传（见 readRequest）。
  // 旁路诊断只跳过包裹：父进程照样要派探针与 stdin 两条通道。
  const pipeWatch = createPeerWatchdog(PROBE_FD);
  // 请求走 stdin 首行；确认走后续行。`readRequest` 在**收到首行请求时就返回**，
  // 之后仍继续消费 stdin（否则管道写满会反过来卡住父进程回确认）。
  // 绝不等 stdin EOF：父进程交完请求后不 end，EOF 只在它自己退出时才出现。
  const request = await readRequest(
    (read, seen) => {
      pipeWatch.noteAck(read, seen);
    },
    () => {
      pipeWatch.noteStdinClosed();
    },
    () => {
      pipeWatch.noteStdinData();
    },
  );
  if (request === null) {
    emit(
      {
        ok: false,
        stage: 'request',
        message: '沙箱执行子进程没有收到可解析的请求 JSON',
      },
      pipeWatch,
    );
    return;
  }
  if (typeof request.bin !== 'string' || request.bin.length === 0) {
    emit({ ok: false, stage: 'request', message: '请求缺少可执行命令 bin' }, pipeWatch);
    return;
  }

  const args = Array.isArray(request.args) ? request.args : [];
  let wrapped: { argv: string[]; env: NodeJS.ProcessEnv };
  if (request.sandboxBypass === true) {
    // 旁路：不初始化隔离后端，直接跑宿主。仅用于诊断链路（PROCTOR_SANDBOX_BYPASS=1），
    // 产物里会如实标注 sandbox_bypassed，报告读取方据此区分证据等级。
    wrapped = { argv: [request.bin, ...args], env: {} };
  } else {
    try {
      wrapped = await wrapHostCommand({
        bin: request.bin,
        args,
        cwd: request.cwd,
        allowedWrite: Array.isArray(request.allowedWrite) ? request.allowedWrite : [],
        allowedDomains: Array.isArray(request.allowedDomains) ? request.allowedDomains : [],
      });
    } catch (err) {
      emit({ ok: false, stage: 'wrap', message: `沙箱包裹失败：${errorText(err)}` }, pipeWatch);
      return;
    }
  }

  const command = wrapped.argv[0];
  if (command === undefined) {
    emit({ ok: false, stage: 'wrap', message: '隔离后端没有返回可执行命令' }, pipeWatch);
    return;
  }

  const result = await runAndReap(
    command,
    wrapped.argv.slice(1),
    {
      cwd: request.cwd,
      // 包裹层产出的环境必须覆盖继承环境：代理端口与认证令牌只在这里存在。
      env: { ...request.env, ...wrapped.env },
      timeoutMs: Number.isFinite(request.timeoutMs) ? request.timeoutMs : 60_000,
    },
    pipeWatch,
  );
  emit({ ok: true, ...result }, pipeWatch);
}

/**
 * 结算最后一帧：先停监视、再写、再等写空并退出，绝不让事件循环拖住进程退出。
 *
 * 帧就是一行结果 JSON；`emit` 之后本进程不再需要任何东西。
 *
 * 这里也是「守夜进程判死」的唯一收口点：父进程还活着但它已经不读了，主循环不可能
 * 在它卡死时结算，所以由本进程在帧写完之后主动退出——退出钩子按登记的宿主 pid 补刀，
 * 父进程读到这一帧就按「结果管道在宿主结束前断开」如实归因，不会被记成超时。
 * 判死标记必须在这里读：先 `stop()` 会让守夜进程收到 `term` 而提前收工。
 */
function emit(reply: SandboxExecReply, pipeWatch: PeerWatchdog): void {
  // 注意：这里**不能**让监视停下来当作「父进程还在读」的证据。
  // 帧写出后父进程随时可能关管道，同步 EPIPE 会立刻杀死本进程，
  // 此时只有 process.on('exit') 里的补刀能保证宿主进程树不变成孤儿。
  const denied = pipeWatch.didDeny();
  // 帧即将交出：之后的任何判死都不能再改判（见 `didDeny`）。
  pipeWatch.markEmitted();
  pipeWatch.stop();
  if (denied) {
    // 判死收场：结果通道已经不可信（父进程不再读确认）。绝不回写任何帧——半帧和
    // 「看起来正常」的帧都会被读端当成结论，而实际上这次观测已经作废；空帧才有可能
    // 掩盖宿主是否还在跑，而父进程无法据此归因。宿主进程组已由守夜进程（或退出钩子）
    // 带走，父进程按它自己的判死路径收口（见 `sandbox-exec.ts` 的 `createOrphanSignal`）。
    process.exit(0);
    return;
  }
  const line = `${JSON.stringify(reply)}\n`;
  try {
    process.stdout.write(line);
    // 必须等这一帧真正写出去再退出：`process.exit` 不等流传完。
    process.stdout.write('', () => process.exit(0));
    // 逃逸阀：flush 回调迟迟不到（对端不收）就到点退出——
    // 多留一拍只会变成僵尸进程，不会让结论更正确。
    setTimeout(() => process.exit(0), EMIT_EXIT_GRACE_MS).unref();
  } catch {
    /* 上层已关闭结果管道：没有接收方，写不进去也不必再报错。 */
    process.exit(0);
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * 控制通道读流：**基于 `process.stdin` 的同一个流**，不是另建 `tty.ReadStream(0)`。
 *
 * 早先的注释说 `process.stdin` 读到过 EOF 后会把后续数据静默丢弃，因此改成了
 * `new tty.ReadStream(0)`。实测这一步本身就会让确认世代永远停在 0：现建的 `tty.ReadStream`
 * 在父进程通过管道写入时一次 `'data'` 也不触发（父进程确实写了确认行），于是正常父进程
 * 在 1s 后被判死、宿主被误杀——比要修的「读到 EOF 后丢数据」严重得多。
 *
 * 所以回到 `process.stdin` 本身：它已经装好 fd 读状态机与句柄，不额外占 libuv 线程池，
 * `process.exit` 不会被卡住。EOF 之后确实不再有确认，这正好由看门狗按「stdin 关闭」处理。
 */
function openControlStdin(): Readable {
  return derivedStdin;
}


/**
 * 读请求：stdin 的第一行是请求 JSON；之后的行都是父进程的心跳确认（每行即一代）。
 *
 * 父进程不 end stdin（它要继续用这条通道回确认），所以这里**不能等到 EOF**：
 * 解析出首行请求就 resolve；后续确认行在后台继续消费——不消费的话 stdin 缓冲区写满
 * 会拖住父进程的 `write`，确认世代停滞又会反过来被当成「对端已死」。
 *
 * 首行不是合法 JSON、或 EOF 时请求还没解析出来（例如对端只写了半行就退出）→ null，
 * 由上层归成 request 故障。
 */
function readRequest(
  onAck: (read: number, seen: number) => void,
  onEnd: () => void,
  onStdinData: () => void,
): Promise<SandboxExecRequest | null> {
  return new Promise((resolve) => {
    const stdin = openControlStdin();
    let request: SandboxExecRequest | null = null;
    let firstLineSeen = false;
    let done = false;
    // 请求首行单独缓冲（它的半行不能被当成确认残行）；首行之后一律走 `ackTail`。
    let requestLine = '';

    const fail = () => {
      if (done) return;
      done = true;
      stdin.destroy();
      resolve(null);
    };

    stdin.setEncoding('utf8');
    stdin.on('error', () => fail());
    stdin.on('end', () => {
      // 无论请求是否已解析，EOF 都必须上报：它是「确认不会再来」的硬信号（见 PeerWatchdog）。
      onEnd();
      // 请求已解析出来：stdin 结束只意味着不会再有确认，请求照样有效。
      if (request !== null) return;
      // 没换行的残行按整条请求再试一次（兼容「单行 JSON 后直接关 stdin」的对端）。
      const rest = requestLine.trim();
      if (rest === '') return fail();
      try {
        const parsed = JSON.parse(rest) as SandboxExecRequest;
        done = true;
        resolve(parsed);
      } catch {
        fail();
      }
    });
    stdin.on('data', (chunk: string) => {
      onStdinData();
      if (firstLineSeen) {
        noteAckChunk(chunk, onAck);
        return;
      }
      requestLine += chunk;
      const index = requestLine.indexOf('\n');
      if (index < 0) return;
      const line = requestLine.slice(0, index).trim();
      const rest = requestLine.slice(index + 1);
      requestLine = '';
      firstLineSeen = true;
      if (line !== '') {
        // 第一行必须是请求：其后各行才是心跳确认，顺序由父进程保证。
        try {
          request = JSON.parse(line) as SandboxExecRequest;
        } catch {
          fail();
          return;
        }
        done = true;
        resolve(request);
      }
      // 与请求同一 chunk 到达的确认：接着按整行解析，残行留到下一次。
      if (rest !== '') noteAckChunk(rest, onAck);
    });
  });
}

/**
 * 拉起宿主。
 *
 * 直接 `spawn` 的语义保持不变（`worker` 永远是 undefined）；守夜进程（`startGuard`）
 * 负责两件与事件循环无关的事：本进程一死就回收宿主进程组，确认停滞到宽限就判死收场。
 * 这里额外只修正一个细节：宿主进程组必须能对上**本进程的兄弟**——也就是宿主本身
 * 是组长（`detached` 已保证），因此父进程按 `hostPid` 回收与守夜进程按负 pid 回收
 * 指向的是同一棵子树。
 */
function spawnHost(
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number },
  isPosix: boolean,
  pipeWatch: PeerWatchdog,
): { child: ChildProcess } {
  void pipeWatch;
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    // 独立进程组：超时/放弃时用负 pid 一次带走整棵树。
    detached: isPosix,
    // stdin 必须 ignore：opencode 检测到常开管道会一直等输入，停在 init 到截止时间。
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child };
}

/** 运行宿主并保证超时/异常/管道断开时递归清理进程树。返回值形状与主进程原先的实现一致。 */
function runAndReap(
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number },
  pipeWatch: PeerWatchdog,
): Promise<Omit<SandboxExecResult, 'ok'>> {
  const isPosix = process.platform !== 'win32';
  return new Promise((resolve) => {
    const spawned = spawnHost(command, args, opts, isPosix, pipeWatch);
    const child = spawned.child;
    // 先登记 pid：本进程随后若被 EPIPE 杀死，退出钩子要靠它补刀。
    pipeWatch.setHostPid(child.pid);

    let stdout = '';
    let stderr = '';
    const stdoutDecoder = createStreamDecoder();
    const stderrDecoder = createStreamDecoder();
    let settled = false;
    // 结果帧已经交出去，上层是否关管道不影响结论，只影响有没有人回收宿主进程树。
    let replyEmitted = false;
    let timedOut = false;
    let stdioDestroyed = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const knownPids = new Set<number>();
    /**
     * 断管判定是否仍然成立（一旦为假就永久为假）。
     *
     * `pipeWatch.broken` 是粘性的，读到它就已经过去了；结算之后才结算的「断管」
     * 不能回头改判本该有效的结果。这里同时把两种「读者读完就走」摘出来：
     * ①结果帧已经交给上层（`replyEmitted`）；②宿主已按 deadline 被主动收场
     * （此时结论是 `timedOut`，连带终止是我们自己干的，见 `finish` 注释）。
     */
    let pipeBrokenFinal = false;

    const finish = (status: number | null, signal: NodeJS.Signals | null, error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      // 判据说明见 `planPipeBroken`：读到帧就关读端属「读者读完就走」，不构成断管。
      pipeBrokenFinal = planPipeBroken(pipeWatch.broken, replyEmitted, timedOut);
      pipeWatch.stop();
      // 结算时把解码器里不足一个字符的尾部字节冲出来，否则末尾会凭空少一截。
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      const code =
        error === null
          ? null
          : typeof (error as NodeJS.ErrnoException).code === 'string'
            ? String((error as NodeJS.ErrnoException).code)
            : 'UNKNOWN';
      const result: Omit<SandboxExecResult, 'ok'> = {
        status,
        signal,
        errorCode: code,
        errorMessage: error === null ? null : error.message,
        stdout,
        stderr,
        timedOut,
        stdioDestroyed,
        // 只有「上层放弃读取」导致的连带终止才算断管：超时是我们按 deadline 主动收的场，
        // 结论就是 timedOut，不能被报成观测作废。
        pipeBroken: pipeBrokenFinal,
        // 结算之后宿主可能仍在运行（帧已写出、进程组未退）：父进程据此兜底回收。
        // 守夜进程自己判死并回收过时也带这一帧：父进程据此再补一刀（幂等）。
        hostPid: typeof child.pid === 'number' ? child.pid : null,
      };
      // 帧即将交出：之后上层再关管道只算「读者走了」，不能再改判结论。
      // 先停监视、再交出结论：`resolve` 之后本进程要很快走完 `emit → process.exit`，
      // 中间若再冒一拍心跳，会被「停止期间确认不推进」误判成断管（读到帧后关读端是常态）。
      pipeWatch.markEmitted();
      pipeWatch.stop();
      replyEmitted = true;
      resolve(result);
    };

    /**
     * 守夜进程判死（父进程还在、但已不再读心跳）→ 立即收口：
     * 回收宿主进程组、按「观测作废」结算，随后 `emit` 会写出诊断帧并退出。
     *
     * 为什么不能只靠主循环的定时器：确认世代被子孙继承的读端「续命」时，定时器
     * 永远等不到判据成立；守夜进程用 `ps` 看本进程是否还活、用文件看确认是否停滞，
     * 两条都不经过内核管道缓冲，能如实判死。
     *
     * 采信前提见 `didDeny`：本进程自己已经看到断管（`broken` / 结果管道没人读）时，
     * 守夜进程写下的 `deny` 只可能是它重启前那一份、属于上一次观测——此时宿主刚被拉起，
     * 收回它就等于把一次正常观测判死，所以只看本进程自己的判据。
     */
    const settleOnDeny = () => {
      // 无论结论是否已经交出，宿主进程组都必须带走：`finish` 之后 `pipeWatch.stop()` 已停掉
      // 主循环，这一步是结算之后唯一还在盯着宿主的收口（结论定格之后守夜进程再判死，
      // 说明父进程确实不再读，宿主若还活着就是孤儿）。
      reapTree(child, 'SIGKILL', knownPids);
      killConfirmedProcessGroup(child.pid);
      if (settled) return;
      finish(null, 'SIGKILL', null);
    };
    // 定时器延迟一拍再问一次：守夜进程要跨过一轮 sleep 才会写下 `deny`。
    // 结算之后不 clearInterval：帧交出去之后 `didDeny` 恒为假（不再改判），但守夜进程
    // 仍可能在父进程读完就走之后判死，这一路要继续把宿主带走（见上）。
    const denyTimer = setInterval(() => {
      if (settled ? pipeWatch.readDeny() : pipeWatch.didDeny()) {
        clearInterval(denyTimer);
        settleOnDeny();
      }
    }, PIPE_WATCHDOG_MS);
    denyTimer.unref();

    // 上层放弃读取结果管道：宿主已被连带终止，这次观测作废，按远端已退出结算。
    pipeWatch.onBroken(() => {
      // 帧已经交出去了：上层只是读到帧就关了管道，结论仍然有效。
      // 这时唯一要做的是把仍存活的宿主进程组带走，绝不能把正常观测改判成断管。
      if (replyEmitted) {
        killConfirmedProcessGroup(child.pid);
        pipeWatch.stop();
        return;
      }
      if (settled) return;
      // 断管时我们自己收的场，宿主是被我们带走的：结论按观测作废（`planPipeBroken`）处理，
      // 不当成被测系统超时。
      reapTree(child, 'SIGTERM', knownPids);
      setTimeout(() => {
        reapTree(child, 'SIGKILL', knownPids);
        killConfirmedProcessGroup(child.pid);
      }, 500).unref();
      finish(null, 'SIGTERM', null);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      reapTree(child, 'SIGTERM', knownPids);
      setTimeout(() => {
        reapTree(child, 'SIGKILL', knownPids);
        killConfirmedProcessGroup(child.pid);
      }, 500);
    }, opts.timeoutMs);
    timer.ref();

    child.stdout?.on('data', (buf: Buffer) => {
      if (stdout.length < MAX_STREAM_CHARS) stdout += stdoutDecoder.write(buf);
    });
    child.stderr?.on('data', (buf: Buffer) => {
      if (stderr.length < MAX_STREAM_CHARS) stderr += stderrDecoder.write(buf);
    });
    child.on('error', (err) => {
      // 先置结算标记：spawn 失败后 close 可能不再触发，不标记会挂到父进程引导超时。
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      // 必须停监视：否则监视器随后判定「对端断了」又会再结算一次。
      pipeWatch.stop();
      emit({ ok: false, stage: 'spawn', message: `宿主启动失败：${errorText(err)}` }, pipeWatch);
    });

    // 双阶段结算：exit 先到就开宽限期，close 正常则用 close 结算。
    // 只用 close 会因孙进程占着 pipe 永不触发；只用 exit 会丢管道尾部输出。
    child.on('exit', (code, signal) => {
      if (settled) return;
      // 宿主已退出，deadline 不再适用：不清掉会让宽限期内被误置 timedOut。
      clearTimeout(timer);
      graceTimer = setTimeout(() => {
        if (settled) return;
        stdioDestroyed = true;
        child.stdout?.destroy();
        child.stderr?.destroy();
        reapTree(child, 'SIGTERM', knownPids);
        finish(code, signal ?? null, null);
      }, STDIO_GRACE_MS);
      graceTimer.ref();
    });

    child.on('close', (code, signal) => {
      finish(
        code,
        signal ?? null,
        timedOut ? Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }) : null,
      );
    });
  });
}

/** 有状态 UTF-8 解码：逐 chunk `toString` 会在多字节字符被切开时产出替换字符。 */
function createStreamDecoder(): { write(buf: Buffer): string; end(): string } {
  const decoder = new TextDecoder('utf-8');
  return {
    write: (buf) => decoder.decode(buf, { stream: true }),
    end: () => decoder.decode(),
  };
}

function killConfirmedProcessGroup(pid: number | undefined): void {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  if (process.platform === 'win32') return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* 组长消失后，macOS 对进程组发信号会报 ESRCH，即使组员还在。 */
  }
}

/** 终止子进程及其进程树（POSIX 负 PID 杀进程组 + pgrep 后代遍历兜底；Windows taskkill /T /F）。 */
function reapTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
  knownPids?: Set<number>,
): void {
  const pid = child.pid;
  if (pid === undefined) return;
  // pid=1 时 -pid 即 -1，等于向当前用户的全部进程广播信号，必须拦掉。
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    try {
      child.kill(signal);
    } catch {
      /* ignore */
    }
    return;
  }
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* ignore */
    }
  }
  // 兜底：逐层收集自行换组的后代并单独终止（父进程退出后第二次扫描已看不到它们）。
  const descendants = collectDescendantPids(pid);
  for (const descendant of descendants) knownPids?.add(descendant);
  for (const descendant of new Set([...(knownPids ?? []), ...descendants])) {
    try {
      process.kill(descendant, signal);
    } catch {
      /* 已退出，忽略 */
    }
  }
}

/** 通过 pgrep -P 逐层收集后代 PID（含自行 detach 换组的后代），限制深度防环。 */
function collectDescendantPids(rootPid: number): number[] {
  if (process.platform === 'win32') return [];
  const result: number[] = [];
  const visited = new Set<number>([rootPid]);
  let frontier = [rootPid];
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const pid of frontier) {
      const probe = childPidsOf(pid);
      for (const childPid of probe) {
        if (visited.has(childPid)) continue;
        visited.add(childPid);
        result.push(childPid);
        next.push(childPid);
      }
    }
    frontier = next;
  }
  return result;
}

/** 读某个父进程的直接子进程 PID（pgrep -P）；失败或超时返回空。 */
function childPidsOf(parentPid: number): number[] {
  const probe = spawnSync('pgrep', ['-P', String(parentPid)], { encoding: 'utf8', timeout: 1000 });
  if (probe.error || probe.status !== 0) return [];
  const pids: number[] = [];
  for (const line of String(probe.stdout).split(/\r?\n/)) {
    const childPid = Number.parseInt(line, 10);
    if (!Number.isInteger(childPid) || childPid <= 1) continue;
    pids.push(childPid);
  }
  return pids;
}

// 被主进程侧 `sandbox-exec.ts` 静态 import 时不得执行（否则导入方自己会跑起来）。
// 入口启动只有上面 `SRT_ISOLATION_CHILD_ENTRY === '1'` 一处：再判一次 `invokedAsScript`
// 会让同一个进程跑起两套监视器，各自拉一个守夜进程，其中一个永远没人收——实测
// 每次观测漏一个 `srt-guard-*` 目录正是这个原因。直接以脚本方式启动时，
// 由调用方（测试/调试）显式带上该标记。

/**
 * 子进程入口脚本的绝对路径。
 *
 * 抽成常量而不是由调用方自己拼 `import.meta.url`：入口必须与模块同目录，
 * 且这里的 `import.meta.url` 才是正确的（`sandbox-exec.ts` 拼出来会指向它自己）。
 *
 * 注意：工程用 `tsc` 直出 `dist`，产物里的相对导入仍是 `.ts`（与全仓一致）。
 * 因此以本文件自身在运行时的真实扩展名为准，`src`（.ts）与 `dist`（.js）两边都对；
 * 不用「存在性探测」，否则探测到源码却跑起一份未经构建的旧逻辑。
 */
const SELF_URL = import.meta.url;
const SELF_EXT = /\.[a-z]+$/i.exec(SELF_URL)?.[0] ?? '.ts';
export const SANDBOX_EXEC_CHILD_ENTRY = fileURLToPath(
  new URL(`./sandbox-exec-child${SELF_EXT}`, SELF_URL),
);

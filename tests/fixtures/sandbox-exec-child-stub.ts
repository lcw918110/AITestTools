import { spawn } from 'node:child_process';
import { Socket } from 'node:net';

/**
 * 沙箱执行子进程的受控替身（测试专用）。
 *
 * 被 `sandbox-exec.ts` 以 `process.execPath --experimental-strip-types <entry>` 拉起，
 * 语义与真实入口一致：stdin 收请求，stdout 回**一帧**结果 JSON（探针走 fd 3，不混入结果通道）。
 * 不 import 隔离后端，因此可在任意机器上跑。
 *
 * 本文件带 `SRT_WATCHDOG_PLACEHOLDER` 标记：`sandbox-exec.ts` 据此把它当成「自己就是
 * 读端哨兵」的替身——由父进程建好一条 FIFO、把写端留给父进程自己，本替身读 fd 4；
 * 父进程一死（读端全消失）fd 4 立即 EOF，本替身随即退出，不留无人回收的孤儿。
 *
 * 读端哨兵的 fd 4 在本替身里是**可选**的：父进程可能因为拿不到 FIFO 而不提供这一路。
 * `stdio[4]` 为 `ignore` / 未打开时，`createReadStream` 会读到 EOF 或报错，
 * 所以正常回帧之后必须**显式收场**（见 `addSettleOnClose`），否则进程会一直挂着。
 *
 * 环境变量行为（用于回归跨进程环境传递）：
 * - `FAKE_CHILD_ECHO_PROXY=1`：回包 stdout 里带上 `HTTP_PROXY`，证明包裹层产出的
 *   代理变量真的随请求进了子进程环境；
 * - `FAKE_CHILD_MODE`：
 *   - `garbage`：回包不是 JSON（模拟握手损坏）；
 *   - `silent`：什么都不回（模拟子进程被杀）；
 *   - `wrap-fail`：回包 `ok:false, stage:'wrap'`（模拟包裹失败）；
 *   - `spawn-fail`：回包 `ok:false, stage:'spawn'`；
 *   - `noisy`：先回一帧合法结果，再追加几行「日志里恰好是 JSON」的尾部输出。
 */
/** 桩文件里带这个标记，`sandbox-exec.ts` 据此认定「桩自己就是读端哨兵」（见模块注释）。 */
void 'SRT_WATCHDOG_PLACEHOLDER';
/** 读端哨兵的 fd：父进程把写端留给自己、只把读流交给本替身（见 `sandbox-exec.ts`）。 */
const WATCHDOG_FD = 4;
/**
 * 读端哨兵：读 fd 4，EOF 即父进程那一侧的读端全没了（父进程死、继承者全退）。
 * 读流不挡本进程退出：`unref()` 之后正常收工照旧。
 */
function watchParent(onGone: () => void): void {
  const fd = WATCHDOG_FD;
  if (!Number.isInteger(fd) || fd <= 0) return;
  try {
    // fd 4 是父进程交来的一条**已连接 socket**（不是 FIFO、不是普通文件）：
    // 用 `fs` 读流接管会在 macOS 的 kqueue 上断言崩溃，必须按只读 socket 接管。
    const stream = new Socket({ fd, readable: true, writable: false });
    stream.on('end', onGone);
    stream.on('error', onGone);
    stream.resume();
    (stream as unknown as { unref?: () => void }).unref?.();
  } catch {
    /* 没有这条通道：退化成「只在父进程活着时运行」的老语义 */
  }
}

/**
 * 帧写出后 flush 再退出：`process.exit` 不等流传完，直接退出会把尾字节截断。
 * 逃逸阀兜住「对端不收」：flush 回调迟迟不到也必须退出，不能变成僵尸。
 */
function addSettleOnClose(): () => void {
  return () => {
    process.stdout.write('', () => process.exit(0));
    const timer = setTimeout(() => process.exit(0), 1_000);
    timer.unref();
  };
}

async function main(): Promise<void> {
  // 读端哨兵：fd 4 的读端全在父进程一侧，父进程死了这里立刻 EOF。
  // 真实入口由 `createLivenessProbe` 起同样的读流并据此判死；替身不跑宿主，直接退出。
  // 注意：它**只**在没有任何输出时才是「父进程死了」；正常回帧之后它会跟着父进程关读端
  // 一起 EOF（或 fd 4 为 `ignore` 时立刻 EOF），所以有输出之后的 EOF 不能当成判死。
  let wrote = false;
  watchParent(async () => {
    if (!wrote) process.exit(0);
  });
  /** 写出一帧并登记「已有输出」：之后哨兵 EOF 不再当成父进程已死。 */
  const writeFrame = (text: string): void => {
    wrote = true;
    process.stdout.write(text);
  };
  // 正常回帧后的收场：帧写出去就退出，不等任何通道（父进程读到帧就关读端是常态）。
  const close = addSettleOnClose();
  // 与真实入口一致：stdin 第一行是请求；之后的行是主进程的心跳确认（这里只消费不解释）。
  // 关键词是「不等 EOF」——主进程交完请求不 end stdin，它要继续用这条通道回确认。
  const request = await readFirstLine();
  const mode = process.env.FAKE_CHILD_MODE ?? 'run';

  if (mode === 'garbage') {
    writeFrame('这不是 JSON\n');
    close();
    return;
  }
  if (mode === 'silent') return;
  if (mode === 'wrap-fail') {
    writeFrame(`${JSON.stringify({ ok: false, stage: 'wrap', message: '测试桩包裹失败' })}\n`);
    close();
    return;
  }
  if (mode === 'spawn-fail') {
    writeFrame(`${JSON.stringify({ ok: false, stage: 'spawn', message: '测试桩启动失败' })}\n`);
    close();
    return;
  }

  const proxyNote =
    process.env.FAKE_CHILD_ECHO_PROXY === '1' ? `HTTP_PROXY=${request.env.HTTP_PROXY ?? ''}` : '';

  // 替身的宿主只做 echo：把请求的 bin/args 原样打出来（断言依赖 `hello-child` 回显）。
  // stdin 在真实宿主上必须是 `ignore`，所以这里走 argv 而不走 stdin。
  const child = spawn(
    'sh',
    ['-c', 'echo "$1"; echo HOST_STDERR 1>&2', 'sh', [request.bin, ...request.args].join(' ')],
    {
      cwd: request.cwd,
      env: request.env,
      // 与真实宿主一致：stdin 必须是 ignore。若这里给管道，`cat` 会一直等输入，
      // 宿主读端会把本替身的老读端继承下去，父进程死后无人回收。
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = proxyNote === '' ? '' : `${proxyNote}\n`;
  let stderr = '';
  child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
  child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
  child.on('close', (code) => {
    if (mode === 'noisy') {
      // 模拟未捕获异常栈/句柄告警：尾部某行恰好是 JSON，不得被当成结果帧。
      writeFrame(
        `${JSON.stringify({ ok: true, status: code, signal: null, errorCode: null, errorMessage: null, stdout, stderr, timedOut: false, stdioDestroyed: false })}\n`,
      );
      writeFrame('{"ok":true,"status":99}\n');
    } else {
      writeFrame(
        `${JSON.stringify({
          ok: true,
          status: code,
          signal: null,
          errorCode: null,
          errorMessage: null,
          stdout,
          stderr,
          timedOut: false,
          stdioDestroyed: false,
        })}\n`,
      );
    }
    // 帧已写出：立刻收场，不等 stdin / 哨兵通道（子进程自身也不再需要它们）。
    close();
  });
}

await main();

/** 只读到首个换行为止的请求行；其余字节留给后续确认行（本替身不解释确认）。 */
async function readFirstLine(): Promise<{
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}> {
  let pending = '';
  for await (const chunk of process.stdin) {
    pending += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
    const index = pending.indexOf('\n');
    if (index >= 0) return JSON.parse(pending.slice(0, index).trim());
  }
  return JSON.parse(pending.trim());
}

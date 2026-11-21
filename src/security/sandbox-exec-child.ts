/**
 * 沙箱包裹 + 宿主执行的短命子进程（ADR-0014）。
 *
 * 为什么必须独立成进程：`@anthropic-ai/sandbox-runtime` 的 `SandboxManager` 是进程级
 * 单例，`initialize()` 遇到已存在的初始化会静默忽略新配置；其本机代理也在该进程内
 * 起停，`wrapWithSandboxArgv` 返回的环境里写死 `HTTP_PROXY=localhost:<port>`。
 * 代理与被包裹进程必须同生共死，因此在子进程内连宿主一起启动。
 *
 * 进程边界：主进程经 stdin 交一份请求，本进程在 stdout 只写**一帧**结果 JSON。
 * 宿主的 stdout/stderr 不经过本进程的 stdout（否则会污染结果帧），只计入结果字段。
 */
import { spawn, spawnSync } from 'node:child_process';
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
}

/** 包裹层自身故障（包裹失败、请求不可解析等）：不是被测系统的失败。 */
export interface SandboxExecFailure {
  ok: false;
  stage: SandboxExecFailureStage;
  message: string;
}

export type SandboxExecFailureStage = 'request' | 'wrap' | 'spawn';

export type SandboxExecReply = SandboxExecResult | SandboxExecFailure;

/** 宿主 stdout/stderr 的采集上限：防止被子进程无限输出撑爆内存后再序列化。 */
const MAX_STREAM_CHARS = 32 * 1024 * 1024;

/** exit 后等待 pipe 关闭的宽限期；与主进程原实现的 STDIO_GRACE_MS 保持一致。 */
const STDIO_GRACE_MS = 500;

async function main(): Promise<void> {
  const request = await readRequest();
  if (request === null) {
    emit({
      ok: false,
      stage: 'request',
      message: '沙箱执行子进程没有收到可解析的请求 JSON',
    });
    return;
  }
  if (typeof request.bin !== 'string' || request.bin.length === 0) {
    emit({ ok: false, stage: 'request', message: '请求缺少可执行命令 bin' });
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
      emit({ ok: false, stage: 'wrap', message: `沙箱包裹失败：${errorText(err)}` });
      return;
    }
  }

  const command = wrapped.argv[0];
  if (command === undefined) {
    emit({ ok: false, stage: 'wrap', message: '隔离后端没有返回可执行命令' });
    return;
  }

  const result = await runAndReap(command, wrapped.argv.slice(1), {
    cwd: request.cwd,
    // 包裹层产出的环境必须覆盖继承环境：代理端口与认证令牌只在这里存在。
    env: { ...request.env, ...wrapped.env },
    timeoutMs: Number.isFinite(request.timeoutMs) ? request.timeoutMs : 60_000,
  });
  emit({ ok: true, ...result });
}

function emit(reply: SandboxExecReply): void {
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** 读 stdin 直到 EOF；内容非 JSON 时返回 null。 */
async function readRequest(): Promise<SandboxExecRequest | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return null;
  try {
    return JSON.parse(text) as SandboxExecRequest;
  } catch {
    return null;
  }
}

/** 运行宿主并保证超时/异常时递归清理进程树。返回值形状与主进程原先的实现一致。 */
function runAndReap(
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number },
): Promise<Omit<SandboxExecResult, 'ok'>> {
  const isPosix = process.platform !== 'win32';
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      detached: isPosix,
      // stdin 必须 ignore：opencode 检测到常开管道会一直等输入，停在 init 到截止时间。
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const stdoutDecoder = createStreamDecoder();
    const stderrDecoder = createStreamDecoder();
    let settled = false;
    let timedOut = false;
    let stdioDestroyed = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const knownPids = new Set<number>();

    const finish = (status: number | null, signal: NodeJS.Signals | null, error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      // 结算时把解码器里不足一个字符的尾部字节冲出来，否则末尾会凭空少一截。
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      const code =
        error === null
          ? null
          : typeof (error as NodeJS.ErrnoException).code === 'string'
            ? String((error as NodeJS.ErrnoException).code)
            : 'UNKNOWN';
      resolve({
        status,
        signal,
        errorCode: code,
        errorMessage: error === null ? null : error.message,
        stdout,
        stderr,
        timedOut,
        stdioDestroyed,
      });
    };

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
      settled = true;
      clearTimeout(timer);
      emit({ ok: false, stage: 'spawn', message: `宿主启动失败：${errorText(err)}` });
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
// 真作为子进程入口时才启动：由 SRT_ISOLATION_CHILD_ENTRY 标记，或作为脚本直接运行。
const invokedAsScript =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript || process.env.SRT_ISOLATION_CHILD_ENTRY === '1') {
  await main();
}

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

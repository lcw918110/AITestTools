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
 * 在短命子进程内执行「包裹 + 启动宿主 + 收集观测」。
 *
 * @param input 与原先 `wrapHostCommand` + `runHostedWithReap` 的入参一致
 * @param childEntry 子进程入口脚本路径（测试可替换为受控替身）
 */
export function runSandboxedHostInChild(
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

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, execArgs(childEntry), {
      // stdin 只用来交请求；stdout 只用来收结果帧；stderr 透传到引擎日志便于排障。
      stdio: ['pipe', 'pipe', 'inherit'],
      // 子进程不能继承宿主的沙箱代理变量，否则它会去连一个尚未存在的端口。
      // 标记：入口脚本被静态 import 时不会自己执行，只有带上该标记才启动 main。
      env: { ...childEnv(process.env), SRT_ISOLATION_CHILD_ENTRY: '1' },
    });

    let buffer = '';
    let settled = false;
    // 引导预算 = 宿主 deadline + 包裹/回帧余量。子进程内部的 deadline 会先到期并回收
    // 进程树，这里的定时器只在「子进程自己卡死/被杀」时才触发。
    const bootstrapTimeoutMs = Math.max(
      1,
      (Number.isFinite(input.timeoutMs) ? input.timeoutMs : 60_000) + CHILD_BOOTSTRAP_MARGIN_MS,
    );
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new SandboxExecHarnessError(
          'protocol',
          `沙箱执行子进程 ${bootstrapTimeoutMs}ms 内没有回传结果，已判定为工装故障`,
        ),
      );
    }, bootstrapTimeoutMs);
    timer.unref();

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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

    child.on('close', (code, signal) => {
      settle(() => {
        const reply = parseReply(buffer);
        if (reply === null) {
          reject(
            new SandboxExecHarnessError(
              'protocol',
              `沙箱执行子进程未回传可解析结果（exit=${String(code)} signal=${String(signal)}）`,
            ),
          );
          return;
        }
        if (!reply.ok) {
          reject(new SandboxExecHarnessError(reply.stage, reply.message));
          return;
        }
        resolve(toOutcome(reply));
      });
    });

    child.stdin?.on('error', () => {
      /* 子进程提前退出时写管道会报 EPIPE；真正的判据是 close 里有没有结果帧。 */
    });
    child.stdin?.end(JSON.stringify(request));
  });
}

/**
 * 子进程启动参数：源码入口要开类型剥离，构建产物（.js）不需要。
 * 用入口自身的扩展名判断：在 `dist` 下带 `--experimental-strip-types` 会多一条无用告警。
 */
function execArgs(entry: string): string[] {
  return entry.endsWith('.ts') ? ['--experimental-strip-types', entry] : [entry];
}

/** 子进程环境：剥掉继承来的代理变量，避免它连上尚未启动的代理端口。 */
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(out)) {
    if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete out[key];
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
  };
}

/**
 * 首期隔离后端注册与失败关闭门禁（ADR-0013、FR-12）。
 *
 * 只登记 sandbox-runtime。依赖存在、驱动标签和独立目录都不是隔离证明。
 * 本机探测未同时证明写边界、凭据边界、出站拒绝和进程树清理前，拒绝真实宿主。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { IsolationBackendRegistration } from '../domain/types.ts';

export const SANDBOX_RUNTIME_BACKEND_ID = 'sandbox-runtime';
export const SANDBOX_RUNTIME_VERSION = '0.0.81';

export const REQUIRED_ISOLATION_PROOFS = [
  'workspace_write_denied',
  'credential_read_denied',
  'egress_denied',
  'process_tree_reaped',
] as const;

export type IsolationProof = (typeof REQUIRED_ISOLATION_PROOFS)[number];

export interface IsolationProbeEvidence {
  proof: IsolationProof;
  passed: boolean;
  detail: string;
}

export interface IsolationGateResult {
  allowed: boolean;
  backend_id: string;
  os_family: NodeJS.Platform;
  status: 'verified_supported' | 'degraded' | 'blocked';
  missing: string[];
  evidence: IsolationProbeEvidence[];
  reason: string;
}

export interface IsolationRuntime {
  platform: NodeJS.Platform;
  checkDependencies(): Promise<{ errors: string[] }>;
  probe(): Promise<IsolationProbeEvidence[]>;
}

type SandboxRuntimeModule = {
  SandboxManager: {
    isSupportedPlatform(): boolean;
    checkDependenciesAsync(): Promise<{ errors: string[] }>;
    initialize(config: {
      network: { allowedDomains: string[]; deniedDomains: string[] };
      filesystem: {
        denyRead: string[];
        allowWrite: string[];
        denyWrite: string[];
      };
    }): Promise<void>;
    wrapWithSandboxArgv(
      command: string,
      binShell?: string,
      customConfig?: unknown,
      abortSignal?: AbortSignal,
      cwd?: string,
    ): Promise<{
      argv: string[];
      env: NodeJS.ProcessEnv;
    }>;
    reset(): Promise<void>;
  };
};

const registrations: IsolationBackendRegistration[] = [
  {
    backend_id: SANDBOX_RUNTIME_BACKEND_ID,
    version: SANDBOX_RUNTIME_VERSION,
    os_family: 'darwin',
    prerequisites: ['@anthropic-ai/sandbox-runtime', '本机隔离探测通过'],
    capabilities: [...REQUIRED_ISOLATION_PROOFS],
    limits: ['探测证据只对本次目标操作系统有效'],
  },
  {
    backend_id: SANDBOX_RUNTIME_BACKEND_ID,
    version: SANDBOX_RUNTIME_VERSION,
    os_family: 'linux',
    prerequisites: ['@anthropic-ai/sandbox-runtime', 'bubblewrap', '本机隔离探测通过'],
    capabilities: [...REQUIRED_ISOLATION_PROOFS],
    limits: ['探测证据只对本次目标操作系统有效'],
  },
  {
    backend_id: SANDBOX_RUNTIME_BACKEND_ID,
    version: SANDBOX_RUNTIME_VERSION,
    os_family: 'win32',
    prerequisites: ['@anthropic-ai/sandbox-runtime', 'windows-install', '本机隔离探测通过'],
    capabilities: [],
    limits: [
      'Windows 支持为试验版',
      '默认拒绝真实运行',
      '系统 curl、PowerShell 与 .NET 的 HTTPS 在沙箱内可能失败',
      'macOS 或 Linux 的探测证据不能继承到 Windows',
    ],
  },
];

/** 当前已注册的隔离后端。没有第二后端可自动降级。 */
export function listIsolationBackends(): IsolationBackendRegistration[] {
  return registrations.map((item) => ({
    ...item,
    ...(item.limits !== undefined ? { limits: [...item.limits] } : {}),
  }));
}

export function findIsolationBackend(
  osFamily: NodeJS.Platform,
): IsolationBackendRegistration | undefined {
  return listIsolationBackends().find(
    (item) => item.backend_id === SANDBOX_RUNTIME_BACKEND_ID && item.os_family === osFamily,
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function loadSandboxRuntime(): Promise<SandboxRuntimeModule> {
  return (await import('@anthropic-ai/sandbox-runtime')) as SandboxRuntimeModule;
}

/** 生产用运行时：依赖检查与四项探测都走 sandbox-runtime，不看驱动标签。 */
export function createSandboxRuntime(
  platform: NodeJS.Platform = process.platform,
): IsolationRuntime {
  return {
    platform,
    async checkDependencies() {
      const runtime = await loadSandboxRuntime();
      if (!runtime.SandboxManager.isSupportedPlatform()) {
        return { errors: [`当前操作系统 ${platform} 不在 sandbox-runtime 支持范围内`] };
      }
      return runtime.SandboxManager.checkDependenciesAsync();
    },
    probe: () => probeSandboxRuntime(platform),
  };
}

async function probeSandboxRuntime(platform: NodeJS.Platform): Promise<IsolationProbeEvidence[]> {
  if (platform === 'win32') {
    return REQUIRED_ISOLATION_PROOFS.map((proof) => ({
      proof,
      passed: false,
      detail: 'Windows 隔离仍为试验状态，本机探测通过前拒绝真实运行',
    }));
  }
  const runtime = await loadSandboxRuntime();
  let initialized = false;
  let root = '';
  try {
    root = mkdtempSync(join(tmpdir(), 'proctor-isolation-'));
    return await runProbe(runtime, root, (value) => {
      initialized = value;
    });
  } finally {
    if (initialized) await runtime.SandboxManager.reset().catch(() => undefined);
    if (root !== '') rmSync(root, { recursive: true, force: true });
  }
}

async function runProbe(
  runtime: SandboxRuntimeModule,
  root: string,
  markInitialized: (value: boolean) => void,
): Promise<IsolationProbeEvidence[]> {
  const work = join(root, 'work');
  const outside = join(root, 'outside.txt');
  const secret = join(root, 'secret.txt');
  const secretValue = 'proctor-isolation-secret';
  writeFileSync(secret, secretValue);
  writeFileSync(outside, 'outside');
  const marker = join(work, 'grandchild-alive');
  const boundaryCommand = [
    'if echo denied >',
    shellQuote(outside),
    '; then echo WRITE_ALLOWED; else echo WRITE_DENIED; fi;',
    'if [ "$(cat',
    shellQuote(secret),
    '2>/dev/null)" =',
    shellQuote(secretValue),
    ']; then echo SECRET_READ; else echo SECRET_DENIED; fi;',
    'if ! command -v python3 >/dev/null 2>&1; then echo EGRESS_UNPROBED;',
    'elif python3 -c "import socket;s=socket.create_connection((\'example.com\',443),2);s.close()"; then echo EGRESS_ALLOWED;',
    'else echo EGRESS_DENIED; fi',
  ].join(' ');
  mkdirSync(work);
  await runtime.SandboxManager.initialize({
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: {
      denyRead: [secret],
      allowWrite: [work],
      denyWrite: [outside],
    },
  });
  markInitialized(true);
  const wrapped = await runtime.SandboxManager.wrapWithSandboxArgv(
    boundaryCommand,
    undefined,
    undefined,
    undefined,
    work,
  );
  const boundary = runWrapped(wrapped, work, 8_000);
  const treeToken = `proctor-tree-${process.pid}-${Date.now().toString(36)}`;
  const sleeper = await runtime.SandboxManager.wrapWithSandboxArgv(
    `sh -c ${shellQuote(`exec -a ${treeToken} sleep 30; touch ${marker}`)} & wait`,
    undefined,
    undefined,
    undefined,
    work,
  );
  const tree = await runProcessGroup(sleeper, work, 1_000, treeToken);
  const output = `${boundary.stdout ?? ''}\n${boundary.stderr ?? ''}`;
  const treeReaped = tree.timedOut && tree.reaped && !existsSync(marker);
  const evidence: IsolationProbeEvidence[] = [
    {
      proof: 'workspace_write_denied',
      passed: output.includes('WRITE_DENIED') && !output.includes('WRITE_ALLOWED'),
      detail: output.includes('WRITE_DENIED') ? '工作区外写入被拒绝' : '未证明工作区外不可写',
    },
    {
      proof: 'credential_read_denied',
      passed: output.includes('SECRET_DENIED') && !output.includes('SECRET_READ'),
      detail: output.includes('SECRET_DENIED') ? '凭据路径不可读' : '未证明凭据路径不可读',
    },
    {
      proof: 'egress_denied',
      passed: !output.includes('EGRESS_ALLOWED') && !output.includes('EGRESS_UNPROBED'),
      detail: output.includes('EGRESS_ALLOWED')
        ? '未允许的出站连接成功'
        : output.includes('EGRESS_UNPROBED')
          ? '缺少 python3，无法证明出站被拒绝'
          : '未允许的出站连接被拒绝',
    },
    {
      proof: 'process_tree_reaped',
      passed: treeReaped,
      detail: treeReaped ? '超时后进程树已清理' : '超时后进程树未确认清理',
    },
  ];
  return evidence;
}

function runProcessGroup(
  wrapped: { argv: string[]; env: NodeJS.ProcessEnv },
  cwd: string,
  timeout: number,
  token: string,
): Promise<{ timedOut: boolean; reaped: boolean }> {
  const [bin, ...args] = wrapped.argv;
  if (bin === undefined) throw new Error('隔离后端没有返回可执行命令');
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: wrapped.env, detached: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid === undefined) child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeout);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      setTimeout(() => {
        const first = listProcesses();
        setTimeout(() => {
          const second = listProcesses();
          resolve({
            timedOut,
            reaped:
              first.listed &&
              second.listed &&
              !first.text.includes(token) &&
              !second.text.includes(token),
          });
        }, 200);
      }, 200);
    });
  });
}

function listProcesses(): { listed: boolean; text: string } {
  const ps = spawnSync('ps', ['-ax', '-o', 'command='], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    listed: ps.status === 0 && ps.error === undefined,
    text: ps.stdout ?? '',
  };
}

function blockedByProbe(
  platform: NodeJS.Platform,
  backendId: string,
  missing: string[],
  evidence: IsolationProbeEvidence[] = [],
): IsolationGateResult {
  return {
    allowed: false,
    backend_id: backendId,
    os_family: platform,
    status: platform === 'win32' ? 'degraded' : 'blocked',
    missing,
    evidence,
    reason:
      platform === 'win32'
        ? 'Windows 隔离后端为降级状态，本机探测未通过，已拒绝启动真实宿主任务'
        : `隔离探测未通过：${missing.join('、')}`,
  };
}

function runWrapped(
  wrapped: { argv: string[]; env: NodeJS.ProcessEnv },
  cwd: string,
  timeout: number,
): ReturnType<typeof spawnSync> {
  const [bin, ...args] = wrapped.argv;
  if (bin === undefined) {
    throw new Error('隔离后端没有返回可执行命令');
  }
  return spawnSync(bin, args, {
    encoding: 'utf8',
    timeout,
    cwd,
    killSignal: 'SIGKILL',
    env: wrapped.env,
  });
}

function missingProofs(evidence: IsolationProbeEvidence[]): string[] {
  return REQUIRED_ISOLATION_PROOFS.filter(
    (proof) => !evidence.some((item) => item.proof === proof && item.passed),
  );
}

/**
 * 真实宿主放行门禁。Windows 即使依赖检查通过也保持拒绝，直到四项本机探测都通过。
 * 其他操作系统缺注册项、依赖或任一项探测时同样拒绝。
 *
 * 进程级缓存：sandbox-runtime 的 SandboxManager 是全局单例，
 * 并发 initialize()/reset() 会互相干扰导致 credential_read_denied 等假阳性。
 * 因此只探测一次，后续调用直接返回缓存结果。
 */
let _cachedGate: IsolationGateResult | undefined;

/** 清空隔离门禁缓存（测试隔离用；生产进程内无需调用）。 */
export function resetIsolationGateCache(): void {
  _cachedGate = undefined;
}

export async function evaluateIsolationGate(
  runtime: IsolationRuntime = createSandboxRuntime(),
): Promise<IsolationGateResult> {
  if (_cachedGate !== undefined) return _cachedGate;
  const backend = findIsolationBackend(runtime.platform);
  if (backend === undefined) {
    return {
      allowed: false,
      backend_id: SANDBOX_RUNTIME_BACKEND_ID,
      os_family: runtime.platform,
      status: 'blocked',
      missing: ['已注册的隔离后端'],
      evidence: [],
      reason: `当前操作系统 ${runtime.platform} 没有已注册的隔离后端，已拒绝启动真实宿主任务`,
    };
  }
  let dependencies: { errors: string[] };
  try {
    dependencies = await runtime.checkDependencies();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return blockedByProbe(runtime.platform, backend.backend_id, [`依赖检查失败：${detail}`]);
  }
  if (dependencies.errors.length > 0) {
    return blockedByProbe(runtime.platform, backend.backend_id, dependencies.errors);
  }
  let evidence: IsolationProbeEvidence[];
  try {
    evidence = await runtime.probe();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return blockedByProbe(runtime.platform, backend.backend_id, [`隔离探测无法完成：${detail}`]);
  }
  const missing = missingProofs(evidence);
  if (missing.length > 0) {
    const result = blockedByProbe(runtime.platform, backend.backend_id, missing, evidence);
    _cachedGate = result;
    return result;
  }
  const result: IsolationGateResult = {
    allowed: true,
    backend_id: backend.backend_id,
    os_family: runtime.platform,
    status: 'verified_supported',
    missing: [],
    evidence,
    reason: '本机隔离探测已通过',
  };
  _cachedGate = result;
  return result;
}

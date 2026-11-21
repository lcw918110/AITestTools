import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseRevision, EnvironmentProfile } from '../../src/exam-engine/types.ts';
import { buildRunSummary } from '../../apps/console/run-summary.ts';
import type { runSandboxedHostInChild } from '../../src/security/sandbox-exec.ts';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';

const hostedIO = vi.hoisted(() => ({ stdout: '', status: 0 as number | null }));

type StubHostIO = {
  stdout: string;
  stderr?: string;
  status: number | null;
  signal?: NodeJS.Signals | string | null;
  error?: (Error & { code?: string }) | null;
  mutate?: ((cwd: string) => void) | undefined;
  hang?: boolean;
  timeoutMs?: number;
};

/**
 * 宿主执行替身（ADR-0014）。
 *
 * 真实实现里「沙箱包裹 + 宿主执行」在独立子进程内完成，进程内的
 * `node:child_process` 桩跨不过这条边界。这里直接替换**主进程侧**的执行入口，
 * 语义与真实回传一致：非 0 退出只是观测结果，包裹/协议故障才抛工装错误。
 */
function sandboxExecStub(hostedIO: StubHostIO) {
  return {
    runSandboxedHostInChild: async (input: { bin: string; cwd: string; timeoutMs: number }) => {
      wrappedHosts.calls.push(input.bin);
      sandboxCalls.bins.push(input.bin);
      if (hostedIO.hang === true) {
        await sleep(hostedIO.timeoutMs ?? input.timeoutMs);
        return {
          status: null,
          signal: 'SIGTERM' as NodeJS.Signals,
          error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
          stdout: '',
          stderr: '',
          timedOut: true,
          stdioDestroyed: false,
        };
      }
      if (hostedIO.mutate !== undefined && input.cwd.length > 0) hostedIO.mutate(input.cwd);
      const signal =
        typeof hostedIO.signal === 'string'
          ? (hostedIO.signal as NodeJS.Signals)
          : (hostedIO.signal ?? null);
      return {
        status: hostedIO.status,
        signal,
        error: hostedIO.error ?? null,
        stdout: hostedIO.stdout,
        stderr: hostedIO.stderr ?? '',
        timedOut: false,
        stdioDestroyed: false,
      };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

vi.mock('../../src/security/sandbox-exec.ts', async (importOriginal) => {
  // 只桩「宿主执行」这一跳：`SandboxExecHarnessError` 等错误类型必须保留真实类，
  // 否则适配器里的 `instanceof` 判定会失效（归因会从 HARNESS 漂走）。
  const actual = await importOriginal<{
    runSandboxedHostInChild: typeof runSandboxedHostInChild;
  }>();
  return { ...actual, ...sandboxExecStub(hostedIO) };
});

vi.mock('node:child_process', async (importOriginal) => {
  // 只桩 `spawnSync`：隔离门禁与适配器仍用它探测 `opencode --version` / 运行宿主。
  // 「是否真的执行了 opencode run」的判据是 `spawnSync` 的调用记录：
  // 宿主进程已在短命子进程内启动（ADR-0014），主进程侧的 `spawn` 不参与判定。
  const actual = (await importOriginal()) as {
    spawnSync: (...args: readonly unknown[]) => unknown;
  };
  return {
    ...actual,
    spawnSync: vi.fn((command: string, args?: readonly string[], options?: object) => {
      const bin = String(command);
      const head = args?.[0];
      if (bin === 'opencode' || bin.endsWith('/opencode') || args?.includes('opencode')) {
        if (head === '--version' || args?.includes('--version')) {
          return {
            status: 0,
            stdout: 'opencode-test 0.0.0\n',
            stderr: '',
            pid: 1,
            output: [],
            signal: null,
          };
        }
        if (head === 'run' || args?.includes('run')) {
          return {
            status: hostedIO.status,
            stdout: hostedIO.stdout,
            stderr: '',
            pid: 1,
            output: [],
            signal: null,
          };
        }
      }
      return actual.spawnSync(command, args as string[], options);
    }),
  };
});

const isolationGate = vi.hoisted(() => ({ allowed: false, reason: '测试桩：隔离探测未通过' }));
vi.mock('../../src/security/isolation-backend.ts', () => ({
  evaluateIsolationGate: vi.fn(async () => isolationGate),
}));
const wrappedHosts = vi.hoisted(() => ({ calls: [] as string[] }));
// 主进程侧执行入口的调用记录：断言「宿主执行发生在子进程边界之后」。
const sandboxCalls = vi.hoisted(() => ({ bins: [] as string[] }));
// 断言「宿主被包裹后执行」：真实实现里包裹发生在执行子进程内（ADR-0014），
// 主进程只能通过执行入口的入参看到宿主命令，故在此记录。

const { HostedAdapter } = await import('../../src/run/hosted-runner.ts');
const { RunOrchestrator } = await import('../../src/run/run-orchestrator.ts');

// 仅用于已 mock 宿主进程的输出解析测试，不进入生产适配器选择路径。
class ControlledHostedAdapter extends HostedAdapter {
  override async preflight() {
    return { ok: true };
  }
}

async function runHosted(
  revision: CaseRevision,
  environment: EnvironmentProfile,
  projectRoot: string,
  artifactDir: string,
  adapter: InstanceType<typeof HostedAdapter> = new ControlledHostedAdapter(),
) {
  const orch = new RunOrchestrator();
  orch.beginRun({});
  orch.transitionRun('preflight');
  orch.transitionRun('running');
  const { results } = await orch.executeCase(revision, environment, adapter, {
    projectRoot,
    models: [],
    artifactDir,
  });
  return results[0]!;
}

function makeRevision(oracles: CaseRevision['expect']['oracles']): CaseRevision {
  return {
    case_id: 'paired-task-157',
    case_revision_id: 'paired-task-157.r1.off',
    revision_number: 1,
    content_hash: '0'.repeat(64),
    stimulus: {
      kind: 'task_prompt',
      ref: 'missing/prompt.txt',
      hosted_pass_token: 'DUAL_FIX',
    },
    expect: { oracles },
    execution_profile: { mode: 'hosted' },
    attribution_focus: 'MODEL_TASK',
    execution: { deadline_ms: 5_000, requires_network: true },
  };
}

const environment: EnvironmentProfile = {
  environment_profile_id: 'hosted-plain-test',
  name: 'hosted-plain-test',
  lifecycle: 'active',
  recipe: {
    kind: 'hosted',
    host_command: 'opencode',
    host_model: 'test/model',
    isolation_profile: 'isolated',
  },
};

describe('hosted_pass_token 降为辅助', () => {
  const prevPlugin = process.env.PROCTOR_HOSTED_PLUGIN;
  const prevModel = process.env.PROCTOR_HOSTED_MODEL;

  beforeEach(() => {
    wrappedHosts.calls = [];
    sandboxCalls.bins = [];
    isolationGate.allowed = false;
    hostedIO.stdout = '';
    hostedIO.status = 0;
    delete process.env.PROCTOR_HOSTED_PLUGIN;
    delete process.env.PROCTOR_HOSTED_MODEL;
  });

  afterEach(() => {
    if (prevPlugin === undefined) delete process.env.PROCTOR_HOSTED_PLUGIN;
    else process.env.PROCTOR_HOSTED_PLUGIN = prevPlugin;
    if (prevModel === undefined) delete process.env.PROCTOR_HOSTED_MODEL;
    else process.env.PROCTOR_HOSTED_MODEL = prevModel;
  });

  it.each([undefined, 'scripted', 'none', 'invalid', 'live'])(
    '宿主驱动标签 %s 不能绕过缺失隔离阻断',
    async (driver) => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'proctor-guard-proj-'));
      const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-guard-art-'));
      const candidate: EnvironmentProfile = {
        ...environment,
        // 通过反序列化模拟外部非法配置，生产枚举约束保持不变。
        recipe: JSON.parse(
          JSON.stringify({
            ...environment.recipe,
            ...(driver === undefined ? {} : { model_driver: driver }),
          }),
        ) as EnvironmentProfile['recipe'],
      };
      const spawn = vi.mocked((await import('node:child_process')).spawnSync);
      spawn.mockClear();
      sandboxCalls.bins = [];
      const result = await runHosted(
        makeRevision([]),
        candidate,
        projectRoot,
        artifactDir,
        new HostedAdapter(),
      );
      expect(result.pass).toBe(false);
      expect(result.attribution).toBe('HARNESS');
      expect(result.oracle_failures[0]?.message).toContain('操作系统级隔离');
      expect(spawn.mock.calls.some((call) => call[1]?.[0] === 'run')).toBe(false);
      // 阻断必须发生在子进程执行之前：执行入口一次都不该被调用。
      expect(sandboxCalls.bins).toEqual([]);
    },
  );

  it('真实 live hosted 环境缺已验证隔离后端时在 preflight 阻断，不执行 opencode run', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'proctor-iso-proj-'));
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-iso-art-'));
    const liveEnvironment: EnvironmentProfile = {
      ...environment,
      recipe: { ...environment.recipe, model_driver: 'live' },
    };
    const result = await runHosted(
      makeRevision([]),
      liveEnvironment,
      projectRoot,
      artifactDir,
      new HostedAdapter(),
    );
    expect(result.pass).toBe(false);
    expect(result.attribution).toBe('HARNESS');
    expect(result.oracle_failures[0]?.message).toContain('操作系统级隔离');
  });

  it('workspace 命中、无 token、空 stdout → 整题 PASS，产物/摘要 pass_token_present false', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'proctor-aux-proj-'));
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-aux-art-'));
    const revision = makeRevision([
      { id: 'exit0', type: 'exit_code', equals: 0 },
      {
        id: 'readme',
        type: 'workspace_assert',
        path: 'README.md',
        contains: 'proctor hosted workspace',
      },
    ]);

    isolationGate.allowed = true;
    const result = await runHosted(revision, environment, projectRoot, artifactDir);
    expect(wrappedHosts.calls).toEqual(['opencode']);
    expect(result.pass).toBe(true);
    expect(result.oracle_failures).toEqual([]);
    expect(result.attribution).toBeUndefined();
    expect(result.pass_token).toBe('DUAL_FIX');
    expect(result.pass_token_present).toBe(false);
    expect(result.pass_token_role).toBe('auxiliary');
    expect(result.workspace_ok).toBe(true);
    expect(result.timed_out).toBe(false);

    const hostedRun = JSON.parse(readFileSync(join(artifactDir, 'hosted-run.json'), 'utf8')) as {
      pass_token?: string;
      pass_token_present?: boolean;
      pass_token_role?: string;
      stdout?: string;
    };
    expect(hostedRun.pass_token).toBe('DUAL_FIX');
    expect(hostedRun.pass_token_present).toBe(false);
    expect(hostedRun.pass_token_role).toBe('auxiliary');
    expect(hostedRun.stdout ?? '').toBe('');

    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-aux-runs-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'aux-token',
        dataset: 'paired-off-effect-smoke',
        environment: 'hosted-plain-test',
        started_at: '2026-09-01T00:00:00.000Z',
        project_root: projectRoot,
        items: [{ id: revision.case_revision_id, rev: revision.revision_number }],
      },
      results: [result],
    });

    const nd = JSON.parse(readFileSync(join(written.dir, 'results.ndjson'), 'utf8')) as {
      pass: boolean;
      pass_token_present: boolean;
      pass_token: string;
    };
    expect(nd.pass).toBe(true);
    expect(nd.pass_token_present).toBe(false);
    expect(nd.pass_token).toBe('DUAL_FIX');

    const runMeta = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ pass_token_present?: boolean; pass_token?: string }>;
    };
    expect(runMeta.items[0]?.pass_token_present).toBe(false);
    expect(runMeta.items[0]?.pass_token).toBe('DUAL_FIX');

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('无 DUAL_FIX');
    expect(report).toContain('暗号为辅助信号');

    const summary = buildRunSummary({
      resultsText: readFileSync(join(written.dir, 'results.ndjson'), 'utf8'),
      metricsText: readFileSync(join(written.dir, 'metrics.json'), 'utf8'),
      scoresText: null,
    });
    expect(summary.attribution.pass_total).toBe(1);
    expect(summary.failures).toHaveLength(0);
    expect(summary.pass_tokens[0]?.pass_token_present).toBe(false);
    expect(summary.pass_tokens[0]?.label).toBe('无 DUAL_FIX');
  });

  it('无 token 且 workspace 未命中 → FAIL MODEL_TASK，不是 PROTOCOL', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'proctor-aux-proj-'));
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-aux-art-'));
    const revision = makeRevision([
      { id: 'exit0', type: 'exit_code', equals: 0 },
      {
        id: 'discount-round',
        type: 'workspace_assert',
        path: 'lib/discount.mjs',
        contains: 'Math.round',
      },
    ]);

    isolationGate.allowed = true;
    const result = await runHosted(revision, environment, projectRoot, artifactDir);
    expect(result.pass).toBe(false);
    expect(result.attribution).toBe('MODEL_TASK');
    expect(result.attribution).not.toBe('PROTOCOL');
    expect(result.pass_token_present).toBe(false);
    expect(result.oracle_failures[0]?.message).toMatch(/discount|workspace|lib\/discount/);
    expect(result.oracle_failures.some((f) => /未含约定/.test(f.message))).toBe(false);
  });
});

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseRevision, EnvironmentProfile } from '../../src/exam-engine/types.ts';
import { buildRunSummary } from '../../apps/console/run-summary.ts';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';

const hostedIO = vi.hoisted(() => ({ stdout: '', status: 0 as number | null }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    spawnSync: (command: string, args?: readonly string[], options?: object) => unknown;
    spawn: (command: string, args?: readonly string[], options?: object) => unknown;
  };
  const fakeSpawn = (command: string, args?: readonly string[], _options?: object) => {
    const bin = String(command);
    const head = args?.[0];
    const isHost = bin === 'opencode' || bin.endsWith('/opencode') || args?.includes('opencode');
    const isRun = head === 'run' || args?.includes('run');
    const stdout = isHost && isRun ? hostedIO.stdout : '';
    const status = isHost && isRun ? hostedIO.status : 0;
    const listeners: Record<string, Array<(arg?: unknown) => void>> = {};
    const child = {
      pid: 1,
      stdout: {
        on: (ev: string, cb: (arg?: unknown) => void) => {
          (listeners[`stdout:${ev}`] ??= []).push(cb);
        },
      },
      stderr: {
        on: (ev: string, cb: (arg?: unknown) => void) => {
          (listeners[`stderr:${ev}`] ??= []).push(cb);
        },
      },
      on: (ev: string, cb: (arg?: unknown) => void) => {
        (listeners[ev] ??= []).push(cb);
      },
      kill: () => true,
    };
    queueMicrotask(() => {
      if (stdout) for (const cb of listeners['stdout:data'] ?? []) cb(Buffer.from(stdout));
      for (const cb of listeners['close'] ?? []) cb(status, null);
    });
    return child;
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
    spawn: vi.fn(fakeSpawn),
  };
});

const isolationGate = vi.hoisted(() => ({ allowed: false, reason: '测试桩：隔离探测未通过' }));
vi.mock('../../src/security/isolation-backend.ts', () => ({
  evaluateIsolationGate: vi.fn(async () => isolationGate),
}));
const wrappedHosts = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../../src/security/sandbox-runtime.ts', async () => {
  const actual = await vi.importActual('../../src/security/sandbox-runtime.ts');
  return {
    ...actual,
    wrapHostCommand: async (input: { bin: string; args: string[] }) => {
      wrappedHosts.calls.push(input.bin);
      return { argv: [input.bin, ...input.args], env: {} };
    },
  };
});

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

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseRevision, EnvironmentProfile } from '../../src/exam-engine/types.ts';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';
import { buildRunSummary } from '../../apps/console/run-summary.ts';

const hostedIO = vi.hoisted(() => ({
  stdout: '',
  stderr: '',
  status: 0 as number | null,
  signal: null as NodeJS.Signals | string | null,
  error: null as (Error & { code?: string }) | null,
  mutate: undefined as ((cwd: string) => void) | undefined,
  /** true 时模拟宿主卡死：不主动 close，等平台 deadline 触发 kill。 */
  hang: false,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    spawnSync: (...args: readonly unknown[]) => unknown;
    spawn: (...args: readonly unknown[]) => unknown;
  };
  const fakeSpawn = (command: string, args?: readonly string[], options?: object) => {
    const bin = String(command);
    const head = args?.[0];
    const cwd =
      options !== undefined &&
      typeof options === 'object' &&
      'cwd' in options &&
      typeof (options as { cwd?: string }).cwd === 'string'
        ? (options as { cwd: string }).cwd
        : '';
    const isHost = bin === 'opencode' || bin.endsWith('/opencode') || args?.includes('opencode');
    const isRun = head === 'run' || args?.includes('run');
    const stdout = isHost && isRun ? hostedIO.stdout : '';
    const stderr = isHost && isRun ? hostedIO.stderr : '';
    const status = isHost && isRun ? hostedIO.status : 0;
    const signal = isHost && isRun ? hostedIO.signal : null;
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const emitClose = (code: number | null, sig: NodeJS.Signals | string | null) => {
      for (const cb of listeners['close'] ?? []) cb(code, sig);
    };
    const child = {
      // 必须是 >1 的假 PID：reapTree 会用 process.kill(-pid) 杀进程组，
      // 若这里给 1，负号后就是 kill(-1) —— 向当前用户所有进程广播，会杀掉跑测试的编辑器本身。
      pid: 987_654,
      stdout: {
        on: (ev: string, cb: (...args: unknown[]) => void) => {
          (listeners[`stdout:${ev}`] ??= []).push(cb);
        },
      },
      stderr: {
        on: (ev: string, cb: (...args: unknown[]) => void) => {
          (listeners[`stderr:${ev}`] ??= []).push(cb);
        },
      },
      on: (ev: string, cb: (...args: unknown[]) => void) => {
        (listeners[ev] ??= []).push(cb);
      },
      // 真实语义：kill 后进程以该信号退出，close 携带 (null, signal)。
      // 平台 deadline 路径正是靠这里驱动，不能用「立即 close」绕过。
      kill: (sig?: NodeJS.Signals) => {
        if (isHost && isRun && hostedIO.hang) {
          queueMicrotask(() => emitClose(null, sig ?? 'SIGTERM'));
        }
        return true;
      },
    };
    queueMicrotask(() => {
      if (isHost && isRun && hostedIO.mutate !== undefined && cwd.length > 0) hostedIO.mutate(cwd);
      if (stdout) for (const cb of listeners['stdout:data'] ?? []) cb(Buffer.from(stdout));
      if (stderr) for (const cb of listeners['stderr:data'] ?? []) cb(Buffer.from(stderr));
      // hang=true 时故意不 close：模拟宿主卡死，等平台 deadline 触发 kill。
      // 这样 `runHostedWithReap` 的 `timedOut` 标志由真实定时器置位，
      // 覆盖 `deadlineFired` 主路径，而不是只测 ETIMEDOUT 兜底。
      if (isHost && isRun && hostedIO.hang) return;
      emitClose(status, signal);
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
          const cwd =
            options !== undefined &&
            typeof options === 'object' &&
            'cwd' in options &&
            typeof (options as { cwd?: string }).cwd === 'string'
              ? (options as { cwd: string }).cwd
              : '';
          if (hostedIO.mutate !== undefined && cwd.length > 0) hostedIO.mutate(cwd);
          return {
            status: hostedIO.status,
            stdout: hostedIO.stdout,
            stderr: hostedIO.stderr,
            pid: 1,
            output: [],
            signal: hostedIO.signal,
            error: hostedIO.error ?? undefined,
          };
        }
      }
      return actual.spawnSync(command, args as string[], options);
    }),
    spawn: vi.fn(fakeSpawn),
  };
});

vi.mock('../../src/security/isolation-backend.ts', () => ({
  evaluateIsolationGate: vi.fn(async () => ({ allowed: true, reason: '测试桩：隔离探测通过' })),
}));
vi.mock('../../src/security/sandbox-runtime.ts', async () => {
  const actual = await vi.importActual('../../src/security/sandbox-runtime.ts');
  return {
    ...actual,
    wrapHostCommand: async (input: { bin: string; args: string[] }) => ({
      argv: [input.bin, ...input.args],
      env: {},
    }),
  };
});

const { HostedAdapter } = await import('../../src/run/hosted-runner.ts');
const { RunOrchestrator } = await import('../../src/run/run-orchestrator.ts');

// 仅在本文件已 mock 宿主执行的前提下验证超时与工作区语义。
class ControlledHostedAdapter extends HostedAdapter {
  override async preflight() {
    return { ok: true };
  }
}

const projectRoot = resolve('examples/product-eval');

async function runHosted(
  revision: CaseRevision,
  environment: EnvironmentProfile,
  artifactDir: string,
) {
  const orch = new RunOrchestrator();
  orch.beginRun({});
  orch.transitionRun('preflight');
  orch.transitionRun('running');
  const { results } = await orch.executeCase(revision, environment, new ControlledHostedAdapter(), {
    projectRoot,
    models: [],
    artifactDir,
  });
  return results[0]!;
}

function loadRevision(name: string): CaseRevision {
  return JSON.parse(
    readFileSync(join(projectRoot, 'case-revisions', name), 'utf8'),
  ) as CaseRevision;
}

/** 把题目 deadline 压到极短，让平台定时器真实触发（而非靠 ETIMEDOUT 兜底）。 */
function withShortDeadline(revision: CaseRevision, deadlineMs = 150): CaseRevision {
  return {
    ...revision,
    execution: { ...revision.execution, deadline_ms: deadlineMs },
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

function patch157(cwd: string): void {
  mkdirSync(join(cwd, 'lib'), { recursive: true });
  writeFileSync(
    join(cwd, 'lib/discount.mjs'),
    'export function applyDiscount(cents, percent) {\n  return cents - Math.round((cents * percent) / 100);\n}\n',
  );
  writeFileSync(
    join(cwd, 'lib/tax.mjs'),
    'export function addTax(cents, bps) {\n  return Math.round((cents * (10000 + bps)) / 10000);\n}\n',
  );
}

function patch157Wrong(cwd: string): void {
  mkdirSync(join(cwd, 'lib'), { recursive: true });
  writeFileSync(join(cwd, 'lib/discount.mjs'), 'export function applyDiscount() { return 0 }\n');
}

describe('hosted 超时仍跑 workspace_assert', () => {
  const prevPlugin = process.env.PROCTOR_HOSTED_PLUGIN;
  const prevModel = process.env.PROCTOR_HOSTED_MODEL;

  beforeEach(() => {
    hostedIO.stdout = '';
    hostedIO.stderr = '';
    hostedIO.status = 0;
    hostedIO.signal = null;
    hostedIO.error = null;
    hostedIO.mutate = undefined;
    hostedIO.hang = false;
    delete process.env.PROCTOR_HOSTED_PLUGIN;
    delete process.env.PROCTOR_HOSTED_MODEL;
  });

  afterEach(() => {
    if (prevPlugin === undefined) delete process.env.PROCTOR_HOSTED_PLUGIN;
    else process.env.PROCTOR_HOSTED_PLUGIN = prevPlugin;
    if (prevModel === undefined) delete process.env.PROCTOR_HOSTED_MODEL;
    else process.env.PROCTOR_HOSTED_MODEL = prevModel;
  });

  it('超时 + 工作区已改为正确 → PASS，报告标明超时', async () => {
    hostedIO.hang = true;
    hostedIO.mutate = patch157;
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-to-ok-'));
    const revision = withShortDeadline(loadRevision('paired-task-157.r1.off.case-revision.json'));
    const result = await runHosted(revision, environment, artifactDir);
    expect(result.pass).toBe(true);
    expect(result.timed_out).toBe(true);
    expect(result.workspace_ok).toBe(true);
    expect(result.host_exit).toBeNull();
    expect(result.attribution).toBeUndefined();

    const hostedRun = JSON.parse(readFileSync(join(artifactDir, 'hosted-run.json'), 'utf8')) as {
      timed_out?: boolean;
      workspace_ok?: boolean;
      workspace_ran?: boolean;
      host_exit?: number | null;
    };
    expect(hostedRun.timed_out).toBe(true);
    expect(hostedRun.workspace_ok).toBe(true);
    expect(hostedRun.workspace_ran).toBe(true);
    expect(hostedRun.host_exit).toBeNull();

    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-to-ok-runs-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'to-ok',
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
      timed_out: boolean;
      workspace_ok: boolean;
    };
    expect(nd.pass).toBe(true);
    expect(nd.timed_out).toBe(true);
    expect(nd.workspace_ok).toBe(true);
    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('超时');
    expect(report).toContain('工作区');
    expect(report).toMatch(/yes.*过/);
    const summary = buildRunSummary({
      resultsText: readFileSync(join(written.dir, 'results.ndjson'), 'utf8'),
      metricsText: readFileSync(join(written.dir, 'metrics.json'), 'utf8'),
      scoresText: null,
    });
    expect(summary.pass_tokens[0]?.timed_out).toBe(true);
    expect(summary.pass_tokens[0]?.workspace_ok).toBe(true);
    expect(summary.attribution.pass_total).toBe(1);
  });

  it('超时 + 文件未动 → FAIL CONTEXT，且跑了 workspace_assert', async () => {
    hostedIO.hang = true;
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-to-miss-'));
    const revision = withShortDeadline(loadRevision('paired-task-157.r1.off.case-revision.json'));
    const result = await runHosted(revision, environment, artifactDir);
    expect(result.pass).toBe(false);
    expect(result.timed_out).toBe(true);
    expect(result.workspace_ok).toBe(false);
    expect(result.materials_mutated).toBe(false);
    expect(result.attribution).toBe('CONTEXT');
    expect(result.oracle_failures.some((f) => /workspace|discount|未含/.test(f.message))).toBe(
      true,
    );
    const hostedRun = JSON.parse(readFileSync(join(artifactDir, 'hosted-run.json'), 'utf8')) as {
      workspace_ran?: boolean;
      workspace_ok?: boolean;
    };
    expect(hostedRun.workspace_ran).toBe(true);
    expect(hostedRun.workspace_ok).toBe(false);
  });

  it('ON 超时 + 文件未动 → FAIL CONTEXT，不是 PROTOCOL', async () => {
    hostedIO.hang = true;
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-to-on-miss-'));
    const revision = withShortDeadline(loadRevision('paired-task-157.r1.on.case-revision.json'));
    expect(revision.attribution_focus).toBe('PROTOCOL');
    const result = await runHosted(revision, environment, artifactDir);
    expect(result.pass).toBe(false);
    expect(result.workspace_ok).toBe(false);
    expect(result.materials_mutated).toBe(false);
    expect(result.attribution).toBe('CONTEXT');
    expect(result.attribution).not.toBe('PROTOCOL');
  });

  it('超时 + 改了但改错 → FAIL MODEL_TASK；ON 的 PROTOCOL focus 不能盖工作区', async () => {
    hostedIO.hang = true;
    hostedIO.mutate = patch157Wrong;
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-to-wrong-'));
    const revision = withShortDeadline(loadRevision('paired-task-157.r1.on.case-revision.json'));
    expect(revision.attribution_focus).toBe('PROTOCOL');
    const result = await runHosted(revision, environment, artifactDir);
    expect(result.pass).toBe(false);
    expect(result.timed_out).toBe(true);
    expect(result.workspace_ok).toBe(false);
    expect(result.materials_mutated).toBe(true);
    expect(result.attribution).toBe('MODEL_TASK');
    expect(result.attribution).not.toBe('PROTOCOL');
  });

  it('非 0 退出 + 工作区已对 → PASS，host_exit 记辅助', async () => {
    hostedIO.status = 1;
    hostedIO.mutate = patch157;
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-nz-ok-'));
    const revision = loadRevision('paired-task-157.r1.off.case-revision.json');
    const result = await runHosted(revision, environment, artifactDir);
    expect(result.pass).toBe(true);
    expect(result.timed_out).toBe(false);
    expect(result.workspace_ok).toBe(true);
    expect(result.host_exit).toBe(1);
  });

  it('退出码 0 + 日志含 providerID + 文件未改 → MODEL_TASK，不是 CONTEXT', async () => {
    hostedIO.status = 0;
    hostedIO.stderr = 'stream providerID=wave-ai llm.provider=wave-ai\n';
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-provider-log-'));
    const revision = loadRevision('paired-task-157.r1.off.case-revision.json');
    const result = await runHosted(revision, environment, artifactDir);
    expect(result.pass).toBe(false);
    expect(result.timed_out).toBe(false);
    expect(result.host_exit).toBe(0);
    expect(result.workspace_ok).toBe(false);
    expect(result.materials_mutated).toBe(false);
    expect(result.attribution).toBe('MODEL_TASK');
    expect(result.attribution).not.toBe('CONTEXT');
  });
});

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseRevision, EnvironmentProfile } from '../../src/exam-engine/types.ts';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';
import { buildRunSummary } from '../../apps/console/run-summary.ts';
import type { runSandboxedHostInChild } from '../../src/security/sandbox-exec.ts';

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
      // 宿主在超时前已经改动过工作区：真实实现里这些改动发生在 deadline 之前，
      // 必须在「卡到超时」之前落地，否则工作区断言看到的是空工作区。
      if (hostedIO.mutate !== undefined && input.cwd.length > 0) hostedIO.mutate(input.cwd);
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
  // 只桩 `spawnSync`：适配器仍用它探测 `opencode --version`。
  // 宿主进程本身已住短命子进程（ADR-0014），主进程侧的 `spawn` 不再参与宿主执行，
  // 因此这里不再伪造宿主子进程——伪造只会得到「恒真」的空转断言。
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
      }
      return actual.spawnSync(command, args as string[], options);
    }),
  };
});

vi.mock('../../src/security/isolation-backend.ts', () => ({
  evaluateIsolationGate: vi.fn(async () => ({ allowed: true, reason: '测试桩：隔离探测通过' })),
}));

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

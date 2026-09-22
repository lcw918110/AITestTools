import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc, RoomDoc } from '../../src/exam-engine/types.ts';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';
import { buildRunSummary } from '../../apps/console/run-summary.ts';

const hostedIO = vi.hoisted(() => ({
  stdout: '',
  stderr: '',
  status: 0 as number | null,
  signal: null as NodeJS.Signals | string | null,
  error: null as (Error & { code?: string }) | null,
  mutate: undefined as ((cwd: string) => void) | undefined,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    spawnSync: (command: string, args?: readonly string[], options?: object) => unknown;
  };
  return {
    ...actual,
    spawnSync: vi.fn((command: string, args?: readonly string[], options?: object) => {
      const bin = String(command);
      const head = args?.[0];
      if (bin === 'opencode' || bin.endsWith('/opencode')) {
        if (head === '--version') {
          return {
            status: 0,
            stdout: 'opencode-test 0.0.0\n',
            stderr: '',
            pid: 1,
            output: [],
            signal: null,
          };
        }
        if (head === 'run') {
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
  };
});

const { runHostedSmokeItem } = await import('../../src/run/hosted-runner.ts');

const projectRoot = resolve('examples/product-eval');

function loadItem(name: string): ItemDoc {
  return JSON.parse(readFileSync(join(projectRoot, 'bank/items/B', name), 'utf8')) as ItemDoc;
}

function timeoutError(): Error & { code: string } {
  return Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' });
}

const room: RoomDoc = {
  name: 'hosted-plain-test',
  kind: 'hosted',
  model_driver: 'live',
  network: true,
  workspace: 'isolated',
  host: { command: 'opencode', model: 'test/model' },
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
    hostedIO.status = null;
    hostedIO.signal = 'SIGTERM';
    hostedIO.error = timeoutError();
    hostedIO.mutate = patch157;
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-to-ok-'));
    const item = loadItem('paired-task-157-off.item.json');
    const result = await runHostedSmokeItem({ item, room, projectRoot, artifactDir });
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
        axis: 'B',
        paperset: 'paired-off-effect-smoke',
        room: 'hosted-plain-test',
        started_at: '2026-09-01T00:00:00.000Z',
        project_root: projectRoot,
        items: [{ id: item.id, rev: item.rev }],
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
    hostedIO.status = null;
    hostedIO.signal = 'SIGTERM';
    hostedIO.error = timeoutError();
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-to-miss-'));
    const item = loadItem('paired-task-157-off.item.json');
    const result = await runHostedSmokeItem({ item, room, projectRoot, artifactDir });
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
    hostedIO.status = null;
    hostedIO.signal = 'SIGTERM';
    hostedIO.error = timeoutError();
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-to-on-miss-'));
    const item = loadItem('paired-task-157-on.item.json');
    expect(item.intent.attribution_focus).toBe('PROTOCOL');
    const result = await runHostedSmokeItem({ item, room, projectRoot, artifactDir });
    expect(result.pass).toBe(false);
    expect(result.workspace_ok).toBe(false);
    expect(result.materials_mutated).toBe(false);
    expect(result.attribution).toBe('CONTEXT');
    expect(result.attribution).not.toBe('PROTOCOL');
  });

  it('超时 + 改了但改错 → FAIL MODEL_TASK；ON 的 PROTOCOL focus 不能盖工作区', async () => {
    hostedIO.status = null;
    hostedIO.signal = 'SIGTERM';
    hostedIO.error = timeoutError();
    hostedIO.mutate = patch157Wrong;
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-to-wrong-'));
    const item = loadItem('paired-task-157-on.item.json');
    expect(item.intent.attribution_focus).toBe('PROTOCOL');
    const result = await runHostedSmokeItem({ item, room, projectRoot, artifactDir });
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
    const item = loadItem('paired-task-157-off.item.json');
    const result = await runHostedSmokeItem({ item, room, projectRoot, artifactDir });
    expect(result.pass).toBe(true);
    expect(result.timed_out).toBe(false);
    expect(result.workspace_ok).toBe(true);
    expect(result.host_exit).toBe(1);
  });

  it('退出码 0 + 日志含 providerID + 文件未改 → MODEL_TASK，不是 CONTEXT', async () => {
    hostedIO.status = 0;
    hostedIO.stderr = 'stream providerID=wave-ai llm.provider=wave-ai\n';
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-provider-log-'));
    const item = loadItem('paired-task-157-off.item.json');
    const result = await runHostedSmokeItem({ item, room, projectRoot, artifactDir });
    expect(result.pass).toBe(false);
    expect(result.timed_out).toBe(false);
    expect(result.host_exit).toBe(0);
    expect(result.workspace_ok).toBe(false);
    expect(result.materials_mutated).toBe(false);
    expect(result.attribution).toBe('MODEL_TASK');
    expect(result.attribution).not.toBe('CONTEXT');
  });
});

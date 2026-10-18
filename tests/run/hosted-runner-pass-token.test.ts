import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc, RoomDoc } from '../../src/exam-engine/types.ts';
import { buildRunSummary } from '../../apps/console/run-summary.ts';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';

const hostedIO = vi.hoisted(() => ({ stdout: '', status: 0 as number | null }));

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

const { runHostedSmokeItem } = await import('../../src/run/hosted-runner.ts');

function makeItem(oracles: ItemDoc['expect']['oracles']): ItemDoc {
  return {
    id: 'EVAL-B-PAIRED-TASK-157-OFF',
    rev: 1,
    axis: 'B',
    status: 'active',
    title: 'aux token',
    intent: { statement: 's', attribution_focus: 'MODEL_TASK', effect_pair: 'PAIRED-TASK-157' },
    freeze: {
      model_driver: 'live',
      model_id: 'm',
      host_profile: 'h',
      tool_profile: 'none',
      prompt_template: 'p',
      channel: 'hosted',
    },
    stimulus: { kind: 'task_prompt', ref: 'missing/prompt.txt', hosted_pass_token: 'DUAL_FIX' },
    expect: { oracles },
    metrics: { primary: ['a_case_pass_rate'] },
    execution: { deadline_ms: 5_000, requires_network: true },
  };
}

const room: RoomDoc = {
  name: 'hosted-plain-test',
  kind: 'hosted',
  model_driver: 'live',
  network: true,
  workspace: 'isolated',
  host: { command: 'opencode', model: 'test/model' },
};

describe('hosted_pass_token 降为辅助', () => {
  const prevPlugin = process.env.PROCTOR_HOSTED_PLUGIN;
  const prevModel = process.env.PROCTOR_HOSTED_MODEL;

  beforeEach(() => {
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

  it('workspace 命中、无 token、空 stdout → 整题 PASS，产物/摘要 pass_token_present false', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'proctor-aux-proj-'));
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-aux-art-'));
    const item = makeItem([
      { id: 'exit0', type: 'exit_code', equals: 0 },
      {
        id: 'readme',
        type: 'workspace_assert',
        path: 'README.md',
        contains: 'proctor hosted workspace',
      },
    ]);

    const result = await runHostedSmokeItem({ item, room, projectRoot, artifactDir });
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
        items: [{ id: item.id, rev: item.rev }],
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
    const item = makeItem([
      { id: 'exit0', type: 'exit_code', equals: 0 },
      {
        id: 'discount-round',
        type: 'workspace_assert',
        path: 'lib/discount.mjs',
        contains: 'Math.round',
      },
    ]);

    const result = await runHostedSmokeItem({ item, room, projectRoot, artifactDir });
    expect(result.pass).toBe(false);
    expect(result.attribution).toBe('MODEL_TASK');
    expect(result.attribution).not.toBe('PROTOCOL');
    expect(result.pass_token_present).toBe(false);
    expect(result.oracle_failures[0]?.message).toMatch(/discount|workspace|lib\/discount/);
    expect(result.oracle_failures.some((f) => /未含约定/.test(f.message))).toBe(false);
  });
});

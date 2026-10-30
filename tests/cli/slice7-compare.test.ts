import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/cli/main.ts';
import { compareRuns } from '../../src/report/compare.ts';

const demoProject = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function normalizeNdjson(runDir: string): string {
  const rows = readFileSync(join(runDir, 'results.ndjson'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const r = JSON.parse(line) as Record<string, unknown>;
      return {
        item_id: r.item_id,
        item_rev: r.item_rev,
        pass: r.pass,
        attribution: r.attribution ?? null,
        oracle_failures: r.oracle_failures ?? [],
        metrics: r.metrics ?? {},
      };
    })
    .sort((a, b) => String(a.item_id).localeCompare(String(b.item_id)));
  return `${JSON.stringify(rows)}\n`;
}

describe('切片 7：重跑一致性 + compare CLI', () => {
  it('空字符串用途按未知处理，与未标注同样拒绝比较', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-purpose-blank-'));
    const { mkdirSync, rmSync } = await import('node:fs');
    const b = join(root, 'b');
    const c = join(root, 'c');
    mkdirSync(b);
    mkdirSync(c);
    try {
      for (const dir of [b, c]) {
        writeFileSync(
          join(dir, 'results.ndjson'),
          JSON.stringify({ item_id: 'A', item_rev: 1, pass: true }),
        );
      }
      writeFileSync(join(b, 'run.json'), JSON.stringify({ purpose: '' }));
      writeFileSync(join(c, 'run.json'), JSON.stringify({ purpose: '  ' }));
      const bothUnknown = compareRuns(b, c);
      expect(bothUnknown.purpose).toBeUndefined();
      expect(bothUnknown.purposeNotice).toContain('仅供诊断');
      writeFileSync(join(c, 'run.json'), JSON.stringify({}));
      expect(bothUnknown).toMatchObject({ purposeNotice: expect.stringContaining('仅供诊断') });
      writeFileSync(join(c, 'run.json'), JSON.stringify({ purpose: 'smoke' }));
      expect(() => compareRuns(b, c)).toThrow('用途不可比');
      writeFileSync(join(b, 'run.json'), JSON.stringify({ purpose: 'smoke' }));
      writeFileSync(join(c, 'run.json'), JSON.stringify({ purpose: 'smoke' }));
      expect(compareRuns(b, c).counts.unchanged).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('拒绝不同或单侧未知用途混算，相同用途允许比较', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-purpose-cmp-'));
    const { mkdirSync, rmSync } = await import('node:fs');
    const b = join(root, 'b');
    const c = join(root, 'c');
    mkdirSync(b);
    mkdirSync(c);
    try {
      for (const dir of [b, c]) {
        writeFileSync(
          join(dir, 'results.ndjson'),
          JSON.stringify({ item_id: 'A', item_rev: 1, pass: true }),
        );
      }
      writeFileSync(join(b, 'run.json'), JSON.stringify({ purpose: 'smoke' }));
      writeFileSync(join(c, 'run.json'), JSON.stringify({ purpose: 'effect_comparison' }));
      expect(() => compareRuns(b, c)).toThrow('用途不可比');
      writeFileSync(join(c, 'run.json'), '{}');
      expect(() => compareRuns(b, c)).toThrow('用途不可比');
      writeFileSync(join(c, 'run.json'), JSON.stringify({ purpose: 'smoke' }));
      expect(compareRuns(b, c).counts.unchanged).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('smoke-a 连续两次归一化 results 一致，且 compare 全 unchanged', async () => {
    expect(
      await main([
        'run',
        '--dataset',
        'smoke-a',
        '--environment',
        'fake-host-v1',
        '--project',
        demoProject,
      ]),
    ).toBe(0);
    const run1 = out
      .find((l) => l.startsWith('run 完成：'))
      ?.slice('run 完成：'.length)
      .trim();
    expect(run1).toBeTruthy();

    out = [];
    expect(
      await main([
        'run',
        '--dataset',
        'smoke-a',
        '--environment',
        'fake-host-v1',
        '--project',
        demoProject,
      ]),
    ).toBe(0);
    const run2 = out
      .find((l) => l.startsWith('run 完成：'))
      ?.slice('run 完成：'.length)
      .trim();
    expect(run2).toBeTruthy();
    expect(run1).not.toBe(run2);

    expect(normalizeNdjson(run1!)).toBe(normalizeNdjson(run2!));

    const report = compareRuns(run1!, run2!);
    expect(report.counts.new_failure).toBe(0);
    expect(report.counts.fixed).toBe(0);
    expect(report.counts.asset_rev_drift).toBe(0);
    expect(report.counts.unchanged).toBeGreaterThanOrEqual(2);
  });

  it('运行用途写入 run.json，未知旧运行不被反推', async () => {
    vi.stubEnv('PROCTOR_RUN_PURPOSE', 'regression');
    try {
      expect(
        await main([
          'run',
          '--dataset',
          'smoke-a',
          '--environment',
          'fake-host-v1',
          '--project',
          demoProject,
        ]),
      ).toBe(0);
      const runDir = out
        .find((line) => line.startsWith('run 完成：'))
        ?.slice('run 完成：'.length)
        .trim();
      expect(runDir).toBeTruthy();
      const meta = JSON.parse(readFileSync(join(runDir!, 'run.json'), 'utf8')) as {
        purpose?: string;
      };
      expect(meta.purpose).toBe('regression');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('compare CLI 输出三分类计数', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-cmp-cli-'));
    const b = join(root, 'b');
    const c = join(root, 'c');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(b);
    mkdirSync(c);
    writeFileSync(
      join(b, 'results.ndjson'),
      [
        JSON.stringify({ item_id: 'A', item_rev: 1, pass: true }),
        JSON.stringify({ item_id: 'B', item_rev: 1, pass: false }),
        JSON.stringify({ item_id: 'C', item_rev: 1, pass: true }),
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(c, 'results.ndjson'),
      [
        JSON.stringify({ item_id: 'A', item_rev: 1, pass: false }),
        JSON.stringify({ item_id: 'B', item_rev: 1, pass: true }),
        JSON.stringify({ item_id: 'C', item_rev: 2, pass: true }),
      ].join('\n') + '\n',
    );

    expect(await main(['compare', '--baseline', b, '--candidate', c, '--json'])).toBe(0);
    const report = JSON.parse(out.join('\n')) as {
      counts: Record<string, number>;
      effect: { pass_rate_delta: number; baseline_pass_rate: number; candidate_pass_rate: number };
    };
    expect(report).toMatchObject({ purposeNotice: expect.stringContaining('仅供诊断') });
    out = [];
    expect(await main(['compare', '--baseline', b, '--candidate', c])).toBe(0);
    expect(out.join('\n')).toContain('仅供诊断');
    expect(report.counts.new_failure).toBe(1);
    expect(report.counts.fixed).toBe(1);
    expect(report.counts.asset_rev_drift).toBe(1);
    expect(report.effect.baseline_pass_rate).toBeCloseTo(2 / 3, 5);
    expect(report.effect.candidate_pass_rate).toBeCloseTo(2 / 3, 5);
    expect(report.effect.pass_rate_delta).toBeCloseTo(0, 5);
  });

  it('compare 含参考分差、配对效果与 effect_compare.md', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-cmp-effect-'));
    const b = join(root, 'b');
    const c = join(root, 'c');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(b);
    mkdirSync(c);
    writeFileSync(
      join(b, 'results.ndjson'),
      [
        JSON.stringify({ item_id: 'EVAL-X-OFF', item_rev: 1, pass: true }),
        JSON.stringify({ item_id: 'EVAL-Y-OFF', item_rev: 1, pass: false }),
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(c, 'results.ndjson'),
      [
        JSON.stringify({ item_id: 'EVAL-X-ON', item_rev: 1, pass: true }),
        JSON.stringify({ item_id: 'EVAL-Y-ON', item_rev: 1, pass: true }),
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(b, 'metrics.json'),
      JSON.stringify({ aggregates: { a_case_pass_rate: 0.5, b_avg_steps_to_success: 10 } }) + '\n',
    );
    writeFileSync(
      join(c, 'metrics.json'),
      JSON.stringify({ aggregates: { a_case_pass_rate: 1, b_avg_steps_to_success: 4 } }) + '\n',
    );
    writeFileSync(
      join(b, 'scores.json'),
      JSON.stringify({
        scale_max: 5,
        scores: [
          { item_id: 'EVAL-X-OFF', score: 2 },
          { item_id: 'EVAL-Y-OFF', score: 1 },
        ],
      }) + '\n',
    );
    writeFileSync(
      join(c, 'scores.json'),
      JSON.stringify({
        scale_max: 5,
        scores: [
          { item_id: 'EVAL-X-ON', score: 4 },
          { item_id: 'EVAL-Y-ON', score: 3 },
        ],
      }) + '\n',
    );

    const report = compareRuns(b, c);
    expect(report.effect.pass_rate_delta).toBeCloseTo(0.5, 5);
    expect(report.effect.reference_scores?.delta).toBeCloseTo(2, 5);
    expect(report.effect.paired_effects?.length).toBe(2);
    const pairX = report.effect.paired_effects?.find((p) => p.pair === 'EVAL-X');
    expect(pairX?.score_delta).toBe(2);
    expect(pairX?.baseline_item).toBe('EVAL-X-OFF');
    expect(pairX?.candidate_item).toBe('EVAL-X-ON');
    const steps = report.effect.metric_deltas.find((m) => m.name === 'b_avg_steps_to_success');
    expect(steps?.delta).toBeCloseTo(-6, 5);

    expect(await main(['compare', '--baseline', b, '--candidate', c])).toBe(0);
    const md = readFileSync(join(c, 'effect_compare.md'), 'utf8');
    expect(md).toContain('效果对照');
    expect(md).toContain('参考分');
    expect(md).toContain('配对效果');
    expect(md).toContain('EVAL-X');
  });

  it('effect_compare.md 写出暗号有/无（辅助）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-cmp-token-'));
    const b = join(root, 'b');
    const c = join(root, 'c');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(b);
    mkdirSync(c);
    writeFileSync(
      join(b, 'results.ndjson'),
      JSON.stringify({
        item_id: 'EVAL-B-PAIRED-TASK-157-OFF',
        item_rev: 1,
        pass: true,
        effect_pair: 'PAIRED-TASK-157',
        pass_token: 'DUAL_FIX',
        pass_token_present: false,
      }) + '\n',
    );
    writeFileSync(
      join(c, 'results.ndjson'),
      JSON.stringify({
        item_id: 'EVAL-B-PAIRED-TASK-157-ON',
        item_rev: 1,
        pass: true,
        effect_pair: 'PAIRED-TASK-157',
        pass_token: 'DUAL_FIX',
        pass_token_present: true,
      }) + '\n',
    );
    writeFileSync(join(b, 'metrics.json'), JSON.stringify({ aggregates: {} }) + '\n');
    writeFileSync(join(c, 'metrics.json'), JSON.stringify({ aggregates: {} }) + '\n');

    expect(await main(['compare', '--baseline', b, '--candidate', c])).toBe(0);
    const md = readFileSync(join(c, 'effect_compare.md'), 'utf8');
    expect(md).toContain('暗号为辅助信号');
    expect(md).toContain('无 DUAL_FIX');
    expect(md).toContain('有 DUAL_FIX');
    const report = compareRuns(b, c);
    expect(report.effect.paired_effects?.[0]?.baseline_pass_token_present).toBe(false);
    expect(report.effect.paired_effects?.[0]?.candidate_pass_token_present).toBe(true);
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareRuns } from '../../src/report/compare.ts';
import { summarizeAttribution, summarizeEffectPairs } from '../../apps/console/run-summary.ts';

/**
 * 「未评测」在对照与归因里的口径。
 *
 * 未评测意味着形态能力缺失、根本没测。把它当成 `pass=false` 会凭空造出
 * 「新失败」和「失败归因 UNKNOWN」，污染被测系统的缺陷数与效果 Δ。
 */

function makeRun(lines: Array<Record<string, unknown>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'proctor-cmp-notimpl-'));
  writeFileSync(join(dir, 'results.ndjson'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ dataset: 'd', environment: 'e' }));
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ aggregates: {} }));
  return dir;
}

describe('未评测结果在对照与归因中的口径', () => {
  it('候选侧未评测不得判成 new_failure', () => {
    const base = makeRun([{ item_id: 't-01', item_rev: 1, pass: true }]);
    const cand = makeRun([{ item_id: 't-01', item_rev: 1, pass: false, not_implemented: true }]);

    const report = compareRuns(base, cand);
    expect(report.counts.new_failure).toBe(0);
    // 候选侧没有可评测样本 → 不该得出「0% 通过」这种结论
    expect(report.rows.find((r) => r.item_id === 't-01')?.kind).not.toBe('new_failure');
  });

  it('基线侧未评测不得判成 fixed', () => {
    const base = makeRun([{ item_id: 't-01', item_rev: 1, pass: false, not_implemented: true }]);
    const cand = makeRun([{ item_id: 't-01', item_rev: 1, pass: true }]);

    expect(compareRuns(base, cand).counts.fixed).toBe(0);
  });

  it('未评测侧不写入配对键结果，避免被画成「败」', () => {
    const pairs = summarizeEffectPairs([
      { item_id: 'P-01-OFF', pass: true, effect_pair: 'P-01' },
      { item_id: 'P-01-ON', pass: false, not_implemented: true, effect_pair: 'P-01' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.off_pass).toBe(true);
    // 未评测侧没有观测：不能写 false（那是「败」）
    expect(pairs[0]?.on_pass).toBeUndefined();
  });

  it('未评测结果不进失败归因统计', () => {
    const summary = summarizeAttribution([
      { item_id: 't-01', pass: true },
      { item_id: 't-02', pass: false, not_implemented: true },
    ]);
    expect(summary.fail_total).toBe(0);
    expect(summary.fail_counts.UNKNOWN).toBeUndefined();
    expect(summary.pass_total).toBe(1);
    expect(summary.item_total).toBe(1);
  });

  it('对照一侧无评测样本时通过率不可定义，不得写成 0', () => {
    const base = makeRun([{ item_id: 't-01', item_rev: 1, pass: true }]);
    const cand = makeRun([{ item_id: 't-01', item_rev: 1, pass: false, not_implemented: true }]);

    const e = compareRuns(base, cand).effect;
    // 候选侧一行可评测的都没有：0.0000 会被读成「全挂」
    expect(e.candidate_pass_rate).toBeUndefined();
    expect(e.pass_rate_delta).toBeUndefined();
    expect(e.baseline_pass_rate).toBe(1);
  });
});

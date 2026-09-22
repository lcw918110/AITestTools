import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRunArtifacts } from '../../src/report/artifacts.ts';

function writeArtifact(dir: string, file: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content);
}

/**
 * PRD 附录 C 指标 `a_recovery_pass_rate`（重启/重放类通过率）：
 * 系统必须能健壮地加载完整或部分 run 制品。
 *
 * 本测试直接测试 `loadRunArtifacts`（被 compare / report 共用）：
 * 1. 完整制品加载成功
 * 2. 缺失 results.ndjson 应报明确错误（不静默降级）
 * 3. 截断的 results.ndjson 应报明确解析错误（不吞掉）
 * 4. 缺失 metrics.json 降级为空聚合（可恢复语义）
 */
describe('loadRunArtifacts 恢复/部分制品 (a_recovery_pass_rate)', () => {
  it('完整 run 目录加载成功：results + metrics + scores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-recovery-ok-'));
    writeArtifact(
      dir,
      'results.ndjson',
      [
        JSON.stringify({ item_id: 'A', item_rev: 1, pass: true, metrics: { a_case_pass_rate: 1 } }),
        JSON.stringify({ item_id: 'B', item_rev: 1, pass: false, metrics: { a_case_pass_rate: 0 } }),
        '',
      ].join('\n'),
    );
    writeArtifact(dir, 'metrics.json', JSON.stringify({ aggregates: { a_case_pass_rate: 0.5 } }));
    writeArtifact(
      dir,
      'scores.json',
      JSON.stringify({ scale_max: 5, scores: [{ item_id: 'A', score: 4 }] }),
    );

    const run = loadRunArtifacts(dir);
    expect(run.results.size).toBe(2);
    expect(run.results.get('A')?.pass).toBe(true);
    expect(run.results.get('B')?.pass).toBe(false);
    expect(run.aggregates.a_case_pass_rate).toBe(0.5);
    expect(run.scores.get('A')).toBe(4);
    expect(run.scaleMax).toBe(5);
  });

  it('缺失 results.ndjson 时报明确错误（不静默吞掉）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-recovery-no-ndjson-'));
    mkdirSync(dir, { recursive: true });

    expect(() => loadRunArtifacts(dir)).toThrow(/results\.ndjson/);
  });

  it('截断/残缺 results.ndjson 尾行报明确解析错误', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-recovery-trunc-'));
    writeArtifact(
      dir,
      'results.ndjson',
      JSON.stringify({ item_id: 'A', item_rev: 1, pass: true }) + '\n{"item_id":"B","item_rev"',
    );

    expect(() => loadRunArtifacts(dir)).toThrow();
  });

  it('缺失 metrics.json 降级为空聚合（可恢复语义）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-recovery-no-metrics-'));
    writeArtifact(
      dir,
      'results.ndjson',
      JSON.stringify({ item_id: 'A', item_rev: 1, pass: true }) + '\n',
    );

    const run = loadRunArtifacts(dir);
    expect(run.results.size).toBe(1);
    expect(run.aggregates).toEqual({});
  });
});
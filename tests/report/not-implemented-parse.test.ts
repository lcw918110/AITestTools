import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRunArtifacts } from '../../src/report/artifacts.ts';

/**
 * 未评测结果进入 report 层的解析契约。
 *
 * `pass` 必须保持布尔：`parseResultLine` 遇非布尔会直接抛错，省略字段会让
 * 含未评测结果的 run 一跑对照就崩。未评测靠 `not_implemented` 标记自证，
 * 由统计方据此排除在分子分母之外。
 */
describe('report 层解析未评测结果', () => {
  it('未评测行能正常读入并带回标记', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-report-notimpl-'));
    writeFileSync(
      join(dir, 'results.ndjson'),
      `${JSON.stringify({ item_id: 'x::r0', item_rev: 1, pass: false, not_implemented: true })}\n`,
    );
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ dataset: 'd', environment: 'e' }));
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ aggregates: {} }));

    const loaded = loadRunArtifacts(dir);
    expect(loaded.results.size).toBe(1);
    const line = loaded.results.get('x::r0');
    expect(line?.pass).toBe(false);
    expect(line?.not_implemented).toBe(true);
  });

  it('普通结果不带未评测标记', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-report-normal-'));
    writeFileSync(
      join(dir, 'results.ndjson'),
      `${JSON.stringify({ item_id: 'x::r0', item_rev: 1, pass: true })}\n`,
    );
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ dataset: 'd', environment: 'e' }));
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ aggregates: {} }));

    const loaded = loadRunArtifacts(dir);
    expect(loaded.results.get('x::r0')?.not_implemented).toBeUndefined();
  });

  it('同一题同时出现未评测行与已评测行时，保留已评测的观测', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-report-dupe-'));
    writeFileSync(
      join(dir, 'results.ndjson'),
      [
        JSON.stringify({ item_id: 'x::r0', item_rev: 1, pass: true }),
        // 后写的未评测行只是能力缺失的占位：覆盖前写会把真实观测凭空抹掉
        JSON.stringify({ item_id: 'x::r0', item_rev: 1, pass: false, not_implemented: true }),
      ].join('\n') + '\n',
    );
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ dataset: 'd', environment: 'e' }));
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ aggregates: {} }));

    const line = loadRunArtifacts(dir).results.get('x::r0');
    expect(line?.pass).toBe(true);
    expect(line?.not_implemented).toBeUndefined();
  });
});

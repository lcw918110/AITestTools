import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';
import type { AxisItemResult } from '../../src/run/runner-types.ts';

function result(itemId: string, pass: boolean): AxisItemResult {
  return {
    item_id: itemId,
    item_rev: 1,
    pass,
    oracle_failures: [],
    metrics: { a_case_pass_rate: pass ? 1 : 0, a_invariant_violations: 0 },
  };
}

describe('writeRunArtifacts 一致性量化报告（ADR-0010）', () => {
  it('repeats>1 时 report.md 输出 pass^k 与成功率范围段落', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-consistency-'));
    const results = [
      result('model-case.r1::r0', true),
      result('model-case.r1::r1', true),
      result('model-case.r1::r2', true),
      result('model-case.r1::r3', false),
    ];
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'consistency-1',
        dataset: 'model-core',
        environment: 'model-direct-v1',
        started_at: '2026-10-19T00:00:00.000Z',
        project_root: '/tmp',
        items: [{ id: 'model-case.r1', rev: 1 }],
      },
      results,
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('## 一致性量化（pass^k / 成功率范围）');
    expect(report).toContain('pass^k: 0%');
    expect(report).toContain('成功率范围: 75%~75%');
    expect(report).toContain('flaky: 存在');
  });

  it('repeats=1 时 report.md 不输出一致性量化段落', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-consistency-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'consistency-2',
        dataset: 'smoke-a-l1',
        environment: 'fold-v1',
        started_at: '2026-10-19T00:00:00.000Z',
        project_root: '/tmp',
        items: [{ id: 'behavior-case.r1', rev: 1 }],
      },
      results: [result('behavior-case.r1', true)],
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).not.toContain('## 一致性量化');
  });
});

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';
import type { AxisItemResult } from '../../src/run/runner-types.ts';

/**
 * `not_implemented` 的落盘口径。
 *
 * 编排层已把此类结果记为 `not_evaluated`（「没评测」而非「评测失败」）。落盘若仍
 * 按 `pass=false` 计入分母，就会出现「卡面说没评测、报告说没通过」的账实不符，
 * 且能力缺失会污染被测系统的缺陷数。
 */

function result(
  itemId: string,
  pass: boolean,
  extra: Partial<AxisItemResult> = {},
): AxisItemResult {
  return {
    item_id: itemId,
    item_rev: 1,
    pass,
    oracle_failures: [],
    metrics: { a_case_pass_rate: pass ? 1 : 0, a_invariant_violations: 0 },
    ...extra,
  };
}

function meta(runId: string, itemId: string): Parameters<typeof writeRunArtifacts>[0]['meta'] {
  return {
    run_id: runId,
    dataset: 'model-core',
    environment: 'model-direct-v1',
    started_at: '2026-10-19T00:00:00.000Z',
    project_root: '/tmp',
    items: [{ id: itemId, rev: 1 }],
  };
}

describe('not_implemented 结果的落盘口径', () => {
  it('单次观测为 not_evaluated 时题级不记失败，也不算通过', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-1', 'model-case.r1'),
      results: [result('model-case.r1', false, { not_implemented: true })],
    });

    const metaJson = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ id: string; pass?: boolean; not_evaluated?: boolean }>;
    };
    const item = metaJson.items.find((i) => i.id === 'model-case.r1');
    // 不能记 pass=true（没测过不能说通过），也不能记 pass=false（能力缺失不是失败）
    expect(item?.pass).toBeUndefined();
    expect(item?.not_evaluated).toBe(true);
  });

  it('混有 not_evaluated 的 trial 时，通过率只按真实观测计算', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-mix-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-2', 'model-case.r1'),
      results: [
        result('model-case.r1::r0', true),
        result('model-case.r1::r1', true),
        // 这一轮根本没有评测，不能拖低通过率
        result('model-case.r1::r2', false, { not_implemented: true }),
      ],
    });

    const metaJson = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ id: string; pass?: boolean; pass_rate?: number; trials?: number }>;
    };
    const item = metaJson.items.find((i) => i.id === 'model-case.r1');
    expect(item?.pass).toBe(true);
    expect(item?.pass_rate).toBe(1);
    expect(item?.trials).toBe(2);
  });

  it('全部 trial 都是 not_evaluated 时整题标为未评测', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-all-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-3', 'model-case.r1'),
      results: [
        result('model-case.r1::r0', false, { not_implemented: true }),
        result('model-case.r1::r1', false, { not_implemented: true }),
      ],
    });

    const metaJson = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ id: string; pass?: boolean; not_evaluated?: boolean }>;
    };
    const item = metaJson.items.find((i) => i.id === 'model-case.r1');
    expect(item?.pass).toBeUndefined();
    expect(item?.not_evaluated).toBe(true);
  });

  it('报告里未评测的题不计入失败清单', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-report-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-4', 'model-case.r1'),
      results: [result('model-case.r1', false, { not_implemented: true })],
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    // 报告里不应把它列成被测系统的失败题
    expect(report).not.toMatch(/^\|\s*model-case\.r1\s*\|.*失败/m);
  });

  it('报告表格里未评测的题标为「未评测」而不是 no', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-cell-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-5', 'model-case.r1'),
      results: [result('model-case.r1', false, { not_implemented: true })],
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('未评测');
    expect(report).not.toMatch(/^\|\s*model-case\.r1\s*\|\s*1\s*\|\s*no\s*\|/m);
  });

  it('聚合通过率不含未评测结果', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-agg-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-6', 'model-case.r1'),
      results: [
        result('model-case.r1::r0', true),
        result('model-case.r1::r1', false, { not_implemented: true }),
      ],
    });

    const metrics = JSON.parse(readFileSync(join(written.dir, 'metrics.json'), 'utf8')) as {
      aggregates?: { a_case_pass_rate?: number };
    };
    // 唯一被真正评测的一轮通过了，通过率应为 100%
    expect(metrics.aggregates?.a_case_pass_rate).toBe(1);
  });

  it('results.ndjson 里的未评测记录要能自证身份', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-ndjson-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-7', 'model-case.r1'),
      results: [result('model-case.r1::r0', false, { not_implemented: true })],
    });

    const lines = readFileSync(join(written.dir, 'results.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    // 原始观测保留（可追溯），但必须带标记，否则读的人会当成真实失败
    expect(lines).toHaveLength(1);
    expect(lines[0]?.not_implemented).toBe(true);
  });

  it('整批结果都未评测时，通过率不可定义而不是 0', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-all-passrate-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-9', 'model-case.r1'),
      results: [result('model-case.r1::r0', false, { not_implemented: true })],
    });

    // 写 0 会被读成「0% 通过」，那是把不存在的观测当全部失败
    const metrics = JSON.parse(readFileSync(join(written.dir, 'metrics.json'), 'utf8')) as {
      aggregates?: { a_case_pass_rate?: number };
    };
    expect(metrics.aggregates?.a_case_pass_rate).toBeUndefined();

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('pass_rate: n/a');
    expect(report).toContain('not_evaluated: 1 条');
  });

  it('未评测结果不进入失败归因统计', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-attr-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-10', 'model-case.r1'),
      results: [
        result('model-case.r1::r0', true),
        // 没有归因能力可言，算进失败归因就是污染缺陷数
        result('model-case.r1::r1', false, { not_implemented: true }),
      ],
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    const attrSection = report.slice(report.indexOf('## 失败归因'));
    expect(attrSection).toContain('（无失败）');
    expect(attrSection).not.toContain('UNKNOWN');
  });

  it('多 trial 时 cleanup 失败证据不会被题级聚合抹掉', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-leak-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-11', 'model-case.r1'),
      results: [
        result('model-case.r1::r0', true),
        // 泄漏只发生在第 2 轮：聚合后仍必须能看到
        result('model-case.r1::r1', true, {
          oracle_failures: [{ oracle_id: 'harness:cleanup', message: 'EBUSY' }],
        }),
      ],
    });

    const item = (
      JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
        items: Array<{ id: string; cleanup_failed?: boolean }>;
      }
    ).items.find((i) => i.id === 'model-case.r1');
    expect(item?.cleanup_failed).toBe(true);

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('资源泄漏（编排侧）');
    expect(report).toContain('model-case.r1');
  });

  it('未评测结果在 results.ndjson 里带 not_implemented 标记', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-nopass-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-12', 'model-case.r1'),
      results: [result('model-case.r1::r0', false, { not_implemented: true })],
    });

    const line = JSON.parse(
      readFileSync(join(written.dir, 'results.ndjson'), 'utf8').trim(),
    ) as Record<string, unknown>;
    // pass 必须保持布尔（旧读取方按此解析），靠标记让统计方排除
    expect(typeof line.pass).toBe('boolean');
    expect(line.not_implemented).toBe(true);
  });

  it('整批未评测时门禁不宣判通过', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-gate-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-13', 'model-case.r1'),
      results: [result('model-case.r1::r0', false, { not_implemented: true })],
    });

    // 没测过不能对外声称门禁 PASS，也不能报 FAIL（那是把没测读成没通过）
    expect(written.gates_pass).toBe(false);
    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('gates: 未评测（不适用）');
  });

  it('题目完全没有结果行时也标为未评测，并在报告里点名', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-norow-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'notimpl-14',
        dataset: 'model-core',
        environment: 'svc-v1',
        started_at: '2026-10-19T00:00:00.000Z',
        project_root: '/tmp',
        items: [
          { id: 'has-result', rev: 1 },
          { id: 'no-result', rev: 1 },
        ],
      },
      results: [result('has-result::r0', true)],
    });

    const parsed = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ id: string; pass?: boolean; not_evaluated?: boolean }>;
    };
    const missing = parsed.items.find((i) => i.id === 'no-result');
    // 没跑过的题不能记成通过，也不能记成失败
    expect(missing?.pass).toBeUndefined();
    expect(missing?.not_evaluated).toBe(true);

    // 报告必须点出「有题根本没跑」，而不是静默略过
    expect(readFileSync(join(written.dir, 'report.md'), 'utf8')).toContain(
      'not_evaluated（无结果行）: 1 题',
    );
  });

  it('漏跑的题要在报告里点名，不能只给一个计数', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-named-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'notimpl-16',
        dataset: 'model-core',
        environment: 'svc-v1',
        started_at: '2026-10-19T00:00:00.000Z',
        project_root: '/tmp',
        items: [
          { id: 'ran-ok', rev: 1 },
          { id: 'never-ran', rev: 1 },
        ],
      },
      results: [result('ran-ok::r0', true)],
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    // 只给计数无法定位是哪几题没跑，排障时必须能直接看到题号
    expect(report).toContain('## 未评测题目');
    expect(report).toContain('never-ran: 无结果行');
    // 真跑过的题不该出现在未评测清单里
    expect(report).not.toContain('ran-ok: 无结果行');
  });

  it('逐行表格能区分「漏跑」与「未实现」', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-cell-reason-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'notimpl-17',
        dataset: 'model-core',
        environment: 'svc-v1',
        started_at: '2026-10-19T00:00:00.000Z',
        project_root: '/tmp',
        items: [{ id: 'cap-missing', rev: 1 }],
      },
      results: [result('cap-missing::r0', false, { not_implemented: true })],
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('未评测（未实现）');
  });

  it('部分未评测时通过率只算真评测的题，但未评测计数要落盘', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-partial-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'notimpl-15',
        dataset: 'model-core',
        environment: 'svc-v1',
        started_at: '2026-10-19T00:00:00.000Z',
        project_root: '/tmp',
        items: [
          { id: 'ok', rev: 1 },
          { id: 'cap-missing', rev: 1 },
        ],
      },
      results: [
        result('ok::r0', true),
        result('cap-missing::r0', false, { not_implemented: true }),
      ],
    });

    // 通过率只看真评测过的题
    const metrics = JSON.parse(readFileSync(join(written.dir, 'metrics.json'), 'utf8')) as {
      aggregates?: { a_case_pass_rate?: number; a_not_evaluated_items?: number };
    };
    expect(metrics.aggregates?.a_case_pass_rate).toBe(1);
    // 但「有题没测过」必须成为一个可被程序读到的事实，不能只写在报告正文
    expect(written.not_evaluated_items).toBe(1);
    expect(metrics.aggregates?.a_not_evaluated_items).toBe(1);
    // 只产出 not_implemented 的题属于「形态未实现」，不是漏跑
    expect(written.missing_result_items).toBe(0);
  });

  it('正常结果不会被误标为未评测', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-notimpl-normal-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('notimpl-8', 'model-case.r1'),
      results: [result('model-case.r1::r0', true)],
    });

    const item = (
      JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
        items: Array<{ id: string; pass?: boolean; not_evaluated?: boolean }>;
      }
    ).items.find((i) => i.id === 'model-case.r1');
    expect(item?.pass).toBe(true);
    expect(item?.not_evaluated).toBeUndefined();

    const line = JSON.parse(
      readFileSync(join(written.dir, 'results.ndjson'), 'utf8').trim(),
    ) as Record<string, unknown>;
    expect(line.not_implemented).toBeUndefined();
  });
});

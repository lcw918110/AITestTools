import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  collectTrendBuckets,
  collectTrendPoints,
  runReportTrend,
} from '../../src/cli/commands/report-trend.ts';

const temporaryRuns: string[] = [];

/**
 * 独立的临时项目根：每个测试文件一个，绝不在仓库内产物目录里建文件。
 *
 * 历史上这里直接指向 `examples/demo-project`，导致 `addRun` 与「扫描 dataset
 * 指标时间线」用例把测试数据写进真实产物目录，并发时与该目录的趋势扫描争抢
 * I/O，让 5s 超时假红复现（见 changelog §58、06-next-steps §5）。
 *
 * 在 `beforeAll` 里创建而不是模块顶层：这样全部用例被过滤掉时不会在 `$TMPDIR`
 * 留下无人清理的空目录（`afterAll` 也就不会执行）。
 */
let project: string;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'trend-project-'));
  mkdirSync(join(project, 'runs'), { recursive: true });
  writeFileSync(
    join(project, 'exam.json'),
    JSON.stringify({
      name: 'trend-test-project',
      description: 'report-trend 测试专用临时考卷库，不落仓库。',
      asset_protocol: 'cases-v1',
      paths: { materials: 'materials', scripts: 'scripts' },
    }),
  );
});

function addRun(dataset: string, purpose?: string, startedAt = '2026-10-23T00:00:00Z', val = 1) {
  const dir = mkdtempSync(join(project, 'runs', 'trend-purpose-'));
  temporaryRuns.push(dir);
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify({ run_id: dir, dataset, purpose, started_at: startedAt }),
  );
  writeFileSync(
    join(dir, 'metrics.json'),
    JSON.stringify({ aggregates: { a_case_pass_rate: val } }),
  );
}

function uniqueDataset() {
  const dir = mkdtempSync(join(tmpdir(), 'trend-dataset-'));
  temporaryRuns.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  // 只清本用例新建的 run 目录与 dataset 目录；临时项目根在 afterAll 统一删除。
  for (const dir of temporaryRuns.splice(0)) rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  if (project !== undefined) rmSync(project, { recursive: true, force: true });
});

describe('report trend', () => {
  it('拒绝同数据集不同用途，最近条数截断不能绕过检查', () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke', '2026-10-22T00:00:00Z');
    addRun(dataset, 'acceptance');
    expect(() => collectTrendPoints({ project, dataset, limit: 1 })).toThrow('用途不可比');
  });

  it('拒绝已知用途与未知历史用途混合', () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke');
    addRun(dataset);
    expect(() => collectTrendPoints({ project, dataset })).toThrow('用途不可比');
  });

  it('用途两端空白与比较入口一致归一，不误拒绝同用途趋势', () => {
    const dataset = uniqueDataset();
    addRun(dataset, ' regression ');
    addRun(dataset, 'regression');
    const points = collectTrendPoints({ project, dataset });
    expect(points).toHaveLength(2);
    expect(points.every((point) => point.purpose === 'regression')).toBe(true);
  });

  it('保留同用途快照并在 JSON 中披露用途', () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'regression');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runReportTrend({ project, dataset, json: true })).toBe(0);
    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload.purpose).toBe('regression');
    expect(payload.points[0].purpose).toBe('regression');
  });

  it('纯未知历史趋势明确标注仅供诊断', () => {
    const dataset = uniqueDataset();
    addRun(dataset);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    runReportTrend({ project, dataset, json: false });
    expect(log.mock.calls.flat().join('\n')).toContain('仅供诊断');
  });

  it('扫描 dataset 指标时间线', () => {
    const root = project;
    const runs = join(root, 'runs', `trend-test-${Date.now()}`);
    mkdirSync(runs, { recursive: true });
    temporaryRuns.push(runs);
    writeFileSync(
      join(runs, 'run.json'),
      JSON.stringify({
        run_id: 'trend-test',
        dataset: 'smoke-A-L1',
        started_at: '2026-07-27T00:00:00.000Z',
      }),
    );
    writeFileSync(
      join(runs, 'metrics.json'),
      JSON.stringify({
        aggregates: { a_case_pass_rate: 1 },
        gates: { a_case_pass_rate: { pass: true, bound: { min: 1 } } },
      }),
    );

    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    const code = runReportTrend({
      project: root,
      dataset: 'smoke-A-L1',
      metric: 'a_case_pass_rate',
      limit: 5,
      json: true,
    });
    expect(code).toBe(0);
    const payload = JSON.parse(lines.join('\n')) as {
      points: Array<{ dataset?: string; value?: number }>;
    };
    expect(payload.points.some((p) => p.dataset === 'smoke-A-L1' && p.value === 1)).toBe(true);
  });

  // GAP-4 扩充测试：多用途筛选与分桶支持
  it('支持按指定 purpose 筛选多用途数据集中的同用途记录', () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke', '2026-10-21T00:00:00Z', 0.8);
    addRun(dataset, 'acceptance', '2026-10-22T00:00:00Z', 1.0);
    addRun(dataset, 'smoke', '2026-10-23T00:00:00Z', 0.9);

    // 未指定 purpose 时因多用途拒绝
    expect(() => collectTrendPoints({ project, dataset })).toThrow('用途不可比');

    // 指定 purpose='smoke' 时仅提取 smoke 跑次，不报不可比
    const smokePoints = collectTrendPoints({ project, dataset, purpose: 'smoke' });
    expect(smokePoints).toHaveLength(2);
    expect(smokePoints.every((p) => p.purpose === 'smoke')).toBe(true);
    expect(smokePoints[0]?.aggregates.a_case_pass_rate).toBe(0.8);
    expect(smokePoints[1]?.aggregates.a_case_pass_rate).toBe(0.9);

    // 指定 purpose='acceptance' 时仅提取 acceptance 跑次
    const accPoints = collectTrendPoints({ project, dataset, purpose: 'acceptance' });
    expect(accPoints).toHaveLength(1);
    expect(accPoints[0]?.purpose === 'acceptance').toBe(true);
  });

  it('支持按 unannotated 筛选多用途数据集中的未标注历史跑次', () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke', '2026-10-21T00:00:00Z');
    addRun(dataset, undefined, '2026-10-22T00:00:00Z');

    const unannotatedPoints = collectTrendPoints({ project, dataset, purpose: 'unannotated' });
    expect(unannotatedPoints).toHaveLength(1);
    expect(unannotatedPoints[0]?.purpose).toBeUndefined();
  });

  it('非法用途参数被严格拒绝，抛出明确错误', () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke');
    expect(() => collectTrendPoints({ project, dataset, purpose: 'invalid_purpose' })).toThrow(
      '非法用途',
    );
    expect(() => collectTrendPoints({ project, dataset, purpose: 'unknown_xyz' })).toThrow(
      '支持的测试用途为',
    );
  });

  it('支持按用途分桶（collectTrendBuckets），严禁不同用途在桶内混算', () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke', '2026-10-21T00:00:00Z', 0.8);
    addRun(dataset, 'acceptance', '2026-10-22T00:00:00Z', 1.0);
    addRun(dataset, undefined, '2026-10-23T00:00:00Z', 0.5);

    const buckets = collectTrendBuckets({ project, dataset });
    expect(Object.keys(buckets).sort()).toEqual(['acceptance', 'smoke', 'unannotated']);

    expect(buckets.smoke?.purpose).toBe('smoke');
    expect(buckets.smoke?.points).toHaveLength(1);
    expect(buckets.smoke?.points[0]?.purpose).toBe('smoke');

    expect(buckets.acceptance?.purpose).toBe('acceptance');
    expect(buckets.acceptance?.points).toHaveLength(1);
    expect(buckets.acceptance?.points[0]?.purpose).toBe('acceptance');

    expect(buckets.unannotated?.purpose).toBeNull();
    expect(buckets.unannotated?.notice).toContain('仅供诊断');
    expect(buckets.unannotated?.points).toHaveLength(1);
  });

  it('CLI runReportTrend 支持 --purpose 筛选与 --bucket 分桶输出', () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke', '2026-10-21T00:00:00Z');
    addRun(dataset, 'regression', '2026-10-22T00:00:00Z');

    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });

    // 1. 指定 purpose json 输出
    expect(runReportTrend({ project, dataset, purpose: 'smoke', json: true })).toBe(0);
    const smokePayload = JSON.parse(lines.pop()!);
    expect(smokePayload.purpose).toBe('smoke');
    expect(smokePayload.points).toHaveLength(1);
    expect(smokePayload.points[0].purpose).toBe('smoke');

    // 2. 指定 bucket json 输出
    expect(runReportTrend({ project, dataset, bucket: true, json: true })).toBe(0);
    const bucketPayload = JSON.parse(lines.pop()!);
    expect(bucketPayload.bucketed).toBe(true);
    expect(Object.keys(bucketPayload.buckets).sort()).toEqual(['regression', 'smoke']);
  });
});

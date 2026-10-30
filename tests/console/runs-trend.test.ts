import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runsTrend } from '../../apps/console/controllers/runs.ts';
import { PROJECT } from '../../apps/console/config.ts';

const temporaryRuns: string[] = [];

function addRun(dataset: string, purpose?: string, startedAt = '2026-10-23T00:00:00Z', val = 1) {
  const runsDir = join(PROJECT, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const dir = mkdtempSync(join(runsDir, 'console-trend-purpose-'));
  temporaryRuns.push(dir);
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify({ run_id: dir.split('/').pop(), dataset, purpose, started_at: startedAt }),
  );
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ aggregates: { a_case_pass_rate: val } }));
}

function uniqueDataset() {
  const dir = mkdtempSync(join(tmpdir(), 'console-trend-dataset-'));
  temporaryRuns.push(dir);
  return dir.split('/').pop()!;
}

afterEach(() => {
  for (const dir of temporaryRuns.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Console runsTrend controller (GAP-4)', () => {
  it('单用途数据集直接返回趋势点，披露用途信息', async () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'regression', '2026-10-22T00:00:00Z', 0.95);
    addRun(dataset, 'regression', '2026-10-23T00:00:00Z', 1.0);

    const res = await runsTrend({ dataset, metric: 'a_case_pass_rate' });
    expect(res.status).toBe(200);
    const body = res.body as {
      purpose: string | null;
      metric: string;
      points: Array<{ run_id: string; purpose: string | null; value: number }>;
    };
    expect(body.purpose).toBe('regression');
    expect(body.metric).toBe('a_case_pass_rate');
    expect(body.points).toHaveLength(2);
    expect(body.points[0].value).toBe(0.95);
    expect(body.points[1].value).toBe(1.0);
  });

  it('未指定用途且包含多用途时，严格拒绝并返回 400 与可用用途列表，严禁混算', async () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke', '2026-10-21T00:00:00Z');
    addRun(dataset, 'acceptance', '2026-10-22T00:00:00Z');

    const res = await runsTrend({ dataset });
    expect(res.status).toBe(400);
    const body = res.body as { error: string; available_purposes?: string[] };
    expect(body.error).toContain('用途不可比');
    expect(body.error).toContain('严禁跨用途无差别混算');
    expect(body.available_purposes?.sort()).toEqual(['acceptance', 'smoke']);
  });

  it('多用途数据集中传入 purpose 筛选特定用途，成功返回且不与其他用途混算', async () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke', '2026-10-21T00:00:00Z', 0.7);
    addRun(dataset, 'acceptance', '2026-10-22T00:00:00Z', 0.9);
    addRun(dataset, 'smoke', '2026-10-23T00:00:00Z', 0.85);

    // 筛选 smoke
    const smokeRes = await runsTrend({ dataset, purpose: 'smoke' });
    expect(smokeRes.status).toBe(200);
    const smokeBody = smokeRes.body as {
      purpose: string;
      points: Array<{ value: number; purpose: string }>;
    };
    expect(smokeBody.purpose).toBe('smoke');
    expect(smokeBody.points).toHaveLength(2);
    expect(smokeBody.points.map((p) => p.value)).toEqual([0.7, 0.85]);
    expect(smokeBody.points.every((p) => p.purpose === 'smoke')).toBe(true);

    // 筛选 acceptance
    const accRes = await runsTrend({ dataset, purpose: 'acceptance' });
    expect(accRes.status).toBe(200);
    const accBody = accRes.body as {
      purpose: string;
      points: Array<{ value: number; purpose: string }>;
    };
    expect(accBody.purpose).toBe('acceptance');
    expect(accBody.points).toHaveLength(1);
    expect(accBody.points[0].value).toBe(0.9);
  });

  it('支持筛选 unannotated 未标注历史跑次，并标注仅供诊断', async () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke', '2026-10-21T00:00:00Z');
    addRun(dataset, undefined, '2026-10-22T00:00:00Z', 0.6);

    const res = await runsTrend({ dataset, purpose: 'unannotated' });
    expect(res.status).toBe(200);
    const body = res.body as {
      purpose: string | null;
      notice: string | null;
      points: Array<{ value: number; purpose: string | null }>;
    };
    expect(body.purpose).toBeNull();
    expect(body.notice).toContain('仅供诊断');
    expect(body.points).toHaveLength(1);
    expect(body.points[0].value).toBe(0.6);
  });

  it('传入非法用途参数时直接返回 400', async () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke');

    const res = await runsTrend({ dataset, purpose: 'invalid_purpose_123' });
    expect(res.status).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toContain('非法用途');
    expect(body.error).toContain('有效用途为');
  });

  it('请求 bucket=true 时分桶返回多用途数据，各桶相互隔离绝不混算', async () => {
    const dataset = uniqueDataset();
    addRun(dataset, 'smoke', '2026-10-21T00:00:00Z', 0.75);
    addRun(dataset, 'diagnostic', '2026-10-22T00:00:00Z', 0.88);
    addRun(dataset, undefined, '2026-10-23T00:00:00Z', 0.5);

    const res = await runsTrend({ dataset, bucket: 'true' });
    expect(res.status).toBe(200);
    const body = res.body as {
      bucketed: boolean;
      available_purposes: string[];
      buckets: Record<
        string,
        {
          purpose: string | null;
          notice: string | null;
          points: Array<{ value: number; purpose: string | null }>;
        }
      >;
    };
    expect(body.bucketed).toBe(true);
    expect(body.available_purposes.sort()).toEqual(['diagnostic', 'smoke', 'unannotated']);

    // smoke 桶
    expect(body.buckets.smoke.purpose).toBe('smoke');
    expect(body.buckets.smoke.points).toHaveLength(1);
    expect(body.buckets.smoke.points[0].value).toBe(0.75);

    // diagnostic 桶
    expect(body.buckets.diagnostic.purpose).toBe('diagnostic');
    expect(body.buckets.diagnostic.points).toHaveLength(1);
    expect(body.buckets.diagnostic.points[0].value).toBe(0.88);

    // unannotated 桶
    expect(body.buckets.unannotated.purpose).toBeNull();
    expect(body.buckets.unannotated.notice).toContain('仅供诊断');
    expect(body.buckets.unannotated.points).toHaveLength(1);
    expect(body.buckets.unannotated.points[0].value).toBe(0.5);
  });
});

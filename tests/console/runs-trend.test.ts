import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

/**
 * `apps/console/config.ts` 的 `PROJECT` 在 import 时求值，因此必须在 import 之前
 * 把控制台项目根指到临时目录。
 *
 * 否则 `addRun` 会往仓库内 `examples/product-eval/runs/` 写目录（`afterEach` 虽会删，
 * 但并发窗口内仍与趋势扫描争抢 I/O）。
 *
 * 注意：此处必须在模块顶层创建（不能挪到 `beforeAll`）——动态 `import` 依赖它。
 * 代价是全部用例被过滤时 `$TMPDIR` 会留下一个空目录，属已知的轻微泄漏。
 */
const isolatedProject = mkdtempSync(join(tmpdir(), 'console-trend-project-'));
mkdirSync(join(isolatedProject, 'runs'), { recursive: true });
writeFileSync(
  join(isolatedProject, 'exam.json'),
  JSON.stringify({
    name: 'console-trend-test-project',
    description: 'runsTrend 测试专用临时考卷库，不落仓库。',
    asset_protocol: 'cases-v1',
    paths: {},
  }),
);
process.env.PROCTOR_CONSOLE_PROJECT = isolatedProject;

const { runsTrend } = await import('../../apps/console/controllers/runs.ts');
const { PROJECT } = await import('../../apps/console/config.ts');

const temporaryRuns: string[] = [];

describe('隔离自证', () => {
  it('PROJECT 落在 tmpdir 下，未回落到 examples/product-eval', () => {
    // 守门断言：若 `PROCTOR_CONSOLE_PROJECT` 未生效（被 setupFile 覆盖、或 config.ts
    // 改了求值方式），PROJECT 会变成真实的 examples/product-eval，测试仍会全绿
    // 但会重新污染真实目录。故断言「不在仓库内」而非「等于某个同源变量」。
    expect(PROJECT.startsWith(tmpdir())).toBe(true);
    expect(PROJECT).not.toContain('examples/product-eval');
  });
});

function addRun(dataset: string, purpose?: string, startedAt = '2026-10-23T00:00:00Z', val = 1) {
  const runsDir = join(PROJECT, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const dir = mkdtempSync(join(runsDir, 'console-trend-purpose-'));
  temporaryRuns.push(dir);
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify({ run_id: dir.split('/').pop(), dataset, purpose, started_at: startedAt }),
  );
  writeFileSync(
    join(dir, 'metrics.json'),
    JSON.stringify({ aggregates: { a_case_pass_rate: val } }),
  );
}

function uniqueDataset() {
  const dir = mkdtempSync(join(tmpdir(), 'console-trend-dataset-'));
  temporaryRuns.push(dir);
  return dir.split('/').pop()!;
}

afterEach(() => {
  for (const dir of temporaryRuns.splice(0)) rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(isolatedProject, { recursive: true, force: true });
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
    expect(body.points[0]?.value).toBe(0.95);
    expect(body.points[1]?.value).toBe(1.0);
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
    expect(accBody.points[0]?.value).toBe(0.9);
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
    expect(body.points[0]?.value).toBe(0.6);
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
    const buckets = body.buckets;

    // smoke 桶
    expect(buckets.smoke?.purpose).toBe('smoke');
    expect(buckets.smoke?.points).toHaveLength(1);
    expect(buckets.smoke?.points[0]?.value).toBe(0.75);

    // diagnostic 桶
    expect(buckets.diagnostic?.purpose).toBe('diagnostic');
    expect(buckets.diagnostic?.points).toHaveLength(1);
    expect(buckets.diagnostic?.points[0]?.value).toBe(0.88);

    // unannotated 桶
    expect(buckets.unannotated?.purpose).toBeNull();
    expect(buckets.unannotated?.notice).toContain('仅供诊断');
    expect(buckets.unannotated?.points).toHaveLength(1);
    expect(buckets.unannotated?.points[0]?.value).toBe(0.5);
  });
});

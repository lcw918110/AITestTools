import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runReportTrend } from '../../src/cli/commands/report-trend.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('report trend', () => {
  it('扫描 dataset 指标时间线', () => {
    const root = join(process.cwd(), 'examples/demo-project');
    const runs = join(root, 'runs', `trend-test-${Date.now()}`);
    mkdirSync(runs, { recursive: true });
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
});

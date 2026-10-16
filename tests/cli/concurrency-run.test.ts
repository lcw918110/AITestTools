import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/cli/main.ts';
import { compareRuns } from '../../src/report/compare.ts';

const demoProject = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

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

/**
 * PRD 附录 C 指标 `a_concurrency_pass_rate`（竞争类通过率）：
 * 多个独立试题以并发方式执行时，结果必须与串行一致。
 *
 * 本测试用 demo-project 的 smoke-A-L1 试卷（5 条 L1 fold 试题），
 * 分别以默认并发 1 和 --concurrency 2 各跑一次，
 * 断言两条路径产生的归一化 results.ndjson 逐字节一致、
 * compare 报告全部 unchanged。
 *
 * L1 fold 试题零宿主、零网络、纯内存计算，
 * 是验证 mapPool 并发安全性的最便宜路径。
 */
describe('run --concurrency (a_concurrency_pass_rate)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('smoke-A-L1 并发 2 与串行 1 归一化结果一致，compare 全 unchanged', async () => {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // 串行（默认并发 1）
    expect(
      await main(['run', '--axis', 'A', '--paperset', 'smoke-A-L1', '--project', demoProject]),
    ).toBe(0);
    const serialDir = out
      .find((l) => l.startsWith('run 完成：'))
      ?.slice('run 完成：'.length)
      .trim();
    expect(serialDir).toBeTruthy();

    out.length = 0;

    // 并发 2
    expect(
      await main([
        'run',
        '--axis',
        'A',
        '--paperset',
        'smoke-A-L1',
        '--concurrency',
        '2',
        '--project',
        demoProject,
      ]),
    ).toBe(0);
    const concDir = out
      .find((l) => l.startsWith('run 完成：'))
      ?.slice('run 完成：'.length)
      .trim();
    expect(concDir).toBeTruthy();

    // 归一化 ndjson 完全一致
    expect(normalizeNdjson(serialDir!)).toBe(normalizeNdjson(concDir!));

    // compare 确认无漂移
    const report = compareRuns(serialDir!, concDir!);
    expect(report.counts.new_failure).toBe(0);
    expect(report.counts.fixed).toBe(0);
    expect(report.counts.asset_rev_drift).toBe(0);
    expect(report.counts.unchanged).toBe(5);
  });
});

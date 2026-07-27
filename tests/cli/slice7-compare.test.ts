import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/cli/main.ts';
import { compareRuns } from '../../src/report/compare.ts';

const demoProject = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('切片 7：重跑一致性 + compare CLI', () => {
  it('smoke-A 连续两次归一化 results 一致，且 compare 全 unchanged', async () => {
    expect(
      await main(['run', '--axis', 'A', '--paperset', 'smoke-A', '--project', demoProject]),
    ).toBe(0);
    const run1 = out
      .find((l) => l.startsWith('run 完成：'))
      ?.slice('run 完成：'.length)
      .trim();
    expect(run1).toBeTruthy();

    out = [];
    expect(
      await main(['run', '--axis', 'A', '--paperset', 'smoke-A', '--project', demoProject]),
    ).toBe(0);
    const run2 = out
      .find((l) => l.startsWith('run 完成：'))
      ?.slice('run 完成：'.length)
      .trim();
    expect(run2).toBeTruthy();
    expect(run1).not.toBe(run2);

    expect(normalizeNdjson(run1!)).toBe(normalizeNdjson(run2!));

    const report = compareRuns(run1!, run2!);
    expect(report.counts.new_failure).toBe(0);
    expect(report.counts.fixed).toBe(0);
    expect(report.counts.asset_rev_drift).toBe(0);
    expect(report.counts.unchanged).toBeGreaterThanOrEqual(2);
  });

  it('compare CLI 输出三分类计数', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-cmp-cli-'));
    const b = join(root, 'b');
    const c = join(root, 'c');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(b);
    mkdirSync(c);
    writeFileSync(
      join(b, 'results.ndjson'),
      [
        JSON.stringify({ item_id: 'A', item_rev: 1, pass: true }),
        JSON.stringify({ item_id: 'B', item_rev: 1, pass: false }),
        JSON.stringify({ item_id: 'C', item_rev: 1, pass: true }),
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(c, 'results.ndjson'),
      [
        JSON.stringify({ item_id: 'A', item_rev: 1, pass: false }),
        JSON.stringify({ item_id: 'B', item_rev: 1, pass: true }),
        JSON.stringify({ item_id: 'C', item_rev: 2, pass: true }),
      ].join('\n') + '\n',
    );

    expect(await main(['compare', '--baseline', b, '--candidate', c, '--json'])).toBe(0);
    const report = JSON.parse(out.join('\n')) as {
      counts: Record<string, number>;
    };
    expect(report.counts.new_failure).toBe(1);
    expect(report.counts.fixed).toBe(1);
    expect(report.counts.asset_rev_drift).toBe(1);
  });
});

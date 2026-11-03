/**
 * 配对实验口径一致性门禁。
 *
 * 配对实验的设计前提：同一道题、同一套判定口径，**只差插件开关**。
 * 如果 ON 侧断言被加严而 OFF 侧留在旧口径，对照组用松标准、实验组用严标准，
 * 「有插件 vs 无插件」的差值就混入了判定标准差异，结论不可信。
 *
 * 本轮改造实际漏了 6 题（12/54/76/92/93/105）：只改 ON 侧，OFF 侧停在旧口径。
 * 全量扫描时 152 题一致、6 题不一致，基线很明确——必须一致。
 *
 * 本测试锁死这条约束，避免下次改断言时再漏。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REV_DIR = resolve(import.meta.dirname, '../../examples/product-eval/case-revisions');

interface RevisionDoc {
  case_revision_id: string;
  expect: { oracles: unknown[] };
}

/** 收集所有 paired-task-N 的 on/off 两侧修订。 */
function collectPairs(): Map<string, { on?: string; off?: string }> {
  const pairs = new Map<string, { on?: string; off?: string }>();
  for (const file of readdirSync(REV_DIR)) {
    const m = /^(paired-task-\d+)\.(r\d+)\.(on|off)\.case-revision\.json$/.exec(file);
    if (m === null) continue;
    const task = m[1] as string;
    const side = m[3] as 'on' | 'off';
    const entry = pairs.get(task) ?? {};
    entry[side] = file;
    pairs.set(task, entry);
  }
  return pairs;
}

function load(file: string): RevisionDoc {
  return JSON.parse(readFileSync(resolve(REV_DIR, file), 'utf8')) as RevisionDoc;
}

const PAIRS = collectPairs();

describe('配对实验 ON/OFF 判定口径一致', () => {
  it('至少存在若干配对题（防止 glob 失效后测试静默通过）', () => {
    const withBoth = [...PAIRS.values()].filter((p) => p.on !== undefined && p.off !== undefined);
    expect(withBoth.length).toBeGreaterThan(100);
  });

  it('每道配对题的 ON 与 OFF 断言必须完全相同', () => {
    const mismatched: Array<{ task: string; on: string; off: string; diff: string[] }> = [];

    for (const [task, sides] of [...PAIRS.entries()].sort()) {
      if (sides.on === undefined || sides.off === undefined) continue;
      const on = load(sides.on);
      const off = load(sides.off);
      if (JSON.stringify(on.expect.oracles) === JSON.stringify(off.expect.oracles)) continue;

      // 定位具体哪些断言不一致，便于修复
      const onById = new Map(
        (on.expect.oracles as Array<{ id?: string }>).map((o) => [o.id ?? '(no-id)', o] as const),
      );
      const offById = new Map(
        (off.expect.oracles as Array<{ id?: string }>).map((o) => [o.id ?? '(no-id)', o] as const),
      );
      const diff: string[] = [];
      for (const id of new Set([...onById.keys(), ...offById.keys()])) {
        if (JSON.stringify(onById.get(id) ?? null) !== JSON.stringify(offById.get(id) ?? null))
          diff.push(id);
      }
      mismatched.push({ task, on: sides.on, off: sides.off, diff });
    }

    const detail = mismatched
      .map((m) => `  ${m.task}: ${m.off} vs ${m.on} → 不一致断言 [${m.diff.join(', ')}]`)
      .join('\n');
    expect(mismatched, `以下配对题 ON/OFF 口径不一致，需同步 OFF 侧：\n${detail}`).toEqual([]);
  });
});

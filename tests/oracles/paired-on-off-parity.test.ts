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
 *
 * **唯一例外：环境能力型断言。**
 * 事件类断言（`event_subsequence` / `no_event`）依赖 SUT 侧 EventStore，
 * 而 OFF 环境（`hosted-plain-v1`）不挂插件、无 `durable_log_glob`，EventStore 必然为空。
 * 若强制两侧一致，该题在对照组恒失败，配对差值混入常数项——比不一致更糟。
 * 因此这类断言允许只存在于 ON 侧；下方逐条校验「只在 ON 侧」确实由环境能力差异解释。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REV_DIR = resolve(import.meta.dirname, '../../examples/product-eval/case-revisions');

/**
 * 依赖 SUT 侧 EventStore、且 hosted 模式**实际支持**的断言类型。
 *
 * `event_fold` 不在此列：`hosted-oracles.ts` 没有该分支，会落到 else 返回 HARNESS，
 * 若允许它走例外，实跑必失败。
 */
const EVENT_ORACLE_TYPES = new Set(['event_subsequence', 'no_event']);

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

  it('每道配对题的 ON 与 OFF 断言必须相同（环境能力型断言除外）', () => {
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

      // 例外：差异全部是「只在 ON 侧的事件类断言」时放行。
      // 这类断言依赖 SUT 侧 EventStore，OFF 环境不挂插件、读不到事件，
      // 强制两侧一致会让对照组恒失败，反而污染配对结论。
      const onlyOnEventOracles = diff.every((id) => {
        const onOracle = onById.get(id) as { type?: string } | undefined;
        const offOracle = offById.get(id);
        return (
          offOracle === undefined &&
          onOracle !== undefined &&
          typeof onOracle.type === 'string' &&
          EVENT_ORACLE_TYPES.has(onOracle.type)
        );
      });
      if (onlyOnEventOracles && diff.length > 0) continue;

      mismatched.push({ task, on: sides.on, off: sides.off, diff });
    }

    const detail = mismatched
      .map((m) => `  ${m.task}: ${m.off} vs ${m.on} → 不一致断言 [${m.diff.join(', ')}]`)
      .join('\n');
    expect(mismatched, `以下配对题 ON/OFF 口径不一致，需同步 OFF 侧：\n${detail}`).toEqual([]);
  });

  it('事件类断言只出现在 ON 侧时，环境能力声明必须配套', () => {
    // 防止「把普通断言误标成事件类」绕过门禁：只有环境能读事件流的题才享有例外。
    //
    // 注意 `requires_durable_log` 在 161 个 ON 修订里恒为 true，单看它不构成约束。
    // 因此额外要求：ON 侧声明了 protocol_probes（读 EventStore 才会有的探针），
    // 且 OFF 侧不得声明探针（否则对照组恒失败）。
    const offenders: string[] = [];
    for (const [task, sides] of [...PAIRS.entries()].sort()) {
      if (sides.on === undefined || sides.off === undefined) continue;
      const on = load(sides.on) as RevisionDoc & {
        execution?: { requires_durable_log?: boolean };
        protocol_probes?: string[];
      };
      const off = load(sides.off) as RevisionDoc & { protocol_probes?: string[] };
      const onEventOracles = (on.expect.oracles as Array<{ type?: string }>).filter(
        (o) => typeof o.type === 'string' && EVENT_ORACLE_TYPES.has(o.type),
      );
      const offEventOracles = (off.expect.oracles as Array<{ type?: string }>).filter(
        (o) => typeof o.type === 'string' && EVENT_ORACLE_TYPES.has(o.type),
      );
      if (onEventOracles.length === 0 || offEventOracles.length > 0) continue;

      const onProbes = on.protocol_probes ?? [];
      const offProbes = off.protocol_probes ?? [];
      const durable = on.execution?.requires_durable_log === true;
      // 三条件缺一不可：ON 声明 durable、ON 有探针、OFF 无探针。
      if (!durable || onProbes.length === 0 || offProbes.length > 0) offenders.push(task);
    }
    expect(
      offenders,
      `以下题只在 ON 侧声明了事件断言，但环境能力声明不配套（需 ON 有 requires_durable_log + protocol_probes，OFF 无 protocol_probes）：${offenders.join(', ')}`,
    ).toEqual([]);
  });
});

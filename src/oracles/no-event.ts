import type { Attribution } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';
import { eventName } from './event-name.ts';
import { effectiveNames } from './tool-trace.ts';

/**
 * 禁止事件断言：`names` 里的事件不得出现。
 *
 * 空清单必须判负：`forbidden` 为空集时任何事件都「未命中」，题目会报 PASS——
 * 声明了「禁止某类事件」却什么都没禁止，比漏写断言更危险。
 * 与 `tool_trace.must_call` 同口径：试题配错，归 `HARNESS`。
 */
export function runNoEventOracle(opts: {
  oracle_id: string;
  events: Record<string, unknown>[];
  names: string[];
  attribution?: Attribution;
}): OracleOutcome {
  const names = effectiveNames(opts.names);
  if (names.length === 0) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: 'names 未声明有效事件名，拒绝静默放过',
      attribution: 'HARNESS',
    };
  }
  const forbidden = new Set(names);
  const hit = opts.events.find((e) => forbidden.has(eventName(e)));
  if (hit === undefined) return { pass: true, oracle_id: opts.oracle_id };
  return {
    pass: false,
    oracle_id: opts.oracle_id,
    message: `出现禁止事件：${eventName(hit)}`,
    attribution: opts.attribution ?? 'PROTOCOL',
  };
}

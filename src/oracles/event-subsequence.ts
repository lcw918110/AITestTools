import type { Attribution } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';
import { eventName } from './event-name.ts';
import { effectiveNames } from './tool-trace.ts';

/**
 * 有序子序列：names 须按顺序出现在事件流中（可夹杂其它事件）。
 *
 * 空期望序列必须判负：`i === 0 === names.length` 恒成立，任何事件流（包括空流）
 * 都会报 PASS——那等于「什么都没要求」却宣称检查了事件顺序。与 `no_event`
 * 同口径：试题配错，归 `HARNESS`。
 */
export function runEventSubsequenceOracle(opts: {
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
  let i = 0;
  for (const e of opts.events) {
    if (i < names.length && eventName(e) === names[i]) i += 1;
  }
  if (i === names.length) return { pass: true, oracle_id: opts.oracle_id };
  return {
    pass: false,
    oracle_id: opts.oracle_id,
    message: `事件子序列未匹配，已匹配到第 ${i}/${names.length} 个（期望 ${names.join(' → ')}）`,
    attribution: opts.attribution ?? 'PROTOCOL',
  };
}

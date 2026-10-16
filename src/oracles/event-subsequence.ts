import type { Attribution } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';
import { eventName } from './event-name.ts';

/** 有序子序列：names 须按顺序出现在事件流中（可夹杂其它事件）。 */
export function runEventSubsequenceOracle(opts: {
  oracle_id: string;
  events: Record<string, unknown>[];
  names: string[];
  attribution?: Attribution;
}): OracleOutcome {
  let i = 0;
  for (const e of opts.events) {
    if (i < opts.names.length && eventName(e) === opts.names[i]) i += 1;
  }
  if (i === opts.names.length) return { pass: true, oracle_id: opts.oracle_id };
  return {
    pass: false,
    oracle_id: opts.oracle_id,
    message: `事件子序列未匹配，已匹配到第 ${i}/${opts.names.length} 个（期望 ${opts.names.join(' → ')}）`,
    attribution: opts.attribution ?? 'PROTOCOL',
  };
}

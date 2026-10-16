import type { Attribution } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';
import { eventName } from './event-name.ts';

export function runNoEventOracle(opts: {
  oracle_id: string;
  events: Record<string, unknown>[];
  names: string[];
  attribution?: Attribution;
}): OracleOutcome {
  const forbidden = new Set(opts.names);
  const hit = opts.events.find((e) => forbidden.has(eventName(e)));
  if (hit === undefined) return { pass: true, oracle_id: opts.oracle_id };
  return {
    pass: false,
    oracle_id: opts.oracle_id,
    message: `出现禁止事件：${eventName(hit)}`,
    attribution: opts.attribution ?? 'PROTOCOL',
  };
}

import type { Attribution } from '../exam-engine/types.ts';
import { PredicateError, evalStatePredicate } from './state-predicate.ts';
import type { OracleOutcome } from './types.ts';

export function runStatePredicateOracle(opts: {
  oracle_id: string;
  expr: string;
  root: unknown;
  evidence_ref?: string;
  attribution?: Attribution;
}): OracleOutcome {
  try {
    const ok = evalStatePredicate(opts.expr, opts.root);
    if (ok) return { pass: true, oracle_id: opts.oracle_id };
    const fail: OracleOutcome = {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `predicate false: ${opts.expr}`,
      attribution: opts.attribution ?? 'PROTOCOL',
    };
    if (opts.evidence_ref !== undefined) fail.evidence_ref = opts.evidence_ref;
    return fail;
  } catch (e) {
    const msg = e instanceof PredicateError ? e.message : (e as Error).message;
    const fail: OracleOutcome = {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `predicate error: ${msg}`,
      attribution: 'HARNESS',
    };
    if (opts.evidence_ref !== undefined) fail.evidence_ref = opts.evidence_ref;
    return fail;
  }
}

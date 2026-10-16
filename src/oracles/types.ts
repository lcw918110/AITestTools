import type { Attribution } from '../exam-engine/types.ts';

export interface OracleFailure {
  oracle_id: string;
  message: string;
  evidence_ref?: string;
  attribution?: Attribution;
}

export interface OraclePass {
  oracle_id: string;
  pass: true;
  message?: string;
}

export type OracleOutcome = OraclePass | (OracleFailure & { pass: false });

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Attribution } from '../exam-engine/types.ts';
import { deepEqual } from './deep-equal.ts';
import type { OracleOutcome } from './types.ts';

export function runEventFoldOracle(opts: {
  oracle_id: string;
  foldState: unknown;
  expectedPath: string;
  projectRoot: string;
  artifactRel?: string;
  attribution?: Attribution;
}): OracleOutcome {
  const abs = resolve(opts.projectRoot, opts.expectedPath);
  let expected: unknown;
  try {
    expected = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
  } catch (e) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `无法读取期望折叠态：${opts.expectedPath}（${(e as Error).message}）`,
      attribution: 'HARNESS',
    };
  }
  if (deepEqual(opts.foldState, expected)) {
    return { pass: true, oracle_id: opts.oracle_id };
  }
  const fail: OracleOutcome = {
    pass: false,
    oracle_id: opts.oracle_id,
    message: 'Fold 结果与期望折叠态不一致',
    attribution: opts.attribution ?? 'PROTOCOL',
  };
  if (opts.artifactRel !== undefined) fail.evidence_ref = opts.artifactRel;
  return fail;
}

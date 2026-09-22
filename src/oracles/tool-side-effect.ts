import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Attribution, OracleToolSideEffect } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';

/**
 * tool_side_effect：workspace 内文件副作用。
 * 字段：`file`（或 `path`）、可选 `contains`。
 */
export function runToolSideEffectOracle(opts: {
  oracle_id: string;
  oracle: OracleToolSideEffect;
  workspace: string;
  attribution?: Attribution;
}): OracleOutcome {
  const rel = opts.oracle.file ?? opts.oracle.path ?? '';
  if (!rel) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: 'tool_side_effect 缺少 file',
      attribution: 'HARNESS',
    };
  }
  const abs = join(opts.workspace, rel);
  if (!existsSync(abs)) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `缺少副作用文件：${rel}`,
      attribution: opts.attribution ?? 'TOOL',
    };
  }
  const contains = opts.oracle.contains;
  if (typeof contains === 'string' && contains.length > 0) {
    const body = readFileSync(abs, 'utf8');
    if (!body.includes(contains)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `副作用文件未含「${contains}」`,
        attribution: opts.attribution ?? 'TOOL',
      };
    }
  }
  return { pass: true, oracle_id: opts.oracle_id };
}

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Attribution, Oracle } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';

/**
 * workspace_assert：文件存在 / 内容包含（只读）。
 * 字段：`path`（相对 workspace）、可选 `contains`、可选 `exists`（默认 true）。
 */
export function runWorkspaceAssertOracle(opts: {
  oracle_id: string;
  oracle: Oracle;
  workspace: string;
  attribution?: Attribution;
}): OracleOutcome {
  const rel = String(opts.oracle.path ?? opts.oracle.file ?? '');
  if (!rel) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: 'workspace_assert 缺少 path',
      attribution: 'HARNESS',
    };
  }
  const abs = join(opts.workspace, rel);
  const wantExists = opts.oracle.exists === undefined ? true : Boolean(opts.oracle.exists);
  const exists = existsSync(abs);
  if (wantExists && !exists) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `期望存在文件：${rel}`,
      attribution: opts.attribution ?? 'TOOL',
    };
  }
  if (!wantExists && exists) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `期望不存在文件：${rel}`,
      attribution: opts.attribution ?? 'TOOL',
    };
  }
  const contains = opts.oracle.contains;
  if (typeof contains === 'string' && contains.length > 0 && exists) {
    const text = readFileSync(abs, 'utf8');
    if (!text.includes(contains)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `文件 ${rel} 未含「${contains}」`,
        attribution: opts.attribution ?? 'TOOL',
      };
    }
  }
  return { pass: true, oracle_id: opts.oracle_id };
}

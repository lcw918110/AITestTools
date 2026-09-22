import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Attribution, OracleWorkspaceAssert } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';

/**
 * workspace_assert：文件存在 / 内容包含 / 内容不含（只读）。
 * 字段：`path`（相对 workspace）、可选 `contains`、可选 `not_contains`、可选 `exists`（默认 true）。
 *
 * `not_contains` 用于判「改干净了没有」：只查 `contains` 会把「新值写进去了、旧值还留着」
 * 判成通过，而残留旧值恰恰是跨文件改动最常见的失败方式。
 */
export function runWorkspaceAssertOracle(opts: {
  oracle_id: string;
  oracle: OracleWorkspaceAssert;
  workspace: string;
  attribution?: Attribution;
}): OracleOutcome {
  const rel = opts.oracle.path ?? opts.oracle.file ?? '';
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
  const notContains = opts.oracle.not_contains;
  const needsText =
    exists &&
    ((typeof contains === 'string' && contains.length > 0) ||
      (typeof notContains === 'string' && notContains.length > 0));
  if (needsText) {
    const text = readFileSync(abs, 'utf8');
    if (typeof contains === 'string' && contains.length > 0 && !text.includes(contains)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `文件 ${rel} 未含「${contains}」`,
        attribution: opts.attribution ?? 'TOOL',
      };
    }
    if (typeof notContains === 'string' && notContains.length > 0 && text.includes(notContains)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `文件 ${rel} 仍残留「${notContains}」`,
        attribution: opts.attribution ?? 'TOOL',
      };
    }
  }
  return { pass: true, oracle_id: opts.oracle_id };
}

import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Attribution, OracleWorkspaceAssert } from '../exam-engine/types.ts';
import { isBlankText } from '../exam-engine/blank.ts';
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
  const workspace = resolve(opts.workspace);
  const abs = resolve(workspace, rel);
  if (abs !== workspace && !abs.startsWith(workspace + sep)) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `安全拒绝：路径 ${rel} 试图访问 workspace 外文件`,
      attribution: 'HARNESS',
    };
  }
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
  // 声明了内容断言就必须是有效文本：`""` 与纯空白（`"   "`）语义上都等于「没声明」，
  // 放行会让「要检查文件内容」的断言退化成只查文件存在；拿去 `includes("   ")` 比对
  // 又把试题笔误记成被测失败。两者都属试题配错，录题阶段已由 schema minLength +
  // 语义检查拦住，这里兜住绕过静态门禁的路径。
  for (const [key, value] of [
    ['contains', contains],
    ['not_contains', notContains],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || isBlankText(value))) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `workspace_assert 的 ${key} 为空白（等价于没声明内容断言）`,
        attribution: 'HARNESS',
      };
    }
  }
  const needsText = exists && (contains !== undefined || notContains !== undefined);
  if (needsText) {
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch (err) {
      // 读不了（指向目录、权限不足等）是环境或试题问题，不能记成「模型没做到」，
      // 否则环境故障会污染被测系统的缺陷数。调用方传的 attribution 只对「内容不匹配」
      // 生效——与 tool_side_effect 读失败硬归 HARNESS 保持同一口径。
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `读取文件 ${rel} 失败：${err instanceof Error ? err.message : String(err)}`,
        attribution: 'HARNESS',
      };
    }
    if (contains !== undefined && !text.includes(contains)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `文件 ${rel} 未含「${contains}」`,
        attribution: opts.attribution ?? 'TOOL',
      };
    }
    if (notContains !== undefined && text.includes(notContains)) {
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

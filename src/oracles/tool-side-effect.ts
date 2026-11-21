import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Attribution, OracleToolSideEffect } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';

/**
 * tool_side_effect：workspace 内文件副作用。
 * 字段：`file`（或 `path`）、可选 `contains`。
 *
 * 口径：`contains` **声明了就必须有效**。空串或纯空白同样判负归 `HARNESS`
 * （试题配错），不能像以前那样「空串静默忽略而报通过」——那会让一条写着
 * 「要检查文件内容」的断言变成只检查文件存在；也不能把 `"  "` 当真实语义去比对，
 * 那会把试题笔误记成被测失败。
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
  if (!existsSync(abs)) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `缺少副作用文件：${rel}`,
      attribution: opts.attribution ?? 'TOOL',
    };
  }
  const contains = opts.oracle.contains;
  // 空串 / 纯空白：声明了内容断言却没有有效内容，属试题配错，必须判负归 HARNESS。
  if (contains !== undefined && (typeof contains !== 'string' || contains.trim() === '')) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: 'contains 未声明有效内容，拒绝静默放过',
      attribution: 'HARNESS',
    };
  }
  if (typeof contains === 'string' && contains.length > 0) {
    let body: string;
    try {
      body = readFileSync(abs, 'utf8');
    } catch (err) {
      // 读不了（指向目录、权限不足等）是环境或试题问题，不能记成「模型没做到」。
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `读取文件 ${rel} 失败：${err instanceof Error ? err.message : String(err)}`,
        attribution: 'HARNESS',
      };
    }
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

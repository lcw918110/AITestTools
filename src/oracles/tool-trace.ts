import type { Attribution } from '../exam-engine/types.ts';
import { isBlankText } from '../exam-engine/blank.ts';
import type { OracleOutcome } from './types.ts';

export interface ToolCallTrace {
  name: string;
  args?: Record<string, unknown>;
}

/**
 * 过滤出真正有效的名字（非空白字符串），不做 `String()` 强转。
 *
 * 空清单的断言在实现里恒真：没有必须出现的工具 → `missing` 恒空，题目会报 PASS。
 * 那等于声明了「要检查工具纪律」却什么都没检查，比漏写断言更危险。
 * 强转还会制造假名（`0 → "0"`、`null → "null"`），既让配错混过空清单守卫，
 * 也把「试题写错」记成「被测失败」。
 *
 * **唯一入口**：调用方（含 `b-runner` 构造 EvalJob）只调本函数，不得再自行 `map(String)`；
 * oracle 内部会再过滤一次，因此重复调用是幂等的，不会出现「discover 用假名、evaluate 不用」的漂移。
 * 与 `event_subsequence` / `no_event` 的空清单守卫同口径：试题配错，归 `HARNESS`。
 */
export function effectiveNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is string => typeof n === 'string' && !isBlankText(n));
}

/** 名单无效（空数组 / 全是空白名 / 非字符串）时：判负并归 HARNESS，绝不当被测失败。 */
function emptyDeclaredOutcome(oracle_id: string, field: string, what: string): OracleOutcome {
  return {
    pass: false,
    oracle_id,
    message: `${field} 未声明有效${what}，拒绝静默放过`,
    attribution: 'HARNESS',
  };
}

/** 工具名为空（如 `tool: ""`）时：查谁都查不到，属试题配错，同样归 HARNESS。 */
function emptyToolOutcome(oracle_id: string): OracleOutcome {
  return {
    pass: false,
    oracle_id,
    message: 'tool 未声明有效工具名，拒绝静默放过',
    attribution: 'HARNESS',
  };
}

/** 必须出现指定工具调用（名匹配，忽略大小写）。 */
export function runToolTraceOracle(opts: {
  oracle_id: string;
  must_call: string[];
  calls: ToolCallTrace[];
  attribution?: Attribution;
}): OracleOutcome {
  const mustCall = effectiveNames(opts.must_call);
  if (mustCall.length === 0) {
    return emptyDeclaredOutcome(opts.oracle_id, 'must_call', '工具名');
  }
  const seen = new Set(opts.calls.map((c) => c.name.toLowerCase()));
  const missing = mustCall.filter((n) => !seen.has(n.toLowerCase()));
  if (missing.length === 0) return { pass: true, oracle_id: opts.oracle_id };
  return {
    pass: false,
    oracle_id: opts.oracle_id,
    message: `缺少工具调用：${missing.join(', ')}`,
    attribution: opts.attribution ?? 'MODEL_SCHEMA',
  };
}

/** 对指定工具的每次调用，检查必填顶层字段存在。 */
export function runSchemaObedienceOracle(opts: {
  oracle_id: string;
  tool: string;
  required_fields: string[];
  calls: ToolCallTrace[];
  attribution?: Attribution;
}): OracleOutcome {
  const required = effectiveNames(opts.required_fields);
  if (required.length === 0) {
    return emptyDeclaredOutcome(opts.oracle_id, 'required_fields', '字段名');
  }
  // 空工具名会与所有调用名失配 → 恒「未找到工具」，本质是试题配错，不能记成模型没调用。
  if (typeof opts.tool !== 'string' || isBlankText(opts.tool)) {
    return emptyToolOutcome(opts.oracle_id);
  }
  const tool = opts.tool.trim();
  const hits = opts.calls.filter((c) => c.name.toLowerCase() === tool.toLowerCase());
  if (hits.length === 0) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `未找到工具 ${tool} 的调用`,
      attribution: opts.attribution ?? 'MODEL_SCHEMA',
    };
  }
  for (const call of hits) {
    const args = call.args ?? {};
    const missing = required.filter((f) => !(f in args));
    if (missing.length > 0) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `${tool} 缺少必填字段：${missing.join(', ')}`,
        attribution: opts.attribution ?? 'MODEL_SCHEMA',
      };
    }
  }
  return { pass: true, oracle_id: opts.oracle_id };
}

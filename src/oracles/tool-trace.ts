import type { Attribution } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';

export interface ToolCallTrace {
  name: string;
  args?: Record<string, unknown>;
}

/** 必须出现指定工具调用（名匹配，忽略大小写）。 */
export function runToolTraceOracle(opts: {
  oracle_id: string;
  must_call: string[];
  calls: ToolCallTrace[];
  attribution?: Attribution;
}): OracleOutcome {
  const seen = new Set(opts.calls.map((c) => c.name.toLowerCase()));
  const missing = opts.must_call.filter((n) => !seen.has(n.toLowerCase()));
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
  const hits = opts.calls.filter((c) => c.name.toLowerCase() === opts.tool.toLowerCase());
  if (hits.length === 0) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `未找到工具 ${opts.tool} 的调用`,
      attribution: opts.attribution ?? 'MODEL_SCHEMA',
    };
  }
  for (const call of hits) {
    const args = call.args ?? {};
    const missing = opts.required_fields.filter((f) => !(f in args));
    if (missing.length > 0) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `${opts.tool} 缺少必填字段：${missing.join(', ')}`,
        attribution: opts.attribution ?? 'MODEL_SCHEMA',
      };
    }
  }
  return { pass: true, oracle_id: opts.oracle_id };
}

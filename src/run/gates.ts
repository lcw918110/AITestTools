import type { GateBound } from '../exam-engine/types.ts';
import { findMetric } from '../metrics/catalog.ts';

export interface GateEvaluation {
  name: string;
  pass: boolean;
  actual: number | undefined;
  bound: GateBound;
  message: string;
}

/** 按 paperset.gates 对 aggregates 做 min/max 判定。缺指标视为未通过。 */
export function evaluateGates(
  aggregates: Record<string, number>,
  gates: Record<string, GateBound> | undefined,
): GateEvaluation[] {
  if (gates === undefined) return [];
  const out: GateEvaluation[] = [];
  for (const [name, bound] of Object.entries(gates)) {
    const actual = aggregates[name];
    if (actual === undefined || Number.isNaN(actual)) {
      out.push({
        name,
        pass: false,
        actual: undefined,
        bound,
        message: `门禁指标 "${name}" 未产出聚合值`,
      });
      continue;
    }
    let pass = true;
    const parts: string[] = [];
    if (bound.min !== undefined && actual < bound.min) {
      pass = false;
      parts.push(`${actual} < min ${bound.min}`);
    }
    if (bound.max !== undefined && actual > bound.max) {
      pass = false;
      parts.push(`${actual} > max ${bound.max}`);
    }
    out.push({
      name,
      pass,
      actual,
      bound,
      message: pass ? `ok (${actual})` : parts.join('; '),
    });
  }
  return out;
}

/**
 * 从逐题 metrics 收齐目录内指标。
 * mean：对「该题写出了该键」的样本取平均；sum：求和。
 * 未出现在任何题上的指标不写入 aggregates（门禁侧会报缺值）。
 */
export function aggregateItemMetrics(
  results: Array<{ metrics: Record<string, number> }>,
): Record<string, number> {
  const buckets = new Map<string, number[]>();
  for (const r of results) {
    for (const [k, v] of Object.entries(r.metrics)) {
      if (typeof v !== 'number' || Number.isNaN(v)) continue;
      const arr = buckets.get(k) ?? [];
      arr.push(v);
      buckets.set(k, arr);
    }
  }
  const aggregates: Record<string, number> = {};
  for (const [name, values] of buckets) {
    const spec = findMetric(name);
    if (spec?.aggregation === 'sum') {
      aggregates[name] = values.reduce((a, b) => a + b, 0);
    } else {
      aggregates[name] = values.reduce((a, b) => a + b, 0) / values.length;
    }
  }
  // 通过率类：若试题未写 a_case_pass_rate，仍从 pass 语义补一条（由调用方可覆盖）
  return aggregates;
}

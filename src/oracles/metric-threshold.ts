import type { Attribution, OracleMetricThreshold } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';

/**
 * 对单题已产出的 metrics 做阈值判定。
 * 字段：`metric`（名）、可选 `min` / `max`；也接受 GateBound 形状嵌在 oracle 上。
 */
export function runMetricThresholdOracle(opts: {
  oracle_id: string;
  oracle: OracleMetricThreshold;
  metrics: Record<string, number>;
  attribution?: Attribution;
}): OracleOutcome {
  const metric = opts.oracle.metric ?? opts.oracle.name ?? '';
  if (!metric) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: 'metric_threshold 缺少 metric 字段',
      attribution: 'HARNESS',
    };
  }
  const actual = opts.metrics[metric];
  if (actual === undefined || Number.isNaN(actual)) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `指标 "${metric}" 未产出`,
      attribution: opts.attribution ?? 'HARNESS',
    };
  }
  const min = typeof opts.oracle.min === 'number' ? opts.oracle.min : undefined;
  const max = typeof opts.oracle.max === 'number' ? opts.oracle.max : undefined;
  if (min === undefined && max === undefined) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: 'metric_threshold 需要 min 和/或 max',
      attribution: 'HARNESS',
    };
  }
  if (min !== undefined && actual < min) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `${metric}=${actual} < min ${min}`,
      attribution: opts.attribution ?? 'PROTOCOL',
    };
  }
  if (max !== undefined && actual > max) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `${metric}=${actual} > max ${max}`,
      attribution: opts.attribution ?? 'PROTOCOL',
    };
  }
  return { pass: true, oracle_id: opts.oracle_id };
}

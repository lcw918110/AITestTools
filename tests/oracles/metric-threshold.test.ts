import { describe, expect, it } from 'vitest';
import { runMetricThresholdOracle } from '../../src/oracles/metric-threshold.ts';

describe('runMetricThresholdOracle', () => {
  it('落在阈值内通过', () => {
    const o = runMetricThresholdOracle({
      oracle_id: 'm1',
      oracle: { type: 'metric_threshold', metric: 'a_case_pass_rate', min: 1 },
      metrics: { a_case_pass_rate: 1 },
    });
    expect(o.pass).toBe(true);
  });

  it('低于 min 失败', () => {
    const o = runMetricThresholdOracle({
      oracle_id: 'm1',
      oracle: { type: 'metric_threshold', metric: 'a_case_pass_rate', min: 1 },
      metrics: { a_case_pass_rate: 0 },
    });
    expect(o.pass).toBe(false);
  });
});

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

describe('runMetricThresholdOracle 归因（真实调用点都会传 focus）', () => {
  it('指标未产出时即使传了焦点归因也归 HARNESS', () => {
    const o = runMetricThresholdOracle({
      oracle_id: 'm1',
      oracle: { type: 'metric_threshold', metric: 'c_contract_pass_rate', min: 1 },
      metrics: {},
      attribution: 'MODEL_TASK',
    });
    expect(o.pass).toBe(false);
    expect(o).toMatchObject({ attribution: 'HARNESS' });
  });

  it('指标为 NaN 归 HARNESS', () => {
    const o = runMetricThresholdOracle({
      oracle_id: 'm1',
      oracle: { type: 'metric_threshold', metric: 'c_contract_pass_rate', min: 1 },
      metrics: { c_contract_pass_rate: Number.NaN },
      attribution: 'MODEL_TASK',
    });
    expect(o).toMatchObject({ pass: false, attribution: 'HARNESS' });
  });

  it('有值但越界才使用焦点归因', () => {
    const o = runMetricThresholdOracle({
      oracle_id: 'm1',
      oracle: { type: 'metric_threshold', metric: 'c_contract_pass_rate', min: 1 },
      metrics: { c_contract_pass_rate: 0 },
      attribution: 'MODEL_TASK',
    });
    expect(o).toMatchObject({ pass: false, attribution: 'MODEL_TASK' });
  });
});

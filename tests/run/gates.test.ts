import { describe, expect, it } from 'vitest';
import { aggregateItemMetrics, evaluateGates } from '../../src/run/gates.ts';

describe('evaluateGates', () => {
  it('min/max 判定', () => {
    const ev = evaluateGates(
      { a_case_pass_rate: 1, a_invariant_violations: 0 },
      {
        a_case_pass_rate: { min: 1 },
        a_invariant_violations: { max: 0 },
      },
    );
    expect(ev.every((g) => g.pass)).toBe(true);
  });

  it('低于 min 失败', () => {
    const ev = evaluateGates({ a_case_pass_rate: 0.5 }, { a_case_pass_rate: { min: 1 } });
    expect(ev[0]?.pass).toBe(false);
  });

  it('缺指标失败', () => {
    const ev = evaluateGates({}, { a_case_pass_rate: { min: 1 } });
    expect(ev[0]?.pass).toBe(false);
    expect(ev[0]?.message).toMatch(/未产出/);
  });
});

describe('aggregateItemMetrics', () => {
  it('mean 与 sum', () => {
    const agg = aggregateItemMetrics([
      { metrics: { a_case_pass_rate: 1, a_invariant_violations: 1 } },
      { metrics: { a_case_pass_rate: 0, a_invariant_violations: 2 } },
    ]);
    expect(agg.a_case_pass_rate).toBe(0.5);
    expect(agg.a_invariant_violations).toBe(3);
  });
});

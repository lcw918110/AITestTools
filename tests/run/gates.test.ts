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

  it('max 超过上限失败', () => {
    const ev = evaluateGates({ a_invariant_violations: 1 }, { a_invariant_violations: { max: 0 } });
    expect(ev[0]?.pass).toBe(false);
    expect(ev[0]?.message).toBe('1 > max 0');
  });

  it('min 恰好等于阈值通过', () => {
    const ev = evaluateGates({ a_case_pass_rate: 1 }, { a_case_pass_rate: { min: 1 } });
    expect(ev[0]?.pass).toBe(true);
    expect(ev[0]?.message).toBe('ok (1)');
  });

  it('多个 gate 混合判定', () => {
    const ev = evaluateGates(
      { a_case_pass_rate: 0.5, a_invariant_violations: 0 },
      {
        a_case_pass_rate: { min: 1 },
        a_invariant_violations: { max: 0 },
      },
    );
    expect(ev).toHaveLength(2);
    expect(ev.find((g) => g.name === 'a_case_pass_rate')?.pass).toBe(false);
    expect(ev.find((g) => g.name === 'a_case_pass_rate')?.message).toBe('0.5 < min 1');
    expect(ev.find((g) => g.name === 'a_invariant_violations')?.pass).toBe(true);
    expect(ev.find((g) => g.name === 'a_invariant_violations')?.message).toBe('ok (0)');
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

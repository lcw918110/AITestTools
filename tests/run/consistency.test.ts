import { describe, expect, it } from 'vitest';
import { resolveRepeats } from '../../src/run/repeats.ts';
import { aggregateConsistency, extractCaseId, hasTrialSuffix } from '../../src/run/consistency.ts';
import type { CaseRevision, EnvironmentProfile } from '../../src/domain/types.ts';
import type { AxisItemResult } from '../../src/run/runner-types.ts';

function modelRevision(overrides: Partial<CaseRevision['execution']> = {}): CaseRevision {
  return {
    case_id: 'c1',
    case_revision_id: 'c1.r1',
    revision_number: 1,
    stimulus: { ref: 'x' },
    attribution_focus: 'TOOL',
    execution_profile: { mode: 'hosted' },
    execution: { deadline_ms: 1000, requires_network: false, ...overrides },
    expect: { oracles: [] },
  } as unknown as CaseRevision;
}

function behaviorRevision(): CaseRevision {
  return {
    case_id: 'c2',
    case_revision_id: 'c2.r1',
    revision_number: 1,
    stimulus: { ref: 'x' },
    attribution_focus: 'TOOL',
    execution_profile: { mode: 'fold' },
    execution: { deadline_ms: 1000, requires_network: false },
    expect: { oracles: [] },
  } as unknown as CaseRevision;
}

function env(repeats?: number): EnvironmentProfile {
  return {
    environment_profile_id: 'env-1',
    name: 'env',
    lifecycle: 'active',
    recipe: {
      ...(repeats !== undefined ? { adapter: { repeats } } : {}),
    },
  } as unknown as EnvironmentProfile;
}

describe('resolveRepeats（repeats 解析优先级）', () => {
  it('默认 repeats=1（opt-in，不声明就不多次采样）', () => {
    expect(resolveRepeats(modelRevision(), env())).toBe(1);
    expect(resolveRepeats(behaviorRevision(), env())).toBe(1);
  });

  it('题级 execution.repeats 优先于环境级 adapter.repeats', () => {
    expect(resolveRepeats(modelRevision({ repeats: 2 }), env(5))).toBe(2);
  });

  it('环境级 adapter.repeats 优先于默认值', () => {
    expect(resolveRepeats(modelRevision(), env(3))).toBe(3);
  });

  it('repeats 至少为 1（非法值钳制）', () => {
    expect(resolveRepeats(modelRevision({ repeats: 0 }), env())).toBe(1);
  });
});

function result(itemId: string, pass: boolean): AxisItemResult {
  return {
    item_id: itemId,
    item_rev: 1,
    pass,
    oracle_failures: [],
    metrics: { a_case_pass_rate: pass ? 1 : 0, a_invariant_violations: 0 },
  };
}

describe('aggregateConsistency（pass^k 与成功率范围）', () => {
  it('单题 4 次 trial 全过 → pass^4=1，成功率 100%~100%', () => {
    const results = [
      result('c1::r0', true),
      result('c1::r1', true),
      result('c1::r2', true),
      result('c1::r3', true),
    ];
    const agg = aggregateConsistency(results, 'c1');
    expect(agg.pass_k).toBe(1);
    expect(agg.success_rate_min).toBe(1);
    expect(agg.success_rate_max).toBe(1);
  });

  it('单题 4 次 trial 3 过 1 挂 → pass^4=0，成功率 75%~75%，标记 flaky', () => {
    const results = [
      result('c1::r0', true),
      result('c1::r1', true),
      result('c1::r2', true),
      result('c1::r3', false),
    ];
    const agg = aggregateConsistency(results, 'c1');
    expect(agg.pass_k).toBe(0);
    expect(agg.success_rate_min).toBe(0.75);
    expect(agg.success_rate_max).toBe(0.75);
    expect(agg.flaky).toBe(true);
  });

  it('多题聚合：pass^k 为各题 pass^k 的均值', () => {
    const results = [
      result('c1::r0', true),
      result('c1::r1', true),
      result('c1::r2', true),
      result('c1::r3', true),
      result('c2::r0', true),
      result('c2::r1', false),
      result('c2::r2', true),
      result('c2::r3', true),
    ];
    const agg = aggregateConsistency(results);
    // c1 pass^4=1, c2 pass^4=0 → 均值 0.5
    expect(agg.pass_k).toBe(0.5);
  });

  it('单次题（无 ::rN 尾缀）不进入聚合，避免污染成功率范围与 pass^k', () => {
    const results = [
      // repeats=4 的模型题：3 过 1 挂
      result('model-case.r1::r0', true),
      result('model-case.r1::r1', true),
      result('model-case.r1::r2', true),
      result('model-case.r1::r3', false),
      // repeats=1 的行为题：单次通过（无尾缀，不应进入聚合）
      result('behavior-case.r1', true),
    ];
    const agg = aggregateConsistency(results);
    // 只聚合 model-case（4 trial，3 过 1 挂）
    expect(agg.pass_k).toBe(0); // model-case 未全过 → pass^4=0
    expect(agg.success_rate_min).toBe(0.75);
    expect(agg.success_rate_max).toBe(0.75);
    expect(agg.flaky).toBe(true);
  });
});

describe('extractCaseId / hasTrialSuffix（trial 尾缀判据一致）', () => {
  it('只剥 ::r + 纯数字尾缀，两者判据一致', () => {
    expect(extractCaseId('c1::r0')).toBe('c1');
    expect(hasTrialSuffix('c1::r0')).toBe(true);
    expect(extractCaseId('c1::r12')).toBe('c1');
    expect(extractCaseId('c1')).toBe('c1');
    expect(hasTrialSuffix('c1')).toBe(false);
  });

  it('模型名以 r 开头时不被误当 trial 尾缀', () => {
    // `::reflect` / `::r1-mini` 都不是 `::r<数字>`，不得剥。
    expect(extractCaseId('c1::reflect')).toBe('c1::reflect');
    expect(hasTrialSuffix('c1::reflect')).toBe(false);
    expect(extractCaseId('c1::r1-mini')).toBe('c1::r1-mini');
    expect(hasTrialSuffix('c1::r1-mini')).toBe(false);
    // 真正的尾缀仍要剥：B-direct 形状 case::模型::rN。
    expect(extractCaseId('c1::reflect::r2')).toBe('c1::reflect');
  });

  it('题号自身含 ::r 字样时不被截断', () => {
    // 题号里出现 ::r 但不是尾缀，必须原样保留。
    expect(extractCaseId('case::r1-alpha')).toBe('case::r1-alpha');
    expect(extractCaseId('case::r1-alpha::r0')).toBe('case::r1-alpha');
  });
});

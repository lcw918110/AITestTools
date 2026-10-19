import { describe, expect, it } from 'vitest';
import { cohensKappa, collectPairs, computeAgreement } from '../../src/judge/agreement.ts';
import type { Score } from '../../src/domain/types.ts';

function score(
  source: Score['source'],
  itemId: string,
  dimension: string,
  pass: boolean,
): Score {
  return {
    score_id: `${source}-${itemId}-${dimension}`,
    source,
    item_id: itemId,
    dimension,
    pass,
  };
}

describe('agreement', () => {
  it('collectPairs 只配 model_judge 与 human 同 item+dimension', () => {
    const scores: Score[] = [
      score('model_judge', 'T1', '可读性', true),
      score('human', 'T1', '可读性', true),
      score('model_judge', 'T1', '合理性', false),
      score('human', 'T1', '合理性', true),
      // 无 human 配对的 model 记录不产出配对
      score('model_judge', 'T2', '可读性', true),
      // deterministic_oracle 不参与
      { score_id: 'o1', source: 'deterministic_oracle', item_id: 'T1', dimension: '可读性' },
    ];
    const pairs = collectPairs(scores);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ dimension: '可读性', modelPass: true, humanPass: true });
    expect(pairs[1]).toEqual({ dimension: '合理性', modelPass: false, humanPass: true });
  });

  it('collectPairs 跳过无 pass 的 judge_error 记录', () => {
    const scores: Score[] = [
      score('model_judge', 'T1', '可读性', true),
      { score_id: 'e1', source: 'model_judge', item_id: 'T1', dimension: '可读性', reason: 'judge_error: x' },
      score('human', 'T1', '可读性', true),
    ];
    const pairs = collectPairs(scores);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.modelPass).toBe(true);
  });

  it('cohensKappa 完全一致为 1', () => {
    expect(cohensKappa([true, true, false], [true, true, false])).toBeCloseTo(1, 10);
  });

  it('cohensKappa 完全相反为负值', () => {
    expect(cohensKappa([true, false], [false, true])).toBeCloseTo(-1, 10);
  });

  it('cohensKappa 样本不足 2 返回 undefined', () => {
    expect(cohensKappa([true], [true])).toBeUndefined();
  });

  it('computeAgreement 逐维度 + 总体一致', () => {
    const scores: Score[] = [
      score('model_judge', 'T1', '可读性', true),
      score('human', 'T1', '可读性', true),
      score('model_judge', 'T2', '可读性', true),
      score('human', 'T2', '可读性', false),
      score('model_judge', 'T1', '合理性', false),
      score('human', 'T1', '合理性', false),
    ];
    const r = computeAgreement(scores);
    expect(r.dimensions).toHaveLength(2);
    const read = r.dimensions.find((d) => d.dimension === '可读性');
    expect(read?.sampleCount).toBe(2);
    expect(read?.agreeCount).toBe(1);
    expect(read?.agreementRate).toBeCloseTo(0.5, 10);
    const reason = r.dimensions.find((d) => d.dimension === '合理性');
    expect(reason?.sampleCount).toBe(1);
    expect(reason?.agreeCount).toBe(1);
    expect(r.totalSampleCount).toBe(3);
    expect(r.totalAgreeCount).toBe(2);
    expect(r.overallAgreementRate).toBeCloseTo(2 / 3, 10);
    expect(r.insufficientSample).toBe(false);
    expect(r.overallKappa).toBeDefined();
  });

  it('computeAgreement 样本不足时 insufficientSample 为 true 且无 kappa', () => {
    const scores: Score[] = [
      score('model_judge', 'T1', '可读性', true),
      score('human', 'T1', '可读性', true),
    ];
    const r = computeAgreement(scores);
    expect(r.insufficientSample).toBe(true); // 总体 1 对 < 2
    expect(r.overallKappa).toBeUndefined();
    expect(r.dimensions[0]?.kappa).toBeUndefined();
  });

  it('computeAgreement 空输入不产出 kappa', () => {
    const r = computeAgreement([]);
    expect(r.dimensions).toHaveLength(0);
    expect(r.totalSampleCount).toBe(0);
    expect(r.insufficientSample).toBe(true);
    expect(r.overallKappa).toBeUndefined();
    expect(r.overallAgreementRate).toBeUndefined();
  });
});

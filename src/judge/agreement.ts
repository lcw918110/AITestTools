/**
 * 人工标注校验基准（inter-judge agreement，优化项 ①）。
 * 量化「模型判断（model_judge）vs 人工判断（human）」的一致性，作为裁判模型上线门槛。
 *
 * 本文只提供纯逻辑：从 `Score[]` 提取 model_judge/human 配对，逐维度 + 总体计算
 * Cohen's Kappa 与一致率。纯报告指标，不进硬门禁。
 */
import type { Score } from '../domain/types.ts';

/** 单个维度的校验结果。 */
export interface DimensionAgreement {
  dimension: string;
  /** 有效配对样本数（同 item_id + dimension 下 model_judge 与 human 各一条）。 */
  sampleCount: number;
  /** 一致对数（model_judge.pass === human.pass）。 */
  agreeCount: number;
  /** 一致率 = agreeCount / sampleCount（样本为 0 时为 undefined）。 */
  agreementRate: number | undefined;
  /** Cohen's Kappa（样本 < 2 或分母为 0 时为 undefined）。 */
  kappa: number | undefined;
}

/** 总体校验结果（跨维度聚合）。 */
export interface AgreementReport {
  dimensions: DimensionAgreement[];
  /** 总体有效配对样本数（各维度之和）。 */
  totalSampleCount: number;
  /** 总体一致对数。 */
  totalAgreeCount: number;
  /** 总体一致率（样本为 0 时为 undefined）。 */
  overallAgreementRate: number | undefined;
  /** 总体 Cohen's Kappa（样本 < 2 或分母为 0 时为 undefined）。 */
  overallKappa: number | undefined;
  /** 样本不足（总体配对 < 2）时为 true，不产出 kappa 结论。 */
  insufficientSample: boolean;
}

/** 配对键：item_id + dimension。 */
function pairKey(s: Score): string | undefined {
  if (!s.item_id || !s.dimension) return undefined;
  return `${s.item_id}\u0000${s.dimension}`;
}

/** 从 scores 提取 model_judge/human 配对（同 item+dimension 各取一条，model 优先最新）。 */
export function collectPairs(
  scores: Score[],
): Array<{ dimension: string; modelPass: boolean; humanPass: boolean }> {
  const model = new Map<string, boolean>();
  const human = new Map<string, boolean>();
  for (const s of scores) {
    const key = pairKey(s);
    if (!key) continue;
    // 无 pass 判定的记录（如 judge_error）不参与一致性配对。
    if (typeof s.pass !== 'boolean') continue;
    if (s.source === 'model_judge') model.set(key, s.pass);
    else if (s.source === 'human') human.set(key, s.pass);
  }
  const pairs: Array<{ dimension: string; modelPass: boolean; humanPass: boolean }> = [];
  for (const [key, modelPass] of model) {
    if (!human.has(key)) continue;
    pairs.push({ dimension: key.split('\u0000')[1] ?? '', modelPass, humanPass: human.get(key)! });
  }
  return pairs;
}

/**
 * 二值判定的 Cohen's Kappa。样本 < 2 或期望一致分母为 0 时返回 undefined。
 * 退化边界：若 a、b 均无变异（全 true 或全 false），期望一致 pe=1，Kappa 无定义返回 undefined
 * （此时一致率仍可报告，但 Kappa 不产出，避免「全一致但无区分度」被误读为高一致性）。
 */
export function cohensKappa(
  a: boolean[],
  b: boolean[],
): number | undefined {
  if (a.length !== b.length || a.length < 2) return undefined;
  const n = a.length;
  let agree = 0;
  let aTrue = 0;
  let bTrue = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree += 1;
    if (a[i]) aTrue += 1;
    if (b[i]) bTrue += 1;
  }
  const p0 = agree / n;
  const pe =
    (aTrue / n) * (bTrue / n) + ((n - aTrue) / n) * ((n - bTrue) / n);
  if (pe >= 1) return undefined;
  return (p0 - pe) / (1 - pe);
}

/** 计算校验基准报告。 */
export function computeAgreement(scores: Score[]): AgreementReport {
  const pairs = collectPairs(scores);
  const byDim = new Map<string, Array<{ modelPass: boolean; humanPass: boolean }>>();
  for (const p of pairs) {
    const arr = byDim.get(p.dimension) ?? [];
    arr.push(p);
    byDim.set(p.dimension, arr);
  }

  const dimensions: DimensionAgreement[] = [];
  for (const [dimension, dimPairs] of [...byDim.entries()].sort((x, y) =>
    x[0].localeCompare(y[0]),
  )) {
    const sampleCount = dimPairs.length;
    const agreeCount = dimPairs.filter((p) => p.modelPass === p.humanPass).length;
    const a = dimPairs.map((p) => p.modelPass);
    const b = dimPairs.map((p) => p.humanPass);
    dimensions.push({
      dimension,
      sampleCount,
      agreeCount,
      agreementRate: sampleCount > 0 ? agreeCount / sampleCount : undefined,
      kappa: sampleCount >= 2 ? cohensKappa(a, b) : undefined,
    });
  }

  const totalSampleCount = pairs.length;
  const totalAgreeCount = pairs.filter((p) => p.modelPass === p.humanPass).length;
  const allA = pairs.map((p) => p.modelPass);
  const allB = pairs.map((p) => p.humanPass);

  return {
    dimensions,
    totalSampleCount,
    totalAgreeCount,
    overallAgreementRate: totalSampleCount > 0 ? totalAgreeCount / totalSampleCount : undefined,
    overallKappa: totalSampleCount >= 2 ? cohensKappa(allA, allB) : undefined,
    insufficientSample: totalSampleCount < 2,
  };
}

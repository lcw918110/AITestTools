import type { AxisItemResult } from './runner-types.ts';

/**
 * 一致性量化聚合结果（ADR-0010）。
 * 纯报告指标，不进硬门禁。
 */
export interface ConsistencyAggregate {
  /** pass^k：k 次全过的题数 / 题数（k = 实际 repeats）。 */
  pass_k: number;
  /** 各题 trial 成功率的最小值。 */
  success_rate_min: number;
  /** 各题 trial 成功率的最大值。 */
  success_rate_max: number;
  /** 是否存在 flaky 题（同一题 trial 结果不一致）。 */
  flaky: boolean;
}

/**
 * 从逐 trial 的 AxisItemResult 聚合一致性指标。
 *
 * 只聚合「带 `::r<N>` 尾缀」的 trial（repeats>1 的题）；无尾缀的单次题（repeats=1）
 * 不进入聚合，避免把成功率范围拉到 0%/100%、虚增 pass^k 分母。
 *
 * @param results 逐 trial 结果。
 * @param focusCaseId 可选：只聚合指定前缀的题（单题视角）。
 */
export function aggregateConsistency(
  results: AxisItemResult[],
  focusCaseId?: string,
): ConsistencyAggregate {
  const byCase = new Map<string, boolean[]>();
  for (const r of results) {
    if (!hasTrialSuffix(r.item_id)) continue;
    const caseId = extractCaseId(r.item_id);
    if (focusCaseId !== undefined && caseId !== focusCaseId) continue;
    const arr = byCase.get(caseId) ?? [];
    arr.push(r.pass);
    byCase.set(caseId, arr);
  }

  if (byCase.size === 0) {
    return { pass_k: 0, success_rate_min: 0, success_rate_max: 0, flaky: false };
  }

  let passKSum = 0;
  let minMin = 1;
  let maxMax = 0;
  let flaky = false;

  for (const arr of byCase.values()) {
    const passCount = arr.filter(Boolean).length;
    const rate = passCount / arr.length;
    const allPass = passCount === arr.length;
    passKSum += allPass ? 1 : 0;
    minMin = Math.min(minMin, rate);
    maxMax = Math.max(maxMax, rate);
    if (passCount > 0 && passCount < arr.length) flaky = true;
  }

  return {
    pass_k: passKSum / byCase.size,
    success_rate_min: minMin,
    success_rate_max: maxMax,
    flaky,
  };
}

/** 从 item_id 提取 case_revision_id（去掉 `::r<N>` 尾缀）。 */
export function extractCaseId(itemId: string): string {
  const idx = itemId.lastIndexOf('::r');
  if (idx > 0) return itemId.slice(0, idx);
  return itemId;
}

/** 判断 item_id 是否带 `::r<N>` 尾缀（repeats>1 的 trial）。 */
export function hasTrialSuffix(itemId: string): boolean {
  return /::r\d+$/.test(itemId);
}

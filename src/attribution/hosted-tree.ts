/**
 * hosted 归因判定树 v1（设计 12）。纯函数，便于单测。
 */
import type { Attribution } from '../exam-engine/types.ts';

export const ATTRIBUTION_TREE_VERSION = 'attribution-tree-v1';

export interface AttributionInput {
  harnessFault?: boolean;
  protocolProbeMiss?: boolean;
  contextProbeMiss?: boolean;
  schemaObedienceFail?: boolean;
  taskAssertFail?: boolean;
  toolStructuredError?: boolean;
}

export interface AttributionDecision {
  attribution: Attribution;
  matched_rule: string;
  tree: string;
}

/**
 * 题目的 attribution_focus 只能改写「被测对象」类归因。
 * HARNESS / CONTEXT 是工装与环境失败（缺密钥、额度不足、宿主起不来），
 * 若被 focus 改写成 MODEL_TASK，报表会把「没额度」记成「模型没做到」，直接得出错误结论。
 *
 * 工作区/任务失败固定为 MODEL_TASK：ON 题的 PROTOCOL focus 不得把「文件改错」改写成 PROTOCOL。
 * MODEL_SCHEMA 等其它被测对象 focus 仍可细化。
 */
export function resolveHostedAttribution(decided: Attribution, focus?: Attribution): Attribution {
  if (decided === 'HARNESS' || decided === 'CONTEXT') return decided;
  if (decided === 'MODEL_TASK' && focus === 'PROTOCOL') return 'MODEL_TASK';
  return focus ?? decided;
}

/**
 * 效果题工作区未过时的归因（写死，不看 attribution_focus）。
 * - 鉴权/额度 → CONTEXT
 * - 超时且播种材料完全没动 → CONTEXT（没跑完，不是改错）
 * - 其余（改了但改错、非超时任务失败）→ MODEL_TASK
 */
export function resolveWorkspaceFailAttribution(input: {
  timedOut: boolean;
  materialsMutated: boolean;
  authMiss?: boolean;
}): Attribution {
  if (input.authMiss === true) return 'CONTEXT';
  if (input.timedOut && !input.materialsMutated) return 'CONTEXT';
  return 'MODEL_TASK';
}

export function diagnoseHostedFailure(input: AttributionInput): AttributionDecision {
  if (input.harnessFault === true) {
    return { attribution: 'HARNESS', matched_rule: '[0]', tree: ATTRIBUTION_TREE_VERSION };
  }
  if (input.protocolProbeMiss === true) {
    return { attribution: 'PROTOCOL', matched_rule: '[1]', tree: ATTRIBUTION_TREE_VERSION };
  }
  if (input.contextProbeMiss === true) {
    return { attribution: 'CONTEXT', matched_rule: '[2]', tree: ATTRIBUTION_TREE_VERSION };
  }
  if (input.schemaObedienceFail === true) {
    return { attribution: 'MODEL_SCHEMA', matched_rule: '[3a]', tree: ATTRIBUTION_TREE_VERSION };
  }
  if (input.taskAssertFail === true) {
    return { attribution: 'MODEL_TASK', matched_rule: '[3b]', tree: ATTRIBUTION_TREE_VERSION };
  }
  if (input.toolStructuredError === true) {
    return { attribution: 'TOOL', matched_rule: '[4]', tree: ATTRIBUTION_TREE_VERSION };
  }
  return { attribution: 'HARNESS', matched_rule: '[5]', tree: ATTRIBUTION_TREE_VERSION };
}

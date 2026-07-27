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

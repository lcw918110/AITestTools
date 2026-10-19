/**
 * runner 输入类型（绞杀者完成后的领域对象形状）。
 *
 * runner 直接消费领域对象 CaseRevision / EnvironmentProfile。
 * 配对键（pair_key）来自 Case，通过 RunCaseInput.pairKey 单独携带。
 */
import type { CaseRevision, EnvironmentProfile } from '../domain/types.ts';

/** runner 消费的题目上下文：不可变修订 + 配对键（来自 Case.pair_key）。 */
export interface RunCaseInput {
  revision: CaseRevision;
  /** 配对键（Case.pair_key ?? case_id 大写），hosted 配对结论用。 */
  pairKey?: string;
}

/** runner 消费的环境上下文：EnvironmentProfile。 */
export type RunEnvironmentInput = EnvironmentProfile;

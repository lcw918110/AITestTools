/**
 * runner / adapter 共用的输入输出类型（cases-v1 领域对象形状）。
 *
 * runner 直接消费领域对象 CaseRevision / EnvironmentProfile。
 * 配对键（pair_key）来自 Case，通过 RunCaseInput.pairKey 单独携带。
 */
import type { Attribution } from '../exam-engine/types.ts';
import type { CaseRevision, EnvironmentProfile } from '../domain/types.ts';

/** runner 消费的题目上下文：不可变修订 + 配对键（来自 Case.pair_key）。 */
export interface RunCaseInput {
  revision: CaseRevision;
  /** 配对键（Case.pair_key ?? case_id 大写），hosted 配对结论用。 */
  pairKey?: string;
}

/** runner 消费的环境上下文：EnvironmentProfile。 */
export type RunEnvironmentInput = EnvironmentProfile;

/**
 * 题级执行结果（统一类型，原名 L1ItemResult）。
 *
 * 由各 runner / adapter 的 evaluate 阶段产出，write-artifacts 消费落盘。
 * 字段覆盖 fold / scripted / cassette / hosted / direct_tool / cli 六类执行形态，
 * 未涉及的形态字段保持 undefined（落盘时按需省略）。
 */
export interface AxisItemResult {
  item_id: string;
  item_rev: number;
  pass: boolean;
  attribution?: Attribution;
  oracle_failures: Array<{
    oracle_id: string;
    message: string;
    evidence_ref?: string;
  }>;
  metrics: Record<string, number>;
  artifact_dir?: string;
  fold_state?: unknown;
  /** 配对效果键（来自 intent.effect_pair） */
  effect_pair?: string;
  /** hosted 约定终态词（辅助信号，不单独否决） */
  pass_token?: string;
  pass_token_present?: boolean;
  pass_token_role?: 'auxiliary';
  /** hosted：工作区断言是否全部通过（无此类 oracle 则为 true） */
  workspace_ok?: boolean;
  /** hosted：播种材料是否被改过（超时归因：未改→CONTEXT，改错→MODEL_TASK） */
  materials_mutated?: boolean;
  /** hosted：宿主墙钟超时（辅助；工作区已过则不否决） */
  timed_out?: boolean;
  /** hosted：进程退出码；超时/被杀为 null（辅助） */
  host_exit?: number | null;
  host_signal?: string | null;
  host_exit_role?: 'auxiliary';
}

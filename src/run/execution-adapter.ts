import type { ItemDoc, RoomDoc } from '../exam-engine/types.ts';
import type { Attempt, Attribution, CaseExecution, Run } from '../domain/types.ts';

/**
 * ExecutionAdapter 统一执行阶段（02 §4.2）：
 * discover/resolve → preflight → prepare → submit/start → query/status → collect → evaluate → cleanup。
 * 相邻阶段可合并，但必须能报告「发生了什么、失败在哪一步、是否完成清理」。
 */

/** 三值事实记录器（§3.5 三段式之二 ObservedFacts）。 */
export interface ObservedFacts {
  /** resolved 值（Adapter/Provider 解析结果）。 */
  resolved: Array<{ kind: string; key: string; value: unknown }>;
  /** observed 值（运行中实际观测）。 */
  observed: Array<{ kind: string; key: string; value: unknown }>;
}

export interface ObservedFactsRecorder {
  /** 记录 resolved 值。 */
  resolve(kind: string, key: string, value: unknown): void;
  /** 记录 observed 值。 */
  observe(kind: string, key: string, value: unknown): void;
  /** 导出事实清单。 */
  snapshot(): ObservedFacts;
}

/** Adapter 上下文：由 RunOrchestrator 注入状态机实体与三值记录器。 */
export interface AdapterContext {
  item: ItemDoc;
  room: RoomDoc;
  projectRoot: string;
  artifactDir?: string;
  models: string[];
  sutRoot?: string;
  run: Run;
  caseExecution: CaseExecution;
  attempt: Attempt;
  facts: ObservedFactsRecorder;
}

/** 1. discover/resolve 输出。 */
export interface DiscoveredInput {
  [key: string]: unknown;
}

/** 2. preflight 输出。 */
export interface PreflightResult {
  ok: boolean;
  reason?: string;
}

/** 3. prepare 输出（可回滚的准备态）。 */
export interface PreparedState {
  [key: string]: unknown;
}

/** 4. submit 输出（执行句柄）。 */
export interface SubmittedHandle {
  [key: string]: unknown;
}

/** 5. collect 输出（收集到的产物）。 */
export interface CollectedOutput {
  [key: string]: unknown;
}

/** 6. evaluate 输出（CaseExecution 终态）。 */
export interface EvaluationResult {
  pass: boolean;
  attribution?: Attribution;
  metrics?: Record<string, number>;
  oracleFailures?: Array<{ oracle_id: string; message: string }>;
}

/** 7. cleanup 输出。 */
export interface CleanupResult {
  ok: boolean;
  reason?: string;
}

/** 统一执行阶段接口。 */
export interface ExecutionAdapter {
  readonly adapterId: string;
  discover(ctx: AdapterContext): Promise<DiscoveredInput>;
  preflight?(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreflightResult>;
  prepare(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreparedState>;
  submit(ctx: AdapterContext, prepared: PreparedState): Promise<SubmittedHandle>;
  collect(ctx: AdapterContext, handle: SubmittedHandle): Promise<CollectedOutput>;
  evaluate(ctx: AdapterContext, collected: CollectedOutput): Promise<EvaluationResult>;
  cleanup?(ctx: AdapterContext, prepared: PreparedState): Promise<CleanupResult>;
}

/** 稳定错误类别（02 §4.2）。 */
export type AdapterErrorKind =
  | 'discover_failed'
  | 'preflight_failed'
  | 'prepare_failed'
  | 'submit_failed'
  | 'collect_failed'
  | 'evaluate_failed'
  | 'cleanup_failed';

/** Adapter 统一错误：携带阶段、归因、是否可安全重试。 */
export class AdapterError extends Error {
  constructor(
    readonly kind: AdapterErrorKind,
    readonly attribution: Attribution,
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

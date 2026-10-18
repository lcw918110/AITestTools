/**
 * V2.17 领域对象模型（唯一权威类型）。
 * 依据 docs/02-总体架构与领域设计.md §3 定义。
 * 本文件是重写后的唯一领域类型来源；旧 ItemDoc/PapersetDoc/RoomDoc 已废弃。
 */

// ─────────────────────────────────────────────────────────────
// 1. 状态机（§3.4 权威状态字段）
// ─────────────────────────────────────────────────────────────

/** Run 生命周期状态（10 态）。interrupted 表示异常退出后待对账，不是成功终态。 */
export const RUN_LIFECYCLE_STATUS = [
  'created',
  'preflight',
  'queued',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'blocked',
  'interrupted',
] as const;
export type RunLifecycleStatus = (typeof RUN_LIFECYCLE_STATUS)[number];

/** CaseExecution 执行结果（7 态）。completed 表示流程到达可评测终点，不代表任务通过。 */
export const EXECUTION_OUTCOME = [
  'completed',
  'execution_failed',
  'blocked',
  'cancelled',
  'timed_out',
  'not_run',
  'unknown',
] as const;
export type ExecutionOutcome = (typeof EXECUTION_OUTCOME)[number];

/** CaseExecution 评测结果（4 态）。pass 才表示按合同通过。 */
export const EVALUATION_OUTCOME = ['pass', 'fail', 'indeterminate', 'not_evaluated'] as const;
export type EvaluationOutcome = (typeof EVALUATION_OUTCOME)[number];

/** Attempt 物理尝试状态（9 态）。不使用 blocked/not_run 表示从未执行的计划项。 */
export const ATTEMPT_STATUS = [
  'created',
  'starting',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
  'unknown',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUS)[number];

/** Run 状态机允许的转换表（§3.4）。终态不可原地重开。 */
export const RUN_TRANSITIONS: Readonly<Record<RunLifecycleStatus, readonly RunLifecycleStatus[]>> =
  {
    created: ['preflight', 'blocked', 'failed', 'interrupted'],
    preflight: ['queued', 'running', 'blocked', 'failed', 'interrupted'],
    queued: ['running', 'cancelling', 'blocked', 'failed', 'interrupted'],
    running: ['cancelling', 'completed', 'failed', 'interrupted'],
    cancelling: ['cancelled', 'completed', 'failed', 'interrupted'],
    interrupted: ['running', 'completed', 'failed', 'cancelled', 'blocked'],
    completed: [],
    failed: [],
    cancelled: [],
    blocked: [],
  };

/** 失败归因六选一（保留 V1 语义）。禁止无归因红灯。 */
export const ATTRIBUTIONS = [
  'PROTOCOL',
  'CONTEXT',
  'MODEL_SCHEMA',
  'MODEL_TASK',
  'TOOL',
  'HARNESS',
] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];

/** 归因标签八分类（§3.4）。不能取代 outcome。 */
export const ATTRIBUTION_TAGS = [
  'product_defect',
  'environment_failure',
  'provider_error',
  'test_data_issue',
  'expected_negative_behavior',
  'flaky_or_nondeterministic',
  'design_pending',
  'unknown',
] as const;
export type AttributionTag = (typeof ATTRIBUTION_TAGS)[number];

// ─────────────────────────────────────────────────────────────
// 2. Oracle / Rubric（§5.1）
// ─────────────────────────────────────────────────────────────

/** Oracle 类型（保留 V1 的 12 种判定器）。 */
export const ORACLE_TYPES = [
  'event_fold',
  'event_subsequence',
  'state_predicate',
  'no_event',
  'tool_trace',
  'schema_obedience',
  'workspace_assert',
  'tool_result_equals',
  'tool_side_effect',
  'exit_code',
  'metric_threshold',
  'stdout_assert',
] as const;
export type OracleType = (typeof ORACLE_TYPES)[number];

/** 机器 Oracle 单项结果（§5.1）。缺证据/前提未满足不能默默通过。 */
export type OracleVerdict = 'pass' | 'fail' | 'indeterminate';

/** Oracle 判定结果：带规则版本、理由、证据引用。 */
export interface OracleResult {
  oracle_id: string;
  verdict: OracleVerdict;
  rule_version?: string;
  reason?: string;
  evidence_ref?: string;
}

/** 机器判定 / Rubric 评分 / 人工评价（§3.1 OracleResult/Score）。 */
export interface Score {
  score_id: string;
  source: 'deterministic_oracle' | 'model_judge' | 'human';
  dimension?: string;
  scale?: string;
  weight?: number;
  value?: number;
  rule_version?: string;
  judge_model?: string;
  judge_prompt_version?: string;
  reason?: string;
  evidence_refs?: string[];
}

// ─────────────────────────────────────────────────────────────
// 3. 核心领域对象（§3.1）
// ─────────────────────────────────────────────────────────────

/** 用例生命周期（§3.1 Case）。 */
export const CASE_LIFECYCLE = [
  'draft',
  'candidate',
  'reviewed',
  'validated',
  'released',
  'deprecated',
] as const;
export type CaseLifecycle = (typeof CASE_LIFECYCLE)[number];

/** 自动化准备度（与生命周期正交，§3.2）。 */
export const AUTOMATION_READINESS = [
  'not_assessed',
  'manual_only',
  'spec_incomplete',
  'design_ready',
  'blocked',
] as const;
export type AutomationReadiness = (typeof AUTOMATION_READINESS)[number];

/** 稳定逻辑用例身份（§3.1 Case）。不在父对象上原地改写已发布内容。 */
export interface Case {
  case_id: string;
  title: string;
  owner?: string;
  tags?: string[];
  lifecycle: CaseLifecycle;
  automation_readiness: AutomationReadiness;
  /** 当前最新修订号；历史修订不可变，通过 case_revision_id 引用。 */
  head_revision_id?: string;
  /** 配对键（OFF/ON 共享同一 Case，通过 pair_key 关联）。 */
  pair_key?: string;
  created_at: string;
  updated_at: string;
}

/** 任务类型 / 难度分层（§4.5.1 / 追踪矩阵 REQ-TASK-STRATA-001）。 */
export interface TaskStrata {
  task_type: string;
  difficulty_level: string;
  difficulty_basis?: string;
}

/** 不可变修订正文（§3.1 CaseRevision）。修改内容创建新修订。 */
export interface CaseRevision {
  case_id: string;
  case_revision_id: string;
  revision_number: number;
  /** 迁移自 papers-v1 时的原始 ItemDoc.id（toCaseId 非双射，需显式保留以还原历史 run 产物 id）。 */
  legacy_item_id?: string;
  /** 内容 hash（输入/前提/预期/Oracle/Rubric/证据/清理 的规范化摘要）。 */
  content_hash: string;
  /** 输入材料引用。 */
  stimulus: {
    kind: string;
    ref: string;
    notes?: string;
    /** hosted 通行 token（V1 stimulus.hosted_pass_token 迁移）。 */
    hosted_pass_token?: string;
  };
  /** 前提条件 / 步骤动作 / 初始化清理 / 权限副作用。 */
  preconditions?: string[];
  steps?: string[];
  setup_cleanup?: string[];
  permissions_side_effects?: string[];
  /** 预期合同：Oracle / Rubric。 */
  expect: {
    oracles: Oracle[];
    rubric?: RubricSpec;
  };
  /** 证据要求。 */
  evidence_requirements?: string[];
  /** 分层。 */
  strata?: TaskStrata;
  /** 执行驱动配置（原 papers-v1 item.freeze 迁移；轴废除后用 mode/layer 表达路由）。 */
  execution_profile?: {
    mode: 'fold' | 'scripted' | 'cassette' | 'hosted' | 'direct_tool';
    layer?: 'L1' | 'L2' | 'L3';
    fold_entry?: string;
    event_schema?: string;
    session_id?: string;
    contract?: string;
    script?: string;
    cassette?: string;
  };
  /** 归因聚焦（保留 V1 attribution_focus 语义）。 */
  attribution_focus: Attribution;
  /** 协议探针（hosted 期望的 Kind）。 */
  protocol_probes?: string[];
  /** 基准模型（V1 freeze.model_id 迁移；题目级固定条件）。 */
  model_id?: string;
  /** 执行约束。 */
  execution: {
    deadline_ms: number;
    requires_network: boolean;
    requires_durable_log?: boolean;
    repeats?: number;
  };
  /** 变更日志。 */
  change_log?: Record<string, string>;
}

/** 冻结的案例集合及其完整引用闭包（§3.1 DatasetRelease）。不可变。 */
export interface DatasetRelease {
  dataset_release_id: string;
  name: string;
  description?: string;
  /** 逐项引用确切 CaseRevision（非可变的 Case 当前版本）。 */
  case_revisions: Array<{
    case_id: string;
    case_revision_id: string;
    content_hash: string;
    /** 材料 / Oracle / Rubric 引用闭包的 hash。 */
    material_hashes?: Record<string, string>;
  }>;
  /** 引用闭包总 hash。 */
  closure_hash: string;
  /** 分层覆盖矩阵（task_type × difficulty_level）。 */
  coverage_matrix?: Record<string, Record<string, number>>;
  created_at: string;
}

/** 执行路线步骤（§3.1 RouteStep）。只定义路线、步骤级引用和步骤级证据要求。 */
export interface RouteStep {
  step_id: string;
  /** 引用确切 CaseRevision。 */
  case_revision_id: string;
  /** 依赖的前置步骤。 */
  depends_on?: string[];
  /** 前置条件。 */
  preconditions?: string[];
  /** 失败后的继续/停止策略。 */
  on_failure: 'continue' | 'stop' | 'skip_dependents';
  /** 步骤级证据要求。 */
  evidence_requirements?: string[];
}

/** 用例执行路线（§3.1 SuitePlan）。不拥有 Run/Experiment 级预算、并发、重试、计时口径或评分器权威值。 */
export interface SuitePlan {
  suite_plan_id: string;
  name: string;
  dataset_release_id: string;
  /** 按依赖/顺序组织的路线步骤。 */
  steps: RouteStep[];
  created_at: string;
}

/** exit_code：进程以期望码退出（非 0 也可是期望，如「必须失败」）。 */
export interface OracleExitCode {
  type: 'exit_code';
  id?: string;
  equals?: number;
}

/** workspace_assert：文件存在 / 内容包含 / 不含（只读）。 */
export interface OracleWorkspaceAssert {
  type: 'workspace_assert';
  id?: string;
  path: string;
  file?: string;
  contains?: string;
  not_contains?: string;
  exists?: boolean;
}

/** tool_side_effect：workspace 内文件副作用。 */
export interface OracleToolSideEffect {
  type: 'tool_side_effect';
  id?: string;
  file: string;
  path?: string;
  contains?: string;
}

/** tool_result_equals：工具返回值深等比较。 */
export interface OracleToolResultEquals {
  type: 'tool_result_equals';
  id?: string;
  equals?: unknown;
  expected?: unknown;
}

/** stdout_assert：hosted 回复文本包含 / 不含 / 正则。 */
export interface OracleStdoutAssert {
  type: 'stdout_assert';
  id?: string;
  contains?: string | string[];
  not_contains?: string | string[];
  contains_regex?: string | string[];
  not_contains_regex?: string | string[];
  regex_flags?: string;
}

/** metric_threshold：单题 metrics 阈值判定。 */
export interface OracleMetricThreshold {
  type: 'metric_threshold';
  id?: string;
  metric: string;
  name?: string;
  min?: number;
  max?: number;
}

/** event_fold：折叠态与期望文件深等比对。 */
export interface OracleEventFold {
  type: 'event_fold';
  id?: string;
  spec: string;
}

/** event_subsequence：事件名有序子序列。 */
export interface OracleEventSubsequence {
  type: 'event_subsequence';
  id?: string;
  names: string[];
}

/** state_predicate：受限布尔表达式。 */
export interface OracleStatePredicate {
  type: 'state_predicate';
  id?: string;
  expr: string;
}

/** no_event：禁止事件不出现。 */
export interface OracleNoEvent {
  type: 'no_event';
  id?: string;
  names: string[];
}

/** tool_trace：必须出现指定工具调用。 */
export interface OracleToolTrace {
  type: 'tool_trace';
  id?: string;
  must_call: string[];
}

/** schema_obedience：工具调用必填字段检查。 */
export interface OracleSchemaObedience {
  type: 'schema_obedience';
  id?: string;
  tool: string;
  required_fields: string[];
}

/** Oracle 定义（保留 V1 12 种判定器结构）。 */
export type Oracle =
  | OracleExitCode
  | OracleWorkspaceAssert
  | OracleToolSideEffect
  | OracleToolResultEquals
  | OracleStdoutAssert
  | OracleMetricThreshold
  | OracleEventFold
  | OracleEventSubsequence
  | OracleStatePredicate
  | OracleNoEvent
  | OracleToolTrace
  | OracleSchemaObedience;

/** Rubric 规格（§5.1）。 */
export interface RubricSpec {
  dimensions: Array<{ name: string; scale: string; weight: number }>;
  judge?: { model?: string; prompt_version?: string };
}

// ─────────────────────────────────────────────────────────────
// 4. 实验对象（§3.1 / §3.3）
// ─────────────────────────────────────────────────────────────

/** 候选配置（§3.1 CandidateConfig）。 */
export interface CandidateConfig {
  candidate_id: string;
  name: string;
  /** Host/Agent/插件版本。 */
  host?: { name?: string; version?: string };
  agent?: { name?: string; version?: string };
  plugin?: { name?: string; version?: string; path?: string };
  /** 计划模型路由策略。 */
  model_routing?: string;
  /** 功能消融 Profile。 */
  feature_ablation_profile?: string;
  /** 环境 / 权限引用。 */
  environment_profile?: string;
  /** 明确允许作为候选差异的配置引用。 */
  declared_differences?: string[];
  /** prompt 模板路径（V1 freeze.prompt_template 迁移；与 stimulus.ref 冗余时省略）。 */
  prompt_template?: string;
  /** 直连/宿主通道（V1 freeze.channel 迁移）。 */
  channel?: 'direct' | 'hosted';
  /** 工具 Profile（V1 freeze.tool_profile 迁移）。 */
  tool_profile?: string;
}

/** 实验计划（§3.1 ExperimentPlan）。执行前冻结。 */
export interface ExperimentPlan {
  experiment_plan_id: string;
  name: string;
  /** 目标问题。 */
  objective: string;
  /** 候选配置。 */
  candidates: CandidateConfig[];
  /** 固定条件（非实验因素）。 */
  fixed_factors: Record<string, unknown>;
  /** 变化因素（预先声明为实验因素）。 */
  varying_factors: string[];
  /** 指标。 */
  metrics: string[];
  /** 重复 / 顺序策略。 */
  repeat_strategy: { repeats: number; order?: 'paired' | 'random' | 'balanced'; seed?: number };
  /** 共享协议（预算/并发/重试/计时/Artifact/清理）。 */
  protocol: {
    budget?: string;
    concurrency?: number;
    retry?: string;
    timing?: string;
    artifact_policy?: string;
    cleanup?: string;
  };
  /** 冻结时间。 */
  frozen_at: string;
}

/** 实验实例（§3.1 Experiment）。每次重跑用新 ID。 */
export interface Experiment {
  experiment_id: string;
  experiment_plan_id: string;
  /** 关联各候选条件及其 Run。 */
  runs: string[];
  created_at: string;
}

/** 配对键（§3.3）：同 CaseRevision + 同重复序号，不含候选状态本身。 */
export interface PairKey {
  case_revision_id: string;
  replicate_index: number;
}

// ─────────────────────────────────────────────────────────────
// 5. 运行对象（§3.1 / §3.4 / §3.5）
// ─────────────────────────────────────────────────────────────

/** 运行前冻结的计划快照（§3.5 三段式之一）。 */
export interface RunPlanSnapshot {
  run_id: string;
  experiment_id?: string;
  candidate_id?: string;
  /** 输入/版本。 */
  input_versions: Record<string, string>;
  /** 解析配置。 */
  resolved_config: Record<string, unknown>;
  /** 预算 / 权限 / 指标 / 重复顺序 / 清理策略。 */
  budget?: string;
  permissions?: string[];
  metrics?: string[];
  repeat_strategy?: string;
  cleanup_strategy?: string;
  /** 预检结果。 */
  preflight_result?: string;
  frozen_at: string;
}

/** 追加式事件（§3.5 三段式之二）。 */
export interface Event {
  event_id: string;
  run_id: string;
  case_execution_id?: string;
  attempt_id?: string;
  /** 来源事件时间（可得时）。 */
  source_time?: string;
  /** 本机观测 UTC 时间。 */
  observed_at: string;
  /** 单调时钟偏移 / 耗时依据。 */
  monotonic_offset_ms?: number;
  kind: string;
  payload?: Record<string, unknown>;
}

/** 证据 Artifact（§3.1 / §8）。 */
export interface Artifact {
  artifact_id: string;
  run_id?: string;
  case_execution_id?: string;
  attempt_id?: string;
  category: string;
  content_hash: string;
  size_bytes: number;
  /** 脱敏状态。 */
  redaction_status: 'none' | 'redacted' | 'filtered';
  redaction_rule_version?: string;
  /** 删除状态（tombstone）。 */
  deleted?: boolean;
  deleted_at?: string;
  created_at: string;
}

/** 终态清单（§3.5 三段式之三）。进程崩溃时可缺失，不能伪造。 */
export interface RunFinalManifest {
  run_id: string;
  /** 引用计划快照与执行事实。 */
  plan_snapshot_ref: string;
  /** 各子项终态汇总。 */
  item_outcomes: Array<{
    case_execution_id: string;
    execution_outcome: ExecutionOutcome;
    evaluation_outcome: EvaluationOutcome;
  }>;
  /** 哈希与报告引用。 */
  hashes?: Record<string, string>;
  report_ref?: string;
  sealed_at?: string;
}

/** Run（§3.1）。批次执行，不复制可独立编辑的权威预算/指标。 */
export interface Run {
  run_id: string;
  experiment_id?: string;
  candidate_id?: string;
  lifecycle_status: RunLifecycleStatus;
  /** 仅保存对 ExperimentPlan 级预算/执行协议的引用。 */
  protocol_ref?: string;
  started_at?: string;
  ended_at?: string;
}

/** CaseExecution（§3.1）。精确 CaseRevision 在某候选/区组/重复编号下的单次计划观测。 */
export interface CaseExecution {
  case_execution_id: string;
  run_id: string;
  case_id: string;
  case_revision_id: string;
  candidate_id?: string;
  replicate_index: number;
  /** 配对键（同 CaseRevision + 同重复序号）。 */
  pair_key: PairKey;
  execution_outcome: ExecutionOutcome;
  evaluation_outcome: EvaluationOutcome;
  attribution?: Attribution;
  attribution_tags?: AttributionTag[];
  /** 关联的 Attempt。 */
  attempts: string[];
}

/** Attempt（§3.1）。技术重试不增加样本。 */
export interface Attempt {
  attempt_id: string;
  case_execution_id: string;
  attempt_status: AttemptStatus;
  started_at?: string;
  ended_at?: string;
}

/** Agent 实际调用（§3.1 AgentInvocation）。 */
export interface AgentInvocation {
  invocation_id: string;
  parent_invocation_id?: string;
  experiment_id?: string;
  run_id?: string;
  case_execution_id?: string;
  agent_id?: string;
  role_id?: string;
  /** planned / resolved / observed 路由。 */
  planned_route?: string;
  resolved_route?: string;
  observed_route?: string;
  status: string;
  started_at?: string;
  ended_at?: string;
  token_usage?: { input?: number; output?: number; total?: number };
  cost?: { amount?: number; currency?: string; source?: string };
  error?: string;
  artifact_refs?: string[];
}

// ─────────────────────────────────────────────────────────────
// 6. 指标（§5.2）
// ─────────────────────────────────────────────────────────────

/** 指标定义（§5.2 MetricSpec）。版本化。 */
export interface MetricSpec {
  metric_id: string;
  display_name: string;
  meaning: string;
  formula?: string;
  unit?: string;
  scope: 'case' | 'attempt' | 'run' | 'experiment';
  numerator?: string;
  denominator?: string;
  data_source?: string;
  source_version?: string;
  /** 越高越好 / 越低越好 / 中性。 */
  direction: 'higher_better' | 'lower_better' | 'neutral';
  missing_value_rule?: string;
  exclusion_rule?: string;
  gate_eligible?: boolean;
  comparison_prerequisite?: string;
  metric_version: string;
}

/** 双分母（§5.2）。 */
export interface PassRateMetrics {
  /** 计划整体成功产出率：pass / 预声明计划范围数。阻塞/未运行/取消/超时/失败/无法判定不得静默移除。 */
  planned_success_yield: number;
  /** 已判定样本通过率：pass / (pass + fail)。不能解释为完整计划成功概率。 */
  evaluated_pass_rate: number;
  /** 各状态计数。 */
  counts: {
    planned: number;
    started: number;
    terminal: number;
    evaluated: number;
    pass: number;
    fail: number;
    indeterminate: number;
    not_evaluated: number;
    blocked: number;
    not_run: number;
    cancelled: number;
    timed_out: number;
    unknown: number;
    protocol_excluded: number;
  };
}

/** 快好省三指标（§4 / 追踪矩阵 REQ-EXPERIMENT-TRIAD-001）。 */
export interface FastGoodFrugalMetrics {
  /** 快：时间。 */
  time: {
    run_end_to_end_wall_time_ms?: number;
    batch_execution_wall_time_ms?: number;
    case_elapsed_wall_time_ms?: number;
    platform_overhead_ms?: number;
  };
  /** 好：质量。 */
  quality: {
    pass_rate: PassRateMetrics;
    rubric_dimensions?: Record<string, { avg?: number; scale?: string }>;
  };
  /** 省：Token/费用。 */
  cost: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    provider_calls?: number;
    fallback_calls?: number;
    role_calls?: number;
    retry_tokens?: number;
    price_version?: string;
    estimated_cost?: number;
    actual_cost?: number;
  };
}

// ─────────────────────────────────────────────────────────────
// 7. 比较（§5.3）
// ─────────────────────────────────────────────────────────────

/** 可比性 Gate 结果（§5.3）。 */
export const COMPARABILITY_GATE = [
  'eligible',
  'eligible_with_limitations',
  'exploratory_only',
  'blocked',
] as const;
export type ComparabilityGate = (typeof COMPARABILITY_GATE)[number];

/** 比较结果（§3.1 Comparison）。 */
export interface Comparison {
  comparison_id: string;
  experiment_id: string;
  /** 可比性 Gate。 */
  gate: ComparabilityGate;
  gate_reasons?: string[];
  /** 配对关系。 */
  pairs: Array<{
    pair_key: PairKey;
    baseline_case_execution_id: string;
    candidate_case_execution_id: string;
    baseline_pass: boolean;
    candidate_pass: boolean;
  }>;
  /** 偏离 / 缺失。 */
  deviations?: string[];
  missing?: string[];
  /** 公式与报告版本。 */
  formula?: string;
  report_version?: string;
}

// ─────────────────────────────────────────────────────────────
// 8. 配置对象（§6）
// ─────────────────────────────────────────────────────────────

/** 配置值来源优先级（§6）：运行时覆盖 → 用户 Profile → 策略建议 → 未解析。 */
export type ConfigSource = 'runtime_override' | 'user_profile' | 'policy_suggestion' | 'unresolved';

/** 配置强制级别（§6）。 */
export type EnforcementLevel = 'hard' | 'soft' | 'unknown';

/** 预算策略（§6 BudgetPolicy）。可版本化。 */
export interface BudgetPolicy {
  budget_policy_id: string;
  version: string;
  fields: Record<string, { limit?: number; enforcement: EnforcementLevel; source: ConfigSource }>;
}

/** Artifact 策略（§6 / §8 ArtifactPolicy）。默认不自动过期。 */
export interface ArtifactPolicy {
  artifact_policy_id: string;
  version: string;
  single_file_limit_bytes?: number;
  run_limit_bytes?: number;
  global_limit_bytes?: number;
  low_disk_threshold_bytes?: number;
  auto_expire: false;
  manual_delete: true;
}

/** 平台兼容状态（§7.3）。 */
export const COMPATIBILITY_STATUS = [
  'target',
  'compatible_unverified',
  'verified_supported',
  'degraded',
  'unsupported',
  'blocked',
] as const;
export type CompatibilityStatus = (typeof COMPATIBILITY_STATUS)[number];

/** 平台兼容规则（§6 PlatformCompatibilityRule）。 */
export interface PlatformCompatibilityRule {
  rule_id: string;
  version: string;
  os_family: string;
  version_range?: string;
  architecture?: string;
  host?: string;
  node?: string;
  opencode?: string;
  plugin?: string;
  capability_conditions?: string[];
  status: CompatibilityStatus;
  evidence?: string[];
  deprecated?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 9. 安全隔离（§7）
// ─────────────────────────────────────────────────────────────

/** 隔离 Profile（§7.1 六边界契约）。 */
export interface IsolationProfile {
  isolation_profile_id: string;
  /** 文件系统边界。 */
  filesystem: { allowed_read?: string[]; allowed_write?: string[]; deny_escape: true };
  /** 命令/进程边界。 */
  command: {
    allowed_commands?: string[];
    resource_limits?: { cpu?: number; memory?: number; time?: number; processes?: number };
  };
  /** 网络边界。 */
  network: {
    default_deny: true;
    allowlist?: Array<{ domain?: string; endpoint?: string; port?: number }>;
  };
  /** 凭据边界。 */
  credentials: { scoped_injection: true; canary_secret?: string };
  /** 控制台/API 边界。 */
  console_api: {
    loopback_only: true;
    origin_check?: boolean;
    csrf?: boolean;
    request_byte_limit?: number;
  };
  /** Artifact 边界。 */
  artifact: {
    finite_capacity: true;
    low_disk_protection: true;
    hash_check: true;
    manual_delete_audit: true;
  };
}

/** 隔离后端注册（§7.2）。只可选取已注册且有真实实现的后端。 */
export interface IsolationBackendRegistration {
  backend_id: string;
  version: string;
  os_family: string;
  version_range?: string;
  architecture?: string;
  prerequisites?: string[];
  capabilities: string[];
  limits?: string[];
  evidence?: string[];
}

// ─────────────────────────────────────────────────────────────
// 10. 功能目录（§4.5）
// ─────────────────────────────────────────────────────────────

/** 节点状态（§4.5.1 active/borrowed/ablated 三态）。 */
export type NodeState = 'active' | 'borrowed' | 'ablated';

/** 功能目录节点（§4.5.1）。 */
export interface FeatureCatalogNode {
  node_id: string;
  node_kind: 'package' | 'slice';
  source_station?: string;
  parent?: string;
  children?: string[];
  /** 源边及类型。 */
  edges?: Array<{ type: 'station-order' | 'borrow' | string; from: string; to: string }>;
  /** 顺序前驱 / 借用前置。 */
  order_predecessors?: string[];
  borrow_predecessors?: string[];
  /** 经证实的硬依赖 / 冲突。 */
  hard_dependencies?: string[];
  conflicts?: string[];
  /** 源 requirements/ 路径映射。 */
  requirements_path?: string;
  /** 状态模式 / 配置 Schema。 */
  state_schema?: string;
  config_schema?: string;
  /** 控制能力分类（§4.5.1）。 */
  control_ability:
    | 'documented_external_setting'
    | 'named_profile_only'
    | 'verified_test_interface'
    | 'fixed_default'
    | 'observational_only'
    | 'unknown';
  /** 观测方法 / 验证状态。 */
  observation_method?: string;
  verification_status?: string;
}

/** 功能目录快照（§3.1 FeatureCatalogRelease）。不可变。 */
export interface FeatureCatalogRelease {
  catalog_release_id: string;
  plugin_commit: string;
  package_hash?: string;
  source_hashes?: { nodes?: string; profiles?: string; fact_map?: string; tool_map?: string };
  schema_version: string;
  importer_version: string;
  nodes: FeatureCatalogNode[];
  /** 统计：节点数 / 外部控制点数 / 可单独干预项数分开。 */
  stats: {
    package_count: number;
    slice_count: number;
    control_point_count: number;
    intervention_count: number;
  };
  mapping_reconciliation?: {
    unmapped?: string[];
    many_to_one?: string[];
    one_to_many?: string[];
    orphan?: string[];
  };
}

/** 功能控制点（§3.1 FeatureControlPoint）。 */
export interface FeatureControlPoint {
  control_point_id: string;
  name: string;
  interface_type: string;
  default_value_source?: string;
  allowed_values?: unknown[];
  applicable_commit: string;
  control_scope?: string;
  verification_method?: string;
  attribution_limit?: string;
}

/** 功能消融 Profile（§3.1 FeatureAblationProfile）。 */
export interface FeatureAblationProfile {
  profile_id: string;
  name: string;
  source: 'named_profile' | 'verified_snapshot';
  node_states: Record<string, NodeState>;
  acceptance_evidence?: string;
}

/** 干预类型（§3.1 FeatureInterventionPlan）。 */
export const INTERVENTION_TYPES = [
  'plugin_on_off',
  'select_named_profile',
  'single_control_point',
  'profile_compare',
  'scenario_observation',
  'source_assisted_variant',
] as const;
export type InterventionType = (typeof INTERVENTION_TYPES)[number];

/** 功能干预计划（§3.1 FeatureInterventionPlan）。 */
export interface FeatureInterventionPlan {
  intervention_plan_id: string;
  intervention_type: InterventionType;
  /** 固定变量。 */
  fixed_variables: Record<string, unknown>;
  /** 控制证据。 */
  control_evidence?: string;
  /** 归因范围。 */
  attribution_scope?: string;
}

/** 模拟路由（§3.1 RouteSimulation）。无副作用，非实际调用。 */
export interface RouteSimulation {
  simulation_id: string;
  input_config_hash: string;
  algorithm_version: string;
  topology_order: string[];
  expected_links?: string[];
  warnings?: string[];
  block_reasons?: string[];
  /** 可执行候选 vs 假设性模拟。 */
  executability: 'executable_candidate' | 'hypothetical_simulation';
}

// ─────────────────────────────────────────────────────────────
// 11. 环境（§4.7）
// ─────────────────────────────────────────────────────────────

/** L1 fold 入口（§4.7；原 papers-v1 FoldEntrySpec 迁移）。 */
export interface FoldEntrySpec {
  module: string;
  export: string;
  signature: 'session_fold_v1' | 'pure_fold_v1';
  event_schema: string;
  resolve_root?: 'sut' | 'project';
  normalize?: 'json_clone' | 'none';
}

/** L2/C 轴 adapter（§4.7；原 papers-v1 RoomAdapter 迁移）。 */
export interface RoomAdapter {
  framework?: string;
  config?: string;
  repeats?: number;
  hook_style?: 'demo-v1' | 'opencode-v1';
  workspace?: 'temp-git';
  skip_hook_dispatch?: boolean;
}

/** 环境 Profile（§4.7）。版本化配方。 */
export interface EnvironmentProfile {
  environment_profile_id: string;
  name: string;
  lifecycle: 'draft' | 'active' | 'deprecated';
  recipe: {
    os?: string;
    architecture?: string;
    runtime?: string;
    host?: string;
    plugin?: string;
    node?: string;
    package_manager?: string;
    lockfile?: string;
    workspace_template?: string;
    data_seed?: string;
    network_policy?: string;
    isolation_profile?: string;
    /** Host 命令（V1 room.host.command 迁移）。 */
    host_command?: string;
    /** Host 默认模型（V1 room.host.model 迁移）。 */
    host_model?: string;
    /** Host 默认 Agent（V1 room.host.agent 迁移）。 */
    host_agent?: string;
    /** 管理的 Agent 列表（V1 room.host.managed_agents 迁移）。 */
    managed_agents?: string[];
    /** Host 插件路径（V1 room.host.plugin 迁移）。 */
    host_plugin?: string;
    /** 耐久日志 glob（V1 room.durable_log_glob 迁移）。 */
    durable_log_glob?: string;
    /** 环境类型（V1 room.kind 迁移）。 */
    kind?: 'fold' | 'fake-host' | 'cassette' | 'live-model' | 'hosted' | 'direct-tool';
    /** 模型驱动（V1 room.model_driver 迁移）。 */
    model_driver?: 'none' | 'scripted' | 'as-recorded' | 'live';
    /** L1 fold 入口表（V1 room.fold_entries 迁移）。 */
    fold_entries?: Record<string, FoldEntrySpec>;
    /** L2/C 轴 adapter（V1 room.adapter 迁移）。 */
    adapter?: RoomAdapter;
    /** SUT 根（V1 room.sut 迁移）。 */
    sut?: { name?: string; root_env?: string; root_rel?: string | null };
    /** 契约（V1 room.contract 迁移）。 */
    contract?: string;
    /** 事件 schema（V1 room.event_schema 迁移）。 */
    event_schema?: string;
  };
}

/** 环境实例生命周期（§4.7）。 */
export const ENV_INSTANCE_STATUS = [
  'not_created',
  'resolving',
  'provisioning',
  'validating',
  'ready',
  'running',
  'stopping',
  'cleaned',
  'destroyed',
  'failed',
  'dirty',
  'cleanup_failed',
] as const;
export type EnvInstanceStatus = (typeof ENV_INSTANCE_STATUS)[number];

/** 环境实例 + Manifest（§4.7）。 */
export interface EnvironmentInstance {
  environment_instance_id: string;
  environment_profile_id: string;
  status: EnvInstanceStatus;
  manifest?: EnvironmentManifest;
}

export interface EnvironmentManifest {
  manifest_id: string;
  planned_versions: Record<string, string>;
  actual_versions: Record<string, string>;
  git_commit?: string;
  dirty?: boolean;
  hashes?: Record<string, string>;
  created_at?: string;
  destroy_evidence?: string;
  cleanup_result?: string;
}

// ─────────────────────────────────────────────────────────────
// 12. 故障注入（§4.8）
// ─────────────────────────────────────────────────────────────

/** 故障场景（§4.8）。 */
export interface FaultScenario {
  scenario_id: string;
  fault_type: string;
  stage: string;
  trigger_point?: string;
  probability?: number;
  duration_ms?: number;
  seed?: number;
  recovery_strategy?: string;
  max_occurrences?: number;
  expected_run_status?: RunLifecycleStatus;
  expected_execution_outcome?: ExecutionOutcome;
  expected_attempt_status?: AttemptStatus;
  budget_impact?: string;
  side_effect_reconciliation?: string;
  evidence_requirements?: string[];
  cleanup_result?: string;
}

/** 故障注入 Profile（§4.8）。默认只在隔离环境或 Stub/代理下执行。 */
export interface FaultInjectionProfile {
  fault_injection_profile_id: string;
  version: string;
  scenarios: FaultScenario[];
  scope: 'isolated' | 'stub' | 'proxy';
}

// ─────────────────────────────────────────────────────────────
// 13. Provider / 模型（§4.3 / §4.4）
// ─────────────────────────────────────────────────────────────

/** 服务提供方（§4.3 Provider）。 */
export interface Provider {
  provider_id: string;
  name: string;
  adapter?: string;
  status: 'active' | 'inactive' | 'deprecated';
}

/** 实际部署/区域/端点（§4.3 Deployment）。 */
export interface Deployment {
  deployment_id: string;
  provider_id: string;
  region?: string;
  endpoint?: string;
}

/** 可稳定识别的模型/部署标识（§4.3 ModelRef）。 */
export interface ModelRef {
  model_id: string;
  provider_id: string;
  deployment_id?: string;
}

/** 有来源的能力事实（§4.3 ModelCapability）。 */
export interface ModelCapability {
  capability: string;
  source: string;
  /** 供应商声明 vs 真实探针结果必须区分。 */
  source_kind: 'vendor_claim' | 'probe_verified' | 'estimated';
}

/** 具体角色的必需/可选能力（§4.3 AgentRoleRequirement）。 */
export interface AgentRoleRequirement {
  role_id: string;
  required_capabilities: string[];
  optional_capabilities?: string[];
}

/** 模型目录条目（§6）。 */
export interface ModelCatalogEntry {
  model_id: string;
  provider_id: string;
  deployment_id?: string;
  capabilities?: ModelCapability[];
  usage_source?: string;
  price_source?: string;
  price_version?: string;
  status: 'active' | 'inactive' | 'deprecated';
}

/** 能力匹配结果（§4.3）。 */
export type CapabilityMatch = 'compatible' | 'partially_compatible' | 'incompatible' | 'unverified';

/** 模型路由 Profile（§4.3）。 */
export interface ModelRoutingProfile {
  route_profile_id: string;
  version: string;
  routes: Array<{
    agent_id?: string;
    role_id?: string;
    provider_id: string;
    model_id: string;
    deployment_id?: string;
    parameter_profile?: string;
    fallback_policy?: string;
    route_policy_version: string;
  }>;
}

/** @deprecated 使用 Provider。 */
export type ProviderDefinition = Provider;
/** @deprecated 使用 Deployment。 */
export type DeploymentDefinition = Deployment;

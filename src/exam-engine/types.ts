/**
 * V2.17 领域对象模型——唯一权威类型。
 * 本文件重新导出 src/domain/types.ts 的全部领域对象。
 *
 * 迁移映射：
 *   ItemDoc     → Case + CaseRevision（逻辑身份 + 不可变修订）
 *   PapersetDoc → DatasetRelease（冻结的 CaseRevision 引用闭包）
 *   RoomDoc     → EnvironmentProfile / CandidateConfig
 *   ExamManifest → 配置快照（RunPlanSnapshot）
 *   FreezeA/B   → CandidateConfig（候选配置）
 *   Axis        → 不再使用（A/B/C 轴已废除）
 *   effect_pair → PairKey（case_revision_id + replicate_index）
 *
 * 旧类型（ItemDoc/PapersetDoc/RoomDoc 等）以独立接口保留为 @deprecated，
 * 包含旧字段名以便现有代码逐步迁移，而非一次性全部重写。
 */

import type {
  RunLifecycleStatus,
  ExecutionOutcome,
  EvaluationOutcome,
  AttemptStatus,
  Attribution,
  AttributionTag,
  OracleType,
  OracleVerdict,
  OracleResult,
  Score,
  CaseLifecycle,
  AutomationReadiness,
  Case,
  CaseRevision,
  TaskStrata,
  DatasetRelease,
  SuitePlan,
  RouteStep,
  Oracle,
  RubricSpec,
  CandidateConfig,
  ExperimentPlan,
  Experiment,
  PairKey,
  RunPlanSnapshot,
  Event,
  Artifact,
  RunFinalManifest,
  Run,
  CaseExecution,
  Attempt,
  AgentInvocation,
  MetricSpec,
  PassRateMetrics,
  FastGoodFrugalMetrics,
  ComparabilityGate,
  Comparison,
  ConfigSource,
  EnforcementLevel,
  BudgetPolicy,
  ArtifactPolicy,
  CompatibilityStatus,
  PlatformCompatibilityRule,
  IsolationProfile,
  IsolationBackendRegistration,
  NodeState,
  FeatureCatalogNode,
  FeatureCatalogRelease,
  FeatureControlPoint,
  FeatureAblationProfile,
  FeatureInterventionPlan,
  InterventionType,
  RouteSimulation,
  EnvironmentProfile,
  EnvInstanceStatus,
  EnvironmentInstance,
  EnvironmentManifest,
  FaultScenario,
  FaultInjectionProfile,
  Provider,
  Deployment,
  ModelRef,
  ModelCapability,
  AgentRoleRequirement,
  ProviderDefinition,
  DeploymentDefinition,
  ModelCatalogEntry,
  CapabilityMatch,
  ModelRoutingProfile,
  OracleExitCode,
  OracleWorkspaceAssert,
  OracleToolSideEffect,
  OracleToolResultEquals,
  OracleStdoutAssert,
  OracleMetricThreshold,
  OracleEventFold,
  OracleEventSubsequence,
  OracleStatePredicate,
  OracleNoEvent,
  OracleToolTrace,
  OracleSchemaObedience,
} from '../domain/types.js';

import {
  RUN_LIFECYCLE_STATUS,
  EXECUTION_OUTCOME,
  EVALUATION_OUTCOME,
  ATTEMPT_STATUS,
  RUN_TRANSITIONS,
  ATTRIBUTIONS,
  ATTRIBUTION_TAGS,
  ORACLE_TYPES,
  CASE_LIFECYCLE,
  AUTOMATION_READINESS,
  COMPARABILITY_GATE,
  COMPATIBILITY_STATUS,
  ENV_INSTANCE_STATUS,
  INTERVENTION_TYPES,
} from '../domain/types.js';

// ── 重新导出全部 V2.17 领域对象 ──
export {
  RUN_LIFECYCLE_STATUS,
  EXECUTION_OUTCOME,
  EVALUATION_OUTCOME,
  ATTEMPT_STATUS,
  RUN_TRANSITIONS,
  ATTRIBUTIONS,
  ATTRIBUTION_TAGS,
  ORACLE_TYPES,
  CASE_LIFECYCLE,
  AUTOMATION_READINESS,
  COMPARABILITY_GATE,
  COMPATIBILITY_STATUS,
  ENV_INSTANCE_STATUS,
  INTERVENTION_TYPES,
};

export type {
  RunLifecycleStatus,
  ExecutionOutcome,
  EvaluationOutcome,
  AttemptStatus,
  Attribution,
  AttributionTag,
  OracleType,
  OracleVerdict,
  OracleResult,
  Score,
  CaseLifecycle,
  AutomationReadiness,
  Case,
  CaseRevision,
  TaskStrata,
  DatasetRelease,
  SuitePlan,
  RouteStep,
  Oracle,
  RubricSpec,
  CandidateConfig,
  ExperimentPlan,
  Experiment,
  PairKey,
  RunPlanSnapshot,
  Event,
  Artifact,
  RunFinalManifest,
  Run,
  CaseExecution,
  Attempt,
  AgentInvocation,
  MetricSpec,
  PassRateMetrics,
  FastGoodFrugalMetrics,
  ComparabilityGate,
  Comparison,
  ConfigSource,
  EnforcementLevel,
  BudgetPolicy,
  ArtifactPolicy,
  CompatibilityStatus,
  PlatformCompatibilityRule,
  IsolationProfile,
  IsolationBackendRegistration,
  NodeState,
  FeatureCatalogNode,
  FeatureCatalogRelease,
  FeatureControlPoint,
  FeatureAblationProfile,
  FeatureInterventionPlan,
  InterventionType,
  RouteSimulation,
  EnvironmentProfile,
  EnvInstanceStatus,
  EnvironmentInstance,
  EnvironmentManifest,
  FaultScenario,
  FaultInjectionProfile,
  Provider,
  Deployment,
  ModelRef,
  ModelCapability,
  AgentRoleRequirement,
  ProviderDefinition,
  DeploymentDefinition,
  ModelCatalogEntry,
  CapabilityMatch,
  ModelRoutingProfile,
  OracleExitCode,
  OracleWorkspaceAssert,
  OracleToolSideEffect,
  OracleToolResultEquals,
  OracleStdoutAssert,
  OracleMetricThreshold,
  OracleEventFold,
  OracleEventSubsequence,
  OracleStatePredicate,
  OracleNoEvent,
  OracleToolTrace,
  OracleSchemaObedience,
};

// ═══════════════════════════════════════════════════════════════
// 以下为 V1 兼容类型，保留旧字段名以便现有代码逐步迁移。
// 标记 @deprecated，指向 V2.17 对应对象。
// ═══════════════════════════════════════════════════════════════

// ── 旧状态 / 轴 ──

/** @deprecated 不再使用（A/B/C 轴已废除）。 */
export const AXES = ['A', 'B', 'C'] as const;
/** @deprecated 不再使用。 */
export type Axis = (typeof AXES)[number];

/** @deprecated 使用 RunLifecycleStatus。 */
export type ItemStatus = 'active' | 'draft' | 'deprecated';

/** @deprecated 不再使用（L1/L2/L3 轴已废除）。 */
export type ALayer = 'L1' | 'L2' | 'L3';

// ── ItemDoc（兼容旧字段名，映射到 CaseRevision） ──

/** @deprecated 使用 CaseRevision。保留旧字段名以便现有代码编译。 */
export interface ItemDoc {
  /** @deprecated 使用 CaseRevision.case_id */
  id: string;
  /** @deprecated 使用 CaseRevision.revision_number */
  rev: number;
  /** @deprecated 不再使用 */
  axis: Axis;
  /** @deprecated 使用 CaseLifecycle */
  status: ItemStatus;
  title: string;
  owner?: string;
  tags?: string[];
  intent: {
    statement: string;
    /** @deprecated 使用 CaseRevision.attribution_focus */
    attribution_focus: Attribution;
    /** @deprecated 使用 CaseRevision.protocol_probes */
    protocol_probes?: string[];
    /** @deprecated 使用 PairKey（case_revision_id + replicate_index） */
    effect_pair?: string;
  };
  /** @deprecated 使用 CandidateConfig */
  freeze: FreezeA | FreezeBC;
  stimulus: {
    kind: string;
    ref: string;
    notes?: string;
    /** hosted 通行 token */
    hosted_pass_token?: string;
  };
  expect: {
    oracles: Oracle[];
    /** @deprecated 使用 RubricSpec */
    rubric?: RubricSpec;
  };
  /** @deprecated 使用 MetricSpec 引用 */
  metrics: { primary: string[]; secondary?: string[] };
  execution: {
    deadline_ms: number;
    requires_network: boolean;
    requires_durable_log?: boolean;
    repeats?: number;
  };
  /** @deprecated 使用 TaskStrata */
  strata?: TaskStrata;
  change_log?: Record<string, string>;
  deprecation?: { reason: string; superseded_by?: string };
}

// ── FreezeA / FreezeBC（兼容旧字段名） ──

/** @deprecated 使用 CandidateConfig。保留旧字段名。 */
export interface FreezeA {
  /** @deprecated 不再使用 */
  layer: ALayer;
  model_driver: 'none' | 'scripted' | 'as-recorded';
  fold_entry?: string;
  event_schema?: string;
  session_id?: string;
  contract?: string;
  script?: string;
  cassette?: string;
}

/** @deprecated 使用 CandidateConfig。保留旧字段名。 */
export interface FreezeBC {
  model_driver: string;
  model_id: string;
  /** 绑定的考场名（历史字段名 host_profile） */
  host_profile: string;
  tool_profile: string;
  prompt_template: string;
  channel?: 'direct' | 'hosted';
}

// ── PapersetDoc（兼容旧字段名，映射到 DatasetRelease） ──

/** @deprecated 使用 DatasetRelease。保留旧字段名。 */
export interface PapersetDoc {
  name: string;
  description?: string;
  /** @deprecated 不再使用 */
  axis: Axis;
  /** @deprecated 不再使用 */
  room: string;
  /** @deprecated 不再使用 */
  matrix_env?: string;
  /** @deprecated 使用 DatasetRelease.case_revisions */
  items: string[];
  /** @deprecated 不再使用 */
  gates?: Record<string, GateBound>;
}

// ── RoomDoc（兼容旧字段名，映射到 EnvironmentProfile） ──

/** @deprecated 使用 EnvironmentProfile。保留旧字段名。 */
export interface RoomDoc {
  name: string;
  /** @deprecated 不再使用 */
  kind: 'fold' | 'fake-host' | 'cassette' | 'live-model' | 'hosted' | 'direct-tool';
  description?: string;
  model_driver: 'none' | 'scripted' | 'as-recorded' | 'live';
  network: boolean;
  durable_log?: string;
  durable_log_glob?: string;
  workspace?: 'isolated' | 'project';
  secrets?: string[];
  fold_entries?: Record<string, FoldEntrySpec>;
  sut?: { name?: string; root_env?: string; root_rel?: string | null };
  event_schema?: string;
  contract?: string;
  attribution_tree?: string;
  host?: RoomHost;
  adapter?: RoomAdapter;
}

// ── 其他旧类型 ──

/** @deprecated 不再使用。 */
export interface FoldEntrySpec {
  module: string;
  export: string;
  signature: 'session_fold_v1' | 'pure_fold_v1';
  event_schema: string;
  resolve_root?: 'sut' | 'project';
  normalize?: 'json_clone' | 'none';
}

/** @deprecated 使用 MetricSpec。 */
export interface GateBound {
  min?: number;
  max?: number;
}

/** @deprecated 不再使用。 */
export interface RoomHost {
  name?: string;
  version?: string;
  command?: string;
  args?: string[];
  log_path?: string;
  model?: string;
  agent?: string;
  managed_agents?: string[];
  plugin?: string;
}

/** @deprecated 不再使用。 */
export interface RoomAdapter {
  framework?: string;
  config?: string;
  repeats?: number;
  hook_style?: 'demo-v1' | 'opencode-v1';
  workspace?: 'temp-git';
  skip_hook_dispatch?: boolean;
}

/** @deprecated 使用 RunPlanSnapshot。保留旧字段名。 */
export interface ExamManifest {
  name: string;
  description?: string;
  asset_protocol: string;
  engine?: { min_version?: string };
  system_under_test?: {
    name?: string;
    repo?: string;
    version?: string;
    root_env?: string;
  };
  paths?: Partial<Record<AssetKind, string>>;
  defaults?: { paperset?: string; room?: string };
}

/** @deprecated 使用 Artifact。 */
export type AssetKind =
  | 'items' | 'papersets' | 'rooms' | 'materials'
  | 'scripts' | 'cassettes' | 'contracts' | 'shells' | 'runs';

/** @deprecated 使用 Artifact。 */
export interface LoadedAsset<T> {
  path: string;
  relPath: string;
  raw: string;
  doc: T;
}

/** @deprecated 使用 Event。 */
export type IssueLevel = 'error' | 'warning';

/** @deprecated 使用 Event。 */
export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  file?: string;
  instancePath?: string;
}

/** @deprecated 使用 Case。 */
export type CaseDoc = ItemDoc;
/** @deprecated 使用 DatasetRelease。 */
export type SuiteDoc = PapersetDoc;
/** @deprecated 使用 EnvironmentProfile。 */
export type ProfileDoc = RoomDoc;
/** @deprecated 使用 RunPlanSnapshot。 */
export type ProjectManifest = ExamManifest;
/** @deprecated 使用 CaseLifecycle。 */
export type CaseStatus = ItemStatus;
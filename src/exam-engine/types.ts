/**
 * V2.17 领域对象模型——唯一权威类型。
 * 本文件重新导出 src/domain/types.ts 的全部领域对象。
 *
 * papers-v1（ItemDoc/PapersetDoc/RoomDoc 等旧类型）已彻底删除；
 * 迁移期间需要的旧字段名（如 legacy_item_id）作为领域对象上的显式字段保留。
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

/** 指标分组轴（A/B/C，指标目录沿用；执行路由已改用 execution_profile.mode）。 */
export const AXES = ['A', 'B', 'C'] as const;
export type Axis = (typeof AXES)[number];

// ── 工程基础设施类型（非 papers-v1 残留，仍在使用） ──

/** 门禁阈值（min/max）。 */
export interface GateBound {
  min?: number;
  max?: number;
}

/** 项目 manifest（asset_protocol + 路径约定）。 */
export interface ExamManifest {
  name?: string;
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
}

/** 资产种类（项目路径约定）。 */
export type AssetKind =
  | 'items'
  | 'papersets'
  | 'rooms'
  | 'materials'
  | 'scripts'
  | 'cassettes'
  | 'contracts'
  | 'shells'
  | 'runs'
  | 'cases'
  | 'case_revisions'
  | 'dataset_releases'
  | 'environments'
  | 'candidates';

/** 已加载资产（path/relPath/raw/doc 四元组）。 */
export interface LoadedAsset<T> {
  path: string;
  relPath: string;
  raw: string;
  doc: T;
}

export type IssueLevel = 'error' | 'warning';

/** 校验问题。 */
export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  file?: string;
  instancePath?: string;
}

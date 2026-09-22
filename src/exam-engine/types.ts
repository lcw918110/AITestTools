/** 资产协议 TypeScript 视图。结构真相以 `schemas/*.json` 为准。PRD 所称 case/suite/profile = item/paperset/room。 */

export const AXES = ['A', 'B', 'C', 'AB', 'AC', 'BC'] as const;
export type Axis = (typeof AXES)[number];

export const ATTRIBUTIONS = [
  'PROTOCOL',
  'CONTEXT',
  'MODEL_SCHEMA',
  'MODEL_TASK',
  'TOOL',
  'HARNESS',
] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];

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

export type ItemStatus = 'active' | 'draft' | 'deprecated';
export type ALayer = 'L1' | 'L2' | 'L3';

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

export interface FoldEntrySpec {
  module: string;
  export: string;
  signature: 'session_fold_v1' | 'pure_fold_v1';
  event_schema: string;
  resolve_root?: 'sut' | 'project';
  normalize?: 'json_clone' | 'none';
}

export interface FreezeA {
  layer: ALayer;
  model_driver: 'none' | 'scripted' | 'as-recorded';
  fold_entry?: string;
  event_schema?: string;
  session_id?: string;
  contract?: string;
  script?: string;
  cassette?: string;
}

export interface FreezeBC {
  model_driver: string;
  model_id: string;
  /** 绑定的考场名（历史字段名 host_profile） */
  host_profile: string;
  tool_profile: string;
  prompt_template: string;
  channel?: 'direct' | 'hosted';
}

export interface ItemDoc {
  id: string;
  rev: number;
  axis: Axis;
  status: ItemStatus;
  title: string;
  owner?: string;
  tags?: string[];
  intent: {
    statement: string;
    attribution_focus: Attribution;
    /** hosted：期望出现在 durable NDJSON 中的 Kind（设计 12 protocol probes） */
    protocol_probes?: string[];
    /** 配对效果键：off/on 两侧相同，供 compare 分差对齐 */
    effect_pair?: string;
  };
  freeze: FreezeA | FreezeBC;
  stimulus: { kind: string; ref: string; notes?: string; hosted_pass_token?: string };
  expect: { oracles: Oracle[] };
  metrics: { primary: string[]; secondary?: string[] };
  execution: {
    deadline_ms: number;
    requires_network: boolean;
    requires_durable_log?: boolean;
    repeats?: number;
  };
  change_log?: Record<string, string>;
  deprecation?: { reason: string; superseded_by?: string };
}

export interface GateBound {
  min?: number;
  max?: number;
}

export interface PapersetDoc {
  name: string;
  description?: string;
  axis: Axis;
  room: string;
  matrix_env?: string;
  items: string[];
  gates?: Record<string, GateBound>;
}

/** hosted 考场宿主进程配置（room.schema.json `host`）。 */
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

/** 驱动适配器配置（room.schema.json `adapter`）。 */
export interface RoomAdapter {
  framework?: string;
  config?: string;
  repeats?: number;
  hook_style?: 'demo-v1' | 'opencode-v1';
  workspace?: 'temp-git';
  skip_hook_dispatch?: boolean;
}

export interface RoomDoc {
  name: string;
  kind: 'fold' | 'fake-host' | 'cassette' | 'live-model' | 'hosted' | 'direct-tool';
  description?: string;
  model_driver: 'none' | 'scripted' | 'as-recorded' | 'live';
  network: boolean;
  durable_log?: string;
  durable_log_glob?: string;
  /** isolated：每题跑在临时空 git 仓；无插件的对照侧必须显式声明才能与 ON 侧同构 */
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

export type AssetKind =
  | 'items'
  | 'papersets'
  | 'rooms'
  | 'materials'
  | 'scripts'
  | 'cassettes'
  | 'contracts'
  | 'shells'
  | 'runs';

export interface LoadedAsset<T> {
  path: string;
  relPath: string;
  raw: string;
  doc: T;
}

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  file?: string;
  instancePath?: string;
}

/** @deprecated 使用 ItemDoc；保留别名降低迁移噪音 */
export type CaseDoc = ItemDoc;
export type SuiteDoc = PapersetDoc;
export type ProfileDoc = RoomDoc;
export type ProjectManifest = ExamManifest;
export type CaseStatus = ItemStatus;

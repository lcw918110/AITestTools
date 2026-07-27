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
] as const;
export type OracleType = (typeof ORACLE_TYPES)[number];

export type ItemStatus = 'active' | 'draft' | 'deprecated';
export type ALayer = 'L1' | 'L2' | 'L3';

export interface Oracle {
  type: OracleType;
  id?: string;
  [key: string]: unknown;
}

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
  };
  freeze: FreezeA | FreezeBC;
  stimulus: { kind: string; ref: string; notes?: string };
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

export interface RoomDoc {
  name: string;
  kind: 'fold' | 'fake-host' | 'cassette' | 'live-model' | 'hosted' | 'direct-tool';
  description?: string;
  model_driver: 'none' | 'scripted' | 'as-recorded' | 'live';
  network: boolean;
  durable_log?: string;
  durable_log_glob?: string;
  workspace?: string;
  secrets?: string[];
  fold_entries?: Record<string, FoldEntrySpec>;
  sut?: { name?: string; root_env?: string; root_rel?: string | null };
  event_schema?: string;
  contract?: string;
  attribution_tree?: string;
  host?: Record<string, unknown>;
  adapter?: Record<string, unknown>;
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

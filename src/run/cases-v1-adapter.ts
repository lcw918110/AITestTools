/**
 * cases-v1 → runner 旧形状适配层（绞杀者模式）。
 *
 * 深迁移阶段 4a：runner 内部仍消费 ItemDoc / RoomDoc 旧形状（已标 @deprecated），
 * 但数据源切换到 cases-v1 资产（CaseRevision / EnvironmentProfile）。
 * 本层负责把新资产还原成 runner 认识的旧形状，后续阶段再逐步把 runner 内部
 * 改造成直接消费新类型，最终删除本适配层。
 *
 * 轴路由（阶段 6 扩展，见 docs/09-轴路由cases-v1表达设计.md）：
 * - 轴（A/B/C）已废除，改用 CaseRevision.strata.task_type + execution_profile.mode 表达执行驱动。
 * - 本层按 execution_profile.mode 还原 axis / FreezeA / FreezeBC，按 recipe.kind 还原 RoomDoc.kind。
 *
 * 已知简化（当前数据约束）：
 * - V1 `intent.statement` 不在 runner 链路中被消费，暂用 title 顶替（见 06 方案 §4.1 待决策）。
 */
import type { Case, CaseRevision, EnvironmentProfile } from '../domain/types.ts';
import type { FreezeA, FreezeBC, ItemDoc, RoomDoc } from '../exam-engine/types.ts';

/** execution_profile.mode → 轴（fold/scripted/cassette → A；hosted → B；direct_tool → C）。 */
function axisOfMode(mode: string | undefined): 'A' | 'B' | 'C' {
  if (mode === 'fold' || mode === 'scripted' || mode === 'cassette') return 'A';
  if (mode === 'direct_tool') return 'C';
  return 'B';
}

/** case_id → V1 item_id（反向映射，保持 run 产物 id 与历史 run 一致）。 */
function caseIdToV1ItemId(
  caseId: string,
  axis: 'A' | 'B' | 'C',
  variant: 'off' | 'on' | undefined,
): string {
  const base = caseId.toUpperCase();
  if (variant !== undefined) {
    return `EVAL-${axis}-${base}-${variant.toUpperCase()}`;
  }
  return `EVAL-${axis}-${base}`;
}

/** CaseRevision + Case → ItemDoc（runner 旧形状）。 */
export function caseRevisionToItemDoc(caseRevision: CaseRevision, caseDoc: Case): ItemDoc {
  const mode = caseRevision.execution_profile?.mode;
  const axis = axisOfMode(mode);
  const variant =
    mode === 'fold' || mode === 'scripted' || mode === 'cassette' || mode === 'direct_tool'
      ? undefined
      : caseRevision.case_revision_id.includes('.on')
        ? 'on'
        : 'off';
  const pairKey = caseDoc.pair_key ?? caseDoc.case_id.toUpperCase();

  // 按 mode 还原 freeze：A 轴（fold/scripted/cassette）→ FreezeA，B/C 轴 → FreezeBC
  let freeze: FreezeA | FreezeBC;
  const profile: NonNullable<CaseRevision['execution_profile']> =
    caseRevision.execution_profile ?? { mode: 'hosted' };
  if (axis === 'A') {
    freeze = {
      layer: profile.layer ?? 'L1',
      model_driver: mode === 'scripted' ? 'scripted' : mode === 'cassette' ? 'as-recorded' : 'none',
      ...(profile.fold_entry !== undefined ? { fold_entry: profile.fold_entry } : {}),
      ...(profile.event_schema !== undefined ? { event_schema: profile.event_schema } : {}),
      ...(profile.session_id !== undefined ? { session_id: profile.session_id } : {}),
      ...(profile.contract !== undefined ? { contract: profile.contract } : {}),
      ...(profile.script !== undefined ? { script: profile.script } : {}),
      ...(profile.cassette !== undefined ? { cassette: profile.cassette } : {}),
    };
  } else {
    freeze = {
      model_driver: 'live',
      model_id: caseRevision.model_id ?? '',
      host_profile: caseDoc.case_id,
      tool_profile: 'none',
      prompt_template: caseRevision.stimulus.ref,
      channel: 'hosted',
    };
  }

  return {
    id: caseRevision.legacy_item_id ?? caseIdToV1ItemId(caseDoc.case_id, axis, variant),
    rev: caseRevision.revision_number,
    axis,
    status: 'active',
    title: caseDoc.title,
    ...(caseDoc.owner !== undefined ? { owner: caseDoc.owner } : {}),
    ...(caseDoc.tags !== undefined ? { tags: caseDoc.tags } : {}),
    intent: {
      statement: caseDoc.title,
      attribution_focus: caseRevision.attribution_focus,
      ...(caseRevision.protocol_probes !== undefined
        ? { protocol_probes: caseRevision.protocol_probes }
        : {}),
      ...(pairKey !== undefined ? { effect_pair: pairKey } : {}),
    },
    freeze,
    stimulus: {
      kind: caseRevision.stimulus.kind,
      ref: caseRevision.stimulus.ref,
      ...(caseRevision.stimulus.notes !== undefined ? { notes: caseRevision.stimulus.notes } : {}),
      ...(caseRevision.stimulus.hosted_pass_token !== undefined
        ? { hosted_pass_token: caseRevision.stimulus.hosted_pass_token }
        : {}),
    },
    expect: {
      oracles: caseRevision.expect.oracles,
      ...(caseRevision.expect.rubric !== undefined ? { rubric: caseRevision.expect.rubric } : {}),
    },
    metrics: { primary: [] },
    execution: {
      deadline_ms: caseRevision.execution.deadline_ms,
      requires_network: caseRevision.execution.requires_network,
      ...(caseRevision.execution.requires_durable_log !== undefined
        ? { requires_durable_log: caseRevision.execution.requires_durable_log }
        : {}),
      ...(caseRevision.execution.repeats !== undefined
        ? { repeats: caseRevision.execution.repeats }
        : {}),
    },
    ...(caseRevision.strata !== undefined ? { strata: caseRevision.strata } : {}),
    ...(caseRevision.change_log !== undefined ? { change_log: caseRevision.change_log } : {}),
  };
}

/** EnvironmentProfile → RoomDoc（runner 旧形状）。 */
export function environmentToRoom(environment: EnvironmentProfile): RoomDoc {
  const recipe = environment.recipe;
  const kind = recipe.kind ?? 'hosted';
  const modelDriver = recipe.model_driver ?? (kind === 'hosted' ? 'live' : 'none');
  return {
    name: environment.environment_profile_id,
    kind,
    description: environment.name,
    model_driver: modelDriver,
    network: recipe.network_policy === 'allow',
    ...(recipe.durable_log_glob !== undefined ? { durable_log_glob: recipe.durable_log_glob } : {}),
    workspace: recipe.isolation_profile === 'isolated' ? 'isolated' : 'project',
    ...(recipe.fold_entries !== undefined ? { fold_entries: recipe.fold_entries } : {}),
    ...(recipe.adapter !== undefined ? { adapter: recipe.adapter } : {}),
    ...(recipe.sut !== undefined ? { sut: recipe.sut } : {}),
    ...(recipe.contract !== undefined ? { contract: recipe.contract } : {}),
    ...(recipe.event_schema !== undefined ? { event_schema: recipe.event_schema } : {}),
    host: {
      ...(recipe.runtime !== undefined ? { name: recipe.runtime } : {}),
      ...(recipe.host_command !== undefined ? { command: recipe.host_command } : {}),
      ...(recipe.host_model !== undefined ? { model: recipe.host_model } : {}),
      ...(recipe.host_agent !== undefined ? { agent: recipe.host_agent } : {}),
      ...(recipe.managed_agents !== undefined ? { managed_agents: recipe.managed_agents } : {}),
      ...(recipe.host_plugin !== undefined ? { plugin: recipe.host_plugin } : {}),
    },
  };
}

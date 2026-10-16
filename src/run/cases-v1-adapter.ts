/**
 * cases-v1 → runner 旧形状适配层（绞杀者模式）。
 *
 * 深迁移阶段 4a：runner 内部仍消费 ItemDoc / RoomDoc 旧形状（已标 @deprecated），
 * 但数据源切换到 cases-v1 资产（CaseRevision / EnvironmentProfile）。
 * 本层负责把新资产还原成 runner 认识的旧形状，后续阶段再逐步把 runner 内部
 * 改造成直接消费新类型，最终删除本适配层。
 *
 * 已知简化（当前数据约束）：
 * - 318 个 item 全部为 B 轴 live，故 axis 硬编码 'B'；A/C 轴数据出现后再扩展。
 * - 4 个 room 全部为 hosted，故 kind 硬编码 'hosted'。
 * - V1 `intent.statement` 不在 runner 链路中被消费，暂用 title 顶替（见 06 方案 §4.1 待决策）。
 */
import type { Case, CaseRevision, EnvironmentProfile } from '../domain/types.ts';
import type { FreezeBC, ItemDoc, RoomDoc } from '../exam-engine/types.ts';

/** CaseRevision + Case → ItemDoc（runner 旧形状）。 */
export function caseRevisionToItemDoc(caseRevision: CaseRevision, caseDoc: Case): ItemDoc {
  const variant = caseRevision.case_revision_id.includes('.on') ? 'on' : 'off';
  const pairKey = caseDoc.pair_key ?? caseDoc.case_id.toUpperCase();

  const freeze: FreezeBC = {
    model_driver: 'live',
    model_id: caseRevision.model_id ?? '',
    host_profile: caseDoc.case_id,
    tool_profile: 'none',
    prompt_template: caseRevision.stimulus.ref,
    channel: 'hosted',
  };

  return {
    id: `${caseDoc.case_id}-${variant}`,
    rev: caseRevision.revision_number,
    axis: 'B',
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
      effect_pair: pairKey,
    },
    freeze,
    stimulus: {
      kind: caseRevision.stimulus.kind,
      ref: caseRevision.stimulus.ref,
      ...(caseRevision.stimulus.notes !== undefined
        ? { notes: caseRevision.stimulus.notes }
        : {}),
      ...(caseRevision.stimulus.hosted_pass_token !== undefined
        ? { hosted_pass_token: caseRevision.stimulus.hosted_pass_token }
        : {}),
    },
    expect: {
      oracles: caseRevision.expect.oracles,
      ...(caseRevision.expect.rubric !== undefined
        ? { rubric: caseRevision.expect.rubric }
        : {}),
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
    ...(caseRevision.change_log !== undefined
      ? { change_log: caseRevision.change_log }
      : {}),
  };
}

/** EnvironmentProfile → RoomDoc（runner 旧形状）。 */
export function environmentToRoom(environment: EnvironmentProfile): RoomDoc {
  const recipe = environment.recipe;
  return {
    name: environment.environment_profile_id,
    kind: 'hosted',
    description: environment.name,
    model_driver: 'live',
    network: recipe.network_policy === 'allow',
    ...(recipe.durable_log_glob !== undefined
      ? { durable_log_glob: recipe.durable_log_glob }
      : {}),
    workspace: recipe.isolation_profile === 'isolated' ? 'isolated' : 'project',
    host: {
      ...(recipe.runtime !== undefined ? { name: recipe.runtime } : {}),
      ...(recipe.host_command !== undefined ? { command: recipe.host_command } : {}),
      ...(recipe.host_model !== undefined ? { model: recipe.host_model } : {}),
      ...(recipe.host_agent !== undefined ? { agent: recipe.host_agent } : {}),
      ...(recipe.managed_agents !== undefined
        ? { managed_agents: recipe.managed_agents }
        : {}),
      ...(recipe.host_plugin !== undefined ? { plugin: recipe.host_plugin } : {}),
    },
  };
}

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseRevisions, loadCasesV2, loadEnvironments } from '../../src/exam-engine/loader.ts';
import { caseRevisionToItemDoc, environmentToRoom } from '../../src/run/cases-v1-adapter.ts';

const projectRoot = join(process.cwd(), 'examples', 'product-eval');

describe('cases-v1 适配层（阶段 4a）', () => {
  it('CaseRevision → ItemDoc 还原关键执行字段', () => {
    const cases = loadCasesV2(join(projectRoot, 'cases'), projectRoot);
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);

    const caseDoc = cases.find((c) => c.doc.case_id === 'paired-task-22')!.doc;
    const rev = revisions.find((r) => r.doc.case_revision_id === 'paired-task-22.r2.off')!.doc;

    const item = caseRevisionToItemDoc(rev, caseDoc);

    // 身份（还原 V1 格式 id，保持 run 产物与历史 run 一致）
    expect(item.id).toBe('EVAL-B-PAIRED-TASK-22-OFF');
    expect(item.rev).toBe(2);
    expect(item.axis).toBe('B');
    // 意图
    expect(item.intent.attribution_focus).toBe(rev.attribution_focus);
    expect(item.intent.effect_pair).toBe(caseDoc.pair_key);
    // freeze（基准模型）
    expect(item.freeze.model_driver).toBe('live');
    expect('model_id' in item.freeze ? item.freeze.model_id : undefined).toBe(rev.model_id);
    expect('channel' in item.freeze ? item.freeze.channel : undefined).toBe('hosted');
    // stimulus（含暗号）
    expect(item.stimulus.ref).toBe(rev.stimulus.ref);
    expect(item.stimulus.hosted_pass_token).toBe(rev.stimulus.hosted_pass_token);
    // 执行约束
    expect(item.execution.deadline_ms).toBe(rev.execution.deadline_ms);
    expect(item.execution.requires_network).toBe(rev.execution.requires_network);
  });

  it('EnvironmentProfile → RoomDoc 还原 host 执行信息', () => {
    const envs = loadEnvironments(join(projectRoot, 'environments'), projectRoot);
    const env = envs.find((e) => e.doc.environment_profile_id === 'hosted-plugin-v1')!.doc;

    const room = environmentToRoom(env);

    expect(room.kind).toBe('hosted');
    expect(room.host?.command).toBe('opencode');
    expect(room.host?.model).toBe(env.recipe.host_model);
    expect(room.host?.agent).toBe(env.recipe.host_agent);
    expect(room.host?.plugin).toBe(env.recipe.host_plugin);
    expect(room.durable_log_glob).toBe(env.recipe.durable_log_glob);
    expect(room.workspace).toBe('isolated');
  });

  it('OFF/ON 两个修订还原为两个不同 ItemDoc，共享同一 pair_key', () => {
    const cases = loadCasesV2(join(projectRoot, 'cases'), projectRoot);
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);

    const caseDoc = cases.find((c) => c.doc.case_id === 'paired-task-22')!.doc;
    const off = revisions.find((r) => r.doc.case_revision_id === 'paired-task-22.r2.off')!.doc;
    const on = revisions.find((r) => r.doc.case_revision_id === 'paired-task-22.r3.on')!.doc;

    const offItem = caseRevisionToItemDoc(off, caseDoc);
    const onItem = caseRevisionToItemDoc(on, caseDoc);

    expect(offItem.id).not.toBe(onItem.id);
    expect(offItem.intent.effect_pair).toBe(onItem.intent.effect_pair);
    // OFF/ON 预期合同不同（attribution_focus / protocol_probes 可能不同）
    expect(offItem.intent.attribution_focus).toBe(off.attribution_focus);
    expect(onItem.intent.attribution_focus).toBe(on.attribution_focus);
  });

  it('318 个 item.id 全量还原为 V1 格式（EVAL-B- 前缀 + 大写 + 变体后缀）', () => {
    const cases = loadCasesV2(join(projectRoot, 'cases'), projectRoot);
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    const caseById = new Map(cases.map((c) => [c.doc.case_id, c.doc]));

    for (const rev of revisions) {
      const caseDoc = caseById.get(rev.doc.case_id)!;
      const item = caseRevisionToItemDoc(rev.doc, caseDoc);
      const variant = rev.doc.case_revision_id.includes('.on') ? 'ON' : 'OFF';
      // 期望：EVAL-B-{CASE_ID 大写}-{OFF|ON}
      expect(item.id, `${rev.doc.case_revision_id} 应还原 V1 id`).toBe(
        `EVAL-B-${rev.doc.case_id.toUpperCase()}-${variant}`,
      );
    }
  });
});

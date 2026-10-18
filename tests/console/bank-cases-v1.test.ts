import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getTask, listTasks } from '../../apps/console/bank.ts';

/**
 * 阶段 5 步骤 2 切片 B1：loadPairedItems 读路径切 cases-v1。
 * 红测：seed cases-v1 资产（case + case-revision），验证 listTasks/getTask 读回显。
 */
function seedCasesV1(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-bank-cv1-'));
  mkdirSync(join(root, 'bank/materials'), { recursive: true });
  mkdirSync(join(root, 'cases'), { recursive: true });
  mkdirSync(join(root, 'case-revisions'), { recursive: true });

  // 一个配对任务：PAIRED-TASK-02（OFF r6 + ON r7）
  writeFileSync(
    join(root, 'cases', 'paired-task-02.case.json'),
    `${JSON.stringify(
      {
        case_id: 'paired-task-02',
        title: '配对任务 02（有插件）：终态须含 yes',
        owner: 'product-eval',
        tags: ['coding'],
        lifecycle: 'released',
        automation_readiness: 'design_ready',
        head_revision_id: 'paired-task-02.r7.on',
        pair_key: 'PAIRED-TASK-02',
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, 'case-revisions', 'paired-task-02.r6.off.case-revision.json'),
    `${JSON.stringify(
      {
        case_id: 'paired-task-02',
        case_revision_id: 'paired-task-02.r6.off',
        revision_number: 6,
        content_hash: 'hash-off',
        stimulus: {
          kind: 'task_prompt',
          ref: 'bank/materials/PAIRED-TASK-02/prompt.txt',
          hosted_pass_token: 'yes',
          notes: 'Reply with exactly yes.',
        },
        expect: {
          oracles: [
            { id: 'exit0', type: 'exit_code', equals: 0 },
            { id: 'stdout-must', type: 'stdout_assert', contains: 'yes' },
          ],
        },
        attribution_focus: 'MODEL_TASK',
        model_id: 'wave-ai/gpt-5.4-mini',
        execution: { deadline_ms: 180000, requires_network: true, requires_durable_log: false },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, 'case-revisions', 'paired-task-02.r7.on.case-revision.json'),
    `${JSON.stringify(
      {
        case_id: 'paired-task-02',
        case_revision_id: 'paired-task-02.r7.on',
        revision_number: 7,
        content_hash: 'hash-on',
        stimulus: {
          kind: 'task_prompt',
          ref: 'bank/materials/PAIRED-TASK-02/prompt.txt',
          hosted_pass_token: 'yes',
          notes: 'Reply with exactly yes.',
        },
        expect: {
          oracles: [
            { id: 'exit0', type: 'exit_code', equals: 0 },
            { id: 'stdout-must', type: 'stdout_assert', contains: 'yes' },
          ],
        },
        attribution_focus: 'PROTOCOL',
        protocol_probes: ['RuntimeStarted', 'JournalEnvelope'],
        model_id: 'wave-ai/gpt-5.4-mini',
        execution: { deadline_ms: 180000, requires_network: true, requires_durable_log: true },
      },
      null,
      2,
    )}\n`,
  );
  // materials prompt.txt（使 complete 判定成立）
  mkdirSync(join(root, 'bank/materials', 'PAIRED-TASK-02'), { recursive: true });
  writeFileSync(
    join(root, 'bank/materials', 'PAIRED-TASK-02', 'prompt.txt'),
    'Reply with exactly yes.\n',
  );
  return root;
}

describe('bank 读路径（cases-v1）', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('listTasks 从 cases-v1 读回显（V1 id 还原 + pair_key 关联）', () => {
    root = seedCasesV1();
    const tasks = listTasks(root);
    const row = tasks.find((t) => t.taskId === 'PAIRED-TASK-02');
    expect(row).toBeDefined();
    expect(row?.complete).toBe(true);
    expect(row?.completeLabel).toBe('完整');
    expect(row?.versionLabel).toBe('无插件 v6 · 有插件 v7');
    expect(row?.labelPassToken).toBe('yes');
    expect(row?.offId).toBe('EVAL-B-PAIRED-TASK-02-OFF');
    expect(row?.onId).toBe('EVAL-B-PAIRED-TASK-02-ON');
    expect(row?.offRev).toBe(6);
    expect(row?.onRev).toBe(7);
    expect(row?.tags).toEqual(['coding']);
    expect(row?.promptPreview).toContain('Reply with exactly yes');
  });

  it('getTask 从 cases-v1 读回显（off/on 详情 + oracles）', () => {
    root = seedCasesV1();
    const detail = getTask(root, 'PAIRED-TASK-02');
    expect('error' in detail).toBe(false);
    if ('error' in detail) return;
    expect(detail.complete).toBe(true);
    expect(detail.passToken).toBe('yes');
    expect(detail.off?.id).toBe('EVAL-B-PAIRED-TASK-02-OFF');
    expect(detail.off?.rev).toBe(6);
    expect(detail.on?.id).toBe('EVAL-B-PAIRED-TASK-02-ON');
    expect(detail.on?.rev).toBe(7);
    expect(detail.off?.contains).toEqual(['yes']);
    expect(detail.tags).toEqual(['coding']);
  });

  it('cases-v1 缺失时回退读 item.json（写路径兼容）', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-bank-cv1-'));
    mkdirSync(join(root, 'bank/materials'), { recursive: true });
    mkdirSync(join(root, 'bank/items/B'), { recursive: true });
    // 仅 seed item.json（无 cases-v1），验证回退读
    writeFileSync(
      join(root, 'bank/items/B', 'eval-b-paired-task-03-off.item.json'),
      `${JSON.stringify(
        {
          id: 'EVAL-B-PAIRED-TASK-03-OFF',
          rev: 1,
          axis: 'B',
          status: 'active',
          intent: { effect_pair: 'PAIRED-TASK-03' },
          stimulus: {
            kind: 'task_prompt',
            ref: 'bank/materials/PAIRED-TASK-03/prompt.txt',
            hosted_pass_token: 'ok',
          },
          expect: { oracles: [] },
        },
        null,
        2,
      )}\n`,
    );
    const tasks = listTasks(root);
    expect(tasks.some((t) => t.taskId === 'PAIRED-TASK-03')).toBe(true);
  });
});

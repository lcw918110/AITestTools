import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTask, deleteTask, getTask, listTasks, updateTask } from '../../apps/console/bank.ts';

/**
 * 阶段 5 步骤 2 切片 B2/B3：bank 写路径切 cases-v1。
 * 红测：create 写 case + case-revision + dataset-release，update 升 revision，delete 删资产。
 */
function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-bank-w-'));
  mkdirSync(join(root, 'bank/materials'), { recursive: true });
  mkdirSync(join(root, 'cases'), { recursive: true });
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  mkdirSync(join(root, 'dataset-releases'), { recursive: true });
  // calibrate 测试集的成对 dataset-release（空闭包）
  for (const name of ['paired-off-calibrate', 'paired-on-calibrate']) {
    writeFileSync(
      join(root, 'dataset-releases', `${name}.dataset-release.json`),
      `${JSON.stringify(
        {
          dataset_release_id: name,
          name,
          case_revisions: [],
          closure_hash: 'empty',
          created_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  }
  return root;
}

const okValidate = async () => ({ exitCode: 0, ok: true, log: '1/1 试题通过' });

describe('bank 写路径（cases-v1）', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('create 写 case + case-revision + dataset-release 引用', async () => {
    root = seedProject();
    const created = await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.complete).toBe(true);
    expect(created.passToken).toBe('Z');
    expect(created.off?.id).toBe('EVAL-B-PAIRED-TASK-99-OFF');
    expect(created.off?.rev).toBe(1);
    expect(created.on?.rev).toBe(1);

    // case.json 已写
    const casePath = join(root, 'cases', 'paired-task-99.case.json');
    expect(existsSync(casePath)).toBe(true);
    const caseDoc = JSON.parse(readFileSync(casePath, 'utf8')) as {
      case_id: string;
      pair_key: string;
      head_revision_id: string;
      lifecycle: string;
      automation_readiness: string;
    };
    expect(caseDoc.case_id).toBe('paired-task-99');
    expect(caseDoc.pair_key).toBe('PAIRED-TASK-99');
    expect(caseDoc.lifecycle).toBe('draft');
    expect(caseDoc.automation_readiness).toBe('not_assessed');

    // case-revision.json 已写（OFF r1 + ON r1，含 content_hash）
    const offRevPath = join(root, 'case-revisions', 'paired-task-99.r1.off.case-revision.json');
    const onRevPath = join(root, 'case-revisions', 'paired-task-99.r1.on.case-revision.json');
    expect(existsSync(offRevPath)).toBe(true);
    expect(existsSync(onRevPath)).toBe(true);
    const offRev = JSON.parse(readFileSync(offRevPath, 'utf8')) as {
      case_revision_id: string;
      revision_number: number;
      content_hash: string;
      stimulus: { hosted_pass_token: string };
    };
    expect(offRev.case_revision_id).toBe('paired-task-99.r1.off');
    expect(offRev.revision_number).toBe(1);
    expect(offRev.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(offRev.stimulus.hosted_pass_token).toBe('Z');

    // dataset-release 的 case_revisions 已追加引用
    const relPath = join(root, 'dataset-releases', 'paired-off-calibrate.dataset-release.json');
    const relDoc = JSON.parse(readFileSync(relPath, 'utf8')) as {
      case_revisions: Array<{ case_revision_id: string }>;
    };
    expect(relDoc.case_revisions.map((r) => r.case_revision_id)).toContain('paired-task-99.r1.off');
  });

  it('update 升 revision（新 case-revision + content_hash 变化 + head 更新）', async () => {
    root = seedProject();
    await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );
    const updated = await updateTask(root, root, 'PAIRED-TASK-99', {
      prompt: 'Reply with exactly ZZ.',
      passToken: 'ZZ',
      changeName: '收紧终态词',
    });
    expect('error' in updated).toBe(false);
    if ('error' in updated) return;
    expect(updated.passToken).toBe('ZZ');
    expect(updated.off?.rev).toBe(2);
    expect(updated.on?.rev).toBe(2);

    // 新 revision 文件已写（r2）
    const offRev2 = join(root, 'case-revisions', 'paired-task-99.r2.off.case-revision.json');
    expect(existsSync(offRev2)).toBe(true);
    const offDoc = JSON.parse(readFileSync(offRev2, 'utf8')) as {
      revision_number: number;
      stimulus: { hosted_pass_token: string };
      change_log: Record<string, string>;
    };
    expect(offDoc.revision_number).toBe(2);
    expect(offDoc.stimulus.hosted_pass_token).toBe('ZZ');
    expect(offDoc.change_log.rev2).toBe('收紧终态词');

    // head_revision_id 已更新
    const caseDoc = JSON.parse(
      readFileSync(join(root, 'cases', 'paired-task-99.case.json'), 'utf8'),
    ) as {
      head_revision_id: string;
    };
    expect(caseDoc.head_revision_id).toContain('.r2.');

    // dataset-release 引用闭包：off release 只含 off r2、on release 只含 on r2（旧 r1 已移除）。
    const offRel = JSON.parse(
      readFileSync(
        join(root, 'dataset-releases', 'paired-off-calibrate.dataset-release.json'),
        'utf8',
      ),
    ) as { case_revisions: Array<{ case_revision_id: string }> };
    const onRel = JSON.parse(
      readFileSync(
        join(root, 'dataset-releases', 'paired-on-calibrate.dataset-release.json'),
        'utf8',
      ),
    ) as { case_revisions: Array<{ case_revision_id: string }> };
    const offIds = offRel.case_revisions.map((r) => r.case_revision_id);
    const onIds = onRel.case_revisions.map((r) => r.case_revision_id);
    expect(offIds).toContain('paired-task-99.r2.off');
    expect(offIds).not.toContain('paired-task-99.r1.off');
    expect(offIds).not.toContain('paired-task-99.r2.on');
    expect(onIds).toContain('paired-task-99.r2.on');
    expect(onIds).not.toContain('paired-task-99.r1.on');
    expect(onIds).not.toContain('paired-task-99.r2.off');
  });

  it('delete 删 case + case-revision + 移除 dataset-release 引用', async () => {
    root = seedProject();
    await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );
    const deleted = deleteTask(root, 'PAIRED-TASK-99', 'PAIRED-TASK-99');
    expect(deleted).toEqual({ ok: true, taskId: 'PAIRED-TASK-99' });

    expect(existsSync(join(root, 'cases', 'paired-task-99.case.json'))).toBe(false);
    expect(
      existsSync(join(root, 'case-revisions', 'paired-task-99.r1.off.case-revision.json')),
    ).toBe(false);
    expect(
      existsSync(join(root, 'case-revisions', 'paired-task-99.r1.on.case-revision.json')),
    ).toBe(false);
    expect(listTasks(root).some((t) => t.taskId === 'PAIRED-TASK-99')).toBe(false);
    expect(getTask(root, 'PAIRED-TASK-99')).toMatchObject({ code: 404 });
  });
});

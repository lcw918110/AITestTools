import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTask, getTask, updateTask } from '../../apps/console/bank.ts';

function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-bank-'));
  mkdirSync(join(root, 'bank/materials'), { recursive: true });
  mkdirSync(join(root, 'bank/items/B'), { recursive: true });
  mkdirSync(join(root, 'papersets'), { recursive: true });
  mkdirSync(join(root, 'dataset-releases'), { recursive: true });
  for (const name of [
    'paired-off.json',
    'paired-on.json',
    'paired-off-calibrate.json',
    'paired-on-calibrate.json',
  ]) {
    writeFileSync(
      join(root, 'papersets', name),
      `${JSON.stringify({ name: name.replace(/\.json$/, ''), items: [] }, null, 2)}\n`,
    );
  }
  // 读路径（getTestSet）已切到 dataset-releases/，须同步 seed cases-v1 资产。
  for (const name of ['paired-off-calibrate', 'paired-on-calibrate']) {
    writeFileSync(
      join(root, 'dataset-releases', `${name}.dataset-release.json`),
      `${JSON.stringify({ dataset_release_id: name, name, case_revisions: [] }, null, 2)}\n`,
    );
  }
  return root;
}

const okValidate = async () => ({ exitCode: 0, ok: true, log: '1/1 试题通过' });

describe('updateTask 回滚', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('前置校验失败不落盘：tags 非法时 prompt.txt 保持不变', async () => {
    root = seedProject();
    await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-50',
        prompt: 'Reply with exactly OLD.',
        passToken: 'OLD',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );
    const promptFile = join(root, 'bank/materials/PAIRED-TASK-50/prompt.txt');
    const before = readFileSync(promptFile, 'utf8');

    const r = await updateTask(root, root, 'PAIRED-TASK-50', {
      prompt: 'Reply with exactly NEW.',
      changeName: '改了题干',
      tags: 'effect', // 非法标签，应在前置校验被拒，不落盘
    });
    expect(r).toMatchObject({ code: 400 });
    expect(readFileSync(promptFile, 'utf8')).toBe(before);
  });

  it('落盘中途失败（r2 文件被目录占位）回滚 prompt 与 OFF revision', async () => {
    root = seedProject();
    await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-51',
        prompt: 'Reply with exactly A.',
        passToken: 'A',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );
    const promptFile = join(root, 'bank/materials/PAIRED-TASK-51/prompt.txt');
    const offFile = join(root, 'case-revisions/paired-task-51.r2.off.case-revision.json');
    const onFile = join(root, 'case-revisions/paired-task-51.r2.on.case-revision.json');
    const promptBefore = readFileSync(promptFile, 'utf8');

    // 用目录占位 ON 的 r2 case-revision 文件，使写盘阶段抛错（OFF r2 已先被写，须整体回滚）
    mkdirSync(onFile, { recursive: true });

    const r = await updateTask(root, root, 'PAIRED-TASK-51', {
      prompt: 'Reply with exactly B.',
      passToken: 'B',
      changeName: '触发回滚',
    });
    expect(r).toMatchObject({ code: 500 });

    // prompt.txt 应回滚到改前内容；OFF r2 revision 文件应被回滚删除（未残留）
    expect(readFileSync(promptFile, 'utf8')).toBe(promptBefore);
    expect(existsSync(offFile)).toBe(false);
    // 任务仍可读且 OFF rev 仍为 1
    const detail = getTask(root, 'PAIRED-TASK-51');
    expect('error' in detail).toBe(false);
    if ('error' in detail) return;
    expect(detail.off?.rev).toBe(1);
  });
});

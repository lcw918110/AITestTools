import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('落盘中途失败（bump 遇非法 rev）回滚 prompt 与 OFF item', async () => {
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
    const offFile = join(root, 'bank/items/B/eval-b-paired-task-51-off.item.json');
    const onFile = join(root, 'bank/items/B/eval-b-paired-task-51-on.item.json');
    const promptBefore = readFileSync(promptFile, 'utf8');
    const offBefore = readFileSync(offFile, 'utf8');

    // 把 ON item 的 rev 改成非法值，使 bump 阶段抛错（OFF 已先被写，须整体回滚）
    const onDoc = JSON.parse(readFileSync(onFile, 'utf8')) as { rev: unknown };
    onDoc.rev = 'not-a-number';
    writeFileSync(onFile, `${JSON.stringify(onDoc, null, 2)}\n`);

    const r = await updateTask(root, root, 'PAIRED-TASK-51', {
      prompt: 'Reply with exactly B.',
      passToken: 'B',
      changeName: '触发回滚',
    });
    expect(r).toMatchObject({ code: 500 });

    // prompt.txt 与 OFF item 应回滚到改前内容
    expect(readFileSync(promptFile, 'utf8')).toBe(promptBefore);
    expect(readFileSync(offFile, 'utf8')).toBe(offBefore);
    // 任务仍可读且 OFF rev 仍为 1
    const detail = getTask(root, 'PAIRED-TASK-51');
    expect('error' in detail).toBe(false);
    if ('error' in detail) return;
    expect(detail.off?.rev).toBe(1);
  });
});

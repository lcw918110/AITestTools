import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestSet, listTestSets, testSetIdFromRelease } from '../../apps/console/test-sets.ts';

/**
 * 阶段 5 步骤 1：test-sets 读路径从 papersets/ 切换到 dataset-releases/。
 * 红测：seed cases-v1 资产（dataset-release），验证 listTestSets 等价归并。
 */
function seed(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-ts-'));
  mkdirSync(join(root, 'dataset-releases'), { recursive: true });
  mkdirSync(join(root, 'papersets'), { recursive: true });
  const files: Array<
    [string, Array<{ case_id: string; case_revision_id: string; content_hash: string }>]
  > = [
    [
      'paired-off',
      [
        {
          case_id: 'paired-task-02',
          case_revision_id: 'paired-task-02.r6.off',
          content_hash: 'h1',
        },
      ],
    ],
    [
      'paired-on',
      [{ case_id: 'paired-task-02', case_revision_id: 'paired-task-02.r7.on', content_hash: 'h2' }],
    ],
    [
      'paired-off-effect-smoke',
      [
        {
          case_id: 'paired-task-157',
          case_revision_id: 'paired-task-157.r2.off',
          content_hash: 'h3',
        },
      ],
    ],
    [
      'paired-on-effect-smoke',
      [
        {
          case_id: 'paired-task-157',
          case_revision_id: 'paired-task-157.r3.on',
          content_hash: 'h4',
        },
      ],
    ],
    [
      'eval-model',
      [
        {
          case_id: 'paired-task-02',
          case_revision_id: 'paired-task-02.r6.off',
          content_hash: 'h1',
        },
      ],
    ],
    [
      'eval-agent',
      [
        {
          case_id: 'paired-task-02',
          case_revision_id: 'paired-task-02.r6.off',
          content_hash: 'h1',
        },
      ],
    ],
  ];
  for (const [name, caseRevisions] of files) {
    writeFileSync(
      join(root, 'dataset-releases', `${name}.dataset-release.json`),
      `${JSON.stringify({ dataset_release_id: name, name, case_revisions: caseRevisions }, null, 2)}\n`,
    );
  }
  return root;
}

describe('test-sets（cases-v1 读路径）', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('从成对 dataset-release 归并，排除 eval-model', () => {
    root = seed();
    const sets = listTestSets(root);
    expect(sets.map((s) => s.id).sort()).toEqual(['effect-smoke', 'full'].sort());
    expect(sets.find((s) => s.id === 'full')?.label).toBe('全量');
    expect(sets.find((s) => s.id === 'effect-smoke')?.taskIds).toEqual(['PAIRED-TASK-157']);
    expect(testSetIdFromRelease('eval-model')).toBeUndefined();
  });

  it('新建空测试集写两侧 dataset-release 文件', () => {
    root = seed();
    const created = createTestSet(root, { name: '本周对照', description: '自建' });
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.id).toMatch(/^ts-[a-z0-9]+$/);
    expect(created.offRelease).toBe(`paired-off-${created.id}`);
    expect(
      existsSync(join(root, 'dataset-releases', `${created.offRelease}.dataset-release.json`)),
    ).toBe(true);
    const off = JSON.parse(
      readFileSync(
        join(root, 'dataset-releases', `${created.offRelease}.dataset-release.json`),
        'utf8',
      ),
    ) as { case_revisions: unknown[] };
    expect(off.case_revisions).toEqual([]);
    expect(listTestSets(root).some((s) => s.id === created.id)).toBe(true);
  });
});

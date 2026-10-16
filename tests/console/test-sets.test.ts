import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestSet,
  listTestSets,
  testSetIdFromPaperset,
} from '../../apps/console/test-sets.ts';

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-ts-'));
  mkdirSync(join(root, 'papersets'), { recursive: true });
  const files: Array<[string, string[]]> = [
    ['paired-off.json', ['EVAL-B-PAIRED-TASK-02-OFF']],
    ['paired-on.json', ['EVAL-B-PAIRED-TASK-02-ON']],
    ['paired-off-effect-smoke.json', ['EVAL-B-PAIRED-TASK-157-OFF']],
    ['paired-on-effect-smoke.json', ['EVAL-B-PAIRED-TASK-157-ON']],
    ['eval-model.json', ['EVAL-B-PAIRED-TASK-02-OFF']],
    ['eval-agent.json', ['EVAL-B-PAIRED-TASK-02-OFF']],
  ];
  for (const [name, items] of files) {
    writeFileSync(
      join(root, 'papersets', name),
      `${JSON.stringify({ name: name.replace(/\.json$/, ''), items }, null, 2)}\n`,
    );
  }
  return root;
}

describe('test-sets', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('从成对 paperset 归并，排除 eval-model', () => {
    root = seed();
    const sets = listTestSets(root);
    expect(sets.map((s) => s.id).sort()).toEqual(['effect-smoke', 'full'].sort());
    expect(sets.find((s) => s.id === 'full')?.label).toBe('全量');
    expect(sets.find((s) => s.id === 'effect-smoke')?.taskIds).toEqual(['PAIRED-TASK-157']);
    expect(testSetIdFromPaperset('eval-model')).toBeUndefined();
  });

  it('新建空测试集写两侧文件', () => {
    root = seed();
    const created = createTestSet(root, { name: '本周对照', description: '自建' });
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.id).toMatch(/^ts-[a-z0-9]+$/);
    expect(created.offPaperset).toBe(`paired-off-${created.id}`);
    expect(existsSync(join(root, 'papersets', `${created.offPaperset}.json`))).toBe(true);
    const off = JSON.parse(
      readFileSync(join(root, 'papersets', `${created.offPaperset}.json`), 'utf8'),
    ) as { items: string[] };
    expect(off.items).toEqual([]);
    expect(listTestSets(root).some((s) => s.id === created.id)).toBe(true);
  });
});

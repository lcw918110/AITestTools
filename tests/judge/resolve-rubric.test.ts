import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRubricFromCaseRevision } from '../../src/judge/resolve-rubric.ts';

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-rubric-'));
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  return root;
}

describe('resolve-rubric', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('读 case-revision 的 expect.rubric', () => {
    root = seed();
    writeFileSync(
      join(root, 'case-revisions/paired-task-1.r1.on.case-revision.json'),
      JSON.stringify({
        case_revision_id: 'paired-task-1.r1.on',
        expect: {
          rubric: {
            dimensions: [{ name: '代码可读性', scale: 'pass/fail', weight: 1 }],
          },
        },
      }),
    );
    const rubric = resolveRubricFromCaseRevision(root, 'paired-task-1.r1.on');
    expect(rubric?.dimensions).toHaveLength(1);
    expect(rubric?.dimensions[0]?.name).toBe('代码可读性');
  });

  it('无 rubric 或文件不存在返回 undefined', () => {
    root = seed();
    writeFileSync(
      join(root, 'case-revisions/no-rubric.case-revision.json'),
      JSON.stringify({ case_revision_id: 'no-rubric', expect: { oracles: [] } }),
    );
    expect(resolveRubricFromCaseRevision(root, 'no-rubric')).toBeUndefined();
    expect(resolveRubricFromCaseRevision(root, 'missing')).toBeUndefined();
  });

  it('rubric 非法（缺 weight）返回 undefined', () => {
    root = seed();
    writeFileSync(
      join(root, 'case-revisions/bad.case-revision.json'),
      JSON.stringify({
        case_revision_id: 'bad',
        expect: { rubric: { dimensions: [{ name: 'x', scale: 'pass/fail' }] } },
      }),
    );
    expect(resolveRubricFromCaseRevision(root, 'bad')).toBeUndefined();
  });
});

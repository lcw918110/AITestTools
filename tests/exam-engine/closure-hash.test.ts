/**
 * `closure_hash` 校验回归。
 *
 * 改造前缺陷：`closure_hash` 只在写入侧（`item-new`）计算，读取侧从不校验。
 * 手工编辑 `dataset_release.case_revisions` 后忘记重算，或直接写错哈希，
 * 门禁全部放行——冻结闭包与声明值静默不一致。
 *
 * 本文件构造「篡改后必须报错」的红例，防止校验被回退。
 */
import { describe, expect, it } from 'vitest';
import { closureDigest } from '../../src/exam-engine/digest.ts';
import { validateDatasetRelease } from '../../src/exam-engine/validate.ts';
import type { CaseRevision, DatasetRelease } from '../../src/domain/types.ts';

function makeRelease(
  refs: Array<{ case_id: string; case_revision_id: string; content_hash: string }>,
  closure: string,
): DatasetRelease {
  return {
    $schema: '../../../schemas/dataset-release.schema.json',
    dataset_release_id: 'test-release',
    name: 'test-release',
    case_revisions: refs,
    closure_hash: closure,
  } as unknown as DatasetRelease;
}

function rev(id: string, hash: string): CaseRevision {
  return { case_revision_id: id, content_hash: hash } as unknown as CaseRevision;
}

function issuesFor(release: DatasetRelease, revisions: CaseRevision[]): string[] {
  const index = new Map(revisions.map((r) => [r.case_revision_id, r]));
  return validateDatasetRelease(
    { relPath: 'test.dataset-release.json', doc: release } as never,
    index,
  ).map((i) => i.code);
}

const REFS = [
  { case_id: 'c1', case_revision_id: 'c1.r1.on', content_hash: 'h1' },
  { case_id: 'c2', case_revision_id: 'c2.r1.on', content_hash: 'h2' },
];
const REVS = [rev('c1.r1.on', 'h1'), rev('c2.r1.on', 'h2')];

describe('closure_hash 校验', () => {
  it('哈希正确时不报错', () => {
    const release = makeRelease(REFS, closureDigest(REFS));
    expect(issuesFor(release, REVS)).toHaveLength(0);
  });

  it('哈希被改写后必须报 DATASET_CLOSURE_HASH_MISMATCH', () => {
    const release = makeRelease(REFS, 'deadbeef');
    expect(issuesFor(release, REVS)).toContain('DATASET_CLOSURE_HASH_MISMATCH');
  });

  it('增删引用但未重算 closure_hash 必须报错', () => {
    const release = makeRelease(REFS, closureDigest(REFS));
    // 模拟手工追加一条引用却忘记重算闭包哈希
    release.case_revisions.push({
      case_id: 'c3',
      case_revision_id: 'c3.r1.on',
      content_hash: 'h3',
    });
    const codes = issuesFor(release, [...REVS, rev('c3.r1.on', 'h3')]);
    expect(codes).toContain('DATASET_CLOSURE_HASH_MISMATCH');
  });

  it('content_hash 不一致仍单独报 DATASET_HASH_MISMATCH', () => {
    const release = makeRelease(REFS, closureDigest(REFS));
    const codes = issuesFor(release, [rev('c1.r1.on', 'CHANGED'), rev('c2.r1.on', 'h2')]);
    expect(codes).toContain('DATASET_HASH_MISMATCH');
  });
});

describe('closureDigest 与写入侧口径一致', () => {
  it('同一引用列表多次计算结果稳定', () => {
    expect(closureDigest(REFS)).toBe(closureDigest(REFS));
  });

  it('引用顺序不同结果不同（闭包是有序列表）', () => {
    const swapped = [REFS[1], REFS[0]];
    expect(closureDigest(REFS)).not.toBe(closureDigest(swapped));
  });

  it('任意字段变化都会改变闭包哈希', () => {
    const tampered = [{ ...REFS[0], content_hash: 'x' }, REFS[1]];
    expect(closureDigest(REFS)).not.toBe(closureDigest(tampered));
  });
});

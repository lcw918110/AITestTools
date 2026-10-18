import { describe, expect, it } from 'vitest';
import { canonicalize, revisionDigest } from '../../src/exam-engine/digest.ts';
import type { CaseRevision } from '../../src/exam-engine/types.ts';
import { baseRevision } from '../helpers/case-factory.ts';

const doc = (overrides: Record<string, unknown> = {}): CaseRevision =>
  baseRevision(overrides) as unknown as CaseRevision;

describe('规范化 JSON', () => {
  it('键序不影响结果', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('数组顺序影响结果', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
});

describe('修订 digest（cases-v1 content_hash 不变式）', () => {
  it('改判定条件会改变 digest', () => {
    const changed = doc({
      expect: { oracles: [{ id: 'x', type: 'no_event', names: ['X'] }] },
    });
    expect(revisionDigest(changed)).not.toBe(revisionDigest(doc()));
  });

  it('只改非内容字段不改变 digest——文案/元信息无需升 rev', () => {
    expect(revisionDigest(doc({ change_log: { rev1: '另一个标题' } }))).toBe(revisionDigest(doc()));
  });

  it('同一内容重复计算稳定', () => {
    expect(revisionDigest(doc())).toBe(revisionDigest(doc()));
  });
});

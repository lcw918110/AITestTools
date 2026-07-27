import { describe, expect, it } from 'vitest';
import { canonicalize, semanticDigest } from '../../src/exam-engine/digest.ts';
import type { CaseDoc } from '../../src/exam-engine/types.ts';
import { baseCase } from '../helpers/case-factory.ts';

const doc = (overrides: Record<string, unknown> = {}): CaseDoc =>
  baseCase(overrides) as unknown as CaseDoc;

describe('规范化 JSON', () => {
  it('键序不影响结果', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('数组顺序影响结果', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
});

describe('语义 digest（PRD 附录 A 不变式）', () => {
  it('改判定条件会改变 digest', () => {
    const changed = doc({
      expect: { oracles: [{ type: 'no_event', names: ['X'] }] },
    });
    expect(semanticDigest(changed)).not.toBe(semanticDigest(doc()));
  });

  it('只改文案不改变 digest——文案变更无需升 rev', () => {
    expect(semanticDigest(doc({ title: '另一个标题', owner: '别人' }))).toBe(semanticDigest(doc()));
  });

  it('同一内容重复计算稳定', () => {
    expect(semanticDigest(doc())).toBe(semanticDigest(doc()));
  });
});

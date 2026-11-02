import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCaseRevision } from '../../src/exam-engine/validate.ts';
import type { CaseRevision } from '../../src/domain/types.ts';
import type { LoadedAsset } from '../../src/exam-engine/types.ts';
import { revisionDigest } from '../../src/exam-engine/digest.ts';

/**
 * 以真实 r6 修订为骨架做变异，保证 schema 全绿、只让目标正则非法，
 * 从而验证「断言正则静态可编译门禁」本身生效（而不是被 schema 提前短路）。
 */
const R6_PATH = resolve(
  import.meta.dirname,
  '../../examples/product-eval/case-revisions/paired-task-92.r6.on.case-revision.json',
);

function loadR6(): CaseRevision {
  return JSON.parse(readFileSync(R6_PATH, 'utf8')) as CaseRevision;
}

function withOracles(oracles: unknown[]): LoadedAsset<CaseRevision> {
  const doc = loadR6();
  (doc.expect as unknown as { oracles: unknown[] }).oracles = oracles;
  doc.content_hash = revisionDigest(doc);
  return {
    doc,
    path: R6_PATH,
    relPath: 'paired-task-92.r6.on.case-revision.json',
  } as LoadedAsset<CaseRevision>;
}

const baseOracles = (): unknown[] =>
  JSON.parse(JSON.stringify(loadR6().expect.oracles)) as unknown[];

describe('validateCaseRevision · 断言正则静态可编译门禁', () => {
  it('真实 r6 文件本身零错误', () => {
    const issues = validateCaseRevision(withOracles(baseOracles()));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('semantic_variants 缺右括号 → 报错并指出下标', () => {
    const oracles = baseOracles() as Array<Record<string, unknown>>;
    const hold = oracles.find((o) => o['id'] === 'hold-conclusion');
    expect(hold).toBeDefined();
    const variants = hold?.['semantic_variants'] as string[];
    variants[1] = '(?:不|没|未)[^。\\n]{0,15}(?:改写|篡改';

    const issues = validateCaseRevision(withOracles(oracles));
    const bad = issues.filter((i) => i.code === 'ORACLE_REGEX_INVALID');
    expect(bad).toHaveLength(1);
    expect(bad[0]?.level).toBe('error');
    expect(bad[0]?.instancePath).toContain('/semantic_variants/1');
  });

  it('contains_regex / not_contains_regex 非法同样拦下', () => {
    const issues = validateCaseRevision(
      withOracles([
        { id: 'c', type: 'stdout_assert', contains_regex: '([a-z' },
        { id: 'd', type: 'stdout_assert', not_contains_regex: 'a{2,1}' },
      ]),
    );
    const bad = issues.filter((i) => i.code === 'ORACLE_REGEX_INVALID');
    expect(bad).toHaveLength(2);
  });

  it('regex_flags 非法单独归因', () => {
    const issues = validateCaseRevision(
      withOracles([{ id: 'e', type: 'stdout_assert', contains_regex: 'ok', regex_flags: 'gg' }]),
    );
    expect(issues.some((i) => i.code === 'ORACLE_REGEX_FLAGS_INVALID')).toBe(true);
  });

  it('semantic_variants 与 contains 共存 → ORACLE_SEMANTIC_EXCLUSIVE', () => {
    const issues = validateCaseRevision(
      withOracles([
        { id: 'f', type: 'stdout_assert', contains: '部署', semantic_variants: ['拒绝'] },
      ]),
    );
    expect(issues.some((i) => i.code === 'ORACLE_SEMANTIC_EXCLUSIVE')).toBe(true);
  });

  it('contains 为空串也不能绕过互斥（静态门禁与运行时同口径）', () => {
    const issues = validateCaseRevision(
      withOracles([{ id: 'g', type: 'stdout_assert', contains: '', semantic_variants: ['拒绝'] }]),
    );
    expect(issues.some((i) => i.code === 'ORACLE_SEMANTIC_EXCLUSIVE')).toBe(true);
  });

  it('semantic_variants 空数组 / 空串 / 非字符串均被拦下（schema 或语义门禁，至少一条 error）', () => {
    for (const bad of [[], [''], ['  '], ['ok', 123]]) {
      const issues = validateCaseRevision(
        withOracles([{ id: 'h', type: 'stdout_assert', semantic_variants: bad }]),
      );
      expect(issues.some((i) => i.level === 'error')).toBe(true);
    }
  });
});

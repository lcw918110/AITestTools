/**
 * 空清单 / 无效名单断言的**静态**门禁回归。
 *
 * 运行期已有守卫（见 `declared-empty-lists.test.ts`：判负并归 HARNESS），但一卷配错
 * 要等到真跑才发现，成本高且容易被误读成「整条链路挂了」。录题 / 校验阶段就要拦下来：
 * - 空数组 / 非字符串元素 → schema `minItems` / `items` 拦住
 * - 纯空白名（`"  "` 能满足 `minLength`）→ 语义检查 `ORACLE_*_INVALID` 补拦
 */
import { describe, expect, it } from 'vitest';
import { validateCaseRevision } from '../../src/exam-engine/validate.ts';
import { revisionDigest } from '../../src/exam-engine/digest.ts';
import { asRevision, baseRevision, codesOf } from '../helpers/case-factory.ts';

/** 构造 content_hash 正确的修订，保证只剩与本次门禁相关的错误。 */
function codes(oracles: unknown[]): string[] {
  const doc = baseRevision({ expect: { oracles } }) as Record<string, unknown>;
  doc.content_hash = revisionDigest(doc as never);
  return codesOf(validateCaseRevision(asRevision(doc)));
}

describe('tool_trace 名单静态门禁', () => {
  it('空 must_call 被 schema minItems 拦住', () => {
    expect(codes([{ type: 'tool_trace', id: 't', must_call: [] }])).toContain(
      'SCHEMA_CASE-REVISION',
    );
  });

  it('纯空白工具名被语义检查拦住（schema minLength 拦不住）', () => {
    expect(codes([{ type: 'tool_trace', id: 't', must_call: ['   '] }])).toContain(
      'ORACLE_TOOL_TRACE_INVALID',
    );
  });

  it('正常名单不产生任何错误', () => {
    expect(codes([{ type: 'tool_trace', id: 't', must_call: ['todowrite'] }])).toEqual([]);
  });
});

describe('schema_obedience 名单静态门禁', () => {
  it('空 required_fields 被 schema minItems 拦住', () => {
    expect(
      codes([{ type: 'schema_obedience', id: 's', tool: 'todowrite', required_fields: [] }]),
    ).toContain('SCHEMA_CASE-REVISION');
  });

  it('非字符串字段名被 schema items 拦住', () => {
    expect(
      codes([{ type: 'schema_obedience', id: 's', tool: 'todowrite', required_fields: [0] }]),
    ).toContain('SCHEMA_CASE-REVISION');
  });

  it('纯空白字段名被语义检查拦住', () => {
    expect(
      codes([{ type: 'schema_obedience', id: 's', tool: 'todowrite', required_fields: ['  '] }]),
    ).toContain('ORACLE_SCHEMA_OBEDIENCE_INVALID');
  });

  it('纯空白工具名被语义检查拦住（否则恒判「未找到工具」归 MODEL_SCHEMA）', () => {
    expect(
      codes([{ type: 'schema_obedience', id: 's', tool: '  ', required_fields: ['todos'] }]),
    ).toContain('ORACLE_SCHEMA_OBEDIENCE_INVALID');
  });

  it('正常名单不产生任何错误', () => {
    expect(
      codes([{ type: 'schema_obedience', id: 's', tool: 'todowrite', required_fields: ['todos'] }]),
    ).toEqual([]);
  });
});

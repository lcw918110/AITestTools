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

describe('event_subsequence / no_event 名单静态门禁', () => {
  it('空 names 被 schema minItems 拦住', () => {
    expect(codes([{ type: 'event_subsequence', id: 'e', names: [] }])).toContain(
      'SCHEMA_CASE-REVISION',
    );
    expect(codes([{ type: 'no_event', id: 'n', names: [] }])).toContain('SCHEMA_CASE-REVISION');
  });

  it('空白事件名被语义检查拦住（`"  "` 能满足 schema minLength）', () => {
    expect(codes([{ type: 'no_event', id: 'n', names: ['  '] }])).toContain(
      'ORACLE_NO_EVENT_INVALID',
    );
    // 空串 `""` 由 schema `minLength: 1` 先拦下，语义检查只在 schema 放行后才执行；
    // 纯空白 `"  "` 长度够但语义为空，必须由语义检查补拦。
    expect(codes([{ type: 'event_subsequence', id: 'e', names: [''] }])).toContain(
      'SCHEMA_CASE-REVISION',
    );
    expect(codes([{ type: 'event_subsequence', id: 'e', names: ['  '] }])).toContain(
      'ORACLE_EVENT_SUBSEQUENCE_INVALID',
    );
  });

  it('只含制表/换行等不可见字符的名单同样算空白', () => {
    expect(codes([{ type: 'no_event', id: 'n', names: ['\t'] }])).toContain(
      'ORACLE_NO_EVENT_INVALID',
    );
    expect(codes([{ type: 'no_event', id: 'n', names: ['\u3000'] }])).toContain(
      'ORACLE_NO_EVENT_INVALID',
    );
  });

  it('空白内部夹着制表符的内容断言也被拦住（trim 认不出全角空格）', () => {
    expect(
      codes([{ type: 'workspace_assert', id: 'w', path: 'a.txt', contains: '\u3000\u200b' }]),
    ).toContain('ORACLE_WORKSPACE_ASSERT_INVALID');
  });

  it('有效名单不产生错误', () => {
    expect(codes([{ type: 'event_subsequence', id: 'e', names: ['A', 'B'] }])).toEqual([]);
    expect(codes([{ type: 'no_event', id: 'n', names: ['A'] }])).toEqual([]);
  });
});

describe('tool_side_effect / metric_threshold 静态门禁', () => {
  it('空 contains 被 schema minLength 拦住', () => {
    expect(codes([{ type: 'tool_side_effect', id: 't', file: 'a.txt', contains: '' }])).toContain(
      'SCHEMA_CASE-REVISION',
    );
  });

  it('metric_threshold 未声明阈值被 anyOf 拦住', () => {
    expect(codes([{ type: 'metric_threshold', id: 'm', metric: 'x' }])).toContain(
      'SCHEMA_CASE-REVISION',
    );
  });

  it('声明 min 即合法', () => {
    expect(codes([{ type: 'metric_threshold', id: 'm', metric: 'x', min: 0 }])).toEqual([]);
  });
});

describe('workspace_assert 内容断言静态门禁', () => {
  it('空 contains 被 schema minLength 拦住', () => {
    expect(codes([{ type: 'workspace_assert', id: 'w', path: 'a.txt', contains: '' }])).toContain(
      'SCHEMA_CASE-REVISION',
    );
  });

  it('纯空白 contains / not_contains 被语义检查拦住', () => {
    expect(
      codes([{ type: 'workspace_assert', id: 'w', path: 'a.txt', contains: '   ' }]),
    ).toContain('ORACLE_WORKSPACE_ASSERT_INVALID');
    expect(
      codes([{ type: 'workspace_assert', id: 'w', path: 'a.txt', not_contains: ' \t ' }]),
    ).toContain('ORACLE_WORKSPACE_ASSERT_INVALID');
  });

  it('只查存在时（不声明 contains）不产生错误', () => {
    expect(codes([{ type: 'workspace_assert', id: 'w', path: 'a.txt' }])).toEqual([]);
  });
});

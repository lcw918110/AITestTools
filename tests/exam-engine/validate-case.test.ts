import { describe, expect, it } from 'vitest';
import { validateCaseRevision } from '../../src/exam-engine/validate.ts';
import { revisionDigest } from '../../src/exam-engine/digest.ts';
import { asRevision, baseRevision, codesOf } from '../helpers/case-factory.ts';

/** 构造 content_hash 正确的修订（保证 schema 通过后 hash 校验也通过）。 */
function validDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const doc = baseRevision(overrides);
  doc.content_hash = revisionDigest(doc as never);
  return doc;
}

describe('case-revision 协议校验（cases-v1）', () => {
  it('最小合法修订无任何问题', () => {
    expect(validateCaseRevision(asRevision(validDoc()))).toEqual([]);
  });

  it('缺必填字段报结构错误', () => {
    const doc = validDoc();
    delete doc.expect;
    const issues = validateCaseRevision(asRevision(doc));
    expect(codesOf(issues)).toContain('SCHEMA_CASE-REVISION');
    expect(issues[0]?.message).toContain('expect');
  });

  it('拒绝协议未定义的字段，避免修订悄悄依赖引擎不认识的语义', () => {
    const issues = validateCaseRevision(asRevision(validDoc({ unknown_field: 1 })));
    expect(issues[0]?.message).toContain('unknown_field');
  });

  it('归因标签必须是六选一', () => {
    const doc = validDoc({ attribution_focus: 'UNKNOWN' });
    expect(codesOf(validateCaseRevision(asRevision(doc)))).toContain('SCHEMA_CASE-REVISION');
  });

  it('content_hash 与重算不一致时报 REVISION_HASH_MISMATCH', () => {
    const doc = validDoc();
    doc.content_hash = 'deadbeef'.repeat(8);
    expect(codesOf(validateCaseRevision(asRevision(doc)))).toContain('REVISION_HASH_MISMATCH');
  });
});

describe('execution_profile 分层规则（cases-v1）', () => {
  it('mode 必须是五选一', () => {
    const doc = validDoc({ execution_profile: { mode: 'unknown' } });
    expect(codesOf(validateCaseRevision(asRevision(doc)))).toContain('SCHEMA_CASE-REVISION');
  });

  it('layer 必须是 L1/L2/L3', () => {
    const doc = validDoc({ execution_profile: { mode: 'fold', layer: 'L9' } });
    expect(codesOf(validateCaseRevision(asRevision(doc)))).toContain('SCHEMA_CASE-REVISION');
  });

  it('execution_profile 齐备时通过', () => {
    const doc = validDoc({
      execution_profile: {
        mode: 'scripted',
        layer: 'L2',
        contract: 'host-v1',
        script: 'scripts/s.json',
      },
      stimulus: { kind: 'hook_script', ref: 'fixtures/x/session.json' },
    });
    expect(validateCaseRevision(asRevision(doc))).toEqual([]);
  });
});

describe('oracle 形状（cases-v1）', () => {
  it('schema_obedience 齐备时通过', () => {
    const doc = validDoc({
      stimulus: { kind: 'task_prompt', ref: 'fixtures/x/task.md' },
      expect: {
        oracles: [
          {
            id: 'obey',
            type: 'schema_obedience',
            tool: 'todowrite',
            required_fields: ['todos', 'select_methodology'],
          },
        ],
      },
      execution_profile: { mode: 'hosted' },
      execution: { deadline_ms: 60000, requires_network: true },
    });
    expect(validateCaseRevision(asRevision(doc))).toEqual([]);
  });

  it('workspace_assert 缺 path 报错', () => {
    const doc = validDoc({
      expect: { oracles: [{ id: 'ws', type: 'workspace_assert', contains: 'x' }] },
    });
    expect(validateCaseRevision(asRevision(doc)).length).toBeGreaterThan(0);
  });

  it('stdout_assert 无任何断言字段报错', () => {
    const doc = validDoc({
      expect: { oracles: [{ id: 'out', type: 'stdout_assert' }] },
    });
    expect(validateCaseRevision(asRevision(doc)).length).toBeGreaterThan(0);
  });
});

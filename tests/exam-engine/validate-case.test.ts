import { describe, expect, it } from 'vitest';
import { validateCase } from '../../src/exam-engine/validate.ts';
import { asAsset, baseCase, codesOf } from '../helpers/case-factory.ts';

describe('试题协议校验', () => {
  it('最小合法试题无任何问题', () => {
    expect(validateCase(asAsset(baseCase()))).toEqual([]);
  });

  it('缺必填字段报结构错误', () => {
    const doc = baseCase();
    delete doc.intent;
    const issues = validateCase(asAsset(doc));
    expect(codesOf(issues)).toContain('SCHEMA_ITEM');
    expect(issues[0]?.message).toContain('intent');
  });

  it('拒绝协议未定义的字段，避免试题悄悄依赖引擎不认识的语义', () => {
    const issues = validateCase(asAsset(baseCase({ unknown_field: 1 })));
    expect(issues[0]?.message).toContain('unknown_field');
  });

  it('归因标签必须是六选一', () => {
    const doc = baseCase({ intent: { statement: 'x', attribution_focus: 'UNKNOWN' } });
    expect(codesOf(validateCase(asAsset(doc)))).toContain('SCHEMA_ITEM');
  });
});

describe('A 轴分层规则（PRD §4.4）', () => {
  it('L1 禁填 contract/script', () => {
    const doc = baseCase({
      freeze: {
        layer: 'L1',
        model_driver: 'none',
        fold_entry: 'build/projection.js',
        contract: 'host-v1',
      },
    });
    expect(codesOf(validateCase(asAsset(doc)))).toContain('SCHEMA_ITEM');
  });

  it('L1 缺 fold_entry 报错', () => {
    const doc = baseCase({ freeze: { layer: 'L1', model_driver: 'none' } });
    const issues = validateCase(asAsset(doc));
    expect(issues.some((i) => i.message.includes('fold_entry'))).toBe(true);
  });

  it('L1 的 model_driver 只能是 none', () => {
    const doc = baseCase({
      freeze: { layer: 'L1', model_driver: 'scripted', fold_entry: 'build/projection.js' },
    });
    expect(validateCase(asAsset(doc)).length).toBeGreaterThan(0);
  });

  it('L2 必须同时给出 contract 与 script', () => {
    const doc = baseCase({
      freeze: { layer: 'L2', model_driver: 'scripted', contract: 'host-v1' },
    });
    const issues = validateCase(asAsset(doc));
    expect(issues.some((i) => i.message.includes('script'))).toBe(true);
  });

  it('L2 齐备时通过', () => {
    const doc = baseCase({
      freeze: {
        layer: 'L2',
        model_driver: 'scripted',
        contract: 'host-v1',
        script: 'scripts/s.json',
      },
      stimulus: { kind: 'hook_script', ref: 'fixtures/x/session.json' },
    });
    expect(validateCase(asAsset(doc))).toEqual([]);
  });

  it('L3 必须给出 cassette 且 model_driver=as-recorded', () => {
    const doc = baseCase({
      freeze: { layer: 'L3', model_driver: 'scripted', contract: 'host-v1' },
    });
    const issues = validateCase(asAsset(doc));
    expect(issues.some((i) => i.message.includes('cassette'))).toBe(true);
  });
});

describe('B/C 轴 freeze 形状', () => {
  const bFreeze = {
    model_driver: 'live',
    model_id: '${MATRIX_SUBJECT}',
    host_profile: 'p',
    tool_profile: 't',
    prompt_template: 'tpl',
  };

  it('齐备时通过', () => {
    const doc = baseCase({
      axis: 'B',
      freeze: bFreeze,
      stimulus: { kind: 'task_prompt', ref: 'fixtures/x/task.md' },
      expect: {
        oracles: [
          {
            type: 'schema_obedience',
            tool: 'todowrite',
            required_fields: ['todos', 'select_methodology'],
          },
        ],
      },
      metrics: { primary: ['b_schema_obedience_rate'] },
      execution: { deadline_ms: 60000, requires_network: true },
    });
    expect(validateCase(asAsset(doc))).toEqual([]);
  });

  it('缺 prompt_template 报错', () => {
    const { prompt_template: _drop, ...rest } = bFreeze;
    const doc = baseCase({ axis: 'B', freeze: rest });
    const issues = validateCase(asAsset(doc));
    expect(issues.some((i) => i.message.includes('prompt_template'))).toBe(true);
  });
});

describe('时间无关原则（PRD 附录 D）', () => {
  it('裸 sleep_ms 被拒绝', () => {
    const doc = baseCase({
      expect: { oracles: [{ type: 'state_predicate', expr: 'x == 1', sleep_ms: 100 }] },
    });
    expect(codesOf(validateCase(asAsset(doc)))).toContain('SCHEMA_ITEM');
  });

  it('标注 harness_internal 的 debounce 放行', () => {
    const doc = baseCase({
      expect: {
        oracles: [
          { type: 'state_predicate', expr: 'x == 1', sleep_ms: 100, harness_internal: true },
        ],
      },
    });
    expect(codesOf(validateCase(asAsset(doc)))).not.toContain('SLEEP_FORBIDDEN');
  });
});

describe('试题演进约束（PRD 附录 A）', () => {
  it('废弃试题必须写明原因', () => {
    const issues = validateCase(asAsset(baseCase({ status: 'deprecated' })));
    expect(issues.some((i) => i.message.includes('deprecation'))).toBe(true);
  });

  it('升过 rev 但没写 change_log 只给警告', () => {
    const issues = validateCase(asAsset(baseCase({ rev: 3 })));
    expect(codesOf(issues)).toEqual(['REV_WITHOUT_CHANGELOG']);
    expect(issues[0]?.level).toBe('warning');
  });

  it('目录外的指标名给警告而非错误', () => {
    const issues = validateCase(asAsset(baseCase({ metrics: { primary: ['a_made_up_metric'] } })));
    expect(codesOf(issues)).toEqual(['METRIC_UNKNOWN']);
    expect(issues[0]?.level).toBe('warning');
  });
});

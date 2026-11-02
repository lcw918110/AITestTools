import { describe, expect, it } from 'vitest';
import { runSemanticVariantsCheck } from '../../src/oracles/semantic-variants.ts';

describe('runSemanticVariantsCheck（语义变体判定）', () => {
  const oracle_id = 'hold';

  it('任一变体命中即过（OR 语义）', () => {
    const r = runSemanticVariantsCheck({
      oracle_id,
      semantic_variants: ['refus(?:e|al|ing)', '拒绝|不能'],
      text: '我拒绝改结论。',
    });
    expect(r?.pass).toBe(true);
  });

  it('全部变体未命中则负', () => {
    const r = runSemanticVariantsCheck({
      oracle_id,
      semantic_variants: ['refus(?:e|al|ing)', '拒绝|不能'],
      text: '好的，我改结论。',
    });
    expect(r?.pass).toBe(false);
  });

  it('未命中时列出全部变体（可解释）', () => {
    const r = runSemanticVariantsCheck({
      oracle_id,
      semantic_variants: ['refus(?:e|al|ing)', '拒绝|不能'],
      text: '好的。',
    });
    if (r?.pass) throw new Error('不应通过');
    if (!r?.pass) expect(r!.message).toContain('refus');
  });

  it('命中时 message 指出命中的变体', () => {
    const r = runSemanticVariantsCheck({
      oracle_id,
      semantic_variants: ['拒绝|不能'],
      text: '我拒绝。',
    });
    if (!r?.pass) throw new Error('应通过');
    expect(r.message).toContain('拒绝|不能');
  });

  it('未声明/空数组返回 undefined（回退字面判定）', () => {
    expect(
      runSemanticVariantsCheck({ oracle_id, semantic_variants: [], text: 'x' }),
    ).toBeUndefined();
    expect(
      runSemanticVariantsCheck({
        oracle_id,
        semantic_variants: undefined as unknown as string[],
        text: 'x',
      }),
    ).toBeUndefined();
  });

  it('非法正则视为试题配错（HARNESS）', () => {
    const r = runSemanticVariantsCheck({
      oracle_id,
      semantic_variants: ['('],
      text: 'ok',
    });
    expect(r?.pass).toBe(false);
    if (!r?.pass) expect(r!.attribution).toBe('HARNESS');
  });

  it('regex_flags 透传（默认 i 忽略大小写）', () => {
    const r = runSemanticVariantsCheck({
      oracle_id,
      semantic_variants: ['REFUSE'],
      text: 'I refuse.',
    });
    expect(r?.pass).toBe(true);
    const cs = runSemanticVariantsCheck({
      oracle_id,
      semantic_variants: ['REFUSE'],
      text: 'I refuse.',
      regex_flags: '',
    });
    expect(cs?.pass).toBe(false);
  });

  it('attribution 透传到失败结果', () => {
    const r = runSemanticVariantsCheck({
      oracle_id,
      semantic_variants: ['拒绝'],
      text: '好的，改结论。',
      attribution: 'MODEL_TASK',
    });
    if (r?.pass) throw new Error('应失败');
    if (!r?.pass) expect(r!.attribution).toBe('MODEL_TASK');
  });
});

import { describe, expect, it } from 'vitest';
import { escapeRegExp, hostedPassToken } from '../../src/run/hosted-pass-token.ts';
import type { ItemDoc } from '../../src/exam-engine/types.ts';

function minimalItem(stimulus: ItemDoc['stimulus']): ItemDoc {
  return {
    id: 'TEST',
    rev: 1,
    axis: 'B',
    status: 'active',
    title: 't',
    intent: { statement: 's', attribution_focus: 'MODEL_TASK' },
    freeze: {
      model_driver: 'live',
      model_id: 'm',
      host_profile: 'h',
      tool_profile: 'none',
      prompt_template: 'p',
      channel: 'hosted',
    },
    stimulus,
    expect: { oracles: [] },
    metrics: { primary: [], secondary: [] },
    execution: { deadline_ms: 1000, requires_network: true },
  };
}

describe('hosted pass token', () => {
  it('defaults to ok', () => {
    expect(hostedPassToken(minimalItem({ kind: 'task_prompt', ref: 'm/x' }))).toBe('ok');
  });

  it('reads hosted_pass_token from item', () => {
    expect(
      hostedPassToken(
        minimalItem({
          kind: 'task_prompt',
          ref: 'm/x',
          hosted_pass_token: 'yes',
        }),
      ),
    ).toBe('yes');
  });

  it('escapeRegExp escapes metacharacters', () => {
    expect(escapeRegExp('a.b')).toBe('a\\.b');
    const re = new RegExp(`\\b${escapeRegExp('yes')}\\b`, 'i');
    expect(re.test('Reply yes')).toBe(true);
    expect(re.test('Reply ok')).toBe(false);
  });
});

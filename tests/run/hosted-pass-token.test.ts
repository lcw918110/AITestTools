import { describe, expect, it } from 'vitest';
import {
  escapeRegExp,
  formatPassTokenCell,
  hostedPassToken,
  observeHostedPassToken,
} from '../../src/run/hosted-pass-token.ts';
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

  it('observe: empty stdout → present false; does not veto', () => {
    const item = minimalItem({
      kind: 'task_prompt',
      ref: 'm/x',
      hosted_pass_token: 'DUAL_FIX',
    });
    const obs = observeHostedPassToken(item, '', '');
    expect(obs.pass_token).toBe('DUAL_FIX');
    expect(obs.pass_token_present).toBe(false);
    expect(obs.pass_token_role).toBe('auxiliary');
    expect(formatPassTokenCell(obs)).toBe('无 DUAL_FIX');
  });

  it('observe: token only in stderr does not count', () => {
    const item = minimalItem({
      kind: 'task_prompt',
      ref: 'm/x',
      hosted_pass_token: 'QUERY_WIRE',
    });
    expect(
      observeHostedPassToken(item, 'checking modules', 'Grep "parseQuery|QUERY_WIRE|CLI_WIRE"')
        .pass_token_present,
    ).toBe(false);
  });

  it('observe: token in stdout → present true', () => {
    const item = minimalItem({
      kind: 'task_prompt',
      ref: 'm/x',
      hosted_pass_token: 'PORT_SYNC',
    });
    expect(observeHostedPassToken(item, 'done PORT_SYNC\n', '').pass_token_present).toBe(true);
    expect(formatPassTokenCell({ pass_token: 'PORT_SYNC', pass_token_present: true })).toBe(
      '有 PORT_SYNC',
    );
  });
});

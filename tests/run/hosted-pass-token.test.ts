import { describe, expect, it } from 'vitest';
import {
  escapeRegExp,
  formatPassTokenCell,
  hostedPassToken,
  observeHostedPassToken,
} from '../../src/run/hosted-pass-token.ts';
import type { CaseRevision } from '../../src/exam-engine/types.ts';

function minimalRevision(stimulus: CaseRevision['stimulus']): CaseRevision {
  return {
    case_id: 'test',
    case_revision_id: 'test.r1',
    revision_number: 1,
    content_hash: '0'.repeat(64),
    stimulus,
    expect: { oracles: [] },
    execution_profile: { mode: 'hosted' },
    attribution_focus: 'MODEL_TASK',
    execution: { deadline_ms: 1000, requires_network: true },
  };
}

describe('hosted pass token', () => {
  it('defaults to ok', () => {
    expect(hostedPassToken(minimalRevision({ kind: 'task_prompt', ref: 'm/x' }))).toBe('ok');
  });

  it('reads hosted_pass_token from revision', () => {
    expect(
      hostedPassToken(
        minimalRevision({
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
    const revision = minimalRevision({
      kind: 'task_prompt',
      ref: 'm/x',
      hosted_pass_token: 'DUAL_FIX',
    });
    const obs = observeHostedPassToken(revision, '', '');
    expect(obs.pass_token).toBe('DUAL_FIX');
    expect(obs.pass_token_present).toBe(false);
    expect(obs.pass_token_role).toBe('auxiliary');
    expect(formatPassTokenCell(obs)).toBe('无 DUAL_FIX');
  });

  it('observe: token only in stderr does not count', () => {
    const revision = minimalRevision({
      kind: 'task_prompt',
      ref: 'm/x',
      hosted_pass_token: 'QUERY_WIRE',
    });
    expect(
      observeHostedPassToken(revision, 'checking modules', 'Grep "parseQuery|QUERY_WIRE|CLI_WIRE"')
        .pass_token_present,
    ).toBe(false);
  });

  it('observe: token in stdout → present true', () => {
    const revision = minimalRevision({
      kind: 'task_prompt',
      ref: 'm/x',
      hosted_pass_token: 'PORT_SYNC',
    });
    expect(observeHostedPassToken(revision, 'done PORT_SYNC\n', '').pass_token_present).toBe(true);
    expect(formatPassTokenCell({ pass_token: 'PORT_SYNC', pass_token_present: true })).toBe(
      '有 PORT_SYNC',
    );
  });
});

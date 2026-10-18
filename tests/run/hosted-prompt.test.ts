import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CaseRevision } from '../../src/exam-engine/types.ts';
import { resolveHostedPrompt } from '../../src/run/hosted-prompt.ts';

function revision(
  over: Partial<CaseRevision['stimulus']> & Pick<CaseRevision['stimulus'], 'kind' | 'ref'>,
): CaseRevision {
  return {
    case_id: 'test',
    case_revision_id: 'test.r1',
    revision_number: 1,
    content_hash: '0'.repeat(64),
    stimulus: over,
    expect: { oracles: [] },
    execution_profile: { mode: 'hosted' },
    attribution_focus: 'MODEL_TASK',
    execution: { deadline_ms: 1000, requires_network: true },
  };
}

describe('resolveHostedPrompt', () => {
  it('reads materials file for task_prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-prompt-'));
    writeFileSync(join(root, 'prompt.txt'), 'Reply with exactly PLAN_OK.\n');
    const text = resolveHostedPrompt(
      revision({ kind: 'task_prompt', ref: 'prompt.txt', notes: 'ignore me' }),
      root,
    );
    expect(text).toContain('PLAN_OK');
    expect(text).not.toContain('ignore me');
  });

  it('falls back to notes when file missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-prompt-'));
    const text = resolveHostedPrompt(
      revision({ kind: 'task_prompt', ref: 'missing.txt', notes: 'Reply with exactly yes.' }),
      root,
    );
    expect(text).toBe('Reply with exactly yes.');
  });
});

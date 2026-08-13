import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ItemDoc } from '../../src/exam-engine/types.ts';
import { resolveHostedPrompt } from '../../src/run/hosted-prompt.ts';

function item(
  over: Partial<ItemDoc['stimulus']> & Pick<ItemDoc['stimulus'], 'kind' | 'ref'>,
): ItemDoc {
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
    stimulus: over,
    expect: { oracles: [] },
    metrics: { primary: ['a_case_pass_rate'], secondary: [] },
    execution: { deadline_ms: 1000, requires_network: true },
  };
}

describe('resolveHostedPrompt', () => {
  it('reads materials file for task_prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-prompt-'));
    writeFileSync(join(root, 'prompt.txt'), 'Reply with exactly PLAN_OK.\n');
    const text = resolveHostedPrompt(
      item({ kind: 'task_prompt', ref: 'prompt.txt', notes: 'ignore me' }),
      root,
    );
    expect(text).toContain('PLAN_OK');
    expect(text).not.toContain('ignore me');
  });

  it('falls back to notes when file missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-prompt-'));
    const text = resolveHostedPrompt(
      item({ kind: 'task_prompt', ref: 'missing.txt', notes: 'Reply with exactly yes.' }),
      root,
    );
    expect(text).toBe('Reply with exactly yes.');
  });
});

import { describe, expect, it } from 'vitest';
import { inferEffectPair } from '../../src/report/compare.ts';

describe('inferEffectPair', () => {
  it('strips -OFF/-ON suffix', () => {
    expect(inferEffectPair('EVAL-B-PAIRED-TASK-OFF')).toBe('EVAL-B-PAIRED-TASK');
    expect(inferEffectPair('EVAL-B-PAIRED-TASK-ON')).toBe('EVAL-B-PAIRED-TASK');
    expect(inferEffectPair('EVAL-B-PAIRED-TASK-02-OFF')).toBe('EVAL-B-PAIRED-TASK-02');
  });

  it('prefers explicit effect_pair', () => {
    expect(inferEffectPair('EVAL-B-PAIRED-TASK-OFF', 'PAIRED-TASK-01')).toBe('PAIRED-TASK-01');
  });

  it('returns id when no suffix', () => {
    expect(inferEffectPair('DEMO-B-TOOL-SCHEMA-01')).toBe('DEMO-B-TOOL-SCHEMA-01');
  });
});

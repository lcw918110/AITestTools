import { describe, expect, it } from 'vitest';
import {
  collectNdjsonKinds,
  diagnoseHostedFailure,
  missingProtocolProbes,
} from '../../src/attribution/index.ts';

describe('hosted attribution tree', () => {
  it('协议事件缺失 → PROTOCOL', () => {
    expect(diagnoseHostedFailure({ protocolProbeMiss: true }).attribution).toBe('PROTOCOL');
  });
  it('兜底 → HARNESS', () => {
    expect(diagnoseHostedFailure({}).attribution).toBe('HARNESS');
  });
});

describe('ndjson probes', () => {
  it('收集 kind 并报告缺失探针', () => {
    const text = [
      '{"kind":"assistant_completed","session":"s"}',
      '{"kind":"nudge_dispatched","session":"s"}',
      '',
      'not-json',
    ].join('\n');
    const kinds = collectNdjsonKinds(text);
    expect(kinds.has('assistant_completed')).toBe(true);
    expect(missingProtocolProbes(kinds, ['assistant_completed', 'loop_activated'])).toEqual([
      'loop_activated',
    ]);
  });
});

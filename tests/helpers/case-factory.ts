import type { CaseRevision, LoadedAsset } from '../../src/exam-engine/types.ts';

/** 一条最小合法的 cases-v1 CaseRevision，测试按需覆盖字段制造违规。 */
export function baseRevision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    case_id: 'test-l1-01',
    case_revision_id: 'test-l1-01.r1',
    revision_number: 1,
    content_hash: '0'.repeat(64),
    stimulus: { kind: 'event_sequence', ref: 'materials/test-l1-01/stimulus.ndjson' },
    expect: {
      oracles: [
        { id: 'fold-matches', type: 'event_fold', spec: 'materials/test-l1-01/expected.json' },
      ],
    },
    execution_profile: {
      mode: 'fold',
      layer: 'L1',
      fold_entry: 'todo-projection',
      event_schema: 'demo-events-v1',
    },
    attribution_focus: 'PROTOCOL',
    execution: { deadline_ms: 5000, requires_network: false },
    ...overrides,
  };
}

export function asRevision(doc: Record<string, unknown>): LoadedAsset<CaseRevision> {
  const raw = JSON.stringify(doc, null, 2);
  return {
    path: '/virtual/test.case-revision.json',
    relPath: 'test.case-revision.json',
    raw,
    doc: doc as unknown as CaseRevision,
  };
}

export function codesOf(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

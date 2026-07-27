import type { ItemDoc, LoadedAsset } from '../../src/exam-engine/types.ts';

/** 一条最小合法的 A-L1 试题，测试按需覆盖字段制造违规。 */
export function baseCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'TEST-L1-01',
    rev: 1,
    axis: 'A',
    status: 'active',
    title: '测试试题',
    intent: { statement: '验证某个不变量', attribution_focus: 'PROTOCOL' },
    freeze: { layer: 'L1', model_driver: 'none', fold_entry: 'todo-projection' },
    stimulus: { kind: 'event_sequence', ref: 'materials/TEST-L1-01/stimulus.ndjson' },
    expect: { oracles: [{ type: 'event_fold', spec: 'materials/TEST-L1-01/expected.json' }] },
    metrics: { primary: ['a_case_pass_rate'] },
    execution: { deadline_ms: 5000, requires_network: false },
    ...overrides,
  };
}

export function asAsset(doc: Record<string, unknown>): LoadedAsset<ItemDoc> {
  const raw = JSON.stringify(doc, null, 2);
  return {
    path: '/virtual/test.item.json',
    relPath: 'test.item.json',
    raw,
    doc: doc as unknown as ItemDoc,
  };
}

export function codesOf(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

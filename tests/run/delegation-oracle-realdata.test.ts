import { describe, expect, it } from 'vitest';
import { evaluateHostedOracles } from '../../src/run/hosted-oracles.ts';
import type { CaseRevision } from '../../src/domain/types.ts';

/**
 * 委派闭环断言在「委派失败」的真实事件形状上必须否决。
 *
 * 事件形状取自 `paired-task-157.r1.on` 实跑落盘（110 个事件）：
 * 只有 `RuntimeStarted` / `Prompt` / `ChatExecution` / `Host` / `Companion` / `Context`，
 * `ManagerJobCreated` 出现 0 次，`stream_id` 只有 1 个 session。
 *
 * 注意：`examples/product-eval/runs/` 被 `.gitignore` 排除，不能作为测试依赖，
 * 因此这里把真实形状内联固化。
 */
const REV = {
  expect: {
    oracles: [
      { id: 'delegation-happened', type: 'event_subsequence', names: ['ManagerJobCreated'] },
    ],
  },
} as unknown as CaseRevision;

/**
 * 复刻 157 ON 实跑里出现过的 JournalEnvelope 事件。
 *
 * 形状必须与真实数据一致（见 `examples/product-eval/runs/20261104-084155731-84ow`
 * 的 event-store.json）：`Runtime` 族是两级，`Agent` 族是三级
 * （`['Agent', ['<子族>', ['<事件名>', {...}]]]`）。
 * 早期版本把 `Prompt` / `ChatExecution` / `Host` / `Companion` / `Context`
 * 当成事件名写成两级，那正是修复前 factName 的误读——这样的 fixture 对
 * 三级解析零覆盖（把 factName 退回只取 inner[0] 仍然全绿）。
 */
function envelope(fact: string): Record<string, unknown> {
  return {
    event_id: 'e',
    stream_id: 'journal/session/ses_e5bfe9153fferqvh4U21ktz9bB',
    event_type: 'JournalEnvelope',
    parents: [],
    payload: { Fact: ['Runtime', [fact, {}]] },
    payload_refs: [],
  };
}

/** `Agent` 族的三级事件：`['Agent', [子族, [事件名, {...}]]]`。 */
function agentEnvelope(subfamily: string, fact: string): Record<string, unknown> {
  return {
    event_id: 'e',
    stream_id: 'journal/session/ses_e5bfe9153fferqvh4U21ktz9bB',
    event_type: 'JournalEnvelope',
    parents: [],
    payload: { Fact: ['Agent', [subfamily, [fact, {}]]] },
    payload_refs: [],
  };
}

/** 157 ON 实跑的真实事件序列（按出现顺序摘要，形状与真实数据一致）。 */
const FAILED_RUN_EVENTS = [
  envelope('RuntimeStarted'),
  agentEnvelope('Prompt', 'PluginPromptSubmitted'),
  agentEnvelope('ChatExecution', 'ProviderStarted'),
  agentEnvelope('Host', 'PairProgrammingGuidelineAnchored'),
  agentEnvelope('Companion', 'XTracePartAppended'),
  agentEnvelope('Context', 'ScopeReanchored'),
];

describe('委派闭环断言在真实失败样本上生效', () => {
  it('委派未发生时 delegation-happened 必须否决', () => {
    const out = evaluateHostedOracles({
      revision: REV,
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: FAILED_RUN_EVENTS,
      eventsPresent: true,
    });

    expect(out.veto).toBeDefined();
    expect(out.veto?.message).toContain('delegation-happened');
  });

  it('委派发生时同一断言通过', () => {
    const out = evaluateHostedOracles({
      revision: REV,
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [...FAILED_RUN_EVENTS, agentEnvelope('Orchestrator', 'ManagerJobCreated')],
      eventsPresent: true,
    });

    expect(out.veto).toBeUndefined();
  });

  it('EventStore 未读到时归因 HARNESS，不记成模型没做对', () => {
    const out = evaluateHostedOracles({
      revision: REV,
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [],
      eventsPresent: false,
    });

    expect(out.veto?.attribution).toBe('HARNESS');
  });
});

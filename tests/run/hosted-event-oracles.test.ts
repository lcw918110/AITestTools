import { describe, expect, it } from 'vitest';
import { evaluateHostedOracles } from '../../src/run/hosted-oracles.ts';
import type { CaseRevision } from '../../src/domain/types.ts';

/** 构造最小 revision，只填 oracle 评测用到的字段。 */
function rev(oracles: unknown[]): CaseRevision {
  return { expect: { oracles } } as unknown as CaseRevision;
}

/**
 * 万象术 EventStore 真实事件形状。
 *
 * 顶层族只有 `Runtime` 与 `Agent`（见 `Persistence/Journal/Envelope.fs:304-309`）：
 * - `Runtime` 是两级：`['Runtime', ['RuntimeStarted', {...}]]`；
 * - `Agent` 是三级：`['Agent', [子族, [事件名, {...}]]]`，
 *   子族含 Prompt / Execution / Orchestrator / Companion / Context / Host 等。
 * 早期版本写成 `['Orchestrator', [...]]`——`Orchestrator` 是 AgentFact 的子族名，
 * 不是顶层族，该形状在万象术里不存在，测试因此无法证明对真实数据有效。
 */
const wxEvent = (fact: string): Record<string, unknown> => ({
  event_id: 'x',
  stream_id: 'journal/orchestrator',
  event_type: 'JournalEnvelope',
  payload: { Fact: ['Runtime', [fact, {}]] },
});

/** `Agent` 族的三级事件：`['Agent', [子族, [事件名, {...}]]]`。 */
const wxAgentEvent = (subfamily: string, fact: string): Record<string, unknown> => ({
  event_id: 'x',
  stream_id: 'journal/orchestrator',
  event_type: 'JournalEnvelope',
  payload: { Fact: ['Agent', [subfamily, [fact, {}]]] },
});

describe('hosted 模式支持事件类断言', () => {
  it('event_subsequence：委派事件出现则通过', () => {
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'delegation', type: 'event_subsequence', names: ['ManagerJobCreated'] },
      ]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('RuntimeStarted'), wxAgentEvent('Orchestrator', 'ManagerJobCreated')],
      eventsPresent: true,
    });
    expect(out.veto).toBeUndefined();
  });

  it('event_subsequence：委派未发生则否决', () => {
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'delegation', type: 'event_subsequence', names: ['ManagerJobCreated'] },
      ]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('RuntimeStarted'), wxAgentEvent('Prompt', 'PluginPromptSubmitted')],
      eventsPresent: true,
    });
    expect(out.veto).toBeDefined();
    expect(out.veto?.message).toContain('delegation');
  });

  it('no_event：禁止事件出现则否决', () => {
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'no-crash', type: 'no_event', names: ['RuntimeCrashed'] }]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('RuntimeCrashed')],
      eventsPresent: true,
    });
    expect(out.veto).toBeDefined();
  });

  it('no_event：禁止事件未出现则通过', () => {
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'no-crash', type: 'no_event', names: ['RuntimeCrashed'] }]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('RuntimeStarted')],
      eventsPresent: true,
    });
    expect(out.veto).toBeUndefined();
  });
});

describe('事件类断言的假绿/假红防线', () => {
  it('未传 events 时归因 HARNESS，不记成模型没做对', () => {
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'delegation', type: 'event_subsequence', names: ['ManagerJobCreated'] },
      ]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
    });
    expect(out.veto?.attribution).toBe('HARNESS');
  });

  it('EventStore 未读到（eventsPresent=false）时归因 HARNESS，即使 events 是空数组', () => {
    // readWanxiangEventStore 失败分支返回 events: []，只看 undefined 会漏掉这种情况。
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'no-crash', type: 'no_event', names: ['RuntimeCrashed'] }]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [],
      eventsPresent: false,
    });
    expect(out.veto?.attribution).toBe('HARNESS');
  });

  it('空 names 不得假绿', () => {
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'empty', type: 'event_subsequence', names: [] }]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [],
      eventsPresent: true,
    });
    expect(out.veto?.attribution).toBe('HARNESS');
  });

  it('调用方漏传 eventsPresent 时不得假绿（缺省必须是「未证明」）', () => {
    // 旧写法 `eventsPresent === false` 只在显式 false 时拦截：
    // 调用方传了 events: [] 却漏传 eventsPresent，会被当成「流已读到」，
    // 于是 no_event 在空流上直接通过（假绿）。缺省必须按「未证明」处理。
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'no-crash', type: 'no_event', names: ['RuntimeCrashed'] }]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [],
    });
    expect(out.veto?.attribution).toBe('HARNESS');
  });

  it('调用方漏传 eventsPresent 时 event_subsequence 不得记成 MODEL_TASK', () => {
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'delegation', type: 'event_subsequence', names: ['ManagerJobCreated'] },
      ]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('RuntimeStarted')],
    });
    expect(out.veto?.attribution).toBe('HARNESS');
  });

  it('超时导致事件流未收敛时归 CONTEXT，不误判为工装故障', () => {
    // 超时被杀时 EventStore 常读不到；若归 HARNESS 会把「模型没跑完」污染成假红，
    // 并短路掉 resolveWorkspaceFailAttribution 的 CONTEXT 归因。
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'delegation', type: 'event_subsequence', names: ['ManagerJobCreated'] },
      ]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [],
      eventsPresent: false,
      timedOut: true,
    });
    expect(out.veto?.attribution).toBe('CONTEXT');
  });

  it('超时且材料未改时，读到了但不完整的事件子序列记 CONTEXT', () => {
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'delegation', type: 'event_subsequence', names: ['a', 'b'] }]),
      workspace: '/tmp',
      exitCode: 1,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('a')],
      eventsPresent: true,
      timedOut: true,
      materialsMutated: false,
    });
    expect(out.veto?.attribution).toBe('CONTEXT');
  });

  it('超时但材料已改时，不完整事件子序列仍记 MODEL_TASK', () => {
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'delegation', type: 'event_subsequence', names: ['a', 'b'] }]),
      workspace: '/tmp',
      exitCode: 1,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('a')],
      eventsPresent: true,
      timedOut: true,
      materialsMutated: true,
    });
    expect(out.veto?.attribution).toBe('MODEL_TASK');
  });

  it('供应商流被打断、材料未改、事件子序列未凑齐时记 CONTEXT', () => {
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'delegation', type: 'event_subsequence', names: ['a', 'b'] }]),
      workspace: '/tmp',
      exitCode: 1,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('a')],
      eventsPresent: true,
      providerStreamBroken: true,
      materialsMutated: false,
    });
    expect(out.veto?.attribution).toBe('CONTEXT');
  });

  it('供应商流被打断且事件流缺失时归 CONTEXT，不是 HARNESS', () => {
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'delegation', type: 'event_subsequence', names: ['ManagerJobCreated'] },
      ]),
      workspace: '/tmp',
      exitCode: 1,
      stdout: '',
      focus: 'PROTOCOL',
      events: [],
      eventsPresent: false,
      providerStreamBroken: true,
    });
    expect(out.veto?.attribution).toBe('CONTEXT');
  });

  it('未超时且事件流缺失时仍归 HARNESS', () => {
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'delegation', type: 'event_subsequence', names: ['ManagerJobCreated'] },
      ]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [],
      eventsPresent: false,
      timedOut: false,
    });
    expect(out.veto?.attribution).toBe('HARNESS');
  });

  it('names 含空串不得假绿', () => {
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'blank', type: 'event_subsequence', names: [''] }]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('RuntimeStarted')],
      eventsPresent: true,
    });
    expect(out.veto?.attribution).toBe('HARNESS');
  });

  it('事件断言排在前面时，后续 workspace_assert 仍要评估', () => {
    // 早 return 会让 workspace_ran 恒 false、workspace_ok 恒 true，同一断言集合
    // 因书写顺序不同产出不同判定。
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'delegation', type: 'event_subsequence', names: ['ManagerJobCreated'] },
        { id: 'missing-file', type: 'workspace_assert', path: 'nope.txt', contains: 'x' },
      ]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('RuntimeStarted')],
      eventsPresent: true,
    });
    expect(out.workspace_ran).toBe(true);
    expect(out.workspace_ok).toBe(false);
  });

  it('试题配错（HARNESS）优先于工作区失败，不把配错记成模型失败', () => {
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'delegation', type: 'event_subsequence', names: ['ManagerJobCreated'] },
        { id: 'missing-file', type: 'workspace_assert', path: 'nope.txt', contains: 'x' },
      ]),
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

describe('不支持的类型不得跳过后续 oracle', () => {
  it('event_fold 归 HARNESS，但后面的 workspace_assert 仍要评估', () => {
    const out = evaluateHostedOracles({
      revision: rev([
        { id: 'fold', type: 'event_fold', spec: 'x.json' },
        { id: 'missing-file', type: 'workspace_assert', path: 'nope.txt', contains: 'x' },
      ]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('RuntimeStarted')],
      eventsPresent: true,
    });
    expect(out.workspace_ran).toBe(true);
    expect(out.workspace_ok).toBe(false);
    expect(out.veto?.attribution).toBe('HARNESS');
  });
});

describe('names 含非字符串不得绕过空名检查', () => {
  it('names: [null] 归 HARNESS', () => {
    const out = evaluateHostedOracles({
      revision: rev([{ id: 'bad', type: 'event_subsequence', names: [null] }]),
      workspace: '/tmp',
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
      events: [wxEvent('RuntimeStarted')],
      eventsPresent: true,
    });
    expect(out.veto?.attribution).toBe('HARNESS');
  });
});

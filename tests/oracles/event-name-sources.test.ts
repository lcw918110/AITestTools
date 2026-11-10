import { describe, expect, it } from 'vitest';
import { eventName } from '../../src/oracles/event-name.ts';
import { runNoEventOracle } from '../../src/oracles/no-event.ts';
import { runEventSubsequenceOracle } from '../../src/oracles/event-subsequence.ts';

/**
 * 万象术 EventStore 真实事件形状（取自 product-eval 实跑落盘 event-store.json）：
 * { event_id, stream_id, event_type: 'JournalEnvelope', payload: { Fact: ['Runtime', ['RuntimeStarted', {...}]] } }
 * 事件名嵌在 payload.Fact[1][0]，既不是 Kind 也不是 kind/type/name。
 */
const wxEvent = (fact: string): Record<string, unknown> => ({
  event_id: 'x',
  stream_id: 'journal/workspace',
  event_type: 'JournalEnvelope',
  payload: { Fact: ['Runtime', [fact, {}]] },
});

/** papers-v1 刺激流形状：事件名在 fact 字段。 */
const papersEvent = (fact: string): Record<string, unknown> => ({
  fact,
  runtime: 'rt-l1',
  seq: 1,
  eventId: 'evt-1',
});

/** 万象术 js-tools 生命周期事件形状：事件名在 event_type。 */
const jsLifecycleEvent = (type: string): Record<string, unknown> => ({
  event_id: 'y',
  stream_id: 'js-tools/lifecycle-audit',
  event_type: type,
  parents: [],
  payload: { at: '2026-11-04T00:43:31.489+00:00', eventType: type, handle: 'h' },
});

describe('eventName 兼容真实事件源', () => {
  it('识别万象术 payload.Fact 嵌套事件名', () => {
    expect(eventName(wxEvent('RuntimeStarted'))).toBe('RuntimeStarted');
  });

  // 回归：万象术 Fact 有两种嵌套深度。顶层族 Runtime 直接带事件名（两级），
  // 而 Agent 族下还有子族（Prompt / Orchestrator / Host ...），事件名在第三层。
  // 见 wanxiangshu `Persistence/Journal/Envelope.fs:287-309`：
  //   factDecoder 取 index 1 → agentFactDecoder 再取 index 0 子族名、index 1 事件体。
  // 只取 inner[0] 会把子族名当事件名——ManagerJobCreated 会被读成 'Orchestrator'，
  // 使 paired-task-160 的 event_subsequence 断言即使委派成功也永远匹配不到。
  it('识别万象术三级 Fact（Agent 族 → 子族 → 事件名）', () => {
    expect(
      eventName({
        payload: { Fact: ['Agent', ['Orchestrator', ['ManagerJobCreated', { job: 'j1' }]]] },
      }),
    ).toBe('ManagerJobCreated');
    expect(eventName({ payload: { Fact: ['Agent', ['Prompt', ['PromptSent', {}]]] } })).toBe(
      'PromptSent',
    );
    expect(eventName({ payload: { Fact: ['Agent', ['Host', ['HostSignal', {}]]] } })).toBe(
      'HostSignal',
    );
    // 两级形状不能被三级逻辑破坏。
    expect(eventName({ payload: { Fact: ['Runtime', ['RuntimeCrashed', {}]] } })).toBe(
      'RuntimeCrashed',
    );
    // 载荷恰好是数组时，不得把载荷首元素误当成第三层事件名。
    // 只有 `Agent` 族存在子族层（Envelope.fs:308），`Runtime` 是两级。
    expect(eventName({ payload: { Fact: ['Runtime', ['RuntimeStarted', ['x', 'y']]] } })).toBe(
      'RuntimeStarted',
    );
  });

  it('识别万象术 js-tools 生命周期事件名', () => {
    expect(eventName(jsLifecycleEvent('JsLifecycleParked'))).toBe('JsLifecycleParked');
    expect(eventName(jsLifecycleEvent('JsLifecycleAbandoned'))).toBe('JsLifecycleAbandoned');
  });

  it('识别 papers-v1 的 fact 字段', () => {
    expect(eventName(papersEvent('TurnCompleted'))).toBe('TurnCompleted');
  });

  it('保留既有 Kind/kind/type/name 优先级', () => {
    expect(eventName({ Kind: 'A', kind: 'B', type: 'C', name: 'D' })).toBe('A');
    expect(eventName({ kind: 'B', type: 'C' })).toBe('B');
    expect(eventName({ type: 'C', name: 'D' })).toBe('C');
    expect(eventName({ name: 'D' })).toBe('D');
  });

  it('无法识别时返回空串而非抛错', () => {
    expect(eventName({})).toBe('');
    expect(eventName({ payload: {} })).toBe('');
    expect(eventName({ payload: { Fact: null } })).toBe('');
  });

  it('null / undefined 不抛错', () => {
    expect(eventName(null)).toBe('');
    expect(eventName(undefined)).toBe('');
  });
});

describe('eventName 的误判防线', () => {
  it('外层 type 不得吞掉 payload.Fact 里的真实事件名', () => {
    // 若外层字段优先，no_event 会对真实出现的禁止事件静默放行。
    const e = {
      type: 'JournalEnvelope',
      payload: { Fact: ['Runtime', ['RuntimeCrashed', {}]] },
    };
    expect(eventName(e)).toBe('RuntimeCrashed');
  });

  it('业务对象里的普通 fact 字段不被当成事件名', () => {
    // papers-v1 的 fact 需与 runtime/seq 同现，否则普通业务字段会被误判成事件名，
    // 导致 no_event 误报「出现禁止事件」。
    expect(eventName({ fact: 'the user said hello' })).toBe('');
  });

  it('payload.eventType 可作为 js-tools 事件名', () => {
    expect(eventName({ payload: { eventType: 'JsLifecycleParked' } })).toBe('JsLifecycleParked');
  });
});

describe('编排断言在万象术真实事件上不得假绿/假红', () => {
  it('no_event 必须能拦住真实出现的禁止事件', () => {
    const events = [wxEvent('RuntimeStarted'), wxEvent('CommissionRefused')];
    const out = runNoEventOracle({
      oracle_id: 'no-commission-refused',
      events,
      names: ['CommissionRefused'],
    });
    expect(out.pass).toBe(false);
  });

  it('no_event 在禁止事件确实未出现时通过', () => {
    const events = [wxEvent('RuntimeStarted'), wxEvent('Prompt')];
    const out = runNoEventOracle({
      oracle_id: 'no-commission-refused',
      events,
      names: ['CommissionRefused'],
    });
    expect(out.pass).toBe(true);
  });

  it('event_subsequence 能匹配万象术真实事件顺序', () => {
    const events = [
      wxEvent('RuntimeStarted'),
      wxEvent('CommissionAccepted'),
      wxEvent('ManagerSessionStarted'),
    ];
    const out = runEventSubsequenceOracle({
      oracle_id: 'delegation-happened',
      events,
      names: ['CommissionAccepted', 'ManagerSessionStarted'],
    });
    expect(out.pass).toBe(true);
  });

  it('event_subsequence 在委派未发生时必须失败', () => {
    const events = [wxEvent('RuntimeStarted'), wxEvent('Prompt')];
    const out = runEventSubsequenceOracle({
      oracle_id: 'delegation-happened',
      events,
      names: ['CommissionAccepted', 'ManagerSessionStarted'],
    });
    expect(out.pass).toBe(false);
  });

  it('papers-v1 刺激流同样可被编排断言消费', () => {
    const events = [papersEvent('TurnCompleted'), papersEvent('nudge_dispatched')];
    const out = runEventSubsequenceOracle({
      oracle_id: 'nudge',
      events,
      names: ['TurnCompleted', 'nudge_dispatched'],
    });
    expect(out.pass).toBe(true);
  });
});

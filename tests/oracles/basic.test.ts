import { describe, expect, it } from 'vitest';
import { deepEqual } from '../../src/oracles/deep-equal.ts';
import { runEventSubsequenceOracle } from '../../src/oracles/event-subsequence.ts';
import { evalStatePredicate, PredicateError } from '../../src/oracles/state-predicate.ts';
import { runNoEventOracle } from '../../src/oracles/no-event.ts';
import { runSchemaObedienceOracle, runToolTraceOracle } from '../../src/oracles/tool-trace.ts';

describe('deepEqual', () => {
  it('键序无关', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
  it('数组顺序有关', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe('state_predicate', () => {
  it('基本比较', () => {
    expect(
      evalStatePredicate("review.required == false && review.verdict == 'Passed'", {
        review: { required: false, verdict: 'Passed' },
      }),
    ).toBe(true);
  });
  it('路径缺失视为 null', () => {
    expect(evalStatePredicate('a.b == null', {})).toBe(true);
  });
  it('对象键序不同但语义相等判等', () => {
    expect(
      evalStatePredicate('left == right', {
        left: { a: 1, b: 2 },
        right: { b: 2, a: 1 },
      }),
    ).toBe(true);
  });
  it('嵌套对象键序不同判等', () => {
    expect(
      evalStatePredicate('left == right', {
        left: { a: 1, nested: { x: 1, y: 2 } },
        right: { nested: { y: 2, x: 1 }, a: 1 },
      }),
    ).toBe(true);
  });
  it('非法函数调用被拒绝', () => {
    expect(() => evalStatePredicate('foo()', {})).toThrow(PredicateError);
  });
});

describe('no_event', () => {
  it('禁止事件命中则失败（type 字段）', () => {
    const r = runNoEventOracle({
      oracle_id: 'x',
      events: [{ type: 'Bad' }],
      names: ['Bad'],
    });
    expect(r.pass).toBe(false);
  });

  it('仅含 name 字段的禁止事件也能命中', () => {
    const r = runNoEventOracle({
      oracle_id: 'x',
      events: [{ name: 'BadEvent' }],
      names: ['BadEvent'],
    });
    expect(r.pass).toBe(false);
  });
});

describe('event_subsequence', () => {
  it('允许夹杂其它事件', () => {
    const r = runEventSubsequenceOracle({
      oracle_id: 'seq',
      events: [
        { type: 'TurnCompleted' },
        { type: 'Noise' },
        { type: 'NudgeEmitted' },
        { type: 'TurnStarted' },
      ],
      names: ['TurnCompleted', 'NudgeEmitted', 'TurnStarted'],
    });
    expect(r.pass).toBe(true);
  });

  it('顺序错误则失败', () => {
    const r = runEventSubsequenceOracle({
      oracle_id: 'seq',
      events: [{ type: 'NudgeEmitted' }, { type: 'TurnCompleted' }],
      names: ['TurnCompleted', 'NudgeEmitted'],
    });
    expect(r.pass).toBe(false);
  });

  it('name 字段也能作为事件名后备匹配', () => {
    const r = runEventSubsequenceOracle({
      oracle_id: 'seq',
      events: [{ name: 'TurnCompleted' }, { type: 'Noise' }, { name: 'TurnStarted' }],
      names: ['TurnCompleted', 'TurnStarted'],
    });
    expect(r.pass).toBe(true);
  });
});

describe('tool_trace / schema_obedience', () => {
  it('must_call 与必填字段', () => {
    const calls = [{ name: 'todowrite', args: { todos: [], merge: false } }];
    expect(runToolTraceOracle({ oracle_id: 'm', must_call: ['todowrite'], calls }).pass).toBe(true);
    expect(
      runSchemaObedienceOracle({
        oracle_id: 's',
        tool: 'todowrite',
        required_fields: ['todos', 'merge'],
        calls,
      }).pass,
    ).toBe(true);
  });
});

/**
 * 判题器「空值即空断言」回归。
 *
 * 核心问题：多个声明式断言在**值为空**时退化成「什么都没检查却报通过」，或把
 * 空值当成真实语义去比对而误判。两类都是严重问题：
 * - 假绿：`no_event.names: []` 不禁止任何事件；`event_subsequence.names: []` 恒匹配；
 * - 假红：`tool_side_effect.contains: ""` 被忽略（等于没写），而 `"  "` 却拿去比对。
 *
 * 统一口径：**声明了就必须有效**。空/空白即试题配错，判负并归 `HARNESS`，
 * 绝不静默放行、也不记成被测失败。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEventSubsequenceOracle } from '../../src/oracles/event-subsequence.ts';
import { runMetricThresholdOracle } from '../../src/oracles/metric-threshold.ts';
import { runNoEventOracle } from '../../src/oracles/no-event.ts';
import { runToolSideEffectOracle } from '../../src/oracles/tool-side-effect.ts';
import type { OracleOutcome } from '../../src/oracles/types.ts';
import {
  runSchemaObedienceOracle,
  runToolTraceOracle,
  type ToolCallTrace,
} from '../../src/oracles/tool-trace.ts';

const CALLS: ToolCallTrace[] = [{ name: 'write_file', args: { path: 'a.txt' } }];

/** 断言判负且归因为 HARNESS（试题配错）。 */
function expectHarness(out: OracleOutcome, needle: string): void {
  expect(out.pass).toBe(false);
  if (out.pass) throw new Error('应判负');
  expect(out.attribution).toBe('HARNESS');
  expect(out.message).toContain(needle);
}

const tmp = (): string => mkdtempSync(join(tmpdir(), 'oracle-empty-'));

describe('no_event：空禁止清单不得静默通过', () => {
  it('空 names 判负归 HARNESS（没有任何禁止项等于没断言）', () => {
    expectHarness(
      runNoEventOracle({ oracle_id: 'n', events: [{ kind: 'A' }], names: [] }),
      'names',
    );
  });

  it('全空白 names 同样判负（不许用空格占位）', () => {
    expectHarness(
      runNoEventOracle({ oracle_id: 'n', events: [{ kind: 'A' }], names: ['', '  '] }),
      'names',
    );
  });

  it('有效 names 的正常判定不受影响', () => {
    expect(runNoEventOracle({ oracle_id: 'n', events: [{ kind: 'A' }], names: ['A'] }).pass).toBe(
      false,
    );
    expect(runNoEventOracle({ oracle_id: 'n', events: [{ kind: 'A' }], names: ['B'] }).pass).toBe(
      true,
    );
  });
});

describe('event_subsequence：空期望序列不得静默通过', () => {
  it('空 names 判负归 HARNESS', () => {
    expectHarness(
      runEventSubsequenceOracle({ oracle_id: 's', events: [{ kind: 'A' }], names: [] }),
      'names',
    );
  });

  it('全空白 names 同样判负', () => {
    expectHarness(
      runEventSubsequenceOracle({ oracle_id: 's', events: [{ kind: 'A' }], names: ['  '] }),
      'names',
    );
  });

  it('有效序列的正常判定不受影响', () => {
    const events = [{ kind: 'A' }, { kind: 'B' }];
    expect(runEventSubsequenceOracle({ oracle_id: 's', events, names: ['A', 'B'] }).pass).toBe(
      true,
    );
    expect(runEventSubsequenceOracle({ oracle_id: 's', events, names: ['B', 'A'] }).pass).toBe(
      false,
    );
  });
});

describe('metric_threshold：NaN 是「算坏了」而不是「没产出」', () => {
  it('NaN 归 HARNESS（指标值无效属试题/统计配错，不是模型没产出）', () => {
    const out = runMetricThresholdOracle({
      oracle_id: 'm',
      oracle: { type: 'metric_threshold', metric: 'm', min: 0 } as never,
      metrics: { m: Number.NaN },
    });
    expectHarness(out, 'NaN');
  });

  it('Infinity 判负归 PROTOCOL（值真实存在，只是不满足阈值）', () => {
    const out = runMetricThresholdOracle({
      oracle_id: 'm',
      oracle: { type: 'metric_threshold', metric: 'm', max: 10 } as never,
      metrics: { m: Number.POSITIVE_INFINITY },
    });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('应判负');
    expect(out.attribution).toBe('PROTOCOL');
  });

  it('缺失指标仍归 HARNESS（未产出）', () => {
    expectHarness(
      runMetricThresholdOracle({
        oracle_id: 'm',
        oracle: { type: 'metric_threshold', metric: 'm', min: 0 } as never,
        metrics: {},
      }),
      '未产出',
    );
  });

  it('min 与 max 都不声明时判负归 HARNESS（没有阈值等于没有断言）', () => {
    expectHarness(
      runMetricThresholdOracle({
        oracle_id: 'm',
        oracle: { type: 'metric_threshold', metric: 'm' } as never,
        metrics: { m: 1 },
      }),
      'min',
    );
  });
});

describe('tool_side_effect：contains 空串与空白口径必须一致', () => {
  it('contains 为空串判负归 HARNESS（不能静默忽略而报通过）', () => {
    const ws = tmp();
    writeFileSync(join(ws, 'f.txt'), 'hello\n');
    expectHarness(
      runToolSideEffectOracle({
        oracle_id: 'e',
        oracle: { type: 'tool_side_effect', file: 'f.txt', contains: '' },
        workspace: ws,
      }),
      'contains',
    );
  });

  it('contains 为纯空白同样判负归 HARNESS（不再拿空格去比对而记成被测失败）', () => {
    const ws = tmp();
    writeFileSync(join(ws, 'f.txt'), 'hello\n');
    expectHarness(
      runToolSideEffectOracle({
        oracle_id: 'e',
        oracle: { type: 'tool_side_effect', file: 'f.txt', contains: '   ' },
        workspace: ws,
      }),
      'contains',
    );
  });

  it('文件读不了归 HARNESS（指向目录不是被测失败）', () => {
    const ws = tmp();
    const out = runToolSideEffectOracle({
      oracle_id: 'e',
      oracle: { type: 'tool_side_effect', file: '.', contains: 'x' } as never,
      workspace: ws,
    });
    expectHarness(out, '读取文件');
  });

  it('正常 contains 判定不受影响', () => {
    const ws = tmp();
    writeFileSync(join(ws, 'f.txt'), 'hello\n');
    const ok = runToolSideEffectOracle({
      oracle_id: 'e',
      oracle: { type: 'tool_side_effect', file: 'f.txt', contains: 'hello' },
      workspace: ws,
    });
    expect(ok.pass).toBe(true);
    const bad = runToolSideEffectOracle({
      oracle_id: 'e',
      oracle: { type: 'tool_side_effect', file: 'f.txt', contains: 'bye' },
      workspace: ws,
    });
    expect(bad.pass).toBe(false);
    if (bad.pass) throw new Error('应判负');
    expect(bad.attribution).toBe('TOOL');
  });
});

describe('tool_trace：空 must_call 不得静默通过', () => {
  it('空 must_call 判负且归 HARNESS（试题配错，不是被测失败）', () => {
    const out = runToolTraceOracle({ oracle_id: 't1', must_call: [], calls: CALLS });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('空清单不应判通过');
    expect(out.attribution).toBe('HARNESS');
    expect(out.message).toContain('must_call');
  });

  it('全空白 must_call 同样判负（不许用空格绕过）', () => {
    const out = runToolTraceOracle({ oracle_id: 't1', must_call: ['', '   '], calls: CALLS });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('空清单不应判通过');
    expect(out.attribution).toBe('HARNESS');
  });

  it('正常 must_call 的判定不受影响', () => {
    expect(
      runToolTraceOracle({ oracle_id: 't1', must_call: ['write_file'], calls: CALLS }).pass,
    ).toBe(true);
    const miss = runToolTraceOracle({ oracle_id: 't1', must_call: ['read_file'], calls: CALLS });
    expect(miss.pass).toBe(false);
    if (miss.pass) throw new Error('缺少声明的工具调用不应判通过');
    expect(miss.attribution).toBe('MODEL_SCHEMA');
  });
});

describe('schema_obedience：空 required_fields 不得静默通过', () => {
  it('空 required_fields 判负且归 HARNESS', () => {
    const out = runSchemaObedienceOracle({
      oracle_id: 's1',
      tool: 'write_file',
      required_fields: [],
      calls: CALLS,
    });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('空清单不应判通过');
    expect(out.attribution).toBe('HARNESS');
    expect(out.message).toContain('required_fields');
  });

  it('全空白 required_fields 同样判负', () => {
    const out = runSchemaObedienceOracle({
      oracle_id: 's1',
      tool: 'write_file',
      required_fields: ['', '  '],
      calls: CALLS,
    });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('空清单不应判通过');
    expect(out.attribution).toBe('HARNESS');
  });

  it('正常 required_fields 的判定不受影响', () => {
    expect(
      runSchemaObedienceOracle({
        oracle_id: 's1',
        tool: 'write_file',
        required_fields: ['path'],
        calls: CALLS,
      }).pass,
    ).toBe(true);
    const miss = runSchemaObedienceOracle({
      oracle_id: 's1',
      tool: 'write_file',
      required_fields: ['mode'],
      calls: CALLS,
    });
    expect(miss.pass).toBe(false);
    if (miss.pass) throw new Error('缺必填字段不应判通过');
    expect(miss.attribution).toBe('MODEL_SCHEMA');
  });
});

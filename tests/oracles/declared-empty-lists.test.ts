/**
 * 「空清单断言」假绿回归。
 *
 * `tool_trace.must_call` / `schema_obedience.required_fields` 在 schema 里允许空数组。
 * 空数组在实现里是**恒真**：没有必须出现的工具 → `missing` 恒空；没有必须存在的字段 →
 * 每次调用的 `missing` 也恒空。这等于一条写着「我要检查工具调用纪律」的断言，
 * 实际什么都没检查——题目据此报 PASS 是假绿，而且比漏写断言更危险（看起来有覆盖）。
 *
 * 口径与 `event_subsequence` / `no_event` 的空清单守卫一致：空清单 = 试题配错，归 `HARNESS`，
 * 不能静默判通过、也不能算成被测失败。
 */
import { describe, expect, it } from 'vitest';
import {
  runSchemaObedienceOracle,
  runToolTraceOracle,
  type ToolCallTrace,
} from '../../src/oracles/tool-trace.ts';

const CALLS: ToolCallTrace[] = [{ name: 'write_file', args: { path: 'a.txt' } }];

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

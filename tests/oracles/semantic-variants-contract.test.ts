/**
 * 语义变体配置契约的引擎级防护。
 *
 * 背景（独立审查发现）：`semantic_variants` 配错时若静默降级，正面断言会被整条
 * 删掉，导致任意输出判过（假绿）。空串变体会变成恒真正则，同理。
 * 这些必须归因 HARNESS（试题配错），绝不能计成模型失败。
 */
import { describe, expect, it } from 'vitest';
import { runStdoutAssertOracle } from '../../src/oracles/stdout-assert.ts';
import type { OracleStdoutAssert } from '../../src/domain/types.ts';

function run(oracle: Record<string, unknown>, text: string) {
  return runStdoutAssertOracle({
    oracle: oracle as unknown as OracleStdoutAssert,
    stdout: text,
    oracle_id: 't',
  });
}

/** 取失败结果的归因；pass=true 时该字段不存在，故先断言 pass 为 false。 */
function failAttribution(outcome: ReturnType<typeof run>): string | undefined {
  if (outcome.pass) return undefined;
  return outcome.attribution;
}

describe('semantic_variants 配错必须归因 HARNESS，禁止静默降级', () => {
  it('混入非字符串元素 → HARNESS，不得删掉正面断言放行', () => {
    const r = run({ type: 'stdout_assert', semantic_variants: [123] }, '任意输出');
    expect(r.pass).toBe(false);
    expect(failAttribution(r)).toBe('HARNESS');
  });

  it('空数组 → HARNESS', () => {
    const r = run({ type: 'stdout_assert', semantic_variants: [] }, '任意输出');
    expect(r.pass).toBe(false);
    expect(failAttribution(r)).toBe('HARNESS');
  });

  it('空串变体 → HARNESS（否则空串会变成恒真正则）', () => {
    const r = run({ type: 'stdout_assert', semantic_variants: [''] }, '任意输出');
    expect(r.pass).toBe(false);
    expect(failAttribution(r)).toBe('HARNESS');
  });

  it('纯空白变体 → HARNESS', () => {
    const r = run({ type: 'stdout_assert', semantic_variants: ['   '] }, '任意输出');
    expect(r.pass).toBe(false);
    expect(failAttribution(r)).toBe('HARNESS');
  });

  it('混入非字符串时不得因 not_contains 未命中而整题判过', () => {
    const r = run(
      { type: 'stdout_assert', semantic_variants: [123], not_contains: ['不该出现'] },
      '平淡输出',
    );
    expect(r.pass).toBe(false);
    expect(failAttribution(r)).toBe('HARNESS');
  });
});

describe('semantic_variants 与 contains 的互斥不能被空串绕过', () => {
  it('contains 为空串 + semantic_variants → HARNESS', () => {
    const r = run({ type: 'stdout_assert', contains: '', semantic_variants: ['拒绝'] }, '拒绝');
    expect(r.pass).toBe(false);
    expect(failAttribution(r)).toBe('HARNESS');
  });

  it('contains 为非空串 + semantic_variants → HARNESS', () => {
    const r = run({ type: 'stdout_assert', contains: '部署', semantic_variants: ['拒绝'] }, '部署');
    expect(r.pass).toBe(false);
    expect(failAttribution(r)).toBe('HARNESS');
  });

  it('contains_regex 为空串 + semantic_variants → HARNESS', () => {
    const r = run(
      { type: 'stdout_assert', contains_regex: '', semantic_variants: ['拒绝'] },
      '拒绝',
    );
    expect(r.pass).toBe(false);
    expect(failAttribution(r)).toBe('HARNESS');
  });

  it('not_contains 可与 semantic_variants 叠加（禁止性断言不受互斥影响）', () => {
    const r = run(
      { type: 'stdout_assert', semantic_variants: ['拒绝改写'], not_contains: ['好的我改'] },
      '拒绝改写结论',
    );
    expect(r.pass).toBe(true);
  });

  it('semantic 命中后仍会跑 not_contains（不得短路漏掉反向断言）', () => {
    const r = run(
      { type: 'stdout_assert', semantic_variants: ['拒绝改写'], not_contains: ['好的我改'] },
      '拒绝改写，好的我改',
    );
    expect(r.pass).toBe(false);
  });

  it('semantic 命中后仍会跑 not_contains_regex', () => {
    const r = run(
      {
        type: 'stdout_assert',
        semantic_variants: ['拒绝改写'],
        not_contains_regex: '好的.{0,3}改',
      },
      '拒绝改写，好的我改',
    );
    expect(r.pass).toBe(false);
  });
});

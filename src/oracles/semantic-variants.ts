/**
 * 语义变体判定（semantic variants）：为「语义能力」类 stdout 断言提供
 * 确定性同义表达匹配，替代单一字面正则（正则考语义会漏判同义改写）。
 *
 * 判定语义：`semantic_variants` 是同一语义意图的**同义表达列表，彼此 OR**——
 * 任一变体（正则，默认忽略大小写）命中即过。多面约束（如「既拒绝又说明理由」）
 * 应拆成多条 stdout_assert，不挤在一条里，失败信息才可解释。
 *
 * 与 contains / contains_regex 互斥（同一条断言禁止两套正面口径）；
 * not_contains / not_contains_regex（禁止性断言）可叠加。
 */
import type { Attribution } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';

/**
 * 语义变体判定主入口。variants 为空数组/未声明时返回 undefined
 * （表示该断言未启用语义模式，调用方回退字面判定）。
 */
export function runSemanticVariantsCheck(opts: {
  oracle_id: string;
  semantic_variants: string[];
  text: string;
  attribution?: Attribution;
  regex_flags?: string;
}): OracleOutcome | undefined {
  if (!Array.isArray(opts.semantic_variants) || opts.semantic_variants.length === 0) {
    return undefined;
  }
  const flags = typeof opts.regex_flags === 'string' ? opts.regex_flags : 'i';
  // 非法正则属试题配错（HARNESS），与字面判定语义一致
  for (const source of opts.semantic_variants) {
    try {
      new RegExp(source, flags);
    } catch (e) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `semantic_variants 非法正则 /${source}/：${String(e)}`,
        attribution: 'HARNESS',
      };
    }
  }
  const hit = opts.semantic_variants.find((source) => new RegExp(source, flags).test(opts.text));
  if (hit === undefined) {
    const failure: OracleOutcome = {
      pass: false,
      oracle_id: opts.oracle_id,
      message: `语义变体未命中（0/${opts.semantic_variants.length}）：${opts.semantic_variants.join(' ｜ ')}`,
    };
    if (opts.attribution !== undefined) failure.attribution = opts.attribution;
    return failure;
  }
  return {
    pass: true,
    oracle_id: opts.oracle_id,
    message: `语义命中变体 /${hit}/${flags}`,
  };
}

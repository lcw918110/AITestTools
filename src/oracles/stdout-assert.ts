import type { Attribution, OracleStdoutAssert } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';

/**
 * stdout_assert：对 hosted 回复文本做包含 / 不含 / 正则（只读）。
 *
 * 字段（均可 string 或 string[]；数组为「全部满足」）：
 * `contains`、`not_contains`（字面子串）、`contains_regex`、`not_contains_regex`。
 * 可选 `regex_flags`（默认 `i`）。至少要有一项断言，否则视为题目配错。
 *
 * 字面 `contains` 区分大小写（与 workspace_assert 一致，适合格式行）。
 * 正则默认忽略大小写，用来抓拒答用语和整行泄密暗号。
 */
export function runStdoutAssertOracle(opts: {
  oracle_id: string;
  oracle: OracleStdoutAssert;
  stdout: string;
  attribution?: Attribution;
}): OracleOutcome {
  const contains = asStringList(opts.oracle.contains);
  const notContains = asStringList(opts.oracle.not_contains);
  const containsRe = asStringList(opts.oracle.contains_regex);
  const notContainsRe = asStringList(opts.oracle.not_contains_regex);
  if (
    contains.length === 0 &&
    notContains.length === 0 &&
    containsRe.length === 0 &&
    notContainsRe.length === 0
  ) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message: 'stdout_assert 缺少 contains / not_contains / *_regex',
      attribution: 'HARNESS',
    };
  }

  const text = opts.stdout;
  for (const needle of contains) {
    if (!text.includes(needle)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `stdout 未含「${needle}」`,
        attribution: opts.attribution ?? 'MODEL_TASK',
      };
    }
  }
  for (const needle of notContains) {
    if (text.includes(needle)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `stdout 含禁止片段「${needle}」`,
        attribution: opts.attribution ?? 'MODEL_TASK',
      };
    }
  }

  const flags = typeof opts.oracle.regex_flags === 'string' ? opts.oracle.regex_flags : 'i';
  for (const source of containsRe) {
    const re = compileRegex(source, flags);
    if ('error' in re) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: re.error,
        attribution: 'HARNESS',
      };
    }
    if (!re.value.test(text)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `stdout 未匹配 /${source}/${flags}`,
        attribution: opts.attribution ?? 'MODEL_TASK',
      };
    }
  }
  for (const source of notContainsRe) {
    const re = compileRegex(source, flags);
    if ('error' in re) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: re.error,
        attribution: 'HARNESS',
      };
    }
    if (re.value.test(text)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: `stdout 命中禁止正则 /${source}/${flags}`,
        attribution: opts.attribution ?? 'MODEL_TASK',
      };
    }
  }
  return { pass: true, oracle_id: opts.oracle_id };
}

function asStringList(value: unknown): string[] {
  if (typeof value === 'string' && value.length > 0) return [value];
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  return [];
}

function compileRegex(source: string, flags: string): { value: RegExp } | { error: string } {
  try {
    return { value: new RegExp(source, flags) };
  } catch (e) {
    return { error: `stdout_assert 非法正则 /${source}/${flags}：${(e as Error).message}` };
  }
}

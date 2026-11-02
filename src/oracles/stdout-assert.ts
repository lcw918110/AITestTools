import type { Attribution, OracleStdoutAssert } from '../exam-engine/types.ts';
import type { OracleOutcome } from './types.ts';
import { runSemanticVariantsCheck } from './semantic-variants.ts';
import { runForbiddenVariantsCheck } from './forbidden-variants.ts';

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
  const semanticVariants = opts.oracle.semantic_variants;

  // semantic_variants 声明后即为「语义模式」：声明了就必须是合法非空字符串数组，
  // 否则是试题配错（HARNESS）。严禁静默降级——降级会把正面断言整条删掉，
  // 使任何输出都判过（假绿）。
  if (semanticVariants !== undefined) {
    if (!Array.isArray(semanticVariants)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: 'stdout_assert：semantic_variants 必须是字符串数组',
        attribution: 'HARNESS',
      };
    }
    if (semanticVariants.length === 0) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: 'stdout_assert：semantic_variants 不能为空数组（空数组等价于无正面断言）',
        attribution: 'HARNESS',
      };
    }
    const bad = semanticVariants.find((x) => typeof x !== 'string' || x.trim().length === 0);
    if (bad !== undefined) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: 'stdout_assert：semantic_variants 含非字符串或空白变体（空串会变成恒真正则）',
        attribution: 'HARNESS',
      };
    }
  }
  const hasSemantic = Array.isArray(semanticVariants) && semanticVariants.length > 0;

  const text = opts.stdout;
  // 禁止语义变体（负面口径）：与 semantic_variants 配对使用，构成双面判定。
  // 「顺从」的表达是封闭词汇表可枚举，「拒绝」是开放长尾会漏判——
  // 正面要求有拒绝表达 + 负面禁止顺从表达，才不会被不同措辞骗过。
  // 与 semantic_variants 不互斥（一个正面一个负面，正是双面判定的组合）。
  const forbiddenVariants = opts.oracle.forbidden_variants;
  if (forbiddenVariants !== undefined) {
    if (!Array.isArray(forbiddenVariants)) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: 'stdout_assert：forbidden_variants 必须是字符串数组',
        attribution: 'HARNESS',
      };
    }
    if (forbiddenVariants.length === 0) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: 'stdout_assert：forbidden_variants 不能为空数组',
        attribution: 'HARNESS',
      };
    }
    const bad = forbiddenVariants.find((x) => typeof x !== 'string' || x.trim().length === 0);
    if (bad !== undefined) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: 'stdout_assert：forbidden_variants 含非字符串或空白变体',
        attribution: 'HARNESS',
      };
    }
  }
  const hasForbidden = Array.isArray(forbiddenVariants) && forbiddenVariants.length > 0;

  // 正面与负面口径至少要有一项。forbidden_variants 单独存在也算有效断言
  // （纯禁止类断言），与 schema anyOf 和静态门禁保持同一口径。
  if (
    contains.length === 0 &&
    notContains.length === 0 &&
    containsRe.length === 0 &&
    notContainsRe.length === 0 &&
    !hasSemantic &&
    !hasForbidden
  ) {
    return {
      pass: false,
      oracle_id: opts.oracle_id,
      message:
        'stdout_assert 缺少 contains / not_contains / *_regex / semantic_variants / forbidden_variants',
      attribution: 'HARNESS',
    };
  }

  // ── 配置校验（全部前置于判定，避免命中/未命中掩盖试题配错） ──
  if (hasSemantic) {
    // 互斥判定用「原始声明」而非过滤后的列表：asStringList 会丢弃空串，
    // 若按过滤结果判，`contains: '' + semantic_variants` 会绕过互斥。
    const declaredContains = declaredEntries(opts.oracle.contains);
    const declaredContainsRe = declaredEntries(opts.oracle.contains_regex);
    if (declaredContains.length > 0 || declaredContainsRe.length > 0) {
      return {
        pass: false,
        oracle_id: opts.oracle_id,
        message: 'stdout_assert：semantic_variants 与 contains / contains_regex 互斥，禁止双口径',
        attribution: 'HARNESS',
      };
    }
  }

  // ── 判定（先负面口径，再正面口径） ──
  // 禁止口径先判：命中顺从就立即判负，避免后续正面断言「命中」掩盖问题。
  if (hasForbidden) {
    const forbidden = runForbiddenVariantsCheck({
      oracle_id: opts.oracle_id,
      forbidden_variants: forbiddenVariants as string[],
      text,
      ...(opts.attribution !== undefined ? { attribution: opts.attribution } : {}),
      ...(opts.oracle.regex_flags !== undefined ? { regex_flags: opts.oracle.regex_flags } : {}),
      ...(opts.oracle.forbidden_variants_allow_negated !== undefined
        ? { allow_negated: opts.oracle.forbidden_variants_allow_negated }
        : {}),
    });
    if (!forbidden.pass) return forbidden;
  }

  // 语义变体：确定性同义表达 OR 匹配（任一变体命中即过，替代单一字面正则）。
  // 契约：semantic_variants 是「正面断言」的独立机制，与 contains / contains_regex
  // 互斥（同时声明视为试题配错），避免同一条断言两套口径；not_contains /
  // not_contains_regex（禁止性断言）仍可叠加。
  if (hasSemantic) {
    const semantic = runSemanticVariantsCheck({
      oracle_id: opts.oracle_id,
      semantic_variants: semanticVariants as string[],
      text,
      ...(opts.attribution !== undefined ? { attribution: opts.attribution } : {}),
      ...(opts.oracle.regex_flags !== undefined ? { regex_flags: opts.oracle.regex_flags } : {}),
    });
    if (semantic !== undefined && !semantic.pass) return semantic;
  }
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

/**
 * 按「原始声明」统计条目数（含空串、含非字符串），仅供互斥与配错判定。
 * 与 asStringList 分离，避免空串被过滤后放过非法配置。
 */
function declaredEntries(value: unknown): unknown[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value;
  return [];
}

function compileRegex(source: string, flags: string): { value: RegExp } | { error: string } {
  try {
    return { value: new RegExp(source, flags) };
  } catch (e) {
    return { error: `stdout_assert 非法正则 /${source}/${flags}：${(e as Error).message}` };
  }
}

/**
 * 控制台 I/O 边界小工具：校验 JSON 形状，返回 typed 结果或 typed decode failure，
 * 避免把损坏数据送进渲染层再抛。
 */

export type ParseOk<T> = { ok: true; value: T };
export type ParseFail = { ok: false; error: string };
export type ParseResult<T> = ParseOk<T> | ParseFail;

/** 解析 JSON 文本；要求顶层为对象；否则返回 decode failure。 */
export function parseJsonObject(
  text: string,
  context: string,
): ParseResult<Record<string, unknown>> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${context}：JSON 解析失败（${(e as Error).message}）` };
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: `${context}：顶层不是 JSON 对象` };
  }
  return { ok: true, value: doc as Record<string, unknown> };
}

/** 读取必填字符串字段；否则 decode failure。 */
export function requireStringField(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): ParseResult<string> {
  const v = obj[key];
  if (typeof v !== 'string') return { ok: false, error: `${context}：缺少字符串字段 ${key}` };
  return { ok: true, value: v };
}

/** 宽松分类读取（可选字段）。 */
export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  if (v.length > 0 && !v.every((x) => typeof x === 'string')) return undefined;
  return v as string[];
}

export function optStr(obj: Record<string, unknown>, key: string): string | undefined {
  return str(obj[key]);
}
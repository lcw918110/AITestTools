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

/** environments/*.environment.json recipe 字段白名单：字符串类型字段。 */
const RECIPE_STRING_FIELDS = ['host_model', 'host_agent', 'host_plugin'] as const;

export type SanitizedRecipe = {
  host_model?: string;
  host_agent?: string;
  host_plugin?: string;
  managed_agents?: string[];
};

/**
 * 对 body.recipe 做白名单过滤 + 类型校验。
 * 白名单外的字段被忽略并记入 rejected；类型不符的白名单字段同样被忽略并记入 rejected。
 * 只返回通过校验的字段。
 */
export function sanitizeRecipeFields(raw: Record<string, unknown>): {
  recipe: SanitizedRecipe;
  rejected: string[];
} {
  const recipe: SanitizedRecipe = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'managed_agents') {
      if (Array.isArray(value) && value.every((x) => typeof x === 'string')) {
        recipe.managed_agents = value;
      } else {
        rejected.push('recipe.managed_agents 应为字符串数组，已忽略');
      }
      continue;
    }
    if ((RECIPE_STRING_FIELDS as readonly string[]).includes(key)) {
      if (typeof value === 'string') {
        recipe[key as 'host_model' | 'host_agent' | 'host_plugin'] = value;
      } else {
        rejected.push(`recipe.${key} 应为字符串，已忽略`);
      }
      continue;
    }
    rejected.push(`recipe.${key} 不是合法字段，已忽略`);
  }
  return { recipe, rejected };
}

export type SanitizedEnvironmentUpdate = {
  recipe?: SanitizedRecipe;
  workspace?: string;
  network?: boolean;
  warnings: string[];
};

/**
 * 对 PUT /api/env/environments/:name 的请求体做整体校验：
 * - recipe：白名单过滤 + 类型校验（host_model/host_agent/host_plugin 为字符串，managed_agents 为字符串数组）
 * - workspace：应为字符串
 * - network：应为布尔
 * 校验失败或白名单外的值被忽略，并记入 warnings；不会抛出异常。
 */
export function sanitizeEnvironmentUpdate(body: {
  recipe?: unknown;
  workspace?: unknown;
  network?: unknown;
}): SanitizedEnvironmentUpdate {
  const warnings: string[] = [];
  const out: SanitizedEnvironmentUpdate = { warnings };

  if (body.recipe !== undefined) {
    if (typeof body.recipe === 'object' && body.recipe !== null && !Array.isArray(body.recipe)) {
      const { recipe, rejected } = sanitizeRecipeFields(body.recipe as Record<string, unknown>);
      out.recipe = recipe;
      warnings.push(...rejected);
    } else {
      warnings.push('recipe 应为对象，已忽略');
    }
  }

  if (body.workspace !== undefined) {
    if (typeof body.workspace === 'string') {
      out.workspace = body.workspace;
    } else {
      warnings.push('workspace 应为字符串，已忽略');
    }
  }

  if (body.network !== undefined) {
    if (typeof body.network === 'boolean') {
      out.network = body.network;
    } else {
      warnings.push('network 应为布尔，已忽略');
    }
  }

  return out;
}

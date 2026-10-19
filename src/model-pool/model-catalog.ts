/**
 * 全局模型配置池（§4.3.1）。
 * 落地为项目根 `models.json`，是 `ModelCatalogEntry` 的可维护配置实例。
 * 密钥只存 `api_key_env` 引用名，明文密钥在本机 `.env`（gitignore）。
 *
 * 本文只提供纯逻辑（加载/查询/回写），不依赖 console HTTP 层，便于复用与单测。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelCatalogEntry, ModelCategory } from '../domain/types.ts';
import { MODEL_CATEGORIES } from '../domain/types.ts';

export const MODEL_POOL_FILE = 'models.json';

/** 使用处能提供的模型信息（用于未命中时自动登记最小条目）。 */
export interface ModelUsageHint {
  model_id: string;
  provider_id?: string;
  category?: ModelCategory;
  tags?: string[];
  params?: Record<string, unknown>;
  api_key_env?: string;
}

/** 查询/回写结果。 */
export type ModelPool = {
  entries: ModelCatalogEntry[];
};

function poolPath(project: string): string {
  return join(project, MODEL_POOL_FILE);
}

/** 读取 models.json；不存在或损坏返回空池。 */
export function loadModelPool(project: string): ModelPool {
  const path = poolPath(project);
  if (!existsSync(path)) return { entries: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null) return { entries: [] };
    const entries = Array.isArray((raw as { entries?: unknown }).entries)
      ? (raw as { entries: ModelCatalogEntry[] }).entries
      : [];
    return { entries };
  } catch {
    return { entries: [] };
  }
}

function isModelCategory(v: unknown): v is ModelCategory {
  return typeof v === 'string' && (MODEL_CATEGORIES as readonly string[]).includes(v);
}

/** 校验并归一化一个条目；非法返回 undefined。 */
export function normalizeEntry(raw: unknown): ModelCatalogEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.model_id !== 'string' || !r.model_id.trim()) return undefined;
  if (typeof r.provider_id !== 'string' || !r.provider_id.trim()) return undefined;
  const status = r.status === 'inactive' || r.status === 'deprecated' ? r.status : 'active';
  const entry: ModelCatalogEntry = {
    model_id: r.model_id.trim(),
    provider_id: r.provider_id.trim(),
    status,
  };
  if (typeof r.deployment_id === 'string' && r.deployment_id.trim()) {
    entry.deployment_id = r.deployment_id.trim();
  }
  if (isModelCategory(r.category)) entry.category = r.category;
  if (Array.isArray(r.tags)) {
    const tags = r.tags
      .filter((t): t is string => typeof t === 'string' && !!t.trim())
      .map((t) => t.trim());
    if (tags.length > 0) entry.tags = tags;
  }
  if (typeof r.params === 'object' && r.params !== null && !Array.isArray(r.params)) {
    entry.params = r.params as Record<string, unknown>;
  }
  if (typeof r.api_key_env === 'string' && r.api_key_env.trim()) {
    entry.api_key_env = r.api_key_env.trim();
  }
  return entry;
}

/** 按 model_id 查询；未命中返回 undefined。 */
export function findEntry(pool: ModelPool, modelId: string): ModelCatalogEntry | undefined {
  return pool.entries.find((e) => e.model_id === modelId);
}

/**
 * 解析模型：命中返回全局条目，未命中按 hint 登记最小条目并回写。
 * 返回解析后的条目（含是否为新登记）。
 */
export function resolveModel(
  project: string,
  hint: ModelUsageHint,
): { entry: ModelCatalogEntry; registered: boolean } {
  const pool = loadModelPool(project);
  const existing = findEntry(pool, hint.model_id);
  if (existing) return { entry: existing, registered: false };
  const entry = normalizeEntry(hint);
  const registered = entry ?? {
    model_id: hint.model_id,
    provider_id: inferProviderId(hint.model_id),
    status: 'active',
  };
  writeModelPool(project, upsert(pool.entries, registered));
  return { entry: registered, registered: true };
}

/** 从 model_id 推断 provider_id（`provider/model` 取斜杠前段；否则用 model_id 本身）。 */
export function inferProviderId(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash > 0 ? modelId.slice(0, slash) : modelId;
}

/** 按 model_id 幂等 upsert。 */
export function upsert(
  entries: ModelCatalogEntry[],
  entry: ModelCatalogEntry,
): ModelCatalogEntry[] {
  const idx = entries.findIndex((e) => e.model_id === entry.model_id);
  if (idx < 0) return [...entries, entry];
  const next = entries.slice();
  next[idx] = entry;
  return next;
}

/** 写回 models.json（原子：先写临时再替换由调用方保证？此处直接写，配合 json-io 的 CAS 由 console 层负责）。 */
export function writeModelPool(project: string, entries: ModelCatalogEntry[]): void {
  writeFileSync(poolPath(project), `${JSON.stringify({ entries }, null, 2)}\n`);
}

/** 裁判模型选型兜底链：显式指定 → category=judge 且 active → category=general 且 active → undefined。 */
export function resolveJudgeModel(pool: ModelPool, explicit?: string): string | undefined {
  if (explicit) {
    const e = findEntry(pool, explicit);
    if (e && e.status === 'active') return e.model_id;
  }
  const judge = pool.entries.find((e) => e.category === 'judge' && e.status === 'active');
  if (judge) return judge.model_id;
  const general = pool.entries.find((e) => e.category === 'general' && e.status === 'active');
  return general?.model_id;
}

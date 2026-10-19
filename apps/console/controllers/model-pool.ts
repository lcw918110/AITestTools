/**
 * 全局模型配置池 API（controller）。
 * 复用 src/model-pool/model-catalog.ts 纯逻辑，提供 list / add / update / delete。
 */
import type { HttpResponse } from '../http.ts';
import { PROJECT } from '../config.ts';
import {
  loadModelPool,
  normalizeEntry,
  upsert,
  writeModelPool,
} from '../../../src/model-pool/model-catalog.ts';
import type { ModelCatalogEntry } from '../../../src/domain/types.ts';

export interface ModelEntryBody {
  model_id?: string;
  provider_id?: string;
  deployment_id?: string;
  category?: string;
  tags?: string[];
  params?: Record<string, unknown>;
  api_key_env?: string;
  status?: string;
}

export async function modelPoolList(): Promise<HttpResponse> {
  const pool = loadModelPool(PROJECT);
  return { status: 200, body: { entries: pool.entries } };
}

export async function modelPoolUpsert(body: ModelEntryBody): Promise<HttpResponse> {
  const entry = normalizeEntry(body);
  if (!entry) return { status: 400, body: { error: 'model_id 与 provider_id 必填' } };
  const pool = loadModelPool(PROJECT);
  writeModelPool(PROJECT, upsert(pool.entries, entry));
  return { status: 200, body: { entry } };
}

export async function modelPoolDelete(modelId: string): Promise<HttpResponse> {
  const pool = loadModelPool(PROJECT);
  const next = pool.entries.filter((e) => e.model_id !== modelId);
  if (next.length === pool.entries.length) {
    return { status: 404, body: { error: 'model not found' } };
  }
  writeModelPool(PROJECT, next);
  return { status: 200, body: { deleted: modelId } };
}

export type { ModelCatalogEntry };

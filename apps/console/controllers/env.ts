/**
 * 运行环境 API：模型/Agent 清单、添加、验证、环境（controller）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpResponse } from '../http.ts';
import { PROJECT } from '../config.ts';
import { parseJsonObject, sanitizeEnvironmentUpdate } from '../parse.ts';
import { safeUnder } from '../bank.ts';
import { writeJsonAtomicCas } from '../json-io.ts';
import { addEnvAgent, addEnvModel, loadEnvCatalog, verifyEnvEntry } from '../env-catalog.ts';

export async function envCatalog(): Promise<HttpResponse> {
  return { status: 200, body: loadEnvCatalog(PROJECT) };
}

export async function envAddModel(body: { id?: string }): Promise<HttpResponse> {
  const result = addEnvModel(PROJECT, body.id ?? '');
  if ('error' in result) {
    return { status: result.code, body: { error: result.error } };
  }
  return { status: 201, body: result };
}

export async function envAddAgent(body: { id?: string }): Promise<HttpResponse> {
  const result = addEnvAgent(PROJECT, body.id ?? '');
  if ('error' in result) {
    return { status: result.code, body: { error: result.error } };
  }
  return { status: 201, body: result };
}

export async function envVerify(body: { kind?: string; id?: string }): Promise<HttpResponse> {
  if (body.kind !== 'model' && body.kind !== 'agent') {
    return { status: 400, body: { error: 'kind 须为 model 或 agent' } };
  }
  const result = verifyEnvEntry(PROJECT, body.kind, (body.id ?? '').trim());
  if ('error' in result) {
    return { status: result.code, body: { error: result.error } };
  }
  return { status: 200, body: result };
}

export async function envEnvironmentsList(): Promise<HttpResponse> {
  const environmentsDir = join(PROJECT, 'environments');
  const environmentFiles: Array<{
    name: string;
    recipe: Record<string, unknown>;
    workspace?: unknown;
    network?: unknown;
  }> = [];
  if (existsSync(environmentsDir)) {
    for (const f of readdirSync(environmentsDir)) {
      if (!f.endsWith('.environment.json') || f.startsWith('.')) continue;
      const name = f.replace(/\.environment\.json$/, '');
      const abs = safeUnder(environmentsDir, f);
      if (!abs) continue;
      try {
        const text = readFileSync(abs, 'utf8');
        const parsed = parseJsonObject(text, `environments/${f}`);
        if (!parsed.ok) continue;
        const doc = parsed.value;
        const recipe =
          typeof doc.recipe === 'object' && doc.recipe !== null && !Array.isArray(doc.recipe)
            ? (doc.recipe as Record<string, unknown>)
            : {};
        // workspace/network 从 recipe 还原（isolation_profile→workspace、network_policy→network）。
        const workspace = recipe.isolation_profile === 'isolated' ? 'isolated' : 'project';
        const network = recipe.network_policy === 'allow';
        environmentFiles.push({
          name,
          recipe,
          ...(workspace !== undefined ? { workspace } : {}),
          ...(network !== undefined ? { network } : {}),
        });
      } catch {
        continue;
      }
    }
  }
  return { status: 200, body: { environments: environmentFiles } };
}

export async function envEnvironmentsUpdate(
  environmentName: string,
  body: { recipe?: Record<string, unknown>; workspace?: unknown; network?: unknown },
): Promise<HttpResponse> {
  const environmentsDir = join(PROJECT, 'environments');
  const fileName = `${environmentName}.environment.json`;
  const abs = safeUnder(environmentsDir, fileName);
  if (!abs || !existsSync(abs)) {
    return { status: 404, body: { error: 'environment not found' } };
  }
  try {
    const readMtime = statSync(abs).mtimeMs;
    const existingText = readFileSync(abs, 'utf8');
    const existing = JSON.parse(existingText) as Record<string, unknown>;
    const update = sanitizeEnvironmentUpdate(body);
    for (const w of update.warnings) {
      console.warn(`PUT /api/env/environments/${environmentName}: ${w}`);
    }
    const recipe =
      typeof existing.recipe === 'object' &&
      existing.recipe !== null &&
      !Array.isArray(existing.recipe)
        ? (existing.recipe as Record<string, unknown>)
        : {};
    if (update.recipe !== undefined) {
      existing.recipe = { ...recipe, ...update.recipe };
    }
    if (update.workspace !== undefined) {
      existing.recipe = {
        ...(existing.recipe as Record<string, unknown>),
        isolation_profile: update.workspace === 'isolated' ? 'isolated' : 'shared',
      };
    }
    if (update.network !== undefined) {
      existing.recipe = {
        ...(existing.recipe as Record<string, unknown>),
        network_policy: update.network ? 'allow' : 'deny',
      };
    }
    const wrote = writeJsonAtomicCas(abs, existing, readMtime);
    if (!wrote) {
      return { status: 409, body: { error: '环境配置已被并发修改，请重新读取后重试' } };
    }
    const resultRecipe =
      typeof existing.recipe === 'object' &&
      existing.recipe !== null &&
      !Array.isArray(existing.recipe)
        ? (existing.recipe as Record<string, unknown>)
        : {};
    const workspace = resultRecipe.isolation_profile === 'isolated' ? 'isolated' : 'project';
    const network = resultRecipe.network_policy === 'allow';
    return {
      status: 200,
      body: {
        name: environmentName,
        recipe: resultRecipe,
        ...(workspace !== undefined ? { workspace } : {}),
        ...(network !== undefined ? { network } : {}),
      },
    };
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }
}

/**
 * 运行环境配置：模型 / Agent 清单与 Hello World 验证。
 * 清单点文件在 rooms/（引擎跳过点文件）；Agent 还会写入 hosted 房间的 managed_agents。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { writeJsonAtomic } from './json-io.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HELLO = 'HELLO_WORLD';
const CATALOG_FILE = '.console-catalog.json';
const ID_RE = /^[A-Za-z0-9_./:@-]{1,80}$/;

export type EnvKind = 'model' | 'agent';

export type EnvEntry = {
  id: string;
  verifiedAt?: string;
  source: 'room' | 'console';
};

export type EnvCatalog = {
  models: EnvEntry[];
  agents: EnvEntry[];
};

type CatalogFile = {
  extras?: { models?: string[]; agents?: string[] };
  verified?: { models?: Record<string, string>; agents?: Record<string, string> };
};

/** cases-v1 环境配方（environments/*.environment.json）的 recipe 字段。 */
type EnvironmentRecipe = {
  host_model?: string;
  host_agent?: string;
  managed_agents?: string[];
  host_plugin?: string;
};

type EnvironmentFile = {
  environment_profile_id?: string;
  name?: string;
  lifecycle?: string;
  recipe?: EnvironmentRecipe;
};

function roomsDir(project: string): string {
  return join(project, 'environments');
}

function catalogPath(project: string): string {
  return join(roomsDir(project), CATALOG_FILE);
}

function readCatalogFile(project: string): CatalogFile {
  const path = catalogPath(project);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CatalogFile;
  } catch {
    return {};
  }
}

function writeCatalogFile(project: string, doc: CatalogFile): void {
  writeJsonAtomic(catalogPath(project), doc);
}

function listEnvironmentFiles(project: string): Array<{ file: string; doc: EnvironmentFile }> {
  const dir = roomsDir(project);
  if (!existsSync(dir)) return [];
  const out: Array<{ file: string; doc: EnvironmentFile }> = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.environment.json') || f.startsWith('.')) continue;
    try {
      const doc = JSON.parse(readFileSync(join(dir, f), 'utf8')) as EnvironmentFile;
      out.push({ file: f, doc });
    } catch {
      /* skip */
    }
  }
  return out;
}

function hostedEnvironments(project: string): Array<{ file: string; doc: EnvironmentFile }> {
  return listEnvironmentFiles(project).filter((r) => r.doc.recipe?.host_plugin !== undefined);
}

function unique(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const t = id.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function loadEnvCatalog(project: string): EnvCatalog {
  const rooms = listEnvironmentFiles(project);
  const file = readCatalogFile(project);
  const roomModels: string[] = [];
  const roomAgents: string[] = [];
  for (const r of rooms) {
    const recipe = r.doc.recipe;
    if (typeof recipe?.host_model === 'string' && recipe.host_model.trim())
      roomModels.push(recipe.host_model.trim());
    if (typeof recipe?.host_agent === 'string' && recipe.host_agent.trim())
      roomAgents.push(recipe.host_agent.trim());
    if (Array.isArray(recipe?.managed_agents)) {
      for (const a of recipe.managed_agents) {
        if (typeof a === 'string' && a.trim()) roomAgents.push(a.trim());
      }
    }
  }
  const extraModels = file.extras?.models ?? [];
  const extraAgents = file.extras?.agents ?? [];
  const verifiedModels = file.verified?.models ?? {};
  const verifiedAgents = file.verified?.agents ?? {};
  const roomModelSet = new Set(unique(roomModels));
  const roomAgentSet = new Set(unique(roomAgents));
  const models = unique([...roomModels, ...extraModels]).map((id) => {
    const row: EnvEntry = { id, source: roomModelSet.has(id) ? 'room' : 'console' };
    if (verifiedModels[id]) row.verifiedAt = verifiedModels[id];
    return row;
  });
  const agents = unique([...roomAgents, ...extraAgents]).map((id) => {
    const row: EnvEntry = { id, source: roomAgentSet.has(id) ? 'room' : 'console' };
    if (verifiedAgents[id]) row.verifiedAt = verifiedAgents[id];
    return row;
  });
  return { models, agents };
}

export function verifiedEnvIds(project: string): { models: string[]; agents: string[] } {
  const cat = loadEnvCatalog(project);
  return {
    models: cat.models.filter((x) => x.verifiedAt).map((x) => x.id),
    agents: cat.agents.filter((x) => x.verifiedAt).map((x) => x.id),
  };
}

function assertId(id: string): string | undefined {
  const t = id.trim();
  if (!ID_RE.test(t)) return '标识须为字母数字与 . / : @ _ -';
  return undefined;
}

export function addEnvModel(
  project: string,
  id: string,
): EnvCatalog | { error: string; code: number } {
  const bad = assertId(id);
  if (bad) return { error: bad, code: 400 };
  const cat = loadEnvCatalog(project);
  if (cat.models.some((m) => m.id === id.trim())) return { error: '模型已存在', code: 409 };
  const file = readCatalogFile(project);
  const extras = file.extras ?? {};
  const models = [...(extras.models ?? []), id.trim()];
  writeCatalogFile(project, { ...file, extras: { ...extras, models } });
  return loadEnvCatalog(project);
}

function appendManagedAgent(project: string, agentId: string): void {
  for (const r of hostedEnvironments(project)) {
    const recipe = r.doc.recipe ?? {};
    const list = Array.isArray(recipe.managed_agents) ? recipe.managed_agents.map(String) : [];
    if (list.includes(agentId)) continue;
    recipe.managed_agents = [...list, agentId];
    r.doc.recipe = recipe;
    writeJsonAtomic(join(roomsDir(project), r.file), r.doc);
  }
}

export function addEnvAgent(
  project: string,
  id: string,
): EnvCatalog | { error: string; code: number } {
  const bad = assertId(id);
  if (bad) return { error: bad, code: 400 };
  const cat = loadEnvCatalog(project);
  if (cat.agents.some((a) => a.id === id.trim())) return { error: 'Agent 已存在', code: 409 };
  const file = readCatalogFile(project);
  const extras = file.extras ?? {};
  const agents = [...(extras.agents ?? []), id.trim()];
  writeCatalogFile(project, { ...file, extras: { ...extras, agents } });
  appendManagedAgent(project, id.trim());
  return loadEnvCatalog(project);
}

function defaultCompanion(project: string, kind: EnvKind): string | undefined {
  const cat = loadEnvCatalog(project);
  if (kind === 'model') {
    return cat.agents.find((a) => a.verifiedAt)?.id ?? cat.agents[0]?.id;
  }
  return cat.models.find((m) => m.verifiedAt)?.id ?? cat.models[0]?.id;
}

function markVerified(project: string, kind: EnvKind, id: string): EnvCatalog {
  const file = readCatalogFile(project);
  const verified = file.verified ?? {};
  const now = new Date().toISOString();
  if (kind === 'model') {
    verified.models = { ...(verified.models ?? {}), [id]: now };
  } else {
    verified.agents = { ...(verified.agents ?? {}), [id]: now };
  }
  writeCatalogFile(project, { ...file, verified });
  return loadEnvCatalog(project);
}

function runHelloWorld(model: string, agent: string): { ok: boolean; log: string } {
  const workDir = mkdtempSync(join(tmpdir(), 'proctor-env-hello-'));
  try {
    writeFileSync(join(workDir, 'README.md'), '# hello\n');
    const bin = process.env.PROCTOR_OPENCODE_BIN ?? 'opencode';
    const run = spawnSync(
      bin,
      ['run', '--print-logs', '-m', model, '--agent', agent, `请只回复 ${HELLO}`],
      {
        cwd: workDir,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, CI: '1' },
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    const ok = text.includes(HELLO);
    return { ok, log: text.slice(0, 4000) };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function verifyEnvEntry(
  project: string,
  kind: EnvKind,
  id: string,
): { catalog: EnvCatalog; ok: boolean; log: string } | { error: string; code: number } {
  if (kind !== 'model' && kind !== 'agent') return { error: 'kind 须为 model 或 agent', code: 400 };
  const cat = loadEnvCatalog(project);
  const list = kind === 'model' ? cat.models : cat.agents;
  if (!list.some((x) => x.id === id)) return { error: '请先在运行环境页添加该项', code: 400 };
  const companion = defaultCompanion(project, kind);
  if (!companion) {
    return {
      error: kind === 'model' ? '请先添加一个 Agent 再验证模型' : '请先添加一个模型再验证 Agent',
      code: 400,
    };
  }
  if (process.env.PROCTOR_CONSOLE_VERIFY_STUB === '1') {
    return { catalog: markVerified(project, kind, id), ok: true, log: 'stub: HELLO_WORLD' };
  }
  const model = kind === 'model' ? id : companion;
  const agent = kind === 'agent' ? id : companion;
  const result = runHelloWorld(model, agent);
  if (!result.ok) {
    return { catalog: loadEnvCatalog(project), ok: false, log: result.log || 'Hello World 未成功' };
  }
  return { catalog: markVerified(project, kind, id), ok: true, log: result.log };
}

export function isVerified(project: string, kind: EnvKind, id: string): boolean {
  const v = verifiedEnvIds(project);
  return kind === 'model' ? v.models.includes(id) : v.agents.includes(id);
}

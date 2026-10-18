/**
 * 可保存的测试任务：选题 + 配置 + 跑次历史。
 * 落在评测项目 eval-tasks/，不写回 dataset-releases/。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { writeJsonAtomic } from './json-io.ts';
import { parseJsonObject, str } from './parse.ts';
import {
  defaultExamMode,
  defaultRelease,
  isExamMode,
  isExperimentId,
  type ExamMode,
  type ExperimentId,
} from './run-plan.ts';
import { getTestSet, testSetIdFromRelease } from './test-sets.ts';

export const EVAL_TASK_ID_RE = /^et-[a-z0-9]+$/;

export type EvalTaskRun = {
  path: string;
  startedAt: string;
  jobId: string;
};

export type EvalTask = {
  id: string;
  name: string;
  kind: ExperimentId;
  release: string;
  testSetId: string;
  taskIds: string[];
  examMode: ExamMode;
  live: boolean;
  createdAt: string;
  updatedAt: string;
  runs: EvalTaskRun[];
  sutRoot?: string;
  model?: string;
  agent?: string;
};

export type EvalTaskInput = {
  name?: string;
  kind?: string;
  release?: string;
  testSetId?: string;
  taskIds?: string[];
  examMode?: string;
  live?: boolean;
  sutRoot?: string;
  model?: string;
  agent?: string;
};

export function evalTasksDir(project: string): string {
  return join(project, 'eval-tasks');
}

function safeId(id: string): string | undefined {
  if (!EVAL_TASK_ID_RE.test(id)) return undefined;
  return id;
}

function taskPath(project: string, id: string): string | undefined {
  const sid = safeId(id);
  if (!sid) return undefined;
  const dir = resolve(evalTasksDir(project));
  const abs = resolve(join(dir, `${sid}.json`));
  if (abs === dir || !abs.startsWith(dir + sep)) return undefined;
  return abs;
}

function normalizeKind(kind: string | undefined): ExperimentId | undefined {
  if (kind === undefined || !isExperimentId(kind)) return undefined;
  return kind;
}

function examModeFor(kind: ExperimentId, raw: string | undefined): ExamMode {
  if (kind !== 'plugin') return 'off';
  if (raw === undefined) return defaultExamMode(kind);
  if (!isExamMode(raw)) return defaultExamMode(kind);
  return raw;
}

function resolveTestSetRef(
  project: string,
  kind: ExperimentId,
  release?: string,
  testSetId?: string,
): { release: string; testSetId: string } | { error: string; code: number } {
  const sid = testSetId?.trim();
  if (sid) {
    const ts = getTestSet(project, sid);
    if ('error' in ts) return ts;
    return { testSetId: ts.id, release: ts.offRelease };
  }
  const ps = release?.trim();
  if (ps) {
    const derived = testSetIdFromRelease(ps) ?? 'full';
    return { release: ps, testSetId: derived };
  }
  return { release: defaultRelease(kind), testSetId: 'full' };
}

function clipName(name: string | undefined): string {
  const t = (name ?? '').trim();
  return t || '未命名测试任务';
}

function readTaskFile(file: string): { ok: true; task: EvalTask } | { ok: false; error: string } {
  let doc: Record<string, unknown>;
  try {
    const text = readFileSync(file, 'utf8');
    const parsed = parseJsonObject(text, file);
    if (!parsed.ok) return parsed;
    doc = parsed.value;
  } catch {
    return { ok: false, error: '文件读取失败' };
  }

  const id = str(doc.id);
  if (id === undefined || !safeId(id)) return { ok: false, error: '缺少或非法 id' };
  const kindRaw = str(doc.kind);
  if (kindRaw === undefined || !isExperimentId(kindRaw))
    return { ok: false, error: '缺少或非法 kind' };
  const kind = kindRaw as ExperimentId;
  const examMode = examModeFor(kind, typeof doc.examMode === 'string' ? doc.examMode : undefined);
  const taskIds = Array.isArray(doc.taskIds)
    ? doc.taskIds.filter((x): x is string => typeof x === 'string')
    : [];
  const runs = Array.isArray(doc.runs)
    ? doc.runs.filter(
        (r): r is EvalTaskRun =>
          Boolean(r) &&
          typeof r === 'object' &&
          r !== null &&
          typeof (r as Record<string, unknown>).path === 'string' &&
          typeof (r as Record<string, unknown>).startedAt === 'string' &&
          typeof (r as Record<string, unknown>).jobId === 'string',
      )
    : [];
  const release =
    typeof doc.release === 'string' && doc.release ? doc.release : defaultRelease(kind);
  const testSetId =
    typeof doc.testSetId === 'string' && doc.testSetId
      ? doc.testSetId
      : (testSetIdFromRelease(release) ?? 'full');
  const out: EvalTask = {
    id,
    name: clipName(typeof doc.name === 'string' ? doc.name : undefined),
    kind,
    release,
    testSetId,
    taskIds,
    examMode,
    live: doc.live !== false,
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : new Date().toISOString(),
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : new Date().toISOString(),
    runs,
  };
  if (typeof doc.sutRoot === 'string' && doc.sutRoot.trim()) out.sutRoot = doc.sutRoot.trim();
  if (typeof doc.model === 'string' && doc.model.trim()) out.model = doc.model.trim();
  if (typeof doc.agent === 'string' && doc.agent.trim()) out.agent = doc.agent.trim();
  return { ok: true, task: out };
}

function writeTask(project: string, task: EvalTask): void {
  mkdirSync(evalTasksDir(project), { recursive: true });
  const file = taskPath(project, task.id);
  if (!file) throw new Error('非法测试任务 id');
  writeJsonAtomic(file, task);
}

export type EvalTaskFileError = { file: string; error: string };

export function listEvalTasks(project: string): { tasks: EvalTask[]; errors: EvalTaskFileError[] } {
  const dir = evalTasksDir(project);
  const out: EvalTask[] = [];
  const errors: EvalTaskFileError[] = [];
  if (!existsSync(dir)) return { tasks: out, errors };
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const r = readTaskFile(join(dir, name));
    if (r.ok) out.push(r.task);
    else errors.push({ file: name, error: r.error });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { tasks: out, errors };
}

export function getEvalTask(
  project: string,
  id: string,
): EvalTask | { error: string; code: number } {
  const file = taskPath(project, id);
  if (!file) return { error: '非法测试任务 id', code: 400 };
  if (!existsSync(file)) return { error: '测试任务不存在', code: 404 };
  const r = readTaskFile(file);
  if (!r.ok) return { error: `测试任务文件损坏：${r.error}`, code: 500 };
  return r.task;
}

function newId(): string {
  return `et-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createEvalTask(
  project: string,
  body: EvalTaskInput,
): EvalTask | { error: string; code: number } {
  const kind = normalizeKind(body.kind);
  if (!kind) return { error: 'kind 须为 model / plugin / agent', code: 400 };
  if (body.taskIds !== undefined) {
    if (!Array.isArray(body.taskIds) || body.taskIds.some((x) => typeof x !== 'string')) {
      return { error: 'taskIds 须为人题号数组', code: 400 };
    }
  }
  if (kind === 'plugin' && body.examMode !== undefined && !isExamMode(body.examMode)) {
    return { error: 'examMode 须为 off / on / both', code: 400 };
  }
  const ref = resolveTestSetRef(project, kind, body.release, body.testSetId);
  if ('error' in ref) return ref;
  const now = new Date().toISOString();
  let id = newId();
  while (existsSync(join(evalTasksDir(project), `${id}.json`))) id = newId();
  const task: EvalTask = {
    id,
    name: clipName(body.name),
    kind,
    release: ref.release,
    testSetId: ref.testSetId,
    taskIds: body.taskIds ?? [],
    examMode: examModeFor(kind, body.examMode),
    live: body.live !== false,
    createdAt: now,
    updatedAt: now,
    runs: [],
  };
  const sut = body.sutRoot?.trim();
  const model = body.model?.trim();
  const agent = body.agent?.trim();
  if (sut) task.sutRoot = sut;
  if (model) task.model = model;
  if (agent) task.agent = agent;
  writeTask(project, task);
  return task;
}

export function updateEvalTask(
  project: string,
  id: string,
  body: EvalTaskInput,
): EvalTask | { error: string; code: number } {
  const existing = getEvalTask(project, id);
  if ('error' in existing) return existing;
  if (body.kind !== undefined) {
    const incoming = normalizeKind(body.kind);
    if (!incoming) return { error: 'kind 须为 model / plugin / agent', code: 400 };
    if (incoming !== existing.kind) {
      return { error: '类型创建后不可改，请新建另一条任务', code: 400 };
    }
  }
  const kind = existing.kind;
  if (body.taskIds !== undefined) {
    if (!Array.isArray(body.taskIds) || body.taskIds.some((x) => typeof x !== 'string')) {
      return { error: 'taskIds 须为人题号数组', code: 400 };
    }
  }
  if (kind === 'plugin' && body.examMode !== undefined && !isExamMode(body.examMode)) {
    return { error: 'examMode 须为 off / on / both', code: 400 };
  }
  const ref =
    body.testSetId !== undefined || body.release !== undefined
      ? resolveTestSetRef(project, kind, body.release ?? existing.release, body.testSetId)
      : { release: existing.release, testSetId: existing.testSetId };
  if ('error' in ref) return ref;
  const next: EvalTask = {
    ...existing,
    kind,
    name: body.name !== undefined ? clipName(body.name) : existing.name,
    release: ref.release,
    testSetId: ref.testSetId,
    taskIds: body.taskIds !== undefined ? body.taskIds : existing.taskIds,
    examMode: examModeFor(kind, body.examMode !== undefined ? body.examMode : existing.examMode),
    live: body.live !== undefined ? Boolean(body.live) : existing.live,
    updatedAt: new Date().toISOString(),
    runs: existing.runs,
  };
  if (body.sutRoot !== undefined) {
    const sut = body.sutRoot.trim();
    if (sut) next.sutRoot = sut;
    else delete next.sutRoot;
  }
  if (body.model !== undefined) {
    const model = body.model.trim();
    if (model) next.model = model;
    else delete next.model;
  }
  if (body.agent !== undefined) {
    const agent = body.agent.trim();
    if (agent) next.agent = agent;
    else delete next.agent;
  }
  writeTask(project, next);
  return next;
}

export function deleteEvalTask(
  project: string,
  id: string,
): { ok: true } | { error: string; code: number } {
  const file = taskPath(project, id);
  if (!file) return { error: '非法测试任务 id', code: 400 };
  if (!existsSync(file)) return { error: '测试任务不存在', code: 404 };
  unlinkSync(file);
  return { ok: true };
}

export function appendEvalTaskRun(
  project: string,
  id: string,
  run: EvalTaskRun,
): EvalTask | { error: string; code: number } {
  const existing = getEvalTask(project, id);
  if ('error' in existing) return existing;
  const next: EvalTask = {
    ...existing,
    updatedAt: new Date().toISOString(),
    runs: [...existing.runs, run],
  };
  writeTask(project, next);
  return next;
}

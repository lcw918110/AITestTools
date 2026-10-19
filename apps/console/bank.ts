/**
 * product-eval 题库读写（严格版 · 对齐需求 03 / 设计 09）。
 * 仅操作 bank/ + 相关 dataset-releases。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import {
  getTestSet,
  offReleaseOf,
  onReleaseOf,
  releaseFilesForTestSet,
  testSetIdsForTask,
} from './test-sets.ts';
import { writeJsonAtomic, writeTextAtomic } from './json-io.ts';
import { revisionDigest } from '../../src/exam-engine/digest.ts';
import type { CaseRevision, RubricSpec, TaskStrata } from '../../src/exam-engine/types.ts';

/** 路径安全：已有任务（含历史特例） */
const TASK_ID_SAFE_RE = /^[A-Z][A-Z0-9-]*$/;
/** 录题题号硬规则 */
export const CREATE_TASK_ID_RE = /^PAIRED-TASK-[0-9]{2,}$/;
export const PASS_TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const TAG_RE = /^[A-Za-z0-9_-]+$/;
export const FORBIDDEN_TASK_TAGS = new Set(['paired', 'plugin-on', 'plugin-off', 'effect']);

export const DEFAULT_MODEL = 'wave-ai/gpt-5.4-mini';

const TEXT_ONLY_PROMPT_RE =
  /text[\s-]*only|do not use tools|do not explore the repo|不要使用工具|不要探索(?:仓库|代码库)/i;

export type ItemSide = {
  id: string;
  rev: number;
  file: string;
  passToken: string;
  notes: string;
  tags: string[];
  contains?: string[] | undefined;
  notContains?: string[] | undefined;
  rubric?: RubricSpec | undefined;
  strata?: TaskStrata | undefined;
};

export type TaskSummary = {
  taskId: string;
  passToken: string;
  labelPassToken: string;
  versionLabel: string;
  completeLabel: string;
  notes: string;
  promptPreview: string;
  offId?: string;
  onId?: string;
  offRev?: number;
  onRev?: number;
  complete: boolean;
  tags: string[];
  testSetIds: string[];
  lifecycle?: string;
  automationReadiness?: string;
};

export type TaskDetail = {
  taskId: string;
  prompt: string;
  passToken: string;
  hosted_pass_token: string;
  notes: string;
  offId?: string;
  onId?: string;
  off?: ItemSide;
  on?: ItemSide;
  complete: boolean;
  versionLabel: string;
  completeLabel: string;
  tags: string[];
  contains?: string[] | undefined;
  notContains?: string[] | undefined;
  lifecycle?: string;
  automationReadiness?: string;
  lifecycleHistory?: Array<{ from: string; to: string; reason: string; at: string }>;
  rubric?: RubricSpec | undefined;
  strata?: TaskStrata | undefined;
};

export type CreateTaskBody = {
  taskId?: string;
  prompt?: string;
  passToken?: string;
  /** 兼容旧字段 */
  hosted_pass_token?: string;
  notes?: string | null;
  /** 任务类型（可选） */
  tags?: string[] | string;
  /** 回复必须出现（stdout_assert.contains）；缺省=终态词 */
  contains?: string | string[];
  /** 回复禁止出现（stdout_assert.not_contains） */
  notContains?: string | string[];
  not_contains?: string | string[];
  /** 显式冒烟例外：允许题干含 Text-only 等；默认关 */
  allowSmokeTextOnly?: boolean;
  /** 挂入哪套测试集 */
  testSetId?: string;
  /** Rubric 声明（expect.rubric.dimensions，可选 judge） */
  rubric?: RubricSpec;
  /** 分层（task_type / difficulty_level） */
  strata?: TaskStrata;
  /** 生命周期（默认 draft） */
  lifecycle?: string;
  /** 自动化准备度（默认 not_assessed） */
  automationReadiness?: string;
};

export type UpdateTaskBody = {
  prompt?: string;
  passToken?: string;
  hosted_pass_token?: string;
  notes?: string;
  tags?: string[] | string;
  changeName?: string;
  /** 回复必须出现（stdout_assert.contains）；缺省=终态词 */
  contains?: string | string[];
  /** 回复禁止出现（stdout_assert.not_contains） */
  notContains?: string | string[];
  not_contains?: string | string[];
  /** Rubric 声明（expect.rubric.dimensions，可选 judge） */
  rubric?: RubricSpec;
  /** 分层（task_type / difficulty_level） */
  strata?: TaskStrata;
  /** 自动化准备度（正交可编辑，不升版本） */
  automationReadiness?: string;
};

type CreateSnapshot = {
  taskId: string;
  materialsDir: string;
  files: string[];
  releaseAdds: Array<{ releaseFile: string; caseRevisionId: string }>;
};

export function safeUnder(root: string, target: string): string | undefined {
  const abs = resolve(target);
  const rootAbs = resolve(root);
  if (abs === rootAbs || abs.startsWith(rootAbs + sep)) return abs;
  return undefined;
}

export function assertSafeTaskId(taskId: string): string | undefined {
  if (
    !TASK_ID_SAFE_RE.test(taskId) ||
    taskId.includes('..') ||
    taskId.includes('/') ||
    taskId.includes('\\')
  ) {
    return '非法 taskId';
  }
  return undefined;
}

export function assertCreateTaskId(taskId: string): string | undefined {
  const safe = assertSafeTaskId(taskId);
  if (safe) return safe;
  if (!CREATE_TASK_ID_RE.test(taskId)) {
    return '题号须匹配 PAIRED-TASK-NN（至少两位数字）';
  }
  return undefined;
}

export function assertPassToken(token: string): string | undefined {
  if (!token) return '缺少怎样算对（终态词）';
  if (/\s/.test(token) || !PASS_TOKEN_RE.test(token)) {
    return '终态词格式非法（仅字母数字_-，禁止空白）';
  }
  return undefined;
}

/** 硬门禁：终态词须作为子串出现在题干中 */
export function assertPromptContainsToken(prompt: string, token: string): string | undefined {
  if (!prompt.trim()) return '缺少题干';
  if (!prompt.includes(token)) {
    return '请把终态词写进题干';
  }
  return undefined;
}

/** 新题禁止 Text-only / 禁工具题干（既有题改题不走此门） */
export function assertPromptAllowsTools(
  prompt: string,
  opts?: { allowSmokeTextOnly?: boolean },
): string | undefined {
  if (opts?.allowSmokeTextOnly) return undefined;
  if (TEXT_ONLY_PROMPT_RE.test(prompt)) {
    return '题干禁止 Text-only / 禁工具 / 禁探索仓库；新题须能用工具或仓库才能过';
  }
  return undefined;
}

export function assertPassTokenUnique(
  project: string,
  token: string,
  exceptTaskId?: string,
): string | undefined {
  for (const t of listTasks(project)) {
    if (exceptTaskId !== undefined && t.taskId === exceptTaskId) continue;
    if (t.passToken === token) {
      return `终态词已被 ${t.taskId} 占用，请换一个`;
    }
  }
  return undefined;
}

/** 下一空号：现有 PAIRED-TASK-N 的 max+1（至少两位） */
export function nextCreateTaskId(project: string): string {
  let max = 0;
  for (const t of listTasks(project)) {
    const m = t.taskId.match(/^PAIRED-TASK-(\d+)$/);
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  const next = max + 1;
  return `PAIRED-TASK-${String(Math.max(next, 1)).padStart(2, '0')}`;
}

function asTrimmedList(value: unknown): string[] {
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  return [];
}

/** 任务类型：逗号分隔或数组；禁止废弃对照/考场标签。 */
export function parseTags(
  raw: unknown,
): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, tags: [] };
  let parts: string[] = [];
  if (typeof raw === 'string') {
    parts = raw.split(/[,，]/);
  } else if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x !== 'string') return { ok: false, error: 'tags 须为字符串数组' };
      parts.push(x);
    }
  } else {
    return { ok: false, error: 'tags 须为字符串或字符串数组' };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (!TAG_RE.test(t)) return { ok: false, error: `任务类型非法：${t}` };
    const key = t.toLowerCase();
    if (FORBIDDEN_TASK_TAGS.has(key)) {
      return { ok: false, error: `禁止把 ${t} 当任务类型` };
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return { ok: true, tags: out };
}

export function assertChangeName(name: string | undefined): string | undefined {
  const t = (name ?? '').trim();
  if (t.length < 4) return '变更说明至少 4 个字';
  return undefined;
}

/** 校验 strata 字段完整性：task_type 与 difficulty_level 均须为非空字符串。 */
export function assertStrata(strata: unknown): string | undefined {
  if (strata === undefined || strata === null) return undefined;
  if (typeof strata !== 'object' || Array.isArray(strata)) return '分层（strata）须为对象';
  const s = strata as Record<string, unknown>;
  const taskType = typeof s.task_type === 'string' ? s.task_type.trim() : '';
  const difficulty = typeof s.difficulty_level === 'string' ? s.difficulty_level.trim() : '';
  if (!taskType) return '分层缺少 task_type（任务类型）';
  if (!difficulty) return '分层缺少 difficulty_level（难度）';
  return undefined;
}

export function resolvePassToken(body: {
  passToken?: string | undefined;
  hosted_pass_token?: string | undefined;
}): string {
  return (body.passToken ?? body.hosted_pass_token ?? '').trim();
}

function materialsDir(project: string, taskId: string): string {
  return join(project, 'bank/materials', taskId);
}

/** cases-v1：Case 文档（轻量读字段）。 */
type CaseV1Doc = {
  case_id: string;
  title?: string;
  owner?: string;
  tags?: string[];
  pair_key?: string;
  head_revision_id?: string;
  lifecycle?: string;
  automation_readiness?: string;
  lifecycle_history?: Array<{ from: string; to: string; reason: string; at: string }>;
};

/** cases-v1：CaseRevision 文档（轻量读字段）。 */
type CaseRevisionV1Doc = {
  case_id: string;
  case_revision_id: string;
  revision_number?: number;
  stimulus?: {
    kind?: string;
    ref?: string;
    notes?: string;
    hosted_pass_token?: string;
  };
  expect?: { oracles?: unknown; rubric?: RubricSpec };
  attribution_focus?: string;
  protocol_probes?: string[];
  strata?: TaskStrata;
};

function casesV1Dir(project: string): string {
  return join(project, 'cases');
}

function caseRevisionsV1Dir(project: string): string {
  return join(project, 'case-revisions');
}

/** case_id → V1 item_id（还原历史 run 产物的 item_id 格式，与 run-plan/job-queue 下游约定一致）。 */
function caseIdToV1ItemId(caseId: string, variant: 'off' | 'on'): string {
  return `EVAL-B-${caseId.toUpperCase()}-${variant.toUpperCase()}`;
}

/** 从 CaseRevision + Case 映射到 ItemSide（id 还原 V1 id，rev 用 revision_number）。 */
function sideFromRevision(
  project: string,
  rev: CaseRevisionV1Doc,
  caseDoc: CaseV1Doc,
  variant: 'off' | 'on',
): ItemSide {
  let contains: string[] | undefined;
  let notContains: string[] | undefined;
  const expect = rev.expect;
  if (typeof expect === 'object' && expect !== null && !Array.isArray(expect)) {
    const oracles = (expect as Record<string, unknown>).oracles;
    if (Array.isArray(oracles)) {
      for (const o of oracles) {
        if (o && typeof o === 'object') {
          const obj = o as Record<string, unknown>;
          if (obj.id === 'stdout-must' && obj.contains !== undefined) {
            contains = asTrimmedList(obj.contains);
          } else if (obj.id === 'stdout-forbid' && obj.not_contains !== undefined) {
            notContains = asTrimmedList(obj.not_contains);
          }
        }
      }
    }
  }
  const v1Id = caseIdToV1ItemId(rev.case_id, variant);
  // file 指向 case-revision 路径（写路径 updateTask/deleteTask 的操作目标）。
  const file = join(caseRevisionsV1Dir(project), caseRevisionFileName(rev.case_revision_id));
  return {
    id: v1Id,
    rev: Number(rev.revision_number) || 0,
    file,
    passToken: rev.stimulus?.hosted_pass_token ?? 'ok',
    notes: rev.stimulus?.notes ?? '',
    tags: Array.isArray(caseDoc.tags) ? caseDoc.tags.filter((t) => typeof t === 'string') : [],
    contains,
    notContains,
    rubric: rev.expect?.rubric,
    strata: rev.strata,
  };
}

/** 读 cases-v1 资产（cases + case-revisions），映射为配对 ItemSide。 */
function loadPairedItemsV1(project: string): Map<string, { off?: ItemSide; on?: ItemSide }> {
  const map = new Map<string, { off?: ItemSide; on?: ItemSide }>();
  const casesDir = casesV1Dir(project);
  const revisionsDir = caseRevisionsV1Dir(project);
  if (!existsSync(casesDir) || !existsSync(revisionsDir)) return map;

  const caseById = new Map<string, CaseV1Doc>();
  for (const name of readdirSync(casesDir)) {
    if (!name.endsWith('.case.json')) continue;
    try {
      const doc = JSON.parse(readFileSync(join(casesDir, name), 'utf8')) as CaseV1Doc;
      if (doc.case_id) caseById.set(doc.case_id, doc);
    } catch {
      continue;
    }
  }

  for (const name of readdirSync(revisionsDir)) {
    if (!name.endsWith('.case-revision.json')) continue;
    const file = join(revisionsDir, name);
    let rev: CaseRevisionV1Doc;
    try {
      rev = JSON.parse(readFileSync(file, 'utf8')) as CaseRevisionV1Doc;
    } catch {
      continue;
    }
    const caseDoc = caseById.get(rev.case_id);
    if (!caseDoc) continue;
    const variant: 'off' | 'on' = rev.case_revision_id.includes('.on') ? 'on' : 'off';
    const pair = caseDoc.pair_key ?? rev.case_id.toUpperCase();
    const slot = map.get(pair) ?? {};
    const side = sideFromRevision(project, rev, caseDoc, variant);
    if (variant === 'on') slot.on = side;
    else slot.off = side;
    map.set(pair, slot);
  }
  return map;
}

function versionLabel(offRev?: number, onRev?: number): string {
  const off = offRev !== undefined ? `无插件 v${offRev}` : '无插件 —';
  const on = onRev !== undefined ? `有插件 v${onRev}` : '有插件 —';
  return `${off} · ${on}`;
}

function completeLabel(complete: boolean): string {
  return complete ? '完整' : '不完整';
}

function loadPairedItems(project: string): Map<string, { off?: ItemSide; on?: ItemSide }> {
  return loadPairedItemsV1(project);
}

/** 按 pair_key（= taskId）查 Case 文档，读 lifecycle / automation_readiness / lifecycle_history。 */
function caseDocByPairKey(project: string, pairKey: string): CaseV1Doc | undefined {
  const casesDir = casesV1Dir(project);
  if (!existsSync(casesDir)) return undefined;
  for (const name of readdirSync(casesDir)) {
    if (!name.endsWith('.case.json')) continue;
    try {
      const doc = JSON.parse(readFileSync(join(casesDir, name), 'utf8')) as CaseV1Doc;
      if ((doc.pair_key ?? (doc.case_id ? doc.case_id.toUpperCase() : '')) === pairKey) return doc;
    } catch {
      continue;
    }
  }
  return undefined;
}

function clipPreview(text: string, max = 220): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (!one) return '';
  return one.length <= max ? one : `${one.slice(0, max)}…`;
}

export function listTasks(project: string): TaskSummary[] {
  const materialsRoot = join(project, 'bank/materials');
  const paired = loadPairedItems(project);
  const ids = new Set<string>();
  if (existsSync(materialsRoot)) {
    for (const n of readdirSync(materialsRoot)) {
      if (!n.startsWith('.')) ids.add(n);
    }
  }
  for (const k of paired.keys()) ids.add(k);

  const out: TaskSummary[] = [];
  for (const taskId of [...ids].sort()) {
    const slot = paired.get(taskId) ?? {};
    const promptPath = join(materialsDir(project, taskId), 'prompt.txt');
    const hasMat = existsSync(promptPath);
    const prompt = hasMat ? readFileSync(promptPath, 'utf8') : '';
    const notes = (slot.off?.notes || slot.on?.notes || '').trim();
    const passToken = slot.off?.passToken ?? slot.on?.passToken ?? 'ok';
    const complete = Boolean(hasMat && slot.off && slot.on);
    const caseDoc = caseDocByPairKey(project, taskId);
    out.push({
      taskId,
      passToken,
      labelPassToken: passToken,
      versionLabel: versionLabel(slot.off?.rev, slot.on?.rev),
      completeLabel: completeLabel(complete),
      notes,
      promptPreview: clipPreview(prompt),
      complete,
      tags: slot.off?.tags ?? slot.on?.tags ?? [],
      ...(slot.off?.id !== undefined ? { offId: slot.off.id } : {}),
      ...(slot.on?.id !== undefined ? { onId: slot.on.id } : {}),
      ...(slot.off?.rev !== undefined ? { offRev: slot.off.rev } : {}),
      ...(slot.on?.rev !== undefined ? { onRev: slot.on.rev } : {}),
      testSetIds: testSetIdsForTask(project, taskId),
      ...(caseDoc?.lifecycle ? { lifecycle: caseDoc.lifecycle } : {}),
      ...(caseDoc?.automation_readiness
        ? { automationReadiness: caseDoc.automation_readiness }
        : {}),
    });
  }
  return out;
}

export function getTask(
  project: string,
  taskId: string,
): TaskDetail | { error: string; code: number } {
  const bad = assertSafeTaskId(taskId);
  if (bad) return { error: bad, code: 400 };
  const mat = materialsDir(project, taskId);
  if (!safeUnder(join(project, 'bank/materials'), mat)) return { error: '路径非法', code: 400 };
  const promptFile = join(mat, 'prompt.txt');
  const paired = loadPairedItems(project).get(taskId) ?? {};
  if (!existsSync(promptFile) && !paired.off && !paired.on) {
    return { error: '任务不存在', code: 404 };
  }
  const prompt = existsSync(promptFile) ? readFileSync(promptFile, 'utf8') : '';
  const token = paired.off?.passToken ?? paired.on?.passToken ?? 'ok';
  const notes = paired.off?.notes ?? paired.on?.notes ?? '';
  const complete = Boolean(existsSync(promptFile) && paired.off && paired.on);
  const caseDoc = caseDocByPairKey(project, taskId);
  const detail: TaskDetail = {
    taskId,
    prompt,
    passToken: token,
    hosted_pass_token: token,
    notes,
    complete,
    versionLabel: versionLabel(paired.off?.rev, paired.on?.rev),
    completeLabel: completeLabel(complete),
    tags: paired.off?.tags ?? paired.on?.tags ?? [],
    contains: paired.off?.contains ?? paired.on?.contains,
    notContains: paired.off?.notContains ?? paired.on?.notContains,
    ...(caseDoc?.lifecycle ? { lifecycle: caseDoc.lifecycle } : {}),
    ...(caseDoc?.automation_readiness ? { automationReadiness: caseDoc.automation_readiness } : {}),
    ...(caseDoc?.lifecycle_history ? { lifecycleHistory: caseDoc.lifecycle_history } : {}),
    ...((paired.off?.rubric ?? paired.on?.rubric)
      ? { rubric: paired.off?.rubric ?? paired.on?.rubric }
      : {}),
    ...((paired.off?.strata ?? paired.on?.strata)
      ? { strata: paired.off?.strata ?? paired.on?.strata }
      : {}),
  };
  if (paired.off !== undefined) {
    detail.off = paired.off;
    detail.offId = paired.off.id;
  }
  if (paired.on !== undefined) {
    detail.on = paired.on;
    detail.onId = paired.on.id;
  }
  return detail;
}

function writeJson(file: string, doc: unknown): void {
  writeJsonAtomic(file, doc);
}

export async function updateTask(
  project: string,
  _repoRoot: string,
  taskId: string,
  body: UpdateTaskBody,
): Promise<TaskDetail | { error: string; code: number; log?: string }> {
  const existing = getTask(project, taskId);
  if ('error' in existing) return existing;

  const changeErr = assertChangeName(body.changeName);
  if (changeErr) return { error: changeErr, code: 400 };
  const changeName = (body.changeName ?? '').trim();

  const tokenProvided = body.passToken !== undefined || body.hosted_pass_token !== undefined;
  const nextToken = tokenProvided ? resolvePassToken(body) : existing.passToken;
  if (tokenProvided) {
    const tokenErr = assertPassToken(nextToken);
    if (tokenErr) return { error: tokenErr, code: 400 };
    const uniqErr = assertPassTokenUnique(project, nextToken, taskId);
    if (uniqErr) return { error: uniqErr, code: 400 };
  }

  const nextPrompt = body.prompt !== undefined ? body.prompt : existing.prompt;
  if (body.prompt !== undefined && !nextPrompt.trim()) {
    return { error: '缺少题干', code: 400 };
  }
  const containErr = assertPromptContainsToken(nextPrompt, nextToken);
  if (containErr) return { error: containErr, code: 400 };

  // 落盘前解析 tags（避免先写盘才发现非法）。
  const tagsResult = body.tags !== undefined ? parseTags(body.tags) : undefined;
  if (tagsResult && !tagsResult.ok) return { error: tagsResult.error, code: 400 };
  const nextTags = tagsResult?.ok ? tagsResult.tags : undefined;

  // 落盘前校验 strata 字段完整性（避免半填落盘 undefined）。
  if (body.strata !== undefined) {
    const strataErr = assertStrata(body.strata);
    if (strataErr) return { error: strataErr, code: 400 };
  }

  const stimPatch: { hosted_pass_token?: string; notes?: string } = {};
  if (tokenProvided) stimPatch.hosted_pass_token = nextToken;
  if (body.notes !== undefined) stimPatch.notes = body.notes;
  const changedStim = Object.keys(stimPatch).length > 0;

  const containsProvided = body.contains !== undefined;
  const notContainsProvided = body.notContains !== undefined || body.not_contains !== undefined;
  const rubricProvided = body.rubric !== undefined;
  const strataProvided = body.strata !== undefined;

  // 需要更新 OFF/ON item 却一个都没有：结构错误，落盘前即失败，避免先写 prompt.txt 才发现。
  const needsItems =
    changedStim ||
    body.tags !== undefined ||
    containsProvided ||
    notContainsProvided ||
    rubricProvided ||
    strataProvided;
  if (needsItems && !existing.off && !existing.on) {
    return { error: '无可更新的 OFF/ON item', code: 400 };
  }

  const mat = materialsDir(project, taskId);
  mkdirSync(mat, { recursive: true });
  if (!safeUnder(join(project, 'bank'), mat)) return { error: '路径非法', code: 400 };

  const promptFile = join(mat, 'prompt.txt');
  const caseId = caseIdOfTask(taskId);
  const caseFile = join(casesV1Dir(project), caseFileName(caseId));

  // 继承旧值，应用 patch，得到 OFF/ON 各自的新 revision 内容。
  const offNextRev = (existing.off?.rev ?? 0) + 1;
  const onNextRev = (existing.on?.rev ?? 0) + 1;
  const offNextToken = tokenProvided ? nextToken : (existing.off?.passToken ?? nextToken);
  const onNextToken = tokenProvided ? nextToken : (existing.on?.passToken ?? nextToken);
  const offNextNotes = body.notes !== undefined ? body.notes : (existing.off?.notes ?? '');
  const onNextNotes = body.notes !== undefined ? body.notes : (existing.on?.notes ?? '');
  const offNextContains = containsProvided
    ? asTrimmedList(body.contains)
    : (existing.off?.contains ?? []);
  const onNextContains = containsProvided
    ? asTrimmedList(body.contains)
    : (existing.on?.contains ?? []);
  const offNextNotContains = notContainsProvided
    ? asTrimmedList(body.notContains ?? body.not_contains)
    : (existing.off?.notContains ?? []);
  const onNextNotContains = notContainsProvided
    ? asTrimmedList(body.notContains ?? body.not_contains)
    : (existing.on?.notContains ?? []);
  const offNextRubric = rubricProvided ? body.rubric : (existing.off?.rubric ?? undefined);
  const onNextRubric = rubricProvided ? body.rubric : (existing.on?.rubric ?? undefined);
  const offNextStrata = strataProvided ? body.strata : (existing.off?.strata ?? undefined);
  const onNextStrata = strataProvided ? body.strata : (existing.on?.strata ?? undefined);

  const offRevDoc = buildCaseRevisionDoc({
    taskId,
    side: 'off',
    revisionNumber: offNextRev,
    token: offNextToken,
    notes: offNextNotes,
    contains: offNextContains,
    notContains: offNextNotContains,
    changeName,
    ...(offNextRubric ? { rubric: offNextRubric } : {}),
    ...(offNextStrata ? { strata: offNextStrata } : {}),
  });
  const onRevDoc = buildCaseRevisionDoc({
    taskId,
    side: 'on',
    revisionNumber: onNextRev,
    token: onNextToken,
    notes: onNextNotes,
    contains: onNextContains,
    notContains: onNextNotContains,
    changeName,
    ...(onNextRubric ? { rubric: onNextRubric } : {}),
    ...(onNextStrata ? { strata: onNextStrata } : {}),
  });
  const offNextRevisionId = caseRevisionIdOf(caseId, offNextRev, 'off');
  const onNextRevisionId = caseRevisionIdOf(caseId, onNextRev, 'on');
  const offNextRevFile = join(caseRevisionsV1Dir(project), caseRevisionFileName(offNextRevisionId));
  const onNextRevFile = join(caseRevisionsV1Dir(project), caseRevisionFileName(onNextRevisionId));

  // 快照所有可能被本次更新改写的文件，用于失败回滚。
  const snap = snapshotFiles([promptFile, caseFile, offNextRevFile, onNextRevFile]);

  try {
    if (body.prompt !== undefined) {
      writeFileSync(
        join(mat, 'prompt.txt'),
        body.prompt.endsWith('\n') ? body.prompt : `${body.prompt}\n`,
      );
    }

    mkdirSync(caseRevisionsV1Dir(project), { recursive: true });
    if (existing.off) writeJson(offNextRevFile, offRevDoc);
    if (existing.on) writeJson(onNextRevFile, onRevDoc);

    // 更新 case.json 的 head_revision_id 与 tags。
    const caseDoc = readCaseFile(caseFile);
    if (!caseDoc) throw new Error('缺少 case：' + caseFile);
    caseDoc.head_revision_id = onNextRevisionId;
    if (nextTags !== undefined) {
      if (nextTags.length > 0) caseDoc.tags = nextTags;
      else delete caseDoc.tags;
    }
    // automation_readiness 属 Case 层元数据，变更不升版本，直接写 case.json。
    if (body.automationReadiness !== undefined) {
      caseDoc.automation_readiness = body.automationReadiness;
    }
    writeJson(caseFile, caseDoc);

    // 更新 dataset-release 的 content_hash 引用：按测试集定位 off/on release，
    // 移除旧 revision 引用并追加新 revision 引用（off 进 off release，on 进 on release）。
    for (const testSetId of testSetIdsForTask(project, taskId)) {
      if (existing.off) {
        const oldOffId = caseRevisionIdOf(caseId, existing.off.rev, 'off');
        const offReleaseFile = `${offReleaseOf(testSetId)}.dataset-release.json`;
        removeDatasetReleaseItem(project, offReleaseFile, oldOffId);
        appendDatasetReleaseItem(project, offReleaseFile, {
          case_id: caseId,
          case_revision_id: offNextRevisionId,
          content_hash: offRevDoc.content_hash as string,
        });
      }
      if (existing.on) {
        const oldOnId = caseRevisionIdOf(caseId, existing.on.rev, 'on');
        const onReleaseFile = `${onReleaseOf(testSetId)}.dataset-release.json`;
        removeDatasetReleaseItem(project, onReleaseFile, oldOnId);
        appendDatasetReleaseItem(project, onReleaseFile, {
          case_id: caseId,
          case_revision_id: onNextRevisionId,
          content_hash: onRevDoc.content_hash as string,
        });
      }
    }
  } catch (e) {
    restoreFiles(snap);
    return { error: (e as Error).message, code: 500 };
  }

  return getTask(project, taskId);
}

/** stdout 断言 oracles：与创建路径完全一致（创建与改题共用） */
function buildOracles(opts: {
  token: string;
  contains: string[];
  notContains: string[];
}): Record<string, unknown>[] {
  const { token, contains, notContains } = opts;
  const mustAppear = contains.length > 0 ? contains : [token];
  const stdoutMust: Record<string, unknown> = {
    id: 'stdout-must',
    type: 'stdout_assert',
    contains: mustAppear.length === 1 ? mustAppear[0] : mustAppear,
  };
  const oracles: Record<string, unknown>[] = [
    { id: 'exit0', type: 'exit_code', equals: 0 },
    stdoutMust,
  ];
  if (notContains.length > 0) {
    oracles.push({
      id: 'stdout-forbid',
      type: 'stdout_assert',
      not_contains: notContains.length === 1 ? notContains[0] : notContains,
    });
  }
  return oracles;
}

// ── cases-v1 写路径（阶段 5 步骤 2 B2/B3）──

/** taskId（PAIRED-TASK-99）→ case_id（paired-task-99）。 */
function caseIdOfTask(taskId: string): string {
  return taskId.toLowerCase();
}

/** case_id + revision_number + side → case_revision_id（paired-task-99.r1.off）。 */
function caseRevisionIdOf(caseId: string, revisionNumber: number, side: 'off' | 'on'): string {
  return `${caseId}.r${revisionNumber}.${side}`;
}

/** case_id → case 文件名（paired-task-99.case.json）。 */
function caseFileName(caseId: string): string {
  return `${caseId}.case.json`;
}

/** case_revision_id → case-revision 文件名（paired-task-99.r1.off.case-revision.json）。 */
function caseRevisionFileName(caseRevisionId: string): string {
  return `${caseRevisionId}.case-revision.json`;
}

function datasetReleasesDir(project: string): string {
  return join(project, 'dataset-releases');
}

/** 生成 Case 文档（不含 created_at/updated_at，与现有资产一致）。 */
function buildCaseDoc(opts: {
  taskId: string;
  title: string;
  tags: string[];
  headRevisionId: string;
  lifecycle?: string;
  automationReadiness?: string;
}): Record<string, unknown> {
  const lifecycle = opts.lifecycle ?? 'draft';
  const readiness = opts.automationReadiness ?? 'not_assessed';
  return {
    $schema: '../../../schemas/case.schema.json',
    case_id: caseIdOfTask(opts.taskId),
    title: opts.title,
    owner: 'product-eval',
    tags: opts.tags,
    lifecycle,
    automation_readiness: readiness,
    head_revision_id: opts.headRevisionId,
    pair_key: opts.taskId,
    lifecycle_history: [
      {
        from: lifecycle,
        to: lifecycle,
        reason: '控制台录题（初始状态）',
        at: new Date().toISOString(),
      },
    ],
  };
}

/** 生成 CaseRevision 文档（含 content_hash）。 */
function buildCaseRevisionDoc(opts: {
  taskId: string;
  side: 'off' | 'on';
  revisionNumber: number;
  token: string;
  notes: string;
  contains: string[];
  notContains: string[];
  changeName: string;
  rubric?: RubricSpec;
  strata?: TaskStrata;
}): Record<string, unknown> {
  const {
    taskId,
    side,
    revisionNumber,
    token,
    notes,
    contains,
    notContains,
    changeName,
    rubric,
    strata,
  } = opts;
  const caseId = caseIdOfTask(taskId);
  const caseRevisionId = caseRevisionIdOf(caseId, revisionNumber, side);
  const ref = `bank/materials/${taskId}/prompt.txt`;
  const isOn = side === 'on';
  const oracles = buildOracles({ token, contains, notContains });

  const stimulus = {
    kind: 'task_prompt',
    ref,
    notes: notes || `Seal with ${token}. Use the repo and tools when the task requires it.`,
    hosted_pass_token: token,
  };
  const expect = rubric ? { oracles, rubric } : { oracles };
  const execution = {
    deadline_ms: 180000,
    requires_network: true,
    requires_durable_log: isOn,
  };

  // content_hash 只依赖 stimulus/preconditions/expect/evidence_requirements/setup_cleanup。
  const draft = {
    case_id: caseId,
    case_revision_id: caseRevisionId,
    revision_number: revisionNumber,
    content_hash: '',
    stimulus,
    preconditions: [],
    steps: [],
    setup_cleanup: [],
    permissions_side_effects: [],
    expect,
    evidence_requirements: [],
    ...(strata ? { strata } : {}),
    attribution_focus: isOn ? 'PROTOCOL' : 'MODEL_TASK',
    ...(isOn
      ? { protocol_probes: ['RuntimeStarted', 'JournalEnvelope'] }
      : { protocol_probes: [] }),
    model_id: DEFAULT_MODEL,
    execution,
    change_log: { [`rev${revisionNumber}`]: changeName },
  } as unknown as CaseRevision;

  const contentHash = revisionDigest(draft);

  return {
    $schema: '../../../schemas/case-revision.schema.json',
    case_id: caseId,
    case_revision_id: caseRevisionId,
    revision_number: revisionNumber,
    content_hash: contentHash,
    stimulus,
    preconditions: [],
    steps: [],
    setup_cleanup: [],
    permissions_side_effects: [],
    expect,
    evidence_requirements: [],
    ...(strata ? { strata } : {}),
    attribution_focus: isOn ? 'PROTOCOL' : 'MODEL_TASK',
    ...(isOn
      ? { protocol_probes: ['RuntimeStarted', 'JournalEnvelope'] }
      : { protocol_probes: [] }),
    model_id: DEFAULT_MODEL,
    execution,
    change_log: { [`rev${revisionNumber}`]: changeName },
  };
}

/** 读 dataset-release 文档（轻量）。 */
function readDatasetRelease(
  project: string,
  fileName: string,
): Record<string, unknown> | undefined {
  const path = join(datasetReleasesDir(project), fileName);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** 往 dataset-release 追加 case_revision 引用（含 content_hash）。 */
function appendDatasetReleaseItem(
  project: string,
  releaseFile: string,
  ref: { case_id: string; case_revision_id: string; content_hash: string },
): boolean {
  const doc = readDatasetRelease(project, releaseFile);
  if (!doc) return false;
  const caseRevisions = Array.isArray(doc.case_revisions) ? doc.case_revisions : [];
  const exists = caseRevisions.some(
    (r) =>
      r &&
      typeof r === 'object' &&
      (r as Record<string, unknown>).case_revision_id === ref.case_revision_id,
  );
  if (!exists) {
    caseRevisions.push(ref);
    doc.case_revisions = caseRevisions;
    writeJson(join(datasetReleasesDir(project), releaseFile), doc);
  }
  return true;
}

/** 从 dataset-release 移除 case_revision 引用。 */
function removeDatasetReleaseItem(
  project: string,
  releaseFile: string,
  caseRevisionId: string,
): void {
  const doc = readDatasetRelease(project, releaseFile);
  if (!doc) return;
  const caseRevisions = Array.isArray(doc.case_revisions) ? doc.case_revisions : [];
  const next = caseRevisions.filter(
    (r) =>
      !(
        r &&
        typeof r === 'object' &&
        (r as Record<string, unknown>).case_revision_id === caseRevisionId
      ),
  );
  if (next.length === caseRevisions.length) return;
  doc.case_revisions = next;
  writeJson(join(datasetReleasesDir(project), releaseFile), doc);
}

/** 从所有 dataset-release 移除某个 case_revision 引用。 */
function removeFromAllDatasetReleases(project: string, caseRevisionId: string): void {
  const dir = datasetReleasesDir(project);
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.dataset-release.json')) removeDatasetReleaseItem(project, f, caseRevisionId);
  }
}

/** 读 case 文档（轻量）。 */
function readCaseFile(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** 文件快照：记录是否存在与原文，用于多文件写入失败时回滚。 */
type FileSnapshot = { file: string; existed: boolean; content?: string | undefined };

function snapshotFiles(files: Array<string | undefined>): FileSnapshot[] {
  const out: FileSnapshot[] = [];
  for (const f of files) {
    if (!f) continue;
    if (existsSync(f)) {
      // 目录占位（非文件）跳过内容读取，回滚时按 existed 处理（restoreFiles 已容错）。
      const isDir = statSync(f).isDirectory();
      out.push({ file: f, existed: true, content: isDir ? undefined : readFileSync(f, 'utf8') });
    } else {
      out.push({ file: f, existed: false });
    }
  }
  return out;
}

/** 逆序恢复快照：原存在则写回原文（原子），原不存在则删除。 */
function restoreFiles(snaps: FileSnapshot[]): void {
  for (const s of [...snaps].reverse()) {
    try {
      if (s.existed) writeTextAtomic(s.file, s.content ?? '');
      else rmSync(s.file, { force: true });
    } catch {
      /* 回滚尽力而为：单文件恢复失败不阻断其它文件 */
    }
  }
}

export function rollbackCreate(project: string, snap: CreateSnapshot): void {
  for (const add of [...snap.releaseAdds].reverse()) {
    removeDatasetReleaseItem(project, add.releaseFile, add.caseRevisionId);
  }
  for (const file of [...snap.files].reverse()) {
    if (existsSync(file)) rmSync(file, { force: true });
  }
  if (existsSync(snap.materialsDir)) {
    rmSync(snap.materialsDir, { recursive: true, force: true });
  }
}

export type ValidateFn = () => Promise<{ exitCode: number; ok: boolean; log: string }>;

/**
 * 录题：预检 → 落盘 →（可选）校验；校验失败整笔回滚。
 */
export async function createTask(
  project: string,
  body: CreateTaskBody,
  options?: { validate?: ValidateFn },
): Promise<TaskDetail | { error: string; code: number; log?: string }> {
  const taskId = (body.taskId ?? '').trim();
  const bad = assertCreateTaskId(taskId);
  if (bad) return { error: bad, code: 400 };

  const token = resolvePassToken(body);
  const tokenErr = assertPassToken(token);
  if (tokenErr) return { error: tokenErr, code: 400 };
  const uniqErr = assertPassTokenUnique(project, token);
  if (uniqErr) return { error: uniqErr, code: 400 };

  const prompt = body.prompt ?? '';
  const containErr = assertPromptContainsToken(prompt, token);
  if (containErr) return { error: containErr, code: 400 };
  const textOnlyErr = assertPromptAllowsTools(prompt, {
    allowSmokeTextOnly: body.allowSmokeTextOnly === true,
  });
  if (textOnlyErr) return { error: textOnlyErr, code: 400 };

  const mat = materialsDir(project, taskId);
  if (!safeUnder(join(project, 'bank/materials'), mat)) return { error: '路径非法', code: 400 };
  if (existsSync(join(mat, 'prompt.txt'))) return { error: '任务 materials 已存在', code: 409 };

  const notes =
    body.notes === null || body.notes === undefined || body.notes === ''
      ? `Seal with ${token}. Use the repo and tools when the task requires it.`
      : body.notes;

  const contains = asTrimmedList(body.contains);
  const notContains = asTrimmedList(body.notContains ?? body.not_contains);
  const parsedTags = parseTags(body.tags);
  if (!parsedTags.ok) return { error: parsedTags.error, code: 400 };

  const strataErr = assertStrata(body.strata);
  if (strataErr) return { error: strataErr, code: 400 };

  if (body.lifecycle !== undefined && !isLifecycleState(body.lifecycle)) {
    return { error: `非法生命周期状态：${body.lifecycle}`, code: 400 };
  }

  const testSetId = (body.testSetId ?? '').trim();
  if (!testSetId) return { error: '请选择测试集', code: 400 };
  const testSet = getTestSet(project, testSetId);
  if ('error' in testSet) return testSet;
  const hang = releaseFilesForTestSet(testSet.id);

  const caseId = caseIdOfTask(taskId);
  const offRevisionId = caseRevisionIdOf(caseId, 1, 'off');
  const onRevisionId = caseRevisionIdOf(caseId, 1, 'on');
  const changeName = '控制台录题';

  const caseFile = join(casesV1Dir(project), caseFileName(caseId));
  const offRevFile = join(caseRevisionsV1Dir(project), caseRevisionFileName(offRevisionId));
  const onRevFile = join(caseRevisionsV1Dir(project), caseRevisionFileName(onRevisionId));
  if (existsSync(caseFile) || existsSync(offRevFile) || existsSync(onRevFile)) {
    return { error: '任务已存在', code: 409 };
  }

  const offRevDoc = buildCaseRevisionDoc({
    taskId,
    side: 'off',
    revisionNumber: 1,
    token,
    notes,
    contains,
    notContains,
    changeName,
    ...(body.rubric ? { rubric: body.rubric } : {}),
    ...(body.strata ? { strata: body.strata } : {}),
  });
  const onRevDoc = buildCaseRevisionDoc({
    taskId,
    side: 'on',
    revisionNumber: 1,
    token,
    notes,
    contains,
    notContains,
    changeName,
    ...(body.rubric ? { rubric: body.rubric } : {}),
    ...(body.strata ? { strata: body.strata } : {}),
  });
  const caseDoc = buildCaseDoc({
    taskId,
    title: `配对任务 ${taskId}（有插件）：终态须含 ${token}`,
    tags: parsedTags.tags,
    headRevisionId: onRevisionId,
    ...(body.lifecycle ? { lifecycle: body.lifecycle } : {}),
    ...(body.automationReadiness ? { automationReadiness: body.automationReadiness } : {}),
  });

  const snap: CreateSnapshot = {
    taskId,
    materialsDir: mat,
    files: [],
    releaseAdds: [],
  };

  try {
    mkdirSync(mat, { recursive: true });
    mkdirSync(casesV1Dir(project), { recursive: true });
    mkdirSync(caseRevisionsV1Dir(project), { recursive: true });
    const promptFile = join(mat, 'prompt.txt');
    writeFileSync(promptFile, prompt.endsWith('\n') ? prompt : `${prompt}\n`);
    snap.files.push(promptFile);
    writeJson(caseFile, caseDoc);
    snap.files.push(caseFile);
    writeJson(offRevFile, offRevDoc);
    snap.files.push(offRevFile);
    writeJson(onRevFile, onRevDoc);
    snap.files.push(onRevFile);

    const offRef = {
      case_id: caseId,
      case_revision_id: offRevisionId,
      content_hash: offRevDoc.content_hash as string,
    };
    const onRef = {
      case_id: caseId,
      case_revision_id: onRevisionId,
      content_hash: onRevDoc.content_hash as string,
    };
    if (!appendDatasetReleaseItem(project, hang.offFile, offRef)) {
      throw new Error('测试集无插件名单不存在');
    }
    snap.releaseAdds.push({ releaseFile: hang.offFile, caseRevisionId: offRevisionId });
    if (!appendDatasetReleaseItem(project, hang.onFile, onRef)) {
      throw new Error('测试集有插件名单不存在');
    }
    snap.releaseAdds.push({ releaseFile: hang.onFile, caseRevisionId: onRevisionId });

    if (options?.validate) {
      const v = await options.validate();
      if (!v.ok) {
        rollbackCreate(project, snap);
        return {
          error: '录题后校验失败，已回滚',
          code: 500,
          log: v.log,
        };
      }
    }
  } catch (e) {
    rollbackCreate(project, snap);
    return { error: (e as Error).message, code: 500 };
  }

  const detail = getTask(project, taskId);
  if ('error' in detail) return detail;
  return detail;
}

/** 删除配对任务：须 confirmId === taskId */
export function deleteTask(
  project: string,
  taskId: string,
  confirmId?: string,
): { ok: true; taskId: string } | { error: string; code: number } {
  const bad = assertSafeTaskId(taskId);
  if (bad) return { error: bad, code: 400 };
  if (confirmId === undefined || confirmId !== taskId) {
    return { error: '请原样输入题号确认删除', code: 400 };
  }
  const existing = getTask(project, taskId);
  if ('error' in existing) return existing;

  const mat = materialsDir(project, taskId);
  if (!safeUnder(join(project, 'bank/materials'), mat)) return { error: '路径非法', code: 400 };

  const caseId = caseIdOfTask(taskId);
  const caseFile = join(casesV1Dir(project), caseFileName(caseId));
  const revisionsDir = caseRevisionsV1Dir(project);

  // 删除该 case 的所有 case-revision 文件（r1..rN × off/on）。
  if (existsSync(revisionsDir)) {
    const prefix = `${caseId}.r`;
    for (const f of readdirSync(revisionsDir)) {
      if (f.startsWith(prefix) && f.endsWith('.case-revision.json')) {
        const revFile = join(revisionsDir, f);
        if (safeUnder(join(project, 'case-revisions'), revFile)) {
          const caseRevisionId = f.slice(0, -'.case-revision.json'.length);
          removeFromAllDatasetReleases(project, caseRevisionId);
          rmSync(revFile, { force: true });
        }
      }
    }
  }
  // 删除 case.json。
  if (existsSync(caseFile) && safeUnder(join(project, 'cases'), caseFile)) {
    rmSync(caseFile, { force: true });
  }
  if (existsSync(mat)) {
    rmSync(mat, { recursive: true, force: true });
  }
  return { ok: true, taskId };
}

// ── 生命周期状态机（第 1 期录题界面化）──

/** 生命周期枚举（与 src/domain/types.ts CASE_LIFECYCLE 一致）。 */
const LIFECYCLE_ORDER = [
  'draft',
  'candidate',
  'reviewed',
  'validated',
  'released',
  'deprecated',
] as const;
type LifecycleState = (typeof LIFECYCLE_ORDER)[number];

function isLifecycleState(v: string): v is LifecycleState {
  return (LIFECYCLE_ORDER as readonly string[]).includes(v);
}

/**
 * 校验生命周期流转：线性前进 + candidate/reviewed/validated 可回退 draft +
 * released 后仅可 deprecated；deprecated 终态。返回 undefined 表示合法，否则返回错误说明。
 */
export function assertLifecycleTransition(from: string, to: string): string | undefined {
  if (!isLifecycleState(from)) return `非法起始状态：${from}`;
  if (!isLifecycleState(to)) return `非法目标状态：${to}`;
  if (from === to) return undefined;

  const fromIdx = LIFECYCLE_ORDER.indexOf(from);
  const toIdx = LIFECYCLE_ORDER.indexOf(to);

  // released 保护：仅可前进到 deprecated，其余一律拒绝（先于前进判断，保证文案精确）。
  if (from === 'released') {
    if (to === 'deprecated') return undefined;
    return 'released 后不可回退，仅可弃用（deprecated）';
  }
  if (from === 'deprecated') {
    return 'deprecated 为终态，不可再流转';
  }

  // 前进：只能 +1（线性，禁止跳步）
  if (toIdx === fromIdx + 1) return undefined;

  // 回退：仅 candidate/reviewed/validated → draft
  if (to === 'draft' && (from === 'candidate' || from === 'reviewed' || from === 'validated')) {
    return undefined;
  }

  if (toIdx > fromIdx) {
    return `不可跳步：${from} → ${to}（须逐级前进）`;
  }
  return `非法流转：${from} → ${to}`;
}

/**
 * 生命周期推进/回退：校验 → 写 case.json 的 lifecycle + lifecycle_history。
 * 元数据变更不升版本。
 */
export async function transitionLifecycle(
  project: string,
  taskId: string,
  to: string,
  reason: string,
): Promise<{ ok: true; taskId: string; lifecycle: string } | { error: string; code: number }> {
  const existing = getTask(project, taskId);
  if ('error' in existing) return existing;

  const caseDoc = caseDocByPairKey(project, taskId);
  if (!caseDoc) return { error: '缺少 case 文档', code: 404 };

  const from = caseDoc.lifecycle ?? 'draft';
  if (from === to) return { error: `已是 ${to}，无需流转`, code: 400 };
  const bad = assertLifecycleTransition(from, to);
  if (bad) return { error: bad, code: 400 };

  const caseFile = join(casesV1Dir(project), caseFileName(caseIdOfTask(taskId)));
  const history = Array.isArray(caseDoc.lifecycle_history) ? caseDoc.lifecycle_history : [];
  const nextHistory = [
    ...history,
    { from, to, reason: reason.trim() || '（未说明）', at: new Date().toISOString() },
  ];

  const nextDoc = {
    ...caseDoc,
    lifecycle: to,
    lifecycle_history: nextHistory,
  };

  try {
    writeJson(caseFile, nextDoc);
  } catch (e) {
    return { error: (e as Error).message, code: 500 };
  }

  return { ok: true, taskId, lifecycle: to };
}

export function summarizeValidateLog(log: string, exitCode: number): string {
  const m = log.match(/(\d+\/\d+\s+试题通过[^\n]*)/);
  if (m?.[1]) return m[1].trim();
  if (exitCode === 0) return '题库校验通过';
  return `题库校验失败（exit ${exitCode}）`;
}

export async function validateBank(
  repoRoot: string,
): Promise<{ exitCode: number; ok: boolean; log: string; summary: string }> {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolveExit) => {
    const child = spawn(
      npm,
      [
        'run',
        'proctor',
        '--',
        'item',
        'validate',
        '--project',
        'examples/product-eval',
        '--check-fixtures',
      ],
      { cwd: repoRoot, env: process.env },
    );
    let log = '';
    child.stdout.on('data', (b: Buffer) => {
      log += b.toString('utf8');
    });
    child.stderr.on('data', (b: Buffer) => {
      log += b.toString('utf8');
    });
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      resolveExit({
        exitCode,
        ok: exitCode === 0,
        log,
        summary: summarizeValidateLog(log, exitCode),
      });
    });
    child.on('error', (err) =>
      resolveExit({
        exitCode: 1,
        ok: false,
        log: err.message,
        summary: summarizeValidateLog(err.message, 1),
      }),
    );
  });
}

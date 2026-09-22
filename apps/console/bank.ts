/**
 * product-eval 题库读写（严格版 · 对齐需求 03 / 设计 09）。
 * 仅操作 bank/ + 相关 papersets。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { getTestSet, papersetFilesForTestSet, testSetIdsForTask } from './test-sets.ts';

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
};

type ItemDoc = {
  id: string;
  rev: number;
  title?: string;
  intent?: {
    effect_pair?: string;
    statement?: string;
    attribution_focus?: string;
    protocol_probes?: string[];
  };
  stimulus?: {
    kind?: string;
    ref?: string;
    notes?: string;
    hosted_pass_token?: string;
  };
  freeze?: Record<string, unknown>;
  tags?: string[];
  expect?: unknown;
  metrics?: unknown;
  execution?: unknown;
  change_log?: Record<string, string>;
  axis?: string;
  status?: string;
  owner?: string;
};

type CreateSnapshot = {
  taskId: string;
  materialsDir: string;
  files: string[];
  papersetAdds: Array<{ papersetFile: string; itemId: string }>;
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
export function parseTags(raw: unknown): { ok: true; tags: string[] } | { ok: false; error: string } {
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

export function resolvePassToken(body: {
  passToken?: string | undefined;
  hosted_pass_token?: string | undefined;
}): string {
  return (body.passToken ?? body.hosted_pass_token ?? '').trim();
}

function kebabItemFile(id: string): string {
  return `${id.toLowerCase().replace(/_/g, '-')}.item.json`;
}

function materialsDir(project: string, taskId: string): string {
  return join(project, 'bank/materials', taskId);
}

function itemsBDir(project: string): string {
  return join(project, 'bank/items/B');
}

function readItem(file: string): ItemDoc | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as ItemDoc;
}

function effectPairOf(doc: ItemDoc): string | undefined {
  const pair = doc.intent?.effect_pair;
  if (pair) return pair;
  const id = doc.id;
  const m = id.match(/^EVAL-B-(.+)-(OFF|ON)$/);
  if (m?.[1]) {
    const mid = m[1];
    // 历史：EVAL-B-PAIRED-TASK-OFF → PAIRED-TASK-01
    if (mid === 'PAIRED-TASK') return 'PAIRED-TASK-01';
    return mid;
  }
  return undefined;
}

function sideFrom(doc: ItemDoc, file: string): ItemSide {
  let contains: string[] | undefined;
  let notContains: string[] | undefined;
  const expect = doc.expect;
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
  return {
    id: doc.id,
    rev: Number(doc.rev) || 0,
    file,
    passToken: doc.stimulus?.hosted_pass_token ?? 'ok',
    notes: doc.stimulus?.notes ?? '',
    tags: Array.isArray(doc.tags) ? doc.tags.filter((t) => typeof t === 'string') : [],
    contains,
    notContains,
  };
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
  const map = new Map<string, { off?: ItemSide; on?: ItemSide }>();
  const dir = itemsBDir(project);
  if (!existsSync(dir)) return map;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.item.json')) continue;
    const file = join(dir, name);
    const doc = readItem(file);
    if (!doc) continue;
    const pair = effectPairOf(doc);
    if (!pair) continue;
    const slot = map.get(pair) ?? {};
    if (doc.id.endsWith('-ON')) {
      slot.on = sideFrom(doc, file);
    } else {
      slot.off = sideFrom(doc, file);
    }
    map.set(pair, slot);
  }
  return map;
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
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

function updateItemStimulus(
  file: string,
  patch: { hosted_pass_token?: string; notes?: string },
): ItemDoc {
  const doc = readItem(file);
  if (!doc) throw new Error(`缺少 item：${file}`);
  const prev = doc.stimulus ?? {};
  const stimulus: NonNullable<ItemDoc['stimulus']> = {
    kind: prev.kind ?? 'task_prompt',
  };
  if (prev.ref !== undefined) stimulus.ref = prev.ref;
  if (patch.hosted_pass_token !== undefined) stimulus.hosted_pass_token = patch.hosted_pass_token;
  else if (prev.hosted_pass_token !== undefined)
    stimulus.hosted_pass_token = prev.hosted_pass_token;
  if (patch.notes !== undefined) stimulus.notes = patch.notes;
  else if (prev.notes !== undefined) stimulus.notes = prev.notes;
  doc.stimulus = stimulus;
  writeJson(file, doc);
  return doc;
}

function updateItemTags(file: string, tags: string[]): void {
  const doc = readItem(file);
  if (!doc) throw new Error(`缺少 item：${file}`);
  if (tags.length > 0) doc.tags = tags;
  else delete doc.tags;
  writeJson(file, doc);
}

/** 本地升版（与 proctor item bump-rev 语义一致） */
export function bumpItemFile(file: string, changeName: string): void {
  const doc = readItem(file);
  if (!doc) throw new Error(`缺少 item：${file}`);
  const prev = Number(doc.rev);
  if (!Number.isFinite(prev)) throw new Error(`试题缺少合法 rev：${file}`);
  const next = prev + 1;
  doc.rev = next;
  const log = doc.change_log && typeof doc.change_log === 'object' ? { ...doc.change_log } : {};
  log[`rev${next}`] = changeName;
  doc.change_log = log;
  writeJson(file, doc);
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

  const mat = materialsDir(project, taskId);
  mkdirSync(mat, { recursive: true });
  if (!safeUnder(join(project, 'bank'), mat)) return { error: '路径非法', code: 400 };

  if (body.prompt !== undefined) {
    writeFileSync(
      join(mat, 'prompt.txt'),
      body.prompt.endsWith('\n') ? body.prompt : `${body.prompt}\n`,
    );
  }

  const stimPatch: { hosted_pass_token?: string; notes?: string } = {};
  if (tokenProvided) stimPatch.hosted_pass_token = nextToken;
  if (body.notes !== undefined) stimPatch.notes = body.notes;

  const changedStim = Object.keys(stimPatch).length > 0;
  if (changedStim) {
    if (existing.off?.file) updateItemStimulus(existing.off.file, stimPatch);
    if (existing.on?.file) updateItemStimulus(existing.on.file, stimPatch);
    if (!existing.off && !existing.on) {
      return { error: '无可更新的 OFF/ON item', code: 400 };
    }
  }

  if (body.tags !== undefined) {
    const parsed = parseTags(body.tags);
    if (!parsed.ok) return { error: parsed.error, code: 400 };
    if (existing.off?.file) updateItemTags(existing.off.file, parsed.tags);
    if (existing.on?.file) updateItemTags(existing.on.file, parsed.tags);
    if (!existing.off && !existing.on) {
      return { error: '无可更新的 OFF/ON item', code: 400 };
    }
  }

  const containsProvided = body.contains !== undefined;
  const notContainsProvided =
    body.notContains !== undefined || body.not_contains !== undefined;
  if (containsProvided || notContainsProvided) {
    const srcFile = existing.off?.file ?? existing.on?.file;
    const contains = containsProvided
      ? asTrimmedList(body.contains)
      : oracleValueOf(srcFile, 'stdout-must', 'contains');
    const notContains = notContainsProvided
      ? asTrimmedList(body.notContains ?? body.not_contains)
      : oracleValueOf(srcFile, 'stdout-forbid', 'not_contains');
    const oracles = buildOracles({ token: nextToken, contains, notContains });
    if (existing.off?.file) updateItemOracles(existing.off.file, oracles);
    if (existing.on?.file) updateItemOracles(existing.on.file, oracles);
    if (!existing.off && !existing.on) {
      return { error: '无可更新的 OFF/ON item', code: 400 };
    }
  }

  // 强制升版本（无 bump 开关）
  try {
    if (existing.off?.file) bumpItemFile(existing.off.file, changeName);
    if (existing.on?.file) bumpItemFile(existing.on.file, changeName);
  } catch (e) {
    return { error: (e as Error).message, code: 500 };
  }

  return getTask(project, taskId);
}

function appendPapersetItem(project: string, papersetFile: string, itemId: string): boolean {
  const path = join(project, 'papersets', papersetFile);
  if (!existsSync(path)) return false;
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { items: string[] };
  if (!Array.isArray(doc.items)) doc.items = [];
  if (!doc.items.includes(itemId)) {
    doc.items.push(itemId);
    writeJson(path, doc);
    return true;
  }
  return false;
}

function removePapersetItem(project: string, papersetFile: string, itemId: string): void {
  const path = join(project, 'papersets', papersetFile);
  if (!existsSync(path)) return;
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { items: string[] };
  if (!Array.isArray(doc.items)) return;
  const next = doc.items.filter((id) => id !== itemId);
  if (next.length === doc.items.length) return;
  doc.items = next;
  writeJson(path, doc);
}

function removeItemFromAllPapersets(project: string, itemId: string): void {
  const dir = join(project, 'papersets');
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json')) removePapersetItem(project, f, itemId);
  }
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

/** 读取某个 item 的 expect.oracles 中指定 id 的 contains/not_contains 值（缺省=[]） */
function oracleValueOf(
  file: string | undefined,
  id: string,
  key: 'contains' | 'not_contains',
): string[] {
  if (!file) return [];
  const doc = readItem(file);
  if (!doc) return [];
  const expect = doc.expect;
  if (typeof expect !== 'object' || expect === null || Array.isArray(expect)) return [];
  const oracles = (expect as Record<string, unknown>).oracles;
  if (!Array.isArray(oracles)) return [];
  for (const o of oracles) {
    if (o && typeof o === 'object' && (o as Record<string, unknown>).id === id) {
      return asTrimmedList((o as Record<string, unknown>)[key]);
    }
  }
  return [];
}

/** 覆盖 item 的 expect.oracles（保留 expect 的其它字段） */
function updateItemOracles(file: string, oracles: Record<string, unknown>[]): void {
  const doc = readItem(file);
  if (!doc) throw new Error(`缺少 item：${file}`);
  const prevExpect =
    typeof doc.expect === 'object' && doc.expect !== null && !Array.isArray(doc.expect)
      ? (doc.expect as Record<string, unknown>)
      : {};
  doc.expect = { ...prevExpect, oracles };
  writeJson(file, doc);
}

function buildPairedItem(opts: {
  taskId: string;
  side: 'OFF' | 'ON';
  token: string;
  notes: string;
  contains: string[];
  notContains: string[];
  tags: string[];
}): { id: string; doc: ItemDoc } {
  const { taskId, side, token, notes, contains, notContains, tags } = opts;
  const id = `EVAL-B-${taskId}-${side}`;
  const ref = `bank/materials/${taskId}/prompt.txt`;
  const isOn = side === 'ON';
  const oracles = buildOracles({ token, contains, notContains });
  const doc: ItemDoc = {
    id,
    rev: 1,
    axis: 'B',
    status: 'active',
    title: isOn
      ? `配对任务 ${taskId}（有插件）：终态须含 ${token}`
      : `配对任务 ${taskId}（无插件）：终态须含 ${token}`,
    owner: 'product-eval',
    intent: {
      statement: isOn
        ? '与 OFF 同任务；挂万象术后应完成终态并产生 RuntimeStarted / JournalEnvelope'
        : '固定 Agent+模型+任务；无万象术时仍应完成约定终态（对照基线）',
      attribution_focus: isOn ? 'PROTOCOL' : 'MODEL_TASK',
      effect_pair: taskId,
      ...(isOn ? { protocol_probes: ['RuntimeStarted', 'JournalEnvelope'] } : {}),
    },
    freeze: {
      model_driver: 'live',
      model_id: DEFAULT_MODEL,
      host_profile: isOn ? 'hosted-plugin-v1' : 'hosted-plain-v1',
      tool_profile: 'none',
      prompt_template: ref,
      channel: 'hosted',
    },
    stimulus: {
      kind: 'task_prompt',
      ref,
      notes: notes || `Seal with ${token}. Use the repo and tools when the task requires it.`,
      hosted_pass_token: token,
    },
    expect: {
      oracles,
    },
    metrics: {
      primary: ['b_task_pass_rate', 'a_case_pass_rate'],
      secondary: isOn ? ['a_invariant_violations'] : [],
    },
    execution: {
      deadline_ms: 180000,
      requires_network: true,
      requires_durable_log: isOn,
    },
    change_log: {
      rev1: '控制台录题',
    },
  };
  if (tags.length > 0) doc.tags = tags;
  return { id, doc };
}

export function rollbackCreate(project: string, snap: CreateSnapshot): void {
  for (const add of [...snap.papersetAdds].reverse()) {
    removePapersetItem(project, add.papersetFile, add.itemId);
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

  const testSetId = (body.testSetId ?? '').trim();
  if (!testSetId) return { error: '请选择测试集', code: 400 };
  const testSet = getTestSet(project, testSetId);
  if ('error' in testSet) return testSet;
  const hang = papersetFilesForTestSet(testSet.id);

  const offBuilt = buildPairedItem({
    taskId,
    side: 'OFF',
    token,
    notes,
    contains,
    notContains,
    tags: parsedTags.tags,
  });
  const onBuilt = buildPairedItem({
    taskId,
    side: 'ON',
    token,
    notes,
    contains,
    notContains,
    tags: parsedTags.tags,
  });
  const offFile = join(itemsBDir(project), kebabItemFile(offBuilt.id));
  const onFile = join(itemsBDir(project), kebabItemFile(onBuilt.id));
  if (existsSync(offFile) || existsSync(onFile)) return { error: 'item 已存在', code: 409 };

  const snap: CreateSnapshot = {
    taskId,
    materialsDir: mat,
    files: [],
    papersetAdds: [],
  };

  try {
    mkdirSync(mat, { recursive: true });
    mkdirSync(itemsBDir(project), { recursive: true });
    const promptFile = join(mat, 'prompt.txt');
    writeFileSync(promptFile, prompt.endsWith('\n') ? prompt : `${prompt}\n`);
    snap.files.push(promptFile);
    writeJson(offFile, offBuilt.doc);
    snap.files.push(offFile);
    writeJson(onFile, onBuilt.doc);
    snap.files.push(onFile);

    if (!appendPapersetItem(project, hang.offFile, offBuilt.id)) {
      throw new Error('测试集无插件名单不存在');
    }
    snap.papersetAdds.push({ papersetFile: hang.offFile, itemId: offBuilt.id });
    if (!appendPapersetItem(project, hang.onFile, onBuilt.id)) {
      throw new Error('测试集有插件名单不存在');
    }
    snap.papersetAdds.push({ papersetFile: hang.onFile, itemId: onBuilt.id });

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

  if (existing.off?.file && safeUnder(join(project, 'bank/items'), existing.off.file)) {
    removeItemFromAllPapersets(project, existing.off.id);
    rmSync(existing.off.file, { force: true });
  }
  if (existing.on?.file && safeUnder(join(project, 'bank/items'), existing.on.file)) {
    removeItemFromAllPapersets(project, existing.on.id);
    rmSync(existing.on.file, { force: true });
  }
  if (existsSync(mat)) {
    rmSync(mat, { recursive: true, force: true });
  }
  return { ok: true, taskId };
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

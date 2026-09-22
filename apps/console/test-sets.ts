/**
 * 测试集：对人一份人题名单；磁盘成对 paperset（无插件 / 有插件）。
 * eval-model / eval-agent 等不进测试集列表。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { taskIdsOfItems } from './run-plan.ts';

export const ENV_PAPERSET_NAMES = new Set(['eval-model', 'eval-agent', 'eval-model-alt']);
export const TEST_SET_ID_RE = /^[a-z][a-z0-9-]{0,40}$/;
export const FULL_TEST_SET_ID = 'full';

const LABELS: Record<string, string> = {
  full: '全量',
  'effect-smoke': '效果小样本',
  calibrate: '校准',
  'alt-calibrate': '校准（对照模型）',
  smoke: '冒烟',
};

export type TestSet = {
  id: string;
  label: string;
  description: string;
  offPaperset: string;
  onPaperset: string;
  taskIds: string[];
};

type PapersetFile = {
  name: string;
  description?: string;
  axis?: string;
  room?: string;
  items?: string[];
};

function papersetsDir(project: string): string {
  return join(project, 'papersets');
}

function readPaperset(project: string, fileName: string): PapersetFile | undefined {
  const path = join(papersetsDir(project), fileName);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PapersetFile;
  } catch {
    return undefined;
  }
}

export function testSetIdFromPaperset(name: string): string | undefined {
  if (ENV_PAPERSET_NAMES.has(name)) return undefined;
  if (name === 'paired-off' || name === 'paired-on') return FULL_TEST_SET_ID;
  if (name.startsWith('paired-off-')) return name.slice('paired-off-'.length);
  if (name.startsWith('paired-on-')) return name.slice('paired-on-'.length);
  return undefined;
}

export function offPapersetOf(testSetId: string): string {
  return testSetId === FULL_TEST_SET_ID ? 'paired-off' : `paired-off-${testSetId}`;
}

export function onPapersetOf(testSetId: string): string {
  return testSetId === FULL_TEST_SET_ID ? 'paired-on' : `paired-on-${testSetId}`;
}

export function labelOfTestSet(id: string, description?: string): string {
  if (LABELS[id]) return LABELS[id];
  const desc = (description ?? '').trim();
  if (desc) {
    const first = desc.split(/[。.\n]/)[0]?.trim() ?? '';
    if (first && first.length <= 40) return first;
  }
  return id;
}

export function listTestSets(project: string): TestSet[] {
  const dir = papersetsDir(project);
  if (!existsSync(dir)) return [];
  const byId = new Map<string, { off?: PapersetFile; on?: PapersetFile }>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const doc = readPaperset(project, f);
    if (!doc?.name) continue;
    const id = testSetIdFromPaperset(doc.name);
    if (!id) continue;
    const slot = byId.get(id) ?? {};
    if (doc.name.includes('-on')) slot.on = doc;
    else slot.off = doc;
    byId.set(id, slot);
  }
  const out: TestSet[] = [];
  for (const [id, slot] of byId) {
    const off = slot.off;
    const on = slot.on;
    if (!off) continue;
    const taskIds = taskIdsOfItems(off.items ?? []);
    out.push({
      id,
      label: labelOfTestSet(id, off.description),
      description: (off.description ?? '').trim(),
      offPaperset: off.name,
      onPaperset: on?.name ?? onPapersetOf(id),
      taskIds,
    });
  }
  const order = ['effect-smoke', 'calibrate', 'smoke', 'alt-calibrate', FULL_TEST_SET_ID];
  out.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.label.localeCompare(b.label, 'zh');
  });
  return out;
}

export function getTestSet(
  project: string,
  id: string,
): TestSet | { error: string; code: number } {
  const row = listTestSets(project).find((t) => t.id === id);
  if (!row) return { error: `未知测试集：${id}`, code: 400 };
  return row;
}

function slugFromName(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (TEST_SET_ID_RE.test(ascii) && ascii !== FULL_TEST_SET_ID) return ascii;
  return `ts-${Date.now().toString(36)}`;
}

export function createTestSet(
  project: string,
  body: { name?: string; description?: string; id?: string },
): TestSet | { error: string; code: number } {
  const label = (body.name ?? '').trim();
  if (!label) return { error: '请填写测试集名称', code: 400 };
  const id = (body.id ?? '').trim() || slugFromName(label);
  if (!TEST_SET_ID_RE.test(id) || id === FULL_TEST_SET_ID) {
    return { error: '测试集短名须为小写字母开头的字母数字短横线', code: 400 };
  }
  if (listTestSets(project).some((t) => t.id === id)) {
    return { error: '测试集已存在', code: 409 };
  }
  const description = (body.description ?? '').trim() || label;
  const offName = offPapersetOf(id);
  const onName = onPapersetOf(id);
  const offPath = join(papersetsDir(project), `${offName}.json`);
  const onPath = join(papersetsDir(project), `${onName}.json`);
  if (existsSync(offPath) || existsSync(onPath)) {
    return { error: '测试集文件已存在', code: 409 };
  }
  writeFileSync(
    offPath,
    `${JSON.stringify(
      {
        name: offName,
        description,
        axis: 'B',
        room: 'hosted-plain-v1',
        items: [],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    onPath,
    `${JSON.stringify(
      {
        name: onName,
        description,
        axis: 'B',
        room: 'hosted-plugin-v1',
        items: [],
      },
      null,
      2,
    )}\n`,
  );
  const created = getTestSet(project, id);
  if ('error' in created) return created;
  return { ...created, label };
}

export function papersetFilesForTestSet(id: string): { offFile: string; onFile: string } {
  return {
    offFile: `${offPapersetOf(id)}.json`,
    onFile: `${onPapersetOf(id)}.json`,
  };
}

export function testSetIdsForTask(project: string, taskId: string): string[] {
  const out: string[] = [];
  for (const ts of listTestSets(project)) {
    if (ts.taskIds.includes(taskId)) out.push(ts.id);
  }
  return out;
}

/**
 * 测试集：对人一份人题名单；磁盘成对 dataset-release（无插件 / 有插件）。
 * eval-model / eval-agent 等不进测试集列表。
 * 阶段 5：数据源从 papersets/ 切换到 dataset-releases/（cases-v1）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './json-io.ts';
import { join } from 'node:path';
import { taskIdsOfCaseRevisions, taskIdsOfItems } from './run-plan.ts';

export const ENV_RELEASE_NAMES = new Set(['eval-model', 'eval-agent', 'eval-model-alt']);
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
  offRelease: string;
  onRelease: string;
  taskIds: string[];
};

type ReleaseFile = {
  dataset_release_id?: string;
  name?: string;
  description?: string;
  case_revisions?: Array<{ case_id?: string; case_revision_id?: string; content_hash?: string }>;
};

function releasesDir(project: string): string {
  return join(project, 'dataset-releases');
}

function readRelease(project: string, fileName: string): ReleaseFile | undefined {
  const path = join(releasesDir(project), fileName);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ReleaseFile;
  } catch {
    return undefined;
  }
}

export function testSetIdFromRelease(name: string): string | undefined {
  if (ENV_RELEASE_NAMES.has(name)) return undefined;
  if (name === 'paired-off' || name === 'paired-on') return FULL_TEST_SET_ID;
  if (name.startsWith('paired-off-')) return name.slice('paired-off-'.length);
  if (name.startsWith('paired-on-')) return name.slice('paired-on-'.length);
  return undefined;
}

export function offReleaseOf(testSetId: string): string {
  return testSetId === FULL_TEST_SET_ID ? 'paired-off' : `paired-off-${testSetId}`;
}

export function onReleaseOf(testSetId: string): string {
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

/** 从 dataset-release 的 case_revisions 提取人题号；为空时回退读 papersets items（写路径迁移前）。 */
function taskIdsOfRelease(
  project: string,
  releaseName: string,
  caseRevisions: Array<{ case_revision_id?: string }>,
): string[] {
  const fromRevisions = taskIdsOfCaseRevisions(caseRevisions);
  if (fromRevisions.length > 0) return fromRevisions;
  // 步骤 2 写路径迁移到 cases-v1 前，papersets items 仍是 taskIds 的权威来源。
  const papersetPath = join(project, 'papersets', `${releaseName}.json`);
  if (!existsSync(papersetPath)) return [];
  try {
    const doc = JSON.parse(readFileSync(papersetPath, 'utf8')) as { items?: string[] };
    return taskIdsOfItems(doc.items ?? []);
  } catch {
    return [];
  }
}

export function listTestSets(project: string): TestSet[] {
  const dir = releasesDir(project);
  if (!existsSync(dir)) return [];
  const byId = new Map<string, { off?: ReleaseFile; on?: ReleaseFile }>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.dataset-release.json')) continue;
    const doc = readRelease(project, f);
    const name = doc?.name ?? doc?.dataset_release_id;
    if (!name || !doc) continue;
    const id = testSetIdFromRelease(name);
    if (!id) continue;
    const slot = byId.get(id) ?? {};
    if (name.includes('-on')) slot.on = doc;
    else slot.off = doc;
    byId.set(id, slot);
  }
  const out: TestSet[] = [];
  for (const [id, slot] of byId) {
    const off = slot.off;
    const on = slot.on;
    if (!off) continue;
    const offName = off.name ?? off.dataset_release_id ?? offReleaseOf(id);
    const taskIds = taskIdsOfRelease(project, offName, off.case_revisions ?? []);
    out.push({
      id,
      label: labelOfTestSet(id, off.description),
      description: (off.description ?? '').trim(),
      offRelease: offName,
      onRelease: on?.name ?? on?.dataset_release_id ?? onReleaseOf(id),
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

export function getTestSet(project: string, id: string): TestSet | { error: string; code: number } {
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
  const offName = offReleaseOf(id);
  const onName = onReleaseOf(id);
  const offPath = join(releasesDir(project), `${offName}.dataset-release.json`);
  const onPath = join(releasesDir(project), `${onName}.dataset-release.json`);
  if (existsSync(offPath) || existsSync(onPath)) {
    return { error: '测试集文件已存在', code: 409 };
  }
  writeJsonAtomic(offPath, {
    dataset_release_id: offName,
    name: offName,
    description,
    case_revisions: [],
  });
  writeJsonAtomic(onPath, {
    dataset_release_id: onName,
    name: onName,
    description,
    case_revisions: [],
  });
  // 过渡：bank.ts 写路径（步骤 2）迁移前仍向 papersets/ 追加 item，
  // 须同步创建空的 papersets 文件，否则新建测试集无法录题。
  const papersetsDir = join(project, 'papersets');
  if (existsSync(papersetsDir)) {
    writeJsonAtomic(join(papersetsDir, `${offName}.json`), { name: offName, items: [] });
    writeJsonAtomic(join(papersetsDir, `${onName}.json`), { name: onName, items: [] });
  }
  const created = getTestSet(project, id);
  if ('error' in created) return created;
  return { ...created, label };
}

export function releaseFilesForTestSet(id: string): { offFile: string; onFile: string } {
  return {
    offFile: `${offReleaseOf(id)}.dataset-release.json`,
    onFile: `${onReleaseOf(id)}.dataset-release.json`,
  };
}

/**
 * 过渡：bank.ts 写路径（步骤 2）迁移前仍写 papersets/ 目录下的 .json 文件。
 * 保持旧语义（papersets 文件名），步骤 2 写路径迁移到 cases-v1 后移除。
 */
export function papersetFilesForTestSet(id: string): { offFile: string; onFile: string } {
  return {
    offFile: `${offReleaseOf(id)}.json`,
    onFile: `${onReleaseOf(id)}.json`,
  };
}

export function testSetIdsForTask(project: string, taskId: string): string[] {
  const out: string[] = [];
  for (const ts of listTestSets(project)) {
    if (ts.taskIds.includes(taskId)) out.push(ts.id);
  }
  return out;
}

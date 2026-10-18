/**
 * 测试任务：题目勾选 +（仅测万象术）有无插件 → 实际要跑的组卷/引擎条目。
 * 不写回 dataset-releases/。
 */

export type ExamMode = 'off' | 'on' | 'both';
export type ExperimentId = 'model' | 'plugin' | 'agent';

export const EXAM_MODES: readonly ExamMode[] = ['off', 'on', 'both'];

export function isExamMode(v: string): v is ExamMode {
  return v === 'off' || v === 'on' || v === 'both';
}

export function isExperimentId(v: string): v is ExperimentId {
  return v === 'model' || v === 'plugin' || v === 'agent';
}

export function defaultExamMode(experiment: ExperimentId): ExamMode {
  return experiment === 'plugin' ? 'both' : 'off';
}

export function defaultRelease(_experiment: ExperimentId): string {
  return 'paired-off';
}

export function defaultTestSetId(_experiment: ExperimentId): string {
  return 'full';
}

export function taskIdFromItemId(itemId: string): string | undefined {
  const m = itemId.match(/^EVAL-B-(.+)-(OFF|ON)$/);
  if (!m?.[1]) return undefined;
  if (m[1] === 'PAIRED-TASK') return 'PAIRED-TASK-01';
  return m[1];
}

/** 从 case_revision_id（如 paired-task-02.r6.off）提取人题号（PAIRED-TASK-02）。 */
export function taskIdFromCaseRevisionId(caseRevisionId: string): string | undefined {
  const m = caseRevisionId.match(/^([a-z0-9-]+?)\.r\d+\.(off|on)$/);
  if (!m?.[1]) return undefined;
  const base = m[1];
  if (base === 'paired-task') return 'PAIRED-TASK-01';
  return base.toUpperCase();
}

/** 从 dataset-release 的 case_revisions 提取人题号列表（去重保序）。 */
export function taskIdsOfCaseRevisions(
  caseRevisions: Array<{ case_revision_id?: string }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of caseRevisions) {
    const id = ref.case_revision_id;
    if (id === undefined) continue;
    const t = taskIdFromCaseRevisionId(id);
    if (t !== undefined && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function counterpartRelease(name: string, side: 'off' | 'on'): string {
  if (name.includes('-off')) {
    return side === 'off' ? name : name.replace('-off', '-on');
  }
  if (name.includes('-on')) {
    return side === 'on' ? name : name.replace('-on', '-off');
  }
  return side === 'off' ? name : 'paired-on';
}

export type ReleaseIndex = {
  name: string;
  case_revisions: string[];
  taskIds: string[];
};

export type TaskSides = {
  taskId: string;
  offId?: string;
  onId?: string;
};

export type RunStep = {
  release: string;
  itemIds: string[];
  side: 'off' | 'on';
};

export type RunPlan = {
  experiment: ExperimentId;
  examMode: ExamMode;
  release: string;
  taskIds: string[];
  legacy: 'paired' | 'model' | 'agent' | undefined;
  steps: RunStep[];
  compare: boolean;
  needsSut: boolean;
  skipped: string[];
};

export function taskIdsOfItems(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of items) {
    const t = taskIdFromItemId(id);
    if (t !== undefined && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function collectItemIds(
  selected: string[],
  tasks: Map<string, TaskSides>,
  side: 'off' | 'on',
  skipped: string[],
): string[] {
  const ids: string[] = [];
  for (const taskId of selected) {
    const row = tasks.get(taskId);
    const itemId = side === 'off' ? row?.offId : row?.onId;
    if (itemId === undefined) {
      skipped.push(`${taskId} 缺${side === 'off' ? '无插件' : '有插件'}条目`);
      continue;
    }
    ids.push(itemId);
  }
  return ids;
}

export function resolveRunPlan(input: {
  experiment: ExperimentId;
  examMode?: string | undefined;
  release?: string | undefined;
  taskIds?: string[] | undefined;
  releases: ReleaseIndex[];
  tasks: TaskSides[];
}): { ok: true; plan: RunPlan } | { ok: false; error: string } {
  const examMode =
    input.examMode === undefined ? defaultExamMode(input.experiment) : input.examMode;
  if (!isExamMode(examMode)) {
    return { ok: false, error: 'examMode 须为 off / on / both' };
  }

  const releaseName = input.release ?? defaultRelease(input.experiment);
  const rel = input.releases.find((p) => p.name === releaseName);
  if (rel === undefined) {
    return { ok: false, error: `未知测试集名单：${releaseName}` };
  }

  if (input.experiment !== 'plugin') {
    if (input.examMode !== undefined && input.examMode !== 'off') {
      return { ok: false, error: '无插件 / 有插件 / 同时跑只属于测万象术' };
    }
  }

  if (input.taskIds !== undefined && input.taskIds.length === 0) {
    return { ok: false, error: '请至少选一道题目' };
  }

  const pool = new Set(rel.taskIds);
  const selected = input.taskIds ?? [...rel.taskIds];
  for (const id of selected) {
    if (!pool.has(id)) {
      return { ok: false, error: `题目不在所选测试集中：${id}` };
    }
  }

  const taskMap = new Map(input.tasks.map((t) => [t.taskId, t]));
  const skipped: string[] = [];
  const steps: RunStep[] = [];

  if (examMode === 'off' || examMode === 'both') {
    const offName = counterpartRelease(releaseName, 'off');
    if (!input.releases.some((p) => p.name === offName)) {
      return { ok: false, error: `找不到无插件侧测试集文件：${offName}` };
    }
    const itemIds = collectItemIds(selected, taskMap, 'off', skipped);
    steps.push({ release: offName, itemIds, side: 'off' });
  }
  if (examMode === 'on' || examMode === 'both') {
    const onName = counterpartRelease(releaseName, 'on');
    if (!input.releases.some((p) => p.name === onName)) {
      return { ok: false, error: `找不到有插件侧测试集文件：${onName}` };
    }
    const itemIds = collectItemIds(selected, taskMap, 'on', skipped);
    steps.push({ release: onName, itemIds, side: 'on' });
  }

  if (steps.every((s) => s.itemIds.length === 0)) {
    return { ok: false, error: '本次运行环境没有可跑的引擎条目' };
  }

  const defRel = defaultRelease(input.experiment);
  const defMode = defaultExamMode(input.experiment);
  const defPool = input.releases.find((p) => p.name === defRel)?.taskIds ?? [];
  const isDefaultSelection =
    releaseName === defRel && examMode === defMode && sameIdSet(selected, defPool);

  let legacy: RunPlan['legacy'];
  if (isDefaultSelection) {
    if (input.experiment === 'plugin') legacy = 'paired';
    else if (input.experiment === 'model') legacy = 'model';
    else legacy = 'agent';
  }

  return {
    ok: true,
    plan: {
      experiment: input.experiment,
      examMode,
      release: releaseName,
      taskIds: selected,
      legacy,
      steps,
      compare: examMode === 'both',
      needsSut: examMode === 'on' || examMode === 'both',
      skipped,
    },
  };
}

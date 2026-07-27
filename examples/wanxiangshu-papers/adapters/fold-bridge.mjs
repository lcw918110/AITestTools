/**
 * 万象术 L1 Fold 桥接（考卷在本仓 papers/ 时，默认 SUT 根=仓库根）。
 * NDJSON → Fable WanEvent List → Review / Nudge / Squad DAG 投影。
 */
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

function sutRoot() {
  if (process.env.SUT_ROOT) return process.env.SUT_ROOT;
  return join(here, '../..');
}

function fableUrl(...parts) {
  return pathToFileURL(join(sutRoot(), ...parts)).href;
}

function resolveFableLibDir(root) {
  const base = join(root, 'build/fable_modules');
  const hit = readdirSync(base).find((n) => n.startsWith('fable-library-js.'));
  if (!hit) throw new Error(`未找到 fable-library-js：${base}`);
  return `build/fable_modules/${hit}`;
}

let cached;

async function loadDeps() {
  if (cached) return cached;
  const root = sutRoot();
  const lib = resolveFableLibDir(root);
  const typesMod = await import(fableUrl('build/src/Kernel/EventSourcing/EventEnvelope.js'));
  const mapMod = await import(fableUrl(lib, 'Map.js'));
  const listMod = await import(fableUrl(lib, 'List.js'));
  const setMod = await import(fableUrl(lib, 'Set.js'));
  const utilMod = await import(fableUrl(lib, 'Util.js'));
  const reviewMod = await import(fableUrl('build/src/Kernel/Review/ReviewProjection.js'));
  const nudgeMod = await import(fableUrl('build/src/Kernel/Nudge/NudgeProjection.js'));
  const squadProjMod = await import(fableUrl('build/src/Runtime/EventStore/EventLogSquadProjection.js'));
  const dagMod = await import(fableUrl('build/src/Kernel/Wanxiangzhen/Dag.js'));
  const taskMod = await import(fableUrl('build/src/Kernel/Wanxiangzhen/SquadTask.js'));
  const schedMod = await import(fableUrl('build/src/Kernel/Wanxiangzhen/Scheduler.js'));
  cached = {
    typesMod,
    mapMod,
    listMod,
    setMod,
    utilMod,
    reviewMod,
    nudgeMod,
    squadProjMod,
    dagMod,
    taskMod,
    schedMod,
  };
  return cached;
}

function field(e, ...keys) {
  for (const k of keys) {
    if (e[k] !== undefined && e[k] !== null) return e[k];
  }
  return undefined;
}

function toPayloadMap(raw, mapOfArray, comparePrimitives) {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const entries = Object.entries(obj).map(([k, v]) => {
    if (typeof v === 'string') return [String(k), v];
    if (v == null) return [String(k), ''];
    if (typeof v === 'object') return [String(k), JSON.stringify(v)];
    return [String(k), String(v)];
  });
  return mapOfArray(entries, {
    Compare: (a, b) => comparePrimitives(a, b) | 0,
  });
}

function toWanEventList(events, deps) {
  const { typesMod, mapMod, listMod, utilMod } = deps;
  const WanEvent = typesMod.WanEvent;
  const mapped = events.map((e) => {
    const session = String(field(e, 'Session', 'session') ?? '');
    const kind = String(field(e, 'Kind', 'kind') ?? '');
    const at = String(field(e, 'At', 'at') ?? '0');
    const v = Number(field(e, 'V', 'v') ?? 1);
    const payload = toPayloadMap(
      field(e, 'Payload', 'payload') ?? {},
      mapMod.ofArray,
      utilMod.comparePrimitives,
    );
    // EventId/WriterId/Sequence/Checksum 可选
    return new WanEvent(v, session, kind, at, payload, undefined, undefined, undefined, undefined);
  });
  return listMod.ofArray(mapped);
}

function optStr(v) {
  if (v == null) return null;
  return String(v);
}

function dagToJson(dag, deps) {
  const { mapMod, listMod, taskMod, dagMod, schedMod } = deps;
  const tasks = [...mapMod.toList(dag.Tasks)]
    .map(([id, t]) => ({
      id: String(id),
      status: taskMod.statusToString(t.Status),
      dependsOn: [...listMod.toArray(t.DependsOn)].map(String),
      worktreePath: optStr(t.WorktreePath),
      branchName: optStr(t.BranchName),
      mergedSha: optStr(t.MergedSha),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const ready = [...listMod.toArray(dagMod.readyTasks(dag))].map((t) => String(t.Id)).sort();
  const decision = schedMod.decide(dag, 2);
  return {
    sessionId: String(dag.SessionId),
    requirement: String(dag.RootRequirement),
    tasks,
    readyTaskIds: ready,
    schedule: {
      toStart: [...listMod.toArray(decision.TasksToStart)].map(String).sort(),
      waiting: [...listMod.toArray(decision.TasksWaiting)].map(String).sort(),
    },
  };
}

function foldSquadProjection(sessionId, events, deps) {
  let proj = deps.squadProjMod.emptyProjection();
  const list = toWanEventList(events, deps);
  for (const e of [...deps.listMod.toArray(list)]) {
    proj = deps.squadProjMod.applyWanEvent(proj, e);
  }
  return deps.squadProjMod.getDag(proj, sessionId);
}

export async function foldReviewTask(sessionId, events) {
  const deps = await loadDeps();
  const raw = deps.reviewMod.foldReviewTask(sessionId, toWanEventList(events, deps));
  return raw == null ? null : String(raw);
}

/** 稳定 JSON：与 papers expected-fold 对齐（新语义：仅保留最近一次 dispatched）。 */
export async function foldNudgeDedup(sessionId, events) {
  const deps = await loadDeps();
  const st = deps.nudgeMod.foldDedupStream(sessionId, toWanEventList(events, deps));
  return {
    LastDispatchedAnchor: st.LastDispatchedAnchor == null ? null : String(st.LastDispatchedAnchor),
    PendingNudge: st.PendingNudge == null ? null : String(st.PendingNudge[0]),
  };
}

/** Squad DAG 投影（ST-* 主路径 / 依赖 / 取消等）。 */
export async function foldSquadDag(sessionId, events) {
  const deps = await loadDeps();
  return dagToJson(foldSquadProjection(sessionId, events, deps), deps);
}

/**
 * 从 tasks_created 解析 dependsOn，跑 detectCycle。
 * 用于 ST-13：环依赖在写入前应被拒绝——本入口断言「若写入则能检出环」。
 */
export async function foldSquadCycleCheck(sessionId, events) {
  const deps = await loadDeps();
  const list = [...deps.listMod.toArray(toWanEventList(events, deps))];
  const pairs = [];
  for (const e of list) {
    if (e.Session !== sessionId) continue;
    if (e.Kind !== 'tasks_created') continue;
    const raw = deps.mapMod.tryFind('tasksJson', e.Payload) ?? '';
    if (!raw) continue;
    let rows;
    try {
      rows = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const id = String(row.task_id ?? row.taskId ?? '');
      const depsOn = row.depends_on ?? row.dependsOn ?? [];
      pairs.push([id, deps.listMod.ofArray((Array.isArray(depsOn) ? depsOn : []).map(String))]);
    }
  }
  const cycle = deps.dagMod.detectCycle(deps.listMod.ofArray(pairs));
  if (cycle == null) {
    return { hasCycle: false, cycle: [] };
  }
  return {
    hasCycle: true,
    cycle: [...deps.listMod.toArray(cycle)].map(String),
  };
}

/**
 * ST-14：Strict 策略下非法转移被拒绝、合法转移可应用。
 * 不依赖事件流（stimulus 可空）；对拍 Kernel applyStatusOption。
 */
export async function foldSquadStrictTransition(_sessionId, _events) {
  const deps = await loadDeps();
  const { taskMod, listMod } = deps;
  const Strict = new taskMod.TransitionPolicy(0, []);
  const Running = new taskMod.SquadTaskStatus(1, []);
  const Merged = new taskMod.SquadTaskStatus(3, []);
  const t = taskMod.create('t1', 'title', 'desc', listMod.empty, 'now');
  const illegal = taskMod.applyStatusOption(Strict, t, Merged, 'later');
  const legal = taskMod.applyStatusOption(Strict, t, Running, 'later');
  return {
    illegalRejected: illegal == null,
    legalApplied: legal != null,
    legalStatus: legal == null ? null : taskMod.statusToString(legal.Status),
  };
}

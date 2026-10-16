import { join } from 'node:path';
import {
  loadItems,
  loadPapersets,
  loadRooms,
  loadCasesV2,
  loadCaseRevisions,
  loadDatasetReleases,
  loadEnvironments,
} from '../../exam-engine/loader.ts';
import { loadProject } from '../../exam-engine/project.ts';
import type { FreezeA, ItemDoc, RoomDoc } from '../../exam-engine/types.ts';
import { runBDirectItem } from '../../run/b-runner.ts';
import { runCItem } from '../../run/c-runner.ts';
import { runHostedSmokeItem } from '../../run/hosted-runner.ts';
import { runL1Item } from '../../run/l1-runner.ts';
import { runL2Item, type AxisItemResult } from '../../run/l2-runner.ts';
import { runL3Item } from '../../run/l3-runner.ts';
import { writeRunArtifacts } from '../../run/write-artifacts.ts';
import { formatPassTokenCell } from '../../run/hosted-pass-token.ts';
import {
  caseRevisionToItemDoc,
  environmentToRoom,
} from '../../run/cases-v1-adapter.ts';
import {
  formatHostExitCell,
  formatTimedOutCell,
  formatWorkspaceCell,
} from '../../run/hosted-host-exit.ts';

export interface RunOptions {
  project?: string | undefined;
  axis: string;
  paperset: string;
  json: boolean;
  /** 试题级并发；默认 1。hosted 建议保持 1。 */
  concurrency?: number | undefined;
  /** 只跑试卷中的这些试题 id；不写回组卷。 */
  only?: string[] | undefined;
  /** cases-v1：dataset-release 名（与 environment 组合，替代 paperset）。 */
  dataset?: string | undefined;
  /** cases-v1：environment 名（与 dataset 组合）。 */
  environment?: string | undefined;
}

function runId(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${ms}-${suffix}`;
}

function resolveModels(matrixEnv?: string): string[] {
  const key = matrixEnv ?? 'MATRIX_SUBJECTS';
  const raw = process.env[key] ?? process.env.MATRIX_SUBJECT ?? 'fixture-a,fixture-b';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function runOneItem(opts: {
  item: ItemDoc;
  room: RoomDoc;
  projectRoot: string;
  artifactDir: string;
  models: string[];
  sutRoot?: string | undefined;
}): Promise<AxisItemResult[]> {
  const { item, room, projectRoot, artifactDir, models } = opts;

  if (item.axis === 'A') {
    const freeze = item.freeze as FreezeA;
    if (freeze.layer === 'L1') {
      const l1opts: Parameters<typeof runL1Item>[0] = {
        item,
        room,
        projectRoot,
        artifactDir,
      };
      if (opts.sutRoot !== undefined) l1opts.sutRoot = opts.sutRoot;
      return [await runL1Item(l1opts)];
    }
    if (freeze.layer === 'L2') {
      const l2opts: Parameters<typeof runL2Item>[0] = {
        item,
        room,
        projectRoot,
        artifactDir,
      };
      if (opts.sutRoot !== undefined) l2opts.sutRoot = opts.sutRoot;
      return [await runL2Item(l2opts)];
    }
    if (freeze.layer === 'L3') {
      return [await runL3Item({ item, room, projectRoot, artifactDir })];
    }
    throw new Error(`试题 ${item.id} 的 layer=${String(freeze.layer)} 尚未支持`);
  }

  if (item.axis === 'B') {
    if (room.kind === 'hosted') {
      return [await runHostedSmokeItem({ item, room, projectRoot, artifactDir })];
    }
    return runBDirectItem({ item, room, projectRoot, models, artifactDir });
  }

  if (item.axis === 'C') {
    return [await runCItem({ item, room, projectRoot, artifactDir })];
  }

  throw new Error(`试题 ${item.id} 轴 ${item.axis} 尚未支持`);
}

export async function runCommand(options: RunOptions): Promise<number> {
  // cases-v1 路径：dataset-release × environment 显式组合（V2.17 口径）
  if (options.dataset !== undefined && options.environment !== undefined) {
    return runCommandV2(options);
  }

  const project = loadProject(options.project);
  const papersets = loadPapersets(project.dirs.papersets, project.root);
  const ps = papersets.find((p) => p.doc.name === options.paperset);
  if (ps === undefined) {
    console.error(`找不到试卷：${options.paperset}`);
    return 1;
  }
  if (ps.doc.axis !== options.axis) {
    console.error(`试卷 axis=${ps.doc.axis} 与 --axis ${options.axis} 不一致`);
    return 1;
  }

  const rooms = loadRooms(project.dirs.rooms, project.root);
  const room = rooms.find((r) => r.doc.name === ps.doc.room);
  if (room === undefined) {
    console.error(`找不到考场：${ps.doc.room}`);
    return 1;
  }

  const items = loadItems(project.dirs.items, project.root);
  const byId = new Map(items.map((i) => [i.doc.id, i.doc]));
  let selected: ItemDoc[] = [];
  for (const id of ps.doc.items) {
    const it = byId.get(id);
    if (it === undefined) {
      console.error(`试卷引用了不存在的试题：${id}`);
      return 1;
    }
    selected.push(it);
  }

  const only = options.only;
  if (only !== undefined && only.length > 0) {
    const allow = new Set(only);
    const inPaper = new Set(selected.map((s) => s.id));
    for (const id of allow) {
      if (!inPaper.has(id)) {
        console.error(`--only 试题不在试卷中：${id}`);
        return 1;
      }
    }
    selected = selected.filter((s) => allow.has(s.id));
    if (selected.length === 0) {
      console.error('--only 过滤后没有试题');
      return 1;
    }
  }

  const rid = runId();
  const runsRoot = project.dirs.runs;
  const models = resolveModels(ps.doc.matrix_env);
  const sutEnv = room.doc.sut?.root_env;
  const sutRoot = sutEnv !== undefined ? process.env[sutEnv] : undefined;

  // hosted 默认串行，避免抢同一 OpenCode 会话；其它轴可用 --concurrency
  const defaultConc = room.doc.kind === 'hosted' ? 1 : 1;
  const concurrency = Math.max(1, options.concurrency ?? defaultConc);

  let batchResults: AxisItemResult[][];
  try {
    batchResults = await mapPool(selected, concurrency, async (item) => {
      const artifactDir = join(runsRoot, rid, 'artifacts', item.id);
      return runOneItem({
        item,
        room: room.doc as RoomDoc,
        projectRoot: project.root,
        artifactDir,
        models,
        sutRoot,
      });
    });
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }

  const results = batchResults.flat();

  const { dir, gate_evaluations, gates_pass } = writeRunArtifacts({
    runsRoot,
    meta: {
      run_id: rid,
      axis: options.axis,
      paperset: options.paperset,
      room: room.doc.name,
      started_at: new Date().toISOString(),
      project_root: project.root,
      items: selected.map((i) => ({ id: i.id, rev: i.rev })),
    },
    results,
    gates: ps.doc.gates,
  });

  const itemsPass = results.every((r) => r.pass);

  if (options.json) {
    console.log(JSON.stringify({ run_dir: dir, results, gate_evaluations, gates_pass }, null, 2));
  } else {
    const passed = results.filter((r) => r.pass).length;
    console.log(`run 完成：${dir}`);
    console.log(`${passed}/${results.length} 试题通过`);
    for (const r of results) {
      const mark = r.pass ? 'PASS' : 'FAIL';
      const tokenNote =
        r.pass_token !== undefined || r.pass_token_present !== undefined
          ? `  暗号：${formatPassTokenCell(r)}（辅助）`
          : '';
      const wsNote =
        r.workspace_ok !== undefined ? `  工作区：${formatWorkspaceCell(r.workspace_ok)}` : '';
      const toNote = r.timed_out !== undefined ? `  超时：${formatTimedOutCell(r.timed_out)}` : '';
      const exitNote =
        r.host_exit !== undefined || r.timed_out
          ? `  host_exit：${formatHostExitCell({ host_exit: r.host_exit, timed_out: r.timed_out })}`
          : '';
      console.log(
        `  ${mark}  ${r.item_id}@rev${r.item_rev}${r.attribution ? ` [${r.attribution}]` : ''}${wsNote}${tokenNote}${toNote}${exitNote}`,
      );
      for (const f of r.oracle_failures) console.log(`        - ${f.oracle_id}: ${f.message}`);
    }
    if (gate_evaluations.length > 0) {
      console.log(`gates：${gates_pass ? 'PASS' : 'FAIL'}`);
      for (const g of gate_evaluations) {
        console.log(`  ${g.pass ? 'PASS' : 'FAIL'}  ${g.name}: ${g.message}`);
      }
    }
  }

  return itemsPass && gates_pass ? 0 : 1;
}

/**
 * cases-v1 执行路径（阶段 4a）：dataset-release × environment 显式组合。
 *
 * 与 V1 路径（paperset 绑死 room）的区别：
 * - 数据源：dataset-release（冻结闭包）→ case-revision，environment → room
 * - 组合：运行时显式指定 --dataset + --environment，不写回资产
 * - 执行：适配层还原 ItemDoc/RoomDoc 后复用 runOneItem（绞杀者模式）
 */
async function runCommandV2(options: RunOptions): Promise<number> {
  const project = loadProject(options.project);
  const datasetName = options.dataset!;
  const environmentName = options.environment!;

  const releases = loadDatasetReleases(project.dirs.dataset_releases, project.root);
  const release = releases.find((r) => r.doc.dataset_release_id === datasetName);
  if (release === undefined) {
    console.error(`找不到 dataset-release：${datasetName}`);
    return 1;
  }

  const envs = loadEnvironments(project.dirs.environments, project.root);
  const env = envs.find((e) => e.doc.environment_profile_id === environmentName);
  if (env === undefined) {
    console.error(`找不到 environment：${environmentName}`);
    return 1;
  }

  const cases = loadCasesV2(project.dirs.cases, project.root);
  const revisions = loadCaseRevisions(project.dirs.case_revisions, project.root);
  const caseById = new Map(cases.map((c) => [c.doc.case_id, c.doc]));
  const revById = new Map(revisions.map((r) => [r.doc.case_revision_id, r.doc]));

  // 还原 ItemDoc（按 dataset-release 的 case_revisions 顺序）
  const selected: ItemDoc[] = [];
  for (const ref of release.doc.case_revisions) {
    const rev = revById.get(ref.case_revision_id);
    const caseDoc = caseById.get(ref.case_id);
    if (rev === undefined || caseDoc === undefined) {
      console.error(
        `dataset-release 引用了不存在的修订：${ref.case_revision_id}（case=${ref.case_id}）`,
      );
      return 1;
    }
    selected.push(caseRevisionToItemDoc(rev, caseDoc));
  }

  const only = options.only;
  let filtered = selected;
  if (only !== undefined && only.length > 0) {
    const allow = new Set(only);
    filtered = selected.filter((s) => allow.has(s.id));
    if (filtered.length === 0) {
      console.error('--only 过滤后没有试题');
      return 1;
    }
  }

  const rid = runId();
  const runsRoot = project.dirs.runs;
  const room = environmentToRoom(env.doc);
  const models = resolveModels(undefined);
  const sutEnv = project.manifest.system_under_test?.root_env;
  const sutRoot = sutEnv !== undefined ? process.env[sutEnv] : undefined;

  const concurrency = Math.max(1, options.concurrency ?? 1);

  let batchResults: AxisItemResult[][];
  try {
    batchResults = await mapPool(filtered, concurrency, async (item) => {
      const artifactDir = join(runsRoot, rid, 'artifacts', item.id);
      return runOneItem({
        item,
        room,
        projectRoot: project.root,
        artifactDir,
        models,
        sutRoot,
      });
    });
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }

  const results = batchResults.flat();

  const { dir, gate_evaluations, gates_pass } = writeRunArtifacts({
    runsRoot,
    meta: {
      run_id: rid,
      axis: 'B',
      paperset: datasetName,
      room: env.doc.environment_profile_id,
      started_at: new Date().toISOString(),
      project_root: project.root,
      items: filtered.map((i) => ({ id: i.id, rev: i.rev })),
    },
    results,
    gates: undefined,
  });

  const itemsPass = results.every((r) => r.pass);

  if (options.json) {
    console.log(JSON.stringify({ run_dir: dir, results, gate_evaluations, gates_pass }, null, 2));
  } else {
    const passed = results.filter((r) => r.pass).length;
    console.log(`run 完成：${dir}`);
    console.log(`${passed}/${results.length} 试题通过`);
    for (const r of results) {
      const mark = r.pass ? 'PASS' : 'FAIL';
      console.log(`  ${mark}  ${r.item_id}@rev${r.item_rev}${r.attribution ? ` [${r.attribution}]` : ''}`);
      for (const f of r.oracle_failures) console.log(`        - ${f.oracle_id}: ${f.message}`);
    }
  }

  return itemsPass && gates_pass ? 0 : 1;
}

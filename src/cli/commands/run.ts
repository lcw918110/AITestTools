import { join } from 'node:path';
import {
  loadCasesV2,
  loadCaseRevisions,
  loadDatasetReleases,
  loadEnvironments,
} from '../../exam-engine/loader.ts';
import { loadProject } from '../../exam-engine/project.ts';
import type { CaseRevision, EnvironmentProfile } from '../../domain/types.ts';
import { BDirectAdapter } from '../../run/b-runner.ts';
import { CAdapter } from '../../run/c-runner.ts';
import { HostedAdapter } from '../../run/hosted-runner.ts';
import { L1Adapter } from '../../run/l1-runner.ts';
import { L2Adapter } from '../../run/l2-runner.ts';
import { L3Adapter } from '../../run/l3-runner.ts';
import { RunOrchestrator } from '../../run/run-orchestrator.ts';
import type { ExecutionAdapter } from '../../run/execution-adapter.ts';
import { writeRunArtifacts } from '../../run/write-artifacts.ts';
import type { AxisItemResult, RunCaseInput } from '../../run/runner-types.ts';

export interface RunOptions {
  project?: string | undefined;
  json: boolean;
  /** 试题级并发；默认 1。hosted 建议保持 1。 */
  concurrency?: number | undefined;
  /** 只跑试卷中的这些试题 id；不写回组卷。 */
  only?: string[] | undefined;
  /** cases-v1：dataset-release 名（与 environment 组合）。 */
  dataset: string;
  /** cases-v1：environment 名（与 dataset 组合）。 */
  environment: string;
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

/** 按 mode + environment.recipe.kind 解析执行 adapter（替代原 runOneItem switch）。 */
function resolveAdapter(revision: CaseRevision, environment: EnvironmentProfile): ExecutionAdapter {
  const mode = revision.execution_profile?.mode ?? 'hosted';

  switch (mode) {
    case 'fold':
      return new L1Adapter();
    case 'scripted':
      return new L2Adapter();
    case 'cassette':
      return new L3Adapter();
    case 'hosted':
      if (environment.recipe.kind === 'hosted') return new HostedAdapter();
      return new BDirectAdapter();
    case 'direct_tool':
      return new CAdapter();
    default:
      throw new Error(`试题 ${revision.case_revision_id} 的 mode=${String(mode)} 尚未支持`);
  }
}

/**
 * cases-v1 执行路径：dataset-release × environment 显式组合。
 *
 * 数据源：dataset-release（冻结闭包）→ case-revision，environment → EnvironmentProfile；
 * 执行：runner 直接消费领域对象（CaseRevision / EnvironmentProfile），不再经适配层。
 */

/** 解析 dataset-release × environment，返回 runner 认识的 CaseRevision[] + EnvironmentProfile。 */
export function resolveDatasetItems(
  project: ReturnType<typeof loadProject>,
  datasetName: string,
  environmentName: string,
): { cases: RunCaseInput[]; environment: EnvironmentProfile } {
  const releases = loadDatasetReleases(project.dirs.dataset_releases, project.root);
  const release = releases.find((r) => r.doc.dataset_release_id === datasetName);
  if (release === undefined) {
    throw new Error(`找不到 dataset-release：${datasetName}`);
  }

  const envs = loadEnvironments(project.dirs.environments, project.root);
  const env = envs.find((e) => e.doc.environment_profile_id === environmentName);
  if (env === undefined) {
    throw new Error(`找不到 environment：${environmentName}`);
  }

  const cases = loadCasesV2(project.dirs.cases, project.root);
  const revisions = loadCaseRevisions(project.dirs.case_revisions, project.root);
  const caseById = new Map(cases.map((c) => [c.doc.case_id, c.doc]));
  const revById = new Map(revisions.map((r) => [r.doc.case_revision_id, r.doc]));

  // 按 dataset-release 的 case_revisions 顺序组装 RunCaseInput
  const runCases: RunCaseInput[] = [];
  for (const ref of release.doc.case_revisions) {
    const revision = revById.get(ref.case_revision_id);
    const caseDoc = caseById.get(ref.case_id);
    if (revision === undefined || caseDoc === undefined) {
      throw new Error(
        `dataset-release 引用了不存在的修订：${ref.case_revision_id}（case=${ref.case_id}）`,
      );
    }
    const pairKey = caseDoc.pair_key ?? caseDoc.case_id.toUpperCase();
    runCases.push({ revision, ...(pairKey !== undefined ? { pairKey } : {}) });
  }

  return { cases: runCases, environment: env.doc };
}

export async function runCommand(options: RunOptions): Promise<number> {
  const project = loadProject(options.project);
  const datasetName = options.dataset;
  const environmentName = options.environment;

  let selected: RunCaseInput[];
  let environment: EnvironmentProfile;
  try {
    const resolved = resolveDatasetItems(project, datasetName, environmentName);
    selected = resolved.cases;
    environment = resolved.environment;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }

  const only = options.only;
  let filtered = selected;
  if (only !== undefined && only.length > 0) {
    const allow = new Set(only);
    filtered = selected.filter((s) => allow.has(s.revision.case_revision_id));
    if (filtered.length === 0) {
      console.error('--only 过滤后没有试题');
      return 1;
    }
  }

  const rid = runId();
  const runsRoot = project.dirs.runs;
  const models = resolveModels(undefined);
  const sutEnv = project.manifest.system_under_test?.root_env;
  const sutRoot = sutEnv !== undefined ? process.env[sutEnv] : undefined;

  const concurrency = Math.max(1, options.concurrency ?? 1);

  let batchResults: AxisItemResult[][];
  try {
    batchResults = await mapPool(filtered, concurrency, async (runCase) => {
      const artifactDir = join(runsRoot, rid, 'artifacts', runCase.revision.case_revision_id);
      const adapter = resolveAdapter(runCase.revision, environment);
      const orch = new RunOrchestrator();
      orch.beginRun({});
      orch.transitionRun('preflight');
      orch.transitionRun('running');
      const { results } = await orch.executeCase(runCase.revision, environment, adapter, {
        projectRoot: project.root,
        models,
        artifactDir,
        ...(sutRoot !== undefined ? { sutRoot } : {}),
        ...(runCase.pairKey !== undefined ? { pairKey: runCase.pairKey } : {}),
      });
      return results;
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
      dataset: datasetName,
      environment: environmentName,
      started_at: new Date().toISOString(),
      project_root: project.root,
      items: filtered.map((i) => ({
        id: i.revision.case_revision_id,
        rev: i.revision.revision_number,
      })),
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
      console.log(
        `  ${mark}  ${r.item_id}@rev${r.item_rev}${r.attribution ? ` [${r.attribution}]` : ''}`,
      );
      for (const f of r.oracle_failures) console.log(`        - ${f.oracle_id}: ${f.message}`);
    }
  }

  return itemsPass && gates_pass ? 0 : 1;
}

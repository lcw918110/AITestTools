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
import { HerdchestraAdapter } from '../../run/herdchestra-adapter.ts';
import { L1Adapter } from '../../run/l1-runner.ts';
import { L2Adapter } from '../../run/l2-runner.ts';
import { L3Adapter } from '../../run/l3-runner.ts';
import { RunOrchestrator } from '../../run/run-orchestrator.ts';
import { AdapterError } from '../../run/execution-adapter.ts';
import type { ExecutionAdapter } from '../../run/execution-adapter.ts';
import { resolveRepeats } from '../../run/repeats.ts';
import { writeRunArtifacts } from '../../run/write-artifacts.ts';
import type { AxisItemResult, RunCaseInput } from '../../run/runner-types.ts';
import type { Attempt, CaseExecution } from '../../domain/types.ts';

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

/**
 * 单题执行抛出异常时的记账行：归因 HARNESS（工装故障，不是被测系统缺陷），
 * 但不标 `not_implemented`——它是「跑过且失败」，必须计入分母，否则批跑会看起来正常。
 *
 * 只在**拿不到任何已有结果**时才用它。编排器已产出的结果行带着工作区断言、宿主信号、
 * 材料是否被改等证据，覆盖成笼统 HARNESS 会把真实归因与不变式计数一并抹掉。
 */
function harnessFailureResult(
  revision: CaseRevision,
  err: unknown,
  replicateIndex: number,
  recorded?: { caseExecution: CaseExecution; attempts: Attempt[] },
): AxisItemResult {
  const message = err instanceof Error ? err.message : String(err);
  const attempt = recorded?.attempts.at(-1);
  // 阶段与时间窗取自编排器已记账的 attempt：异常一抛这些事实就随栈帧消失，
  // 只剩一句消息的话，事后无法分辨「没起来」「跑到一半崩了」「清理挂住」。
  const facts: string[] = [];
  if (attempt !== undefined) {
    if (attempt.attempt_status !== undefined) facts.push(`attempt=${attempt.attempt_status}`);
    if (attempt.started_at !== undefined) facts.push(`started_at=${attempt.started_at}`);
    if (attempt.ended_at !== undefined) facts.push(`ended_at=${attempt.ended_at}`);
  }
  const executionOutcome = recorded?.caseExecution.execution_outcome;
  if (executionOutcome !== undefined && executionOutcome !== 'unknown') {
    facts.push(`execution_outcome=${executionOutcome}`);
  }
  return {
    item_id: withTrialSuffix(revision.case_revision_id, replicateIndex),
    item_rev: revision.revision_number,
    pass: false,
    attribution: 'HARNESS',
    oracle_failures: [
      {
        oracle_id: 'harness',
        message: facts.length === 0 ? message : `${message}（${facts.join('；')}）`,
      },
    ],
    metrics: { a_case_pass_rate: 0, a_invariant_violations: 0 },
  };
}

/**
 * 追加 trial 后缀，与编排层 `executeOnce` 的命名约定一致（`<题号>::r<N>`）。
 * 少了后缀，同一题的多个 trial 会被产物层当成同一题的不同行，分组与题级收敛都会错位。
 */
function withTrialSuffix(caseRevisionId: string, replicateIndex: number): string {
  return replicateIndex > 0 ? `${caseRevisionId}::r${replicateIndex}` : caseRevisionId;
}

/** 按 mode + environment.recipe.kind 解析执行 adapter（替代原 runOneItem switch）。 */
function resolveAdapter(
  revision: CaseRevision,
  environment: EnvironmentProfile,
): ExecutionAdapter {
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
    case 'service':
      return new HerdchestraAdapter();
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

/**
 * 从 `case_revision_id` 后缀判定配对侧。
 *
 * 约定：`<...>.off` / `<...>.on`。无后缀返回 undefined（非配对题，用默认环境）。
 * 这是配对实验「按侧解析环境」的唯一侧来源，不另设字段——避免同一事实两处表达。
 */
export function revisionSide(caseRevisionId: string): 'off' | 'on' | undefined {
  if (caseRevisionId.endsWith('.off')) return 'off';
  if (caseRevisionId.endsWith('.on')) return 'on';
  return undefined;
}

/**
 * 按修订侧解析该侧应使用的环境。
 *
 * 配对实验的设计前提是「只差插件开关」，而 CLI 只能传一个 `--environment`。
 * 若两侧共用环境，OFF 侧也会挂插件，差值不再是「有插件 vs 无插件」。
 * 故 environment 可声明 `paired_environments` 映射，按侧切换。
 *
 * 映射目标不存在时**报错而非静默回落**：静默回落会让配对前提再次失效而无从察觉。
 */
export function resolveSideEnvironment(
  revision: CaseRevision,
  base: EnvironmentProfile,
  envs: readonly { doc: EnvironmentProfile }[],
): EnvironmentProfile {
  const side = revisionSide(revision.case_revision_id);
  if (side === undefined) return base;
  const mapped = base.paired_environments?.[side];
  if (mapped === undefined || mapped === base.environment_profile_id) return base;
  const found = envs.find((e) => e.doc.environment_profile_id === mapped);
  if (found === undefined) {
    throw new Error(
      `environment ${base.environment_profile_id} 的 paired_environments.${side} 指向不存在的环境：${mapped}`,
    );
  }
  return found.doc;
}

/** 解析 dataset-release × environment，返回 runner 认识的 CaseRevision[] + EnvironmentProfile。 */
export function resolveDatasetItems(
  project: ReturnType<typeof loadProject>,
  datasetName: string,
  environmentName: string,
): { cases: RunCaseInput[]; environment: EnvironmentProfile } {
  const resolved = assembleDatasetItems(
    project,
    loadDatasetReleases(project.dirs.dataset_releases, project.root),
    loadEnvironments(project.dirs.environments, project.root),
    datasetName,
    environmentName,
  );
  // 对外保持「一条坏就报错」的旧语义：调用方据此尽早修正组卷。
  const first = resolved.unresolved[0];
  if (first !== undefined) throw new Error(first.reason);
  return { cases: resolved.cases, environment: resolved.environment };
}

/** 从修订 id 尾部 `rN` 取修订号；取不到用回退值（解析失败的条目拿不到文件里的修订号）。 */
function revisionNumberFromId(caseRevisionId: string, fallback: number): number {
  const matched = /\.r(\d+)$/.exec(caseRevisionId);
  return matched === null ? fallback : Number.parseInt(matched[1] as string, 10);
}

/** 选题阶段无法解析的条目：不进执行队列，但要照常记进 run 清单与漏跑上报。 */
export interface UnresolvedCase {
  case_id: string;
  case_revision_id: string;
  reason: string;
}

interface DatasetSelection {
  cases: RunCaseInput[];
  environment: EnvironmentProfile;
  unresolved: UnresolvedCase[];
}

/**
 * 从已加载的组卷/环境清单组装执行清单（选题解析与单题解析共用同一份事实）。
 *
 * 单条修订解析失败**不中断整卷**：组卷里只要有一条引用了已改名/删除的修订，
 * 过去会让整个 run 直接放弃、一条结果都不落盘（几小时批跑全部作废）。
 * 现在把坏条目交给调用方记成「漏跑」，其余题照常执行。
 */
function assembleDatasetItems(
  project: ReturnType<typeof loadProject>,
  releases: ReturnType<typeof loadDatasetReleases>,
  envs: ReturnType<typeof loadEnvironments>,
  datasetName: string,
  environmentName: string,
): DatasetSelection {
  const release = releases.find((r) => r.doc.dataset_release_id === datasetName);
  if (release === undefined) {
    throw new Error(`找不到 dataset-release：${datasetName}`);
  }

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
  const unresolved: UnresolvedCase[] = [];
  for (const ref of release.doc.case_revisions) {
    const revision = revById.get(ref.case_revision_id);
    const caseDoc = caseById.get(ref.case_id);
    if (revision === undefined || caseDoc === undefined) {
      unresolved.push({
        case_id: ref.case_id,
        case_revision_id: ref.case_revision_id,
        reason: `dataset-release 引用了不存在的修订：${ref.case_revision_id}（case=${ref.case_id}）`,
      });
      continue;
    }
    const pairKey = caseDoc.pair_key ?? caseDoc.case_id.toUpperCase();
    // 配对题按侧解析环境（OFF 走无插件环境，ON 走挂插件环境），
    // 否则两侧共用 --environment 会让 OFF 也挂插件，配对前提失效。
    try {
      const sideEnv = resolveSideEnvironment(revision, env.doc, envs);
      runCases.push({
        revision,
        ...(pairKey !== undefined ? { pairKey } : {}),
        environment: sideEnv,
      });
    } catch (e) {
      unresolved.push({
        case_id: ref.case_id,
        case_revision_id: ref.case_revision_id,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { cases: runCases, environment: env.doc, unresolved };
}

export async function runCommand(options: RunOptions): Promise<number> {
  const project = loadProject(options.project);
  const datasetName = options.dataset;
  const environmentName = options.environment;

  let selected: RunCaseInput[];
  let environment: EnvironmentProfile;
  let unresolved: UnresolvedCase[] = [];
  try {
    const resolved = assembleDatasetItems(
      project,
      loadDatasetReleases(project.dirs.dataset_releases, project.root),
      loadEnvironments(project.dirs.environments, project.root),
      datasetName,
      environmentName,
    );
    selected = resolved.cases;
    environment = resolved.environment;
    unresolved = resolved.unresolved;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  // 解析不了的条目照常进清单：报告的「漏跑」要能指出是哪道题、为什么。
  // 只在没加 --only 时保留——加了 --only 就是明确不要其他题。
  const unresolvedItems =
    options.only !== undefined && options.only.length > 0
      ? unresolved.filter((u) => options.only?.includes(u.case_revision_id) === true)
      : unresolved;

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
    // 单题异常不得拖垮整卷：否则一条工装故障会让整个 run 一条结果都不落盘，
    // 一次几小时的批跑全部作废（账实不符、也无法复盘是哪道题出的问题）。
    // 这里把异常收敛成该题自己的 HARNESS 结果行，其余题继续跑、照常落盘。
    batchResults = await mapPool(filtered, concurrency, async (runCase) => {
      const artifactDir = join(runsRoot, rid, 'artifacts', runCase.revision.case_revision_id);
      // 配对题按侧解析后的环境优先；非配对题回落到命令行指定的环境。
      const caseEnv = runCase.environment ?? environment;
      // 编排器在 try 外构造：抛错时还要从它身上取回已记账的 attempt 证据。
      const orch = new RunOrchestrator();
      try {
        const adapter = resolveAdapter(runCase.revision, caseEnv);
        orch.beginRun({});
        orch.transitionRun('preflight');
        orch.transitionRun('running');
        const { results } = await orch.executeCase(runCase.revision, caseEnv, adapter, {
          projectRoot: project.root,
          models,
          artifactDir,
          ...(sutRoot !== undefined ? { sutRoot: sutRoot } : {}),
          ...(runCase.pairKey !== undefined ? { pairKey: runCase.pairKey } : {}),
        });
        return results;
      } catch (e) {
        // 只有「一条结果都没拿到」才兜底：编排器已产出的行带着工作区断言、宿主信号、
        // 材料是否被改等证据，覆盖掉会把真实归因抹成笼统 HARNESS。
        const produced = e instanceof AdapterError ? e.result : undefined;
        if (produced !== undefined && produced.length > 0) {
          console.error(
            `[proctor] ${runCase.revision.case_revision_id} 执行异常，沿用已产出的结果行：${(e as Error).message}`,
          );
          return produced;
        }
        const replicas = resolveRepeats(runCase.revision, caseEnv);
        const recorded = orch.lastCaseExecution();
        return Array.from({ length: replicas }, (_, index) =>
          harnessFailureResult(runCase.revision, e, index, recorded),
        );
      }
    });
  } catch (e) {
    // 走到这里只剩「整卷级」故障（选题/环境解析、并发调度本身崩了）。
    console.error((e as Error).message);
    return 2;
  }

  const results = batchResults.flat();

  const { dir, gate_evaluations, gates_pass, not_evaluated_items, missing_result_items } =
    writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: rid,
        ...(process.env.PROCTOR_RUN_PURPOSE?.trim()
          ? { purpose: process.env.PROCTOR_RUN_PURPOSE.trim() }
          : {}),
        dataset: datasetName,
        environment: environmentName,
        started_at: new Date().toISOString(),
        project_root: project.root,
        items: [
          ...filtered.map((i) => ({
            id: i.revision.case_revision_id,
            // 修订号以文件里的权威值为准：从 id 反解只在解析失败时兜底，不覆盖权威值。
            rev: i.revision.revision_number,
            // 记账用实际执行的环境：配对题按侧解析后可能与顶层 environment 不同，
            // 只写基准值会让报告与执行账实不符。
            environment: (i.environment ?? environment).environment_profile_id,
          })),
          // 解析不了的条目必须进清单：否则 run 会「看起来全跑完了」，
          // 而组卷里被引用的坏修订既没执行、也没留下任何痕迹。
          ...unresolvedItems.map((u) => ({
            id: u.case_revision_id,
            rev: revisionNumberFromId(u.case_revision_id, 0),
            environment: environment.environment_profile_id,
          })),
        ],
      },
      results,
      gates: undefined,
    });

  // 未评测既不是通过也不是失败：不能混入通过率分母，也不能打印成 FAIL
  const evaluatedResults = results.filter((r) => r.not_implemented !== true);
  const notEvaluatedCount = results.length - evaluatedResults.length;
  const itemsPass = evaluatedResults.every((r) => r.pass);

  if (options.json) {
    console.log(JSON.stringify({ run_dir: dir, results, gate_evaluations, gates_pass }, null, 2));
  } else {
    const passed = evaluatedResults.filter((r) => r.pass).length;
    console.log(`run 完成：${dir}`);
    if (evaluatedResults.length === 0) {
      console.log(`0/${results.length} 试题通过（${notEvaluatedCount} 条未评测，不计入通过率）`);
    } else {
      console.log(
        `${passed}/${evaluatedResults.length} 试题通过${notEvaluatedCount > 0 ? `（另有 ${notEvaluatedCount} 条未评测，不计入）` : ''}`,
      );
    }
    for (const r of results) {
      const mark = r.not_implemented === true ? 'SKIP' : r.pass ? 'PASS' : 'FAIL';
      console.log(
        `  ${mark}  ${r.item_id}@rev${r.item_rev}${r.attribution ? ` [${r.attribution}]` : ''}`,
      );
      for (const f of r.oracle_failures) console.log(`        - ${f.oracle_id}: ${f.message}`);
    }
  }

  // 退出码优先级，核心原则是「真实失败绝不能被别的状态掩盖」：
  // 1 被测系统失败 > 4 有题漏跑 > 3 有题未评测 > 0 全部评测且通过。
  // 否则「9 过 1 挂 + 1 条未评测」会被报成中性的 3，失败告警链路就断了。
  return resolveRunExitCode({
    passed: itemsPass && gates_pass,
    missing_result_items,
    not_evaluated_items,
  });
}

/**
 * run 命令退出码的纯函数判定，便于单独测优先级。
 *
 * 顺序即语义：真实失败最优先，其次漏跑（异常信号），再次未评测（预期内）。
 */
export function resolveRunExitCode(input: {
  passed: boolean;
  missing_result_items: number;
  not_evaluated_items: number;
}): 0 | 1 | 3 | 4 {
  // 真实失败优先：不能被「没测过」掩盖，否则告警链路会断
  if (!input.passed) return 1;
  // 漏跑是异常（计划里有却没出结果），比「形态未实现」更该被关注
  if (input.missing_result_items > 0) return 4;
  if (input.not_evaluated_items > 0) return 3;
  return 0;
}

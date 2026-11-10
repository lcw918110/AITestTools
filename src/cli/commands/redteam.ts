/**
 * proctor redteam：安全红队执行器（优化项 ③）。
 *
 * 复用 hosted 隔离机制跑题，每个 case 注入独立 canary，run 后汇总泄露判定，
 * 产出 security_report.json（独立于常规 pass 门禁）。首期只做 IPI + 程序化工具 judge。
 */
import { join } from 'node:path';
import { loadProject } from '../../exam-engine/project.ts';
import type { CaseRevision, EnvironmentProfile } from '../../domain/types.ts';
import { HostedAdapter } from '../../run/hosted-runner.ts';
import { RunOrchestrator } from '../../run/run-orchestrator.ts';
import type { ExecutionAdapter } from '../../run/execution-adapter.ts';
import { writeRunArtifacts } from '../../run/write-artifacts.ts';
import type { AxisItemResult, RunCaseInput } from '../../run/runner-types.ts';
import { resolveDatasetItems } from './run.ts';
import {
  buildSecurityReport,
  generateCanarySecrets,
  readCanaryLeakFromArtifact,
  writeSecurityReport,
} from '../../security/redteam.ts';

export interface RedTeamOptions {
  project?: string | undefined;
  json: boolean;
  dataset: string;
  environment: string;
  only?: string[] | undefined;
}

function runId(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `redteam-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${ms}-${suffix}`;
}

function resolveModels(): string[] {
  const raw = process.env.MATRIX_SUBJECTS ?? process.env.MATRIX_SUBJECT ?? 'fixture-a,fixture-b';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 安全红队只支持 hosted 执行（IPI 注入依赖隔离 workspace）。
 *
 * 注意：本函数**不消费环境**（`run.ts` 的同名函数会按 `recipe.kind` 分派）。
 * 按侧解析后的环境由调用方传给 `executeCase` 的第二个参数，此处传什么都是 no-op。
 */
function resolveAdapter(revision: CaseRevision): ExecutionAdapter {
  const mode = revision.execution_profile?.mode ?? 'hosted';
  if (mode !== 'hosted') {
    throw new Error(
      `安全红队仅支持 hosted 执行，题 ${revision.case_revision_id} 的 mode=${String(mode)}`,
    );
  }
  return new HostedAdapter();
}

export async function runRedTeamCommand(options: RedTeamOptions): Promise<number> {
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
  const models = resolveModels();
  const canarySecrets = generateCanarySecrets(filtered.length);

  const batchResults: AxisItemResult[][] = [];
  const caseLeaks: Array<{
    case_revision_id: string;
    canary_secret: string;
    environment: string;
    leak?: { leaked: boolean; locations: string[] };
  }> = [];

  for (let i = 0; i < filtered.length; i += 1) {
    const runCase = filtered[i] as RunCaseInput;
    const canarySecret = canarySecrets[i] as string;
    const artifactDir = join(runsRoot, rid, 'artifacts', runCase.revision.case_revision_id);
    // 配对题按侧解析后的环境优先；非配对题回落到命令行指定的环境。
    // 与 run.ts 同口径：安全红队也跑配对题，共用基准值会让 OFF 侧挂上插件。
    const caseEnv = runCase.environment ?? environment;
    const adapter = resolveAdapter(runCase.revision);
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');
    const { results } = await orch.executeCase(runCase.revision, caseEnv, adapter, {
      projectRoot: project.root,
      models,
      artifactDir,
      security: { canary_secret: canarySecret },
    });
    batchResults.push(results);
    const leak = readCanaryLeakFromArtifact(artifactDir);
    caseLeaks.push({
      case_revision_id: runCase.revision.case_revision_id,
      canary_secret: canarySecret,
      // 逐题记实际环境：安全报告是独立交付物，只写基准值会让配对题账实不符。
      environment: caseEnv.environment_profile_id,
      ...(leak !== undefined ? { leak } : {}),
    });
  }

  const results = batchResults.flat();

  const { dir } = writeRunArtifacts({
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
        // 记账用实际执行的环境，避免配对题报告与执行账实不符。
        environment: (i.environment ?? environment).environment_profile_id,
      })),
    },
    results,
    gates: undefined,
  });

  const report = buildSecurityReport({
    run_id: rid,
    dataset: datasetName,
    environment: environmentName,
    cases: caseLeaks,
  });
  writeSecurityReport(dir, report);

  if (options.json) {
    console.log(JSON.stringify({ run_dir: dir, report }, null, 2));
  } else {
    console.log(`安全红队完成：${dir}`);
    console.log(
      `泄露 ${report.summary.leaked} / 未泄露 ${report.summary.not_leaked} / 无法判定 ${report.summary.inconclusive}`,
    );
    for (const c of report.cases) {
      const mark = c.inconclusive ? '?' : c.leaked ? 'LEAK' : 'OK';
      console.log(
        `  ${mark}  ${c.case_revision_id}${c.leaked ? ` [${c.leak_locations.join(', ')}]` : ''}`,
      );
    }
  }

  // 退出码：存在泄露判 1（安全门禁），否则 0。无法判定不阻塞。
  return report.summary.leaked > 0 ? 1 : 0;
}

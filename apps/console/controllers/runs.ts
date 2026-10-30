/**
 * 运行结果查看、基线管理、比较（controller）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HttpResponse } from '../http.ts';
import { PROJECT, REPO_ROOT } from '../config.ts';
import { safeUnder } from '../bank.ts';
import {
  buildRunSummary,
  listBaselineNames,
  parseBaselinePathFromEffectMd,
} from '../run-summary.ts';
import { buildRunDashboard, readHostedSnaps } from '../dashboard.ts';
import { compareRuns, writeEffectCompareMarkdown } from '../../../src/report/compare.ts';
import { runBaselinePin } from '../../../src/cli/commands/baseline-pin.ts';
import { listRuns } from '../project-reader.ts';
import {
  collectTrendBuckets,
  collectTrendPoints,
  IncomparablePurposeError,
  isValidPurpose,
  VALID_PURPOSES,
} from '../../../src/cli/commands/report-trend.ts';

export async function runsList(): Promise<HttpResponse> {
  return { status: 200, body: { runs: listRuns(30) } };
}

export async function runsTrend(query: {
  dataset?: string | undefined;
  metric?: string | undefined;
  limit?: string | undefined;
  purpose?: string | undefined;
  bucket?: string | undefined;
}): Promise<HttpResponse> {
  const dataset = query.dataset?.trim() || undefined;
  const metric = query.metric?.trim() || 'a_case_pass_rate';
  const limit = Number.parseInt(query.limit ?? '20', 10);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 20;
  const rawPurpose = query.purpose?.trim() || undefined;
  const isBucket = query.bucket === 'true' || query.bucket === '1';

  if (rawPurpose !== undefined && rawPurpose !== 'unannotated' && rawPurpose !== '未标注') {
    if (!isValidPurpose(rawPurpose)) {
      return {
        status: 400,
        body: {
          error: `非法用途：${query.purpose}，有效用途为：${VALID_PURPOSES.join(', ')}（或 unannotated）`,
        },
      };
    }
  }

  if (isBucket) {
    const buckets = collectTrendBuckets({ project: PROJECT, dataset, limit: safeLimit });
    const formattedBuckets: Record<
      string,
      {
        purpose: string | null;
        notice: string | null;
        points: Array<{
          run_id: string;
          started_at: string | undefined;
          dataset: string | undefined;
          purpose: string | null;
          value: number | undefined;
          gates_pass: boolean | undefined;
          run_dir: string;
        }>;
      }
    > = {};

    for (const [key, b] of Object.entries(buckets)) {
      formattedBuckets[key] = {
        purpose: b.purpose,
        notice: b.notice ?? null,
        points: b.points.map((p) => ({
          run_id: p.run_id,
          started_at: p.started_at,
          dataset: p.dataset,
          purpose: p.purpose ?? null,
          value: p.aggregates[metric],
          gates_pass: p.gates_pass,
          run_dir: p.run_dir,
        })),
      };
    }

    return {
      status: 200,
      body: {
        project: PROJECT,
        dataset: dataset ?? null,
        metric,
        bucketed: true,
        available_purposes: Object.keys(buckets),
        buckets: formattedBuckets,
      },
    };
  }

  let points: ReturnType<typeof collectTrendPoints>;
  try {
    points = collectTrendPoints({
      project: PROJECT,
      dataset,
      limit: safeLimit,
      purpose: rawPurpose,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('用途不可比')) {
      const available_purposes =
        error instanceof IncomparablePurposeError
          ? error.available_purposes
          : ((error as { available_purposes?: string[] }).available_purposes ?? []);
      return {
        status: 400,
        body: {
          error: error.message,
          available_purposes,
        },
      };
    }
    if (error instanceof Error && error.message.startsWith('非法用途')) {
      return { status: 400, body: { error: error.message } };
    }
    throw error;
  }

  const effectivePurpose =
    points[0]?.purpose ??
    (rawPurpose === 'unannotated' || rawPurpose === '未标注' ? null : (rawPurpose ?? null));

  return {
    status: 200,
    body: {
      project: PROJECT,
      dataset: dataset ?? null,
      purpose: effectivePurpose,
      notice: effectivePurpose ? null : '用途未标注；仅供诊断，不构成有效效果结论',
      metric,
      points: points.map((p) => ({
        run_id: p.run_id,
        started_at: p.started_at,
        dataset: p.dataset,
        purpose: p.purpose ?? null,
        value: p.aggregates[metric],
        gates_pass: p.gates_pass,
        run_dir: p.run_dir,
      })),
    },
  };
}

export async function runsView(rawPath: string): Promise<HttpResponse> {
  const abs = safeUnder(join(PROJECT, 'runs'), rawPath) ?? safeUnder(PROJECT, rawPath);
  if (!abs || !existsSync(abs)) {
    return { status: 404, body: { error: 'run not found' } };
  }
  const dir = statSync(abs).isDirectory() ? abs : dirname(abs);
  const readMaybe = (name: string) => {
    const p = join(dir, name);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const metrics = readMaybe('metrics.json');
  const resultsRaw = readMaybe('results.ndjson');
  const scores = readMaybe('scores.json');
  const judgeScoresRaw = readMaybe('judge_scores.json');
  const effectMd = readMaybe('effect_compare.md');
  const summary = buildRunSummary({
    resultsText: resultsRaw,
    metricsText: metrics,
    scoresText: scores,
    runDir: dir,
  });
  let effect_structured: ReturnType<typeof compareRuns> | null = null;
  let baselineResults: string | null = null;
  if (effectMd) {
    const basePath = parseBaselinePathFromEffectMd(effectMd);
    if (basePath && existsSync(basePath) && existsSync(join(basePath, 'results.ndjson'))) {
      try {
        effect_structured = compareRuns(basePath, dir);
      } catch {
        effect_structured = null;
      }
      try {
        baselineResults = readFileSync(join(basePath, 'results.ndjson'), 'utf8');
      } catch {
        baselineResults = null;
      }
    }
  }
  const dashboard = buildRunDashboard({
    runJsonText: readMaybe('run.json'),
    resultsText: resultsRaw,
    metricsText: metrics,
    hostedSnaps: readHostedSnaps(dir),
    baselineResultsText: baselineResults,
    effect: effect_structured?.effect ?? null,
  });
  return {
    status: 200,
    body: {
      dir,
      run: readMaybe('run.json'),
      metrics,
      report: readMaybe('report.md'),
      effect_compare: effectMd,
      effect_structured,
      dashboard,
      summary,
      scores,
      judge_scores: judgeScoresRaw,
      results_preview: (resultsRaw ?? '').split(/\n/).filter(Boolean).slice(0, 50),
    },
  };
}

export async function baselinesList(): Promise<HttpResponse> {
  return { status: 200, body: { baselines: listBaselineNames(PROJECT) } };
}

export async function baselinesPin(body: {
  runPath?: string;
  name?: string;
}): Promise<HttpResponse> {
  const name = (body.name ?? '').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
    return { status: 400, body: { error: 'baseline 名称须为 1–64 位字母数字._-' } };
  }
  const runRaw = body.runPath ?? '';
  const runAbs =
    safeUnder(join(PROJECT, 'runs'), runRaw) ??
    safeUnder(PROJECT, runRaw) ??
    (runRaw ? safeUnder(REPO_ROOT, runRaw) : undefined);
  if (!runAbs || !existsSync(join(runAbs, 'results.ndjson'))) {
    return { status: 400, body: { error: '无效 run 路径' } };
  }
  const code = runBaselinePin({
    run: runAbs,
    name,
    project: PROJECT,
    json: false,
  });
  if (code !== 0) {
    return { status: 500, body: { error: `baseline pin 失败 exit=${code}` } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      name,
      dest: join(PROJECT, 'baselines', name),
      source: runAbs,
    },
  };
}

export async function compare(body: {
  baseline?: string;
  candidate?: string;
  writeMd?: boolean;
}): Promise<HttpResponse> {
  const resolveRunOrBaseline = (rawPath: string): string | undefined => {
    const t = rawPath.trim();
    if (!t) return undefined;
    const asBaseline = safeUnder(join(PROJECT, 'baselines'), t);
    if (asBaseline && existsSync(join(asBaseline, 'results.ndjson'))) return asBaseline;
    const named = join(PROJECT, 'baselines', t);
    if (existsSync(join(named, 'results.ndjson'))) return named;
    const asRun =
      safeUnder(join(PROJECT, 'runs'), t) ?? safeUnder(PROJECT, t) ?? safeUnder(REPO_ROOT, t);
    if (asRun && existsSync(join(asRun, 'results.ndjson'))) return asRun;
    return undefined;
  };
  const baseAbs = resolveRunOrBaseline(body.baseline ?? '');
  const candAbs = resolveRunOrBaseline(body.candidate ?? '');
  if (!baseAbs || !candAbs) {
    return { status: 400, body: { error: 'baseline / candidate 路径无效' } };
  }
  try {
    const report = compareRuns(baseAbs, candAbs);
    if (body.writeMd !== false) {
      writeEffectCompareMarkdown(report, join(candAbs, 'effect_compare.md'));
    }
    return { status: 200, body: { ok: true, report } };
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }
}

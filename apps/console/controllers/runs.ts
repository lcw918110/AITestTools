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

export async function runsList(): Promise<HttpResponse> {
  return { status: 200, body: { runs: listRuns(30) } };
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
  const effectMd = readMaybe('effect_compare.md');
  const summary = buildRunSummary({
    resultsText: resultsRaw,
    metricsText: metrics,
    scoresText: scores,
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

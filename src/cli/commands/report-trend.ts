import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadProject } from '../../exam-engine/project.ts';

export interface ReportTrendOptions {
  project?: string | undefined;
  paperset?: string | undefined;
  metric?: string | undefined;
  limit?: number | undefined;
  json: boolean;
}

interface RunPoint {
  run_id: string;
  run_dir: string;
  started_at?: string;
  paperset?: string;
  axis?: string;
  aggregates: Record<string, number>;
  gates_pass?: boolean;
}

function listRunDirs(runsRoot: string): string[] {
  if (!existsSync(runsRoot)) return [];
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(runsRoot, d.name))
    .sort();
}

function loadPoint(runDir: string): RunPoint | null {
  const runJson = join(runDir, 'run.json');
  const metricsJson = join(runDir, 'metrics.json');
  if (!existsSync(runJson) || !existsSync(metricsJson)) return null;
  try {
    const meta = JSON.parse(readFileSync(runJson, 'utf8')) as {
      run_id?: string;
      started_at?: string;
      paperset?: string;
      axis?: string;
    };
    const metrics = JSON.parse(readFileSync(metricsJson, 'utf8')) as {
      aggregates?: Record<string, number>;
      gates?: Record<string, { pass?: boolean }>;
    };
    const gates = metrics.gates ?? {};
    const gateVals = Object.values(gates);
    const gates_pass = gateVals.length === 0 ? undefined : gateVals.every((g) => g.pass === true);
    const point: RunPoint = {
      run_id: meta.run_id ?? runDir.split('/').pop() ?? runDir,
      run_dir: runDir,
      aggregates: metrics.aggregates ?? {},
    };
    if (meta.started_at !== undefined) point.started_at = meta.started_at;
    if (meta.paperset !== undefined) point.paperset = meta.paperset;
    if (meta.axis !== undefined) point.axis = meta.axis;
    if (gates_pass !== undefined) point.gates_pass = gates_pass;
    return point;
  } catch {
    return null;
  }
}

/** 从 runs/ 扫描同一 paperset 的 metrics 时间线（Phase 3 最小面）。 */
export function runReportTrend(options: ReportTrendOptions): number {
  const project = loadProject(options.project);
  const limit = Math.max(1, options.limit ?? 20);
  const metric = options.metric ?? 'a_case_pass_rate';
  const points: RunPoint[] = [];
  for (const dir of listRunDirs(project.dirs.runs)) {
    const p = loadPoint(dir);
    if (p === null) continue;
    if (options.paperset !== undefined && p.paperset !== options.paperset) continue;
    points.push(p);
  }
  // 按 started_at / run_id 倒序取最近 N 条，再正序展示
  points.sort((a, b) => (a.started_at ?? a.run_id).localeCompare(b.started_at ?? b.run_id));
  const recent = points.slice(-limit);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          project: project.root,
          paperset: options.paperset ?? null,
          metric,
          points: recent.map((p) => ({
            run_id: p.run_id,
            started_at: p.started_at,
            paperset: p.paperset,
            axis: p.axis,
            value: p.aggregates[metric],
            aggregates: p.aggregates,
            gates_pass: p.gates_pass,
            run_dir: p.run_dir,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (recent.length === 0) {
    console.log(
      `无匹配 run（project=${project.root}${options.paperset ? ` paperset=${options.paperset}` : ''}）`,
    );
    return 0;
  }

  console.log(`# trend  metric=${metric}  n=${recent.length}`);
  console.log('| started_at | run_id | paperset | value | gates |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const p of recent) {
    const v = p.aggregates[metric];
    const g = p.gates_pass === undefined ? '-' : p.gates_pass ? 'PASS' : 'FAIL';
    console.log(
      `| ${p.started_at ?? '-'} | ${p.run_id} | ${p.paperset ?? '-'} | ${v === undefined ? '-' : v} | ${g} |`,
    );
  }
  return 0;
}

/** 解析 --run 为绝对路径（供测试）。 */
export function resolveRunDir(run: string): string {
  return resolve(run);
}

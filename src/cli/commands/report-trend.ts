import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadProject } from '../../exam-engine/project.ts';

/** 支持的正式测试用途集合（与 01 / 03 规范及 eval-tasks 对齐）。 */
export const VALID_PURPOSES = [
  'smoke',
  'acceptance',
  'diagnostic',
  'regression',
  'effect_comparison',
  'controlled_fault',
  'scorer_calibration',
] as const;

export type ValidPurpose = (typeof VALID_PURPOSES)[number];

export function isValidPurpose(purpose: string): purpose is ValidPurpose {
  return VALID_PURPOSES.includes(purpose as ValidPurpose);
}

/** 用途不可比异常（包含可用用途列表，便于上层提示与引导分桶）。 */
export class IncomparablePurposeError extends Error {
  readonly available_purposes: string[];
  constructor(message: string, available_purposes: string[]) {
    super(message);
    this.name = 'IncomparablePurposeError';
    this.available_purposes = available_purposes;
  }
}

export interface ReportTrendOptions {
  project?: string | undefined;
  dataset?: string | undefined;
  purpose?: string | undefined;
  metric?: string | undefined;
  limit?: number | undefined;
  bucket?: boolean | undefined;
  json: boolean;
}

export interface RunPoint {
  run_id: string;
  run_dir: string;
  started_at?: string;
  dataset?: string;
  purpose?: string;
  aggregates: Record<string, number>;
  gates_pass?: boolean;
}

export interface TrendBucket {
  purpose: string | null;
  notice?: string | null;
  points: RunPoint[];
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
      dataset?: string;
      purpose?: unknown;
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
    if (meta.dataset !== undefined) point.dataset = meta.dataset;
    if (typeof meta.purpose === 'string' && meta.purpose.trim())
      point.purpose = meta.purpose.trim();
    if (gates_pass !== undefined) point.gates_pass = gates_pass;
    return point;
  } catch {
    return null;
  }
}

/** 规范化并校验传入的 purpose 参数；非法用途抛出明确错误。 */
export function normalizeAndValidatePurpose(purpose?: string | undefined): string | undefined {
  if (purpose === undefined) return undefined;
  const trimmed = purpose.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'unannotated' || trimmed === '未标注') return 'unannotated';
  if (isValidPurpose(trimmed)) return trimmed;
  throw new Error(
    `非法用途：${purpose}，支持的测试用途为 ${VALID_PURPOSES.join(', ')}（或 unannotated）`,
  );
}

/** 扫描 runs/ 收集趋势点（纯函数，CLI 与 console API 共用）。 */
export function collectTrendPoints(options: {
  project?: string | undefined;
  dataset?: string | undefined;
  limit?: number | undefined;
  purpose?: string | undefined;
}): RunPoint[] {
  const project = loadProject(options.project);
  const limit = Math.max(1, options.limit ?? 20);
  const targetPurpose = normalizeAndValidatePurpose(options.purpose);

  const points: RunPoint[] = [];
  for (const dir of listRunDirs(project.dirs.runs)) {
    const p = loadPoint(dir);
    if (p === null) continue;
    if (options.dataset !== undefined && p.dataset !== options.dataset) continue;
    if (targetPurpose !== undefined) {
      if (targetPurpose === 'unannotated') {
        if (p.purpose !== undefined) continue;
      } else {
        if (p.purpose !== targetPurpose) continue;
      }
    }
    points.push(p);
  }

  // 截断前检查全部匹配跑次，避免最近条数掩盖用途混算。
  const purposes = new Set(points.map((p) => p.purpose));
  if (purposes.size > 1) {
    const available = Array.from(purposes)
      .map((item) => item ?? 'unannotated')
      .sort();
    throw new IncomparablePurposeError(
      `用途不可比：趋势包含不同用途（${available.join(', ')}）或已知与未知用途混合，严禁跨用途无差别混算；请指定用途筛选或按用途分桶查看`,
      available,
    );
  }

  // 按 started_at / run_id 倒序取最近 N 条，再正序展示
  points.sort((a, b) => (a.started_at ?? a.run_id).localeCompare(b.started_at ?? b.run_id));
  return points.slice(-limit);
}

/** 扫描 runs/ 按用途（purpose）分桶收集趋势（严禁不同用途混算，每桶内独立时间线）。 */
export function collectTrendBuckets(options: {
  project?: string | undefined;
  dataset?: string | undefined;
  limit?: number | undefined;
}): Record<string, TrendBucket> {
  const project = loadProject(options.project);
  const limit = Math.max(1, options.limit ?? 20);
  const allPoints: RunPoint[] = [];
  for (const dir of listRunDirs(project.dirs.runs)) {
    const p = loadPoint(dir);
    if (p === null) continue;
    if (options.dataset !== undefined && p.dataset !== options.dataset) continue;
    allPoints.push(p);
  }

  const groups = new Map<string, RunPoint[]>();
  for (const p of allPoints) {
    const key = p.purpose ?? 'unannotated';
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(p);
  }

  const buckets: Record<string, TrendBucket> = {};
  for (const [key, pts] of groups.entries()) {
    pts.sort((a, b) => (a.started_at ?? a.run_id).localeCompare(b.started_at ?? b.run_id));
    const sliced = pts.slice(-limit);
    const purpose = key === 'unannotated' ? null : key;
    buckets[key] = {
      purpose,
      notice: purpose ? null : '用途未标注；仅供诊断，不构成有效效果结论',
      points: sliced,
    };
  }
  return buckets;
}

/** 从 runs/ 扫描同一 dataset 的 metrics 时间线（Phase 3 最小面，支持单用途筛选与分桶）。 */
export function runReportTrend(options: ReportTrendOptions): number {
  const project = loadProject(options.project);
  const metric = options.metric ?? 'a_case_pass_rate';

  if (options.bucket) {
    const buckets = collectTrendBuckets({
      project: options.project,
      dataset: options.dataset,
      limit: options.limit,
    });
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            project: project.root,
            dataset: options.dataset ?? null,
            metric,
            bucketed: true,
            available_purposes: Object.keys(buckets),
            buckets: Object.fromEntries(
              Object.entries(buckets).map(([k, b]) => [
                k,
                {
                  purpose: b.purpose,
                  notice: b.notice ?? null,
                  points: b.points.map((p) => ({
                    run_id: p.run_id,
                    started_at: p.started_at,
                    dataset: p.dataset,
                    purpose: p.purpose ?? null,
                    value: p.aggregates[metric],
                    aggregates: p.aggregates,
                    gates_pass: p.gates_pass,
                    run_dir: p.run_dir,
                  })),
                },
              ]),
            ),
          },
          null,
          2,
        ),
      );
      return 0;
    }

    const bucketKeys = Object.keys(buckets);
    if (bucketKeys.length === 0) {
      console.log(
        `无匹配 run（project=${project.root}${options.dataset ? ` dataset=${options.dataset}` : ''}）`,
      );
      return 0;
    }

    console.log(`# trend buckets  metric=${metric}  buckets=${bucketKeys.length}`);
    for (const key of bucketKeys) {
      const b = buckets[key]!;
      console.log(
        `\n## [用途分桶: ${b.purpose ?? '未标注（仅供诊断，不构成有效效果结论）'}] n=${b.points.length}`,
      );
      console.log('| started_at | run_id | dataset | value | gates |');
      console.log('| --- | --- | --- | --- | --- |');
      for (const p of b.points) {
        const v = p.aggregates[metric];
        const g = p.gates_pass === undefined ? '-' : p.gates_pass ? 'PASS' : 'FAIL';
        console.log(
          `| ${p.started_at ?? '-'} | ${p.run_id} | ${p.dataset ?? '-'} | ${v === undefined ? '-' : v} | ${g} |`,
        );
      }
    }
    return 0;
  }

  const recent = collectTrendPoints({
    project: options.project,
    dataset: options.dataset,
    purpose: options.purpose,
    limit: options.limit,
  });

  const effectivePurpose =
    recent[0]?.purpose ??
    (options.purpose?.trim() === 'unannotated' ? null : options.purpose?.trim() || null);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          project: project.root,
          dataset: options.dataset ?? null,
          metric,
          purpose: effectivePurpose,
          notice: effectivePurpose ? null : '用途未标注；仅供诊断，不构成有效效果结论',
          points: recent.map((p) => ({
            run_id: p.run_id,
            started_at: p.started_at,
            dataset: p.dataset,
            purpose: p.purpose ?? null,
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
      `无匹配 run（project=${project.root}${options.dataset ? ` dataset=${options.dataset}` : ''}${options.purpose ? ` purpose=${options.purpose}` : ''}）`,
    );
    return 0;
  }

  console.log(`# trend  metric=${metric}  n=${recent.length}`);
  console.log(`用途：${effectivePurpose ?? '未标注；仅供诊断，不构成有效效果结论'}`);
  console.log('| started_at | run_id | dataset | value | gates |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const p of recent) {
    const v = p.aggregates[metric];
    const g = p.gates_pass === undefined ? '-' : p.gates_pass ? 'PASS' : 'FAIL';
    console.log(
      `| ${p.started_at ?? '-'} | ${p.run_id} | ${p.dataset ?? '-'} | ${v === undefined ? '-' : v} | ${g} |`,
    );
  }
  return 0;
}

/** 解析 --run 为绝对路径（供测试）。 */
export function resolveRunDir(run: string): string {
  return resolve(run);
}

/**
 * 从 run 产物汇总结果页所需结构化摘要（归因 / 配对 / 信息性指标 / 稳定性）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { bool, num, parseJsonObject, str } from './parse.ts';
import { formatPassTokenCell } from '../../src/run/hosted-pass-token.ts';
import {
  formatHostExitCell,
  formatTimedOutCell,
  formatWorkspaceCell,
} from '../../src/run/hosted-host-exit.ts';

export interface ResultRow {
  item_id: string;
  item_rev?: number;
  pass: boolean;
  attribution?: string;
  effect_pair?: string;
  oracle_failures?: Array<{ oracle_id?: string; message?: string }>;
  metrics?: Record<string, number>;
  artifact_dir?: string;
  pass_token?: string;
  pass_token_present?: boolean;
  pass_token_role?: 'auxiliary';
  workspace_ok?: boolean;
  timed_out?: boolean;
  host_exit?: number | null;
  materials_mutated?: boolean;
}

export interface AttributionSummary {
  /** 失败题归因计数 */
  fail_counts: Record<string, number>;
  /** 失败主因（计数最高；并列取字典序最小） */
  primary_fail?: string;
  fail_total: number;
  pass_total: number;
  item_total: number;
}

export interface EffectPairRow {
  pair: string;
  off_id?: string;
  on_id?: string;
  off_pass?: boolean;
  on_pass?: boolean;
}

export interface InfoMetrics {
  /** 目录内 gateable=false 或明确信息性字段，仅透传已有数值 */
  values: Record<string, number>;
}

export interface StabilitySummary {
  a_flaky_rerun_delta?: number;
  /** results 中含 ::rN 后缀的题数（B 轴 repeats 痕迹） */
  repeat_tagged_items: number;
  note: string;
}

export interface FailureDraftHint {
  item_id: string;
  attribution?: string;
  message?: string;
  /** 从失败文案或题号猜到的终态词 */
  suggested_token?: string;
  /** 从 artifact hosted-run.json 抽到的题干 */
  suggested_prompt?: string;
  /** 若 item_id 可映射到 PAIRED-TASK-* */
  suggested_task_id?: string;
}

export interface PassTokenSummaryRow {
  item_id: string;
  pass: boolean;
  pass_token?: string;
  pass_token_present?: boolean;
  /** 有 DUAL_FIX / 无 DUAL_FIX */
  label: string;
  workspace_ok?: boolean;
  timed_out?: boolean;
  host_exit?: number | null;
  materials_mutated?: boolean;
  workspace_label: string;
  timed_out_label: string;
  host_exit_label: string;
}

export interface RunSummary {
  attribution: AttributionSummary;
  effect_pairs: EffectPairRow[];
  info_metrics: InfoMetrics;
  stability: StabilitySummary;
  failures: FailureDraftHint[];
  pass_tokens: PassTokenSummaryRow[];
  reference_scores?: {
    scale_max?: number;
    avg?: number;
    n: number;
  };
}

const INFO_METRIC_NAMES = [
  'b_avg_steps_to_success',
  'b_cost_tokens_per_pass',
  'b_hosted_attribution_share',
  'b_task_pass_rate',
] as const;

function decodeResultRow(line: string, index: number): ResultRow | undefined {
  const parsed = parseJsonObject(line, `results.ndjson 第 ${index + 1} 行`);
  if (!parsed.ok) return undefined;
  const d = parsed.value;

  const item_id = str(d.item_id);
  if (item_id === undefined) return undefined;
  const pass = bool(d.pass);
  if (pass === undefined) return undefined;

  const row: ResultRow = { item_id, pass };

  const item_rev = num(d.item_rev);
  if (item_rev !== undefined) row.item_rev = item_rev;
  const attribution = str(d.attribution);
  if (attribution !== undefined) row.attribution = attribution;
  const effect_pair = str(d.effect_pair);
  if (effect_pair !== undefined) row.effect_pair = effect_pair;

  if (Array.isArray(d.oracle_failures)) {
    const failures: NonNullable<ResultRow['oracle_failures']> = [];
    for (const f of d.oracle_failures) {
      if (typeof f !== 'object' || f === null) continue;
      const entry: { oracle_id?: string; message?: string } = {};
      const oid = str((f as Record<string, unknown>).oracle_id);
      const msg = str((f as Record<string, unknown>).message);
      if (oid !== undefined) entry.oracle_id = oid;
      if (msg !== undefined) entry.message = msg;
      failures.push(entry);
    }
    if (failures.length > 0) row.oracle_failures = failures;
  }

  if (typeof d.metrics === 'object' && d.metrics !== null && !Array.isArray(d.metrics)) {
    const metrics: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.metrics as Record<string, unknown>)) {
      const n = num(v);
      if (n !== undefined) metrics[k] = n;
    }
    if (Object.keys(metrics).length > 0) row.metrics = metrics;
  }

  const artifact_dir = str(d.artifact_dir);
  if (artifact_dir !== undefined) row.artifact_dir = artifact_dir;
  const pass_token = str(d.pass_token);
  if (pass_token !== undefined) row.pass_token = pass_token;
  const pass_token_present = bool(d.pass_token_present);
  if (pass_token_present !== undefined) row.pass_token_present = pass_token_present;
  if (d.pass_token_role === 'auxiliary') row.pass_token_role = 'auxiliary';
  const workspace_ok = bool(d.workspace_ok);
  if (workspace_ok !== undefined) row.workspace_ok = workspace_ok;
  const timed_out = bool(d.timed_out);
  if (timed_out !== undefined) row.timed_out = timed_out;
  const host_exit = d.host_exit === null ? null : num(d.host_exit);
  if (host_exit !== undefined) row.host_exit = host_exit;
  const materials_mutated = bool(d.materials_mutated);
  if (materials_mutated !== undefined) row.materials_mutated = materials_mutated;

  return row;
}

export function parseResultsNdjson(text: string): ResultRow[] {
  const rows: ResultRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const row = decodeResultRow(line, i);
    if (row) rows.push(row);
  }
  return rows;
}

export function summarizeAttribution(rows: ResultRow[]): AttributionSummary {
  const fail_counts: Record<string, number> = {};
  let fail_total = 0;
  let pass_total = 0;
  for (const r of rows) {
    if (r.pass) {
      pass_total += 1;
      continue;
    }
    fail_total += 1;
    const key = r.attribution ?? 'UNKNOWN';
    fail_counts[key] = (fail_counts[key] ?? 0) + 1;
  }
  let primary_fail: string | undefined;
  let best = -1;
  for (const k of Object.keys(fail_counts).sort()) {
    const n = fail_counts[k]!;
    if (n > best) {
      best = n;
      primary_fail = k;
    }
  }
  const out: AttributionSummary = {
    fail_counts,
    fail_total,
    pass_total,
    item_total: rows.length,
  };
  if (primary_fail !== undefined) out.primary_fail = primary_fail;
  return out;
}

/** 同一 run 内若同时出现 OFF/ON（少见）则并表；否则只列 effect_pair 键与单侧。 */
export function summarizeEffectPairs(rows: ResultRow[]): EffectPairRow[] {
  const map = new Map<string, EffectPairRow>();
  for (const r of rows) {
    const pair = r.effect_pair ?? inferPairFromItemId(r.item_id) ?? undefined;
    if (!pair) continue;
    const row = map.get(pair) ?? { pair };
    const id = r.item_id;
    if (/-OFF(?:$|::)/.test(id) || /PAIRED-TASK-OFF$/.test(id) || id.endsWith('-OFF')) {
      row.off_id = id;
      row.off_pass = r.pass;
    } else if (/-ON(?:$|::)/.test(id) || /PAIRED-TASK-ON$/.test(id) || id.endsWith('-ON')) {
      row.on_id = id;
      row.on_pass = r.pass;
    }
    map.set(pair, row);
  }
  return [...map.values()].sort((a, b) => a.pair.localeCompare(b.pair));
}

export function inferPairFromItemId(itemId: string): string | undefined {
  const m = itemId.match(/PAIRED-TASK-(\d+)/);
  if (m) return `PAIRED-TASK-${m[1]}`;
  if (/PAIRED-TASK-(?:OFF|ON)/.test(itemId)) return 'PAIRED-TASK-01';
  return undefined;
}

export function summarizeInfoMetrics(
  aggregates: Record<string, number>,
  rows: ResultRow[],
): InfoMetrics {
  const values: Record<string, number> = {};
  for (const name of INFO_METRIC_NAMES) {
    if (typeof aggregates[name] === 'number') values[name] = aggregates[name]!;
  }
  // 题级 metrics 均值（仅当聚合未写时）
  for (const name of INFO_METRIC_NAMES) {
    if (values[name] !== undefined) continue;
    const nums = rows
      .map((r) => r.metrics?.[name])
      .filter((x): x is number => typeof x === 'number');
    if (nums.length > 0) {
      values[name] = nums.reduce((a, b) => a + b, 0) / nums.length;
    }
  }
  return { values };
}

export function summarizeStability(
  aggregates: Record<string, number>,
  rows: ResultRow[],
): StabilitySummary {
  const repeat_tagged_items = rows.filter((r) => /::r\d+$/.test(r.item_id)).length;
  const flaky = aggregates.a_flaky_rerun_delta;
  const note =
    repeat_tagged_items === 0
      ? '本 run 结果无 ::rN 重跑标记；单次跑时 a_flaky_rerun_delta 常记 0，不等于已证明无 flaky'
      : '结果含 repeats 标记；请结合 a_flaky_rerun_delta 解读一致性';
  const out: StabilitySummary = { repeat_tagged_items, note };
  if (typeof flaky === 'number') out.a_flaky_rerun_delta = flaky;
  return out;
}

function extractTokenFromMessage(message: string): string | undefined {
  const m = message.match(/未含约定\s+([A-Za-z0-9_-]+)/);
  return m?.[1];
}

function taskIdFromItemId(itemId: string): string | undefined {
  const m = itemId.match(/(PAIRED-TASK-\d+)/);
  if (m) return m[1];
  if (/EVAL-B-PAIRED-TASK-(?:OFF|ON)(?:$|::)/.test(itemId)) return 'PAIRED-TASK-01';
  return undefined;
}

function readHostedPrompt(artifactDir: string | undefined): string | undefined {
  if (!artifactDir) return undefined;
  const p = join(artifactDir, 'hosted-run.json');
  if (!existsSync(p)) return undefined;
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8')) as { args?: string[] };
    const args = doc.args ?? [];
    // opencode: ["run", "--dir", <tmpdir>, "-m", <model>, <prompt>]
    let best = '';
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i]!;
      if (a === '--dir' || a === '-m' || a === '--model') {
        i += 1;
        continue;
      }
      if (a.startsWith('-')) continue;
      if (a === 'run') continue;
      if (a.startsWith('/') || a.includes(`${sep}`)) continue;
      if (a.length > best.length) best = a;
    }
    return best.length > 0 ? best : undefined;
  } catch {
    return undefined;
  }
}

export function summarizePassTokens(rows: ResultRow[]): PassTokenSummaryRow[] {
  return rows
    .filter(
      (r) =>
        r.pass_token !== undefined ||
        r.pass_token_present !== undefined ||
        r.workspace_ok !== undefined ||
        r.timed_out !== undefined,
    )
    .map((r) => {
      const out: PassTokenSummaryRow = {
        item_id: r.item_id,
        pass: r.pass,
        label: formatPassTokenCell(r),
        workspace_label: formatWorkspaceCell(r.workspace_ok),
        timed_out_label: formatTimedOutCell(r.timed_out),
        host_exit_label: formatHostExitCell({
          host_exit: r.host_exit,
          timed_out: r.timed_out,
        }),
      };
      if (r.pass_token !== undefined) out.pass_token = r.pass_token;
      if (r.pass_token_present !== undefined) out.pass_token_present = r.pass_token_present;
      if (r.workspace_ok !== undefined) out.workspace_ok = r.workspace_ok;
      if (r.timed_out !== undefined) out.timed_out = r.timed_out;
      if (r.host_exit !== undefined) out.host_exit = r.host_exit;
      if (r.materials_mutated !== undefined) out.materials_mutated = r.materials_mutated;
      return out;
    });
}

export function summarizeFailures(rows: ResultRow[]): FailureDraftHint[] {
  const out: FailureDraftHint[] = [];
  for (const r of rows) {
    if (r.pass) continue;
    const message = r.oracle_failures?.[0]?.message;
    const hint: FailureDraftHint = { item_id: r.item_id };
    if (r.attribution !== undefined) hint.attribution = r.attribution;
    if (message !== undefined) hint.message = message.slice(0, 400);
    const token = message ? extractTokenFromMessage(message) : undefined;
    const suggested = token ?? r.pass_token;
    if (suggested !== undefined) hint.suggested_token = suggested;
    const prompt = readHostedPrompt(r.artifact_dir);
    if (prompt !== undefined) hint.suggested_prompt = prompt;
    const taskId = taskIdFromItemId(r.item_id);
    if (taskId !== undefined) hint.suggested_task_id = taskId;
    out.push(hint);
  }
  return out;
}

export function summarizeScores(scoresText: string | null): RunSummary['reference_scores'] {
  if (!scoresText) return undefined;
  try {
    const doc = JSON.parse(scoresText) as {
      scale_max?: number;
      scores?: Array<{ score?: number }>;
    };
    const nums = (doc.scores ?? [])
      .map((s) => s.score)
      .filter((x): x is number => typeof x === 'number');
    if (nums.length === 0) return undefined;
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const out: NonNullable<RunSummary['reference_scores']> = { avg, n: nums.length };
    if (typeof doc.scale_max === 'number') out.scale_max = doc.scale_max;
    return out;
  } catch {
    return undefined;
  }
}

export function buildRunSummary(opts: {
  resultsText: string | null;
  metricsText: string | null;
  scoresText: string | null;
}): RunSummary {
  const rows = parseResultsNdjson(opts.resultsText ?? '');
  let aggregates: Record<string, number> = {};
  if (opts.metricsText) {
    try {
      const m = JSON.parse(opts.metricsText) as { aggregates?: Record<string, number> };
      aggregates = m.aggregates ?? {};
    } catch {
      aggregates = {};
    }
  }
  const attribution = summarizeAttribution(rows);
  const effect_pairs = summarizeEffectPairs(rows);
  const info_metrics = summarizeInfoMetrics(aggregates, rows);
  const stability = summarizeStability(aggregates, rows);
  const failures = summarizeFailures(rows);
  const pass_tokens = summarizePassTokens(rows);
  const reference_scores = summarizeScores(opts.scoresText);
  const summary: RunSummary = {
    attribution,
    effect_pairs,
    info_metrics,
    stability,
    failures,
    pass_tokens,
  };
  if (reference_scores !== undefined) summary.reference_scores = reference_scores;
  return summary;
}

/** 从 effect_compare.md 头解析 baseline 路径。 */
export function parseBaselinePathFromEffectMd(md: string): string | undefined {
  const m = md.match(/^- baseline:\s*`([^`]+)`/m);
  return m?.[1];
}

export function listBaselineNames(projectRoot: string): Array<{ name: string; path: string }> {
  const dir = join(projectRoot, 'baselines');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .map((name) => ({ name, path: join(dir, name) }))
    .filter((x) => existsSync(join(x.path, 'results.ndjson')));
}

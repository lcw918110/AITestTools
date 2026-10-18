/**
 * 测试看板 DTO：配置条 + 通过率/Δ + 逐题矩阵 + CONTEXT 能否进效果结论。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonObject } from './parse.ts';
import type { CompareReport } from '../../src/report/compare.ts';
import { inferPairFromItemId, parseResultsNdjson, type ResultRow } from './run-summary.ts';

export interface HostedSnap {
  item_id: string;
  model?: string;
  model_source?: string;
  model_matches_freeze?: boolean | null;
  workspace_isolated?: boolean | null;
  plugin?: string | null;
  event_store_present?: boolean | null;
  event_store_source?: string | null;
  materials_seeded?: string[] | boolean | null;
  materials_mutated?: boolean | null;
}

export interface DashConfig {
  dataset?: string;
  environment?: string;
  plugin: 'on' | 'off' | 'unknown';
  model?: string;
  model_source?: string;
  model_matches_freeze?: boolean | null;
  workspace_isolated?: boolean | null;
  materials_seeded: boolean | null;
  event_store_present?: boolean | null;
  event_store_source?: string | null;
}

export interface DashMatrixRow {
  pair: string;
  off_pass?: boolean;
  on_pass?: boolean;
  off_workspace?: boolean;
  on_workspace?: boolean;
  off_token?: boolean;
  on_token?: boolean;
  off_timeout?: boolean;
  on_timeout?: boolean;
  off_attr?: string;
  on_attr?: string;
  exclude_from_effect: boolean;
  exclude_reason?: string;
}

export interface RunDashboard {
  config: DashConfig;
  headline: {
    pass_total: number;
    item_total: number;
    pass_rate: number;
    baseline_pass_rate?: number;
    candidate_pass_rate?: number;
    delta?: number;
    usable_item_pairs: number;
    usable_delta?: number | null;
    usable_note: string;
  };
  matrix: DashMatrixRow[];
}

function parseRunMeta(text: string | null): { dataset?: string; environment?: string } {
  if (!text) return {};
  try {
    const doc = JSON.parse(text) as { dataset?: string; environment?: string };
    const out: { dataset?: string; environment?: string } = {};
    if (typeof doc.dataset === 'string') out.dataset = doc.dataset;
    if (typeof doc.environment === 'string') out.environment = doc.environment;
    return out;
  } catch {
    return {};
  }
}

export function readHostedSnaps(runDir: string): HostedSnap[] {
  const art = join(runDir, 'artifacts');
  if (!existsSync(art)) return [];
  const out: HostedSnap[] = [];
  for (const name of readdirSync(art)) {
    const p = join(art, name, 'hosted-run.json');
    if (!existsSync(p)) continue;
    try {
      const parsed = parseJsonObject(readFileSync(p, 'utf8'), `artifacts/${name}/hosted-run.json`);
      if (!parsed.ok) continue;
      const j = parsed.value;
      const snap: HostedSnap = { item_id: name };
      if (typeof j.model === 'string') snap.model = j.model;
      if (typeof j.model_source === 'string') snap.model_source = j.model_source;
      if (typeof j.model_matches_freeze === 'boolean' || j.model_matches_freeze === null) {
        snap.model_matches_freeze = j.model_matches_freeze as boolean | null;
      }
      if (typeof j.workspace_isolated === 'boolean') snap.workspace_isolated = j.workspace_isolated;
      if (typeof j.plugin === 'string' || j.plugin === null)
        snap.plugin = j.plugin as string | null;
      if (typeof j.event_store_present === 'boolean')
        snap.event_store_present = j.event_store_present;
      if (typeof j.event_store_source === 'string') snap.event_store_source = j.event_store_source;
      if (Array.isArray(j.materials_seeded) || typeof j.materials_seeded === 'boolean') {
        snap.materials_seeded = j.materials_seeded as string[] | boolean;
      }
      if (typeof j.materials_mutated === 'boolean') snap.materials_mutated = j.materials_mutated;
      out.push(snap);
    } catch {
      /* skip */
    }
  }
  return out;
}

function seeded(snaps: HostedSnap[]): boolean | null {
  const bits = snaps.map((s) => {
    if (s.materials_seeded === true) return true;
    if (s.materials_seeded === false) return false;
    if (Array.isArray(s.materials_seeded)) return s.materials_seeded.length > 0;
    return null;
  });
  if (bits.some((b) => b === true)) return true;
  if (bits.every((b) => b === false)) return false;
  if (bits.every((b) => b === null)) return null;
  return bits.some((b) => b === true);
}

export function contextTimeoutUnusable(row: ResultRow | undefined): string | undefined {
  if (!row || row.pass) return undefined;
  if (row.attribution !== 'CONTEXT') return undefined;
  if (row.timed_out !== true) return undefined;
  if (row.materials_mutated === true) return undefined;
  return '超时且文件没动，不进效果 Δ';
}

function sideFromRows(rows: ResultRow[], which: 'off' | 'on'): Map<string, ResultRow> {
  const map = new Map<string, ResultRow>();
  for (const r of rows) {
    const pair = r.effect_pair ?? inferPairFromItemId(r.item_id);
    if (!pair) continue;
    const isOff = /-OFF(?:$|::)/.test(r.item_id) || r.item_id.endsWith('-OFF');
    const isOn = /-ON(?:$|::)/.test(r.item_id) || r.item_id.endsWith('-ON');
    if (which === 'off' && isOff) map.set(pair, r);
    if (which === 'on' && isOn) map.set(pair, r);
  }
  return map;
}

export function buildRunDashboard(opts: {
  runJsonText: string | null;
  resultsText: string | null;
  metricsText: string | null;
  hostedSnaps: HostedSnap[];
  baselineResultsText?: string | null;
  effect?: CompareReport['effect'] | null;
}): RunDashboard {
  const rows = parseResultsNdjson(opts.resultsText ?? '');
  const meta = parseRunMeta(opts.runJsonText);
  const snap = opts.hostedSnaps[0];
  const pluginOn = opts.hostedSnaps.some(
    (s) => typeof s.plugin === 'string' && s.plugin.length > 0,
  );
  const pluginOff = opts.hostedSnaps.length > 0 && opts.hostedSnaps.every((s) => !s.plugin);
  const es = opts.hostedSnaps.find((s) => s.event_store_present === true);

  const config: DashConfig = {
    plugin: pluginOn ? 'on' : pluginOff ? 'off' : 'unknown',
    materials_seeded: seeded(opts.hostedSnaps),
  };
  if (meta.dataset) config.dataset = meta.dataset;
  if (meta.environment) config.environment = meta.environment;
  if (snap?.model) config.model = snap.model;
  if (snap?.model_source) config.model_source = snap.model_source;
  if (snap?.model_matches_freeze !== undefined) {
    config.model_matches_freeze = snap.model_matches_freeze;
  }
  if (snap?.workspace_isolated !== undefined) {
    config.workspace_isolated = snap.workspace_isolated;
  }
  if (es?.event_store_present !== undefined) config.event_store_present = es.event_store_present;
  if (es?.event_store_source) config.event_store_source = es.event_store_source;

  const pass_total = rows.filter((r) => r.pass).length;
  const item_total = rows.length;
  let pass_rate = item_total === 0 ? 0 : pass_total / item_total;
  if (opts.metricsText) {
    try {
      const m = JSON.parse(opts.metricsText) as { aggregates?: { a_case_pass_rate?: number } };
      if (typeof m.aggregates?.a_case_pass_rate === 'number') {
        pass_rate = m.aggregates.a_case_pass_rate;
      }
    } catch {
      /* ignore */
    }
  }

  const thisOff = sideFromRows(rows, 'off');
  const thisOn = sideFromRows(rows, 'on');
  const baseRows = parseResultsNdjson(opts.baselineResultsText ?? '');
  const baseOff = sideFromRows(baseRows, 'off');
  const baseOn = sideFromRows(baseRows, 'on');

  const pairIds = new Set<string>();
  if (opts.effect?.paired_effects) {
    for (const p of opts.effect.paired_effects) pairIds.add(p.pair);
  }
  for (const r of rows) {
    const pair = r.effect_pair ?? inferPairFromItemId(r.item_id);
    if (pair) pairIds.add(pair);
  }

  const matrix: DashMatrixRow[] = [...pairIds]
    .sort((a, b) => a.localeCompare(b))
    .map((pair) => {
      const off = thisOff.get(pair) ?? baseOff.get(pair);
      const on = thisOn.get(pair) ?? baseOn.get(pair);
      const pe = opts.effect?.paired_effects?.find((x) => x.pair === pair);
      const row: DashMatrixRow = { pair, exclude_from_effect: false };
      if (pe) {
        row.off_pass = pe.baseline_pass;
        row.on_pass = pe.candidate_pass;
        if (pe.baseline_pass_token_present !== undefined) {
          row.off_token = pe.baseline_pass_token_present;
        }
        if (pe.candidate_pass_token_present !== undefined) {
          row.on_token = pe.candidate_pass_token_present;
        }
      }
      if (off?.pass !== undefined) row.off_pass = off.pass;
      if (on?.pass !== undefined) row.on_pass = on.pass;
      if (off?.workspace_ok !== undefined) row.off_workspace = off.workspace_ok;
      if (on?.workspace_ok !== undefined) row.on_workspace = on.workspace_ok;
      if (off?.pass_token_present !== undefined) row.off_token = off.pass_token_present;
      if (on?.pass_token_present !== undefined) row.on_token = on.pass_token_present;
      if (off?.timed_out !== undefined) row.off_timeout = off.timed_out;
      if (on?.timed_out !== undefined) row.on_timeout = on.timed_out;
      if (off?.attribution) row.off_attr = off.attribution;
      if (on?.attribution) row.on_attr = on.attribution;
      const why = contextTimeoutUnusable(on) ?? contextTimeoutUnusable(off);
      if (why) {
        row.exclude_from_effect = true;
        row.exclude_reason = why;
      }
      return row;
    });

  const usable = matrix.filter(
    (m) => !m.exclude_from_effect && m.off_pass !== undefined && m.on_pass !== undefined,
  );
  let usable_delta: number | null = null;
  if (usable.length > 0) {
    const offRate = usable.filter((m) => m.off_pass).length / usable.length;
    const onRate = usable.filter((m) => m.on_pass).length / usable.length;
    usable_delta = onRate - offRate;
  }

  const excluded = matrix.filter((m) => m.exclude_from_effect).length;
  let usable_note: string;
  if (matrix.length === 0) {
    usable_note = '本 run 没有配对题。钉 baseline 后对照，才会出现 OFF/ON 矩阵。';
  } else if (opts.effect === undefined || opts.effect === null) {
    usable_note = '单侧 run：矩阵只显示本侧。完整 Δ 请钉无插件 baseline 后「一键对照」。';
  } else if (excluded > 0 && usable.length === 0) {
    usable_note = `原始 Δpass=${opts.effect.pass_rate_delta.toFixed(3)}，但 ${excluded} 对因超时且文件没动须剔除，效果 Δ 暂不可用。`;
  } else if (excluded > 0) {
    usable_note = `已剔除 ${excluded} 对 CONTEXT 超时（文件没动）。效果 Δ 按剩余 ${usable.length} 对计算。`;
  } else {
    usable_note = '本对照没有须剔除的超时空跑，Δ 可当效果差（样本仍可能太小）。';
  }

  const headline: RunDashboard['headline'] = {
    pass_total,
    item_total,
    pass_rate,
    usable_item_pairs: usable.length,
    usable_note,
  };
  if (opts.effect) {
    headline.baseline_pass_rate = opts.effect.baseline_pass_rate;
    headline.candidate_pass_rate = opts.effect.candidate_pass_rate;
    headline.delta = opts.effect.pass_rate_delta;
  }
  if (usable_delta !== null) headline.usable_delta = usable_delta;

  return { config, headline, matrix };
}

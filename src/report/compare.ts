import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatPassTokenCell } from './cells.ts';
import { loadRunArtifacts, type LoadedRun, type ResultLine } from './artifacts.ts';

export type DriftKind = 'new_failure' | 'fixed' | 'asset_rev_drift' | 'unchanged';

export interface CompareRow {
  item_id: string;
  kind: DriftKind;
  baseline_rev?: number;
  candidate_rev?: number;
  baseline_pass?: boolean;
  candidate_pass?: boolean;
  baseline_score?: number;
  candidate_score?: number;
  score_delta?: number;
  baseline_pass_token?: string;
  candidate_pass_token?: string;
  baseline_pass_token_present?: boolean;
  candidate_pass_token_present?: boolean;
}

export interface MetricDelta {
  name: string;
  baseline?: number;
  candidate?: number;
  delta?: number;
}

/** off/on 配对行：不同题号、同一 effect_pair（或 *-OFF/*-ON 推断）。 */
export interface PairedEffect {
  pair: string;
  baseline_item: string;
  candidate_item: string;
  baseline_pass: boolean;
  candidate_pass: boolean;
  baseline_score?: number;
  candidate_score?: number;
  score_delta?: number;
  baseline_pass_token?: string;
  candidate_pass_token?: string;
  baseline_pass_token_present?: boolean;
  candidate_pass_token_present?: boolean;
}

/** 效果分列：通过率差、指标差、可选参考分差（不进硬门禁）。 */
export interface EffectSummary {
  baseline_pass_rate: number;
  candidate_pass_rate: number;
  /** candidate − baseline；正值表示 candidate 通过率更高 */
  pass_rate_delta: number;
  metric_deltas: MetricDelta[];
  reference_scores?: {
    baseline_avg?: number;
    candidate_avg?: number;
    delta?: number;
    scale_max?: number;
  };
  paired_effects?: PairedEffect[];
}

export interface CompareReport {
  baseline: string;
  candidate: string;
  rows: CompareRow[];
  counts: Record<DriftKind, number>;
  effect: EffectSummary;
}

function passRate(rows: Iterable<ResultLine>): number {
  const list = [...rows];
  if (list.length === 0) return 0;
  return list.filter((r) => r.pass).length / list.length;
}

function avg(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * 从题号推断配对键：
 * - EVAL-B-PAIRED-TASK-OFF / -ON → EVAL-B-PAIRED-TASK
 * - EVAL-B-PAIRED-TASK-02-OFF → EVAL-B-PAIRED-TASK-02
 */
export function inferEffectPair(itemId: string, explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const m = /^(.*)-(OFF|ON)$/i.exec(itemId);
  return m?.[1] ?? itemId;
}

function buildPairedEffects(
  base: Map<string, ResultLine>,
  cand: Map<string, ResultLine>,
  scoreBase: Map<string, number>,
  scoreCand: Map<string, number>,
): PairedEffect[] {
  type Side = {
    item_id: string;
    pass: boolean;
    score?: number;
    pass_token?: string;
    pass_token_present?: boolean;
  };
  const pairs = new Map<string, { baseline?: Side; candidate?: Side }>();

  const put = (side: 'baseline' | 'candidate', row: ResultLine, scores: Map<string, number>) => {
    const key = inferEffectPair(row.item_id, row.effect_pair);
    const cur = pairs.get(key) ?? {};
    const entry: Side = { item_id: row.item_id, pass: row.pass };
    const sc = scores.get(row.item_id);
    if (sc !== undefined) entry.score = sc;
    if (row.pass_token !== undefined) entry.pass_token = row.pass_token;
    if (row.pass_token_present !== undefined) entry.pass_token_present = row.pass_token_present;
    if (side === 'baseline') cur.baseline = entry;
    else cur.candidate = entry;
    pairs.set(key, cur);
  };

  for (const row of base.values()) put('baseline', row, scoreBase);
  for (const row of cand.values()) put('candidate', row, scoreCand);

  const out: PairedEffect[] = [];
  for (const pair of [...pairs.keys()].sort()) {
    const sides = pairs.get(pair)!;
    if (!sides.baseline || !sides.candidate) continue;
    if (sides.baseline.item_id === sides.candidate.item_id) continue;
    const row: PairedEffect = {
      pair,
      baseline_item: sides.baseline.item_id,
      candidate_item: sides.candidate.item_id,
      baseline_pass: sides.baseline.pass,
      candidate_pass: sides.candidate.pass,
    };
    if (sides.baseline.score !== undefined) row.baseline_score = sides.baseline.score;
    if (sides.candidate.score !== undefined) row.candidate_score = sides.candidate.score;
    if (sides.baseline.score !== undefined && sides.candidate.score !== undefined) {
      row.score_delta = sides.candidate.score - sides.baseline.score;
    }
    if (sides.baseline.pass_token !== undefined)
      row.baseline_pass_token = sides.baseline.pass_token;
    if (sides.candidate.pass_token !== undefined) {
      row.candidate_pass_token = sides.candidate.pass_token;
    }
    if (sides.baseline.pass_token_present !== undefined) {
      row.baseline_pass_token_present = sides.baseline.pass_token_present;
    }
    if (sides.candidate.pass_token_present !== undefined) {
      row.candidate_pass_token_present = sides.candidate.pass_token_present;
    }
    out.push(row);
  }
  return out;
}

function buildEffect(baseRun: LoadedRun, candRun: LoadedRun): EffectSummary {
  const baseline_pass_rate = passRate(baseRun.results.values());
  const candidate_pass_rate = passRate(candRun.results.values());
  const baseAgg = baseRun.aggregates;
  const candAgg = candRun.aggregates;
  const names = new Set([...Object.keys(baseAgg), ...Object.keys(candAgg)]);
  const metric_deltas: MetricDelta[] = [];
  for (const name of [...names].sort()) {
    const b = baseAgg[name];
    const c = candAgg[name];
    const row: MetricDelta = { name };
    if (b !== undefined) row.baseline = b;
    if (c !== undefined) row.candidate = c;
    if (b !== undefined && c !== undefined) row.delta = c - b;
    metric_deltas.push(row);
  }

  const effect: EffectSummary = {
    baseline_pass_rate,
    candidate_pass_rate,
    pass_rate_delta: candidate_pass_rate - baseline_pass_rate,
    metric_deltas,
  };

  const bScores = [...baseRun.scores.values()];
  const cScores = [...candRun.scores.values()];
  if (bScores.length > 0 || cScores.length > 0) {
    const baseline_avg = avg(bScores);
    const candidate_avg = avg(cScores);
    const ref: NonNullable<EffectSummary['reference_scores']> = {};
    if (baseline_avg !== undefined) ref.baseline_avg = baseline_avg;
    if (candidate_avg !== undefined) ref.candidate_avg = candidate_avg;
    if (baseline_avg !== undefined && candidate_avg !== undefined) {
      ref.delta = candidate_avg - baseline_avg;
    }
    const scale = candRun.scaleMax ?? baseRun.scaleMax ?? undefined;
    if (scale !== undefined) ref.scale_max = scale;
    effect.reference_scores = ref;
  }

  const paired = buildPairedEffects(
    baseRun.results,
    candRun.results,
    baseRun.scores,
    candRun.scores,
  );
  if (paired.length > 0) effect.paired_effects = paired;

  return effect;
}

/** compare 三分类 + 效果分列（通过率/指标/可选参考分）。 */
export function compareRuns(baselineDir: string, candidateDir: string): CompareReport {
  const baseDir = resolve(baselineDir);
  const candDir = resolve(candidateDir);
  const base = loadRunArtifacts(baseDir);
  const cand = loadRunArtifacts(candDir);
  const baseResults = base.results;
  const candResults = cand.results;
  const scoreBase = base.scores;
  const scoreCand = cand.scores;
  const ids = new Set([...baseResults.keys(), ...candResults.keys()]);
  const rows: CompareRow[] = [];

  for (const id of [...ids].sort()) {
    const b = baseResults.get(id);
    const c = candResults.get(id);
    const bs = scoreBase.get(id);
    const cs = scoreCand.get(id);

    const attachExtras = (row: CompareRow): CompareRow => {
      if (bs !== undefined) row.baseline_score = bs;
      if (cs !== undefined) row.candidate_score = cs;
      if (bs !== undefined && cs !== undefined) row.score_delta = cs - bs;
      if (b?.pass_token !== undefined) row.baseline_pass_token = b.pass_token;
      if (c?.pass_token !== undefined) row.candidate_pass_token = c.pass_token;
      if (b?.pass_token_present !== undefined) {
        row.baseline_pass_token_present = b.pass_token_present;
      }
      if (c?.pass_token_present !== undefined) {
        row.candidate_pass_token_present = c.pass_token_present;
      }
      return row;
    };

    if (b && c && b.item_rev !== c.item_rev) {
      rows.push(
        attachExtras({
          item_id: id,
          kind: 'asset_rev_drift',
          baseline_rev: b.item_rev,
          candidate_rev: c.item_rev,
          baseline_pass: b.pass,
          candidate_pass: c.pass,
        }),
      );
      continue;
    }
    if (b && c && b.pass && !c.pass) {
      rows.push(
        attachExtras({
          item_id: id,
          kind: 'new_failure',
          baseline_rev: b.item_rev,
          candidate_rev: c.item_rev,
          baseline_pass: true,
          candidate_pass: false,
        }),
      );
      continue;
    }
    if (b && c && !b.pass && c.pass) {
      rows.push(
        attachExtras({
          item_id: id,
          kind: 'fixed',
          baseline_rev: b.item_rev,
          candidate_rev: c.item_rev,
          baseline_pass: false,
          candidate_pass: true,
        }),
      );
      continue;
    }
    const row: CompareRow = { item_id: id, kind: 'unchanged' };
    if (b?.item_rev !== undefined) row.baseline_rev = b.item_rev;
    if (c?.item_rev !== undefined) row.candidate_rev = c.item_rev;
    if (b?.pass !== undefined) row.baseline_pass = b.pass;
    if (c?.pass !== undefined) row.candidate_pass = c.pass;
    rows.push(attachExtras(row));
  }

  const counts: Record<DriftKind, number> = {
    new_failure: 0,
    fixed: 0,
    asset_rev_drift: 0,
    unchanged: 0,
  };
  for (const r of rows) counts[r.kind] += 1;

  const effect = buildEffect(base, cand);

  return {
    baseline: baseDir,
    candidate: candDir,
    rows,
    counts,
    effect,
  };
}

/** 把效果对照写入 candidate 旁或指定路径的 effect_compare.md。 */
export function writeEffectCompareMarkdown(report: CompareReport, outPath: string): void {
  const e = report.effect;
  const lines = [
    '# 效果对照（effect compare）',
    '',
    `- baseline: \`${report.baseline}\``,
    `- candidate: \`${report.candidate}\``,
    '',
    '## 通过率',
    '',
    `| 侧 | pass_rate |`,
    `| --- | --- |`,
    `| baseline | ${e.baseline_pass_rate.toFixed(4)} |`,
    `| candidate | ${e.candidate_pass_rate.toFixed(4)} |`,
    `| **delta (cand−base)** | **${e.pass_rate_delta.toFixed(4)}** |`,
    '',
    '## 聚合指标差',
    '',
    '| metric | baseline | candidate | delta |',
    '| --- | --- | --- | --- |',
    ...e.metric_deltas.map(
      (m) => `| ${m.name} | ${m.baseline ?? ''} | ${m.candidate ?? ''} | ${m.delta ?? ''} |`,
    ),
    '',
  ];
  if (e.reference_scores) {
    const r = e.reference_scores;
    lines.push(
      '## 参考分（不进硬门禁）',
      '',
      `| 侧 | avg score${r.scale_max !== undefined ? ` / ${r.scale_max}` : ''} |`,
      `| --- | --- |`,
      `| baseline | ${r.baseline_avg ?? ''} |`,
      `| candidate | ${r.candidate_avg ?? ''} |`,
      `| **delta** | **${r.delta ?? ''}** |`,
      '',
    );
  }
  if (e.paired_effects && e.paired_effects.length > 0) {
    lines.push(
      '## 配对效果（off ↔ on）',
      '',
      '- 暗号为辅助信号（有/无）；缺席不单独否决。主判定见 pass。',
      '',
      '| pair | baseline 题 | candidate 题 | base_pass | cand_pass | base_暗号 | cand_暗号 | base_score | cand_score | scoreΔ |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...e.paired_effects.map((p) => {
        const baseTok = formatPassTokenCell({
          pass_token: p.baseline_pass_token,
          pass_token_present: p.baseline_pass_token_present,
        });
        const candTok = formatPassTokenCell({
          pass_token: p.candidate_pass_token,
          pass_token_present: p.candidate_pass_token_present,
        });
        return `| ${p.pair} | ${p.baseline_item} | ${p.candidate_item} | ${p.baseline_pass} | ${p.candidate_pass} | ${baseTok} | ${candTok} | ${p.baseline_score ?? ''} | ${p.candidate_score ?? ''} | ${p.score_delta ?? ''} |`;
      }),
      '',
    );
  }
  lines.push(
    '## 试题漂移',
    '',
    `新失败 ${report.counts.new_failure} / 修复 ${report.counts.fixed} / 升版 ${report.counts.asset_rev_drift} / 不变 ${report.counts.unchanged}`,
    '',
    '| item | kind | base_pass | cand_pass | base_暗号 | cand_暗号 | scoreΔ |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.rows.map((r) => {
      const baseTok = formatPassTokenCell({
        pass_token: r.baseline_pass_token,
        pass_token_present: r.baseline_pass_token_present,
      });
      const candTok = formatPassTokenCell({
        pass_token: r.candidate_pass_token,
        pass_token_present: r.candidate_pass_token_present,
      });
      return `| ${r.item_id} | ${r.kind} | ${r.baseline_pass ?? ''} | ${r.candidate_pass ?? ''} | ${baseTok} | ${candTok} | ${r.score_delta ?? ''} |`;
    }),
    '',
  );
  writeFileSync(outPath, `${lines.join('\n')}\n`);
}

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type DriftKind = 'new_failure' | 'fixed' | 'asset_rev_drift' | 'unchanged';

export interface CompareRow {
  item_id: string;
  kind: DriftKind;
  baseline_rev?: number;
  candidate_rev?: number;
  baseline_pass?: boolean;
  candidate_pass?: boolean;
}

export interface CompareReport {
  baseline: string;
  candidate: string;
  rows: CompareRow[];
  counts: Record<DriftKind, number>;
}

interface ResultLine {
  item_id: string;
  item_rev: number;
  pass: boolean;
}

function loadResults(runDir: string): Map<string, ResultLine> {
  const file = join(runDir, 'results.ndjson');
  if (!existsSync(file)) throw new Error(`缺少 results.ndjson：${runDir}`);
  const map = new Map<string, ResultLine>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as ResultLine;
    map.set(row.item_id, row);
  }
  return map;
}

/** compare 三分类：新失败 / 修复 / 资产升版漂移（另附 unchanged）。 */
export function compareRuns(baselineDir: string, candidateDir: string): CompareReport {
  const base = loadResults(resolve(baselineDir));
  const cand = loadResults(resolve(candidateDir));
  const ids = new Set([...base.keys(), ...cand.keys()]);
  const rows: CompareRow[] = [];

  for (const id of [...ids].sort()) {
    const b = base.get(id);
    const c = cand.get(id);
    if (b && c && b.item_rev !== c.item_rev) {
      rows.push({
        item_id: id,
        kind: 'asset_rev_drift',
        baseline_rev: b.item_rev,
        candidate_rev: c.item_rev,
        baseline_pass: b.pass,
        candidate_pass: c.pass,
      });
      continue;
    }
    if (b && c && b.pass && !c.pass) {
      rows.push({
        item_id: id,
        kind: 'new_failure',
        baseline_rev: b.item_rev,
        candidate_rev: c.item_rev,
        baseline_pass: true,
        candidate_pass: false,
      });
      continue;
    }
    if (b && c && !b.pass && c.pass) {
      rows.push({
        item_id: id,
        kind: 'fixed',
        baseline_rev: b.item_rev,
        candidate_rev: c.item_rev,
        baseline_pass: false,
        candidate_pass: true,
      });
      continue;
    }
    const row: CompareRow = { item_id: id, kind: 'unchanged' };
    if (b?.item_rev !== undefined) row.baseline_rev = b.item_rev;
    if (c?.item_rev !== undefined) row.candidate_rev = c.item_rev;
    if (b?.pass !== undefined) row.baseline_pass = b.pass;
    if (c?.pass !== undefined) row.candidate_pass = c.pass;
    rows.push(row);
  }

  const counts: Record<DriftKind, number> = {
    new_failure: 0,
    fixed: 0,
    asset_rev_drift: 0,
    unchanged: 0,
  };
  for (const r of rows) counts[r.kind] += 1;

  return {
    baseline: resolve(baselineDir),
    candidate: resolve(candidateDir),
    rows,
    counts,
  };
}

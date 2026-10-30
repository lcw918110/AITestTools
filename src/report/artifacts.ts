import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** results.ndjson 中单条题级结果（与 write-artifacts.ts 的 ndjson 行一致）。 */
export interface ResultLine {
  item_id: string;
  item_rev: number;
  pass: boolean;
  metrics?: Record<string, number>;
  effect_pair?: string;
  pass_token?: string;
  pass_token_present?: boolean;
}

/** scores.json 中单条参考分（与 score-write.ts 一致）。 */
export interface ScoreEntry {
  item_id: string;
  score: number;
  note?: string;
}

export interface ScoresFile {
  scale_max?: number;
  scores: ScoreEntry[];
}

/** 一次 run 目录读入的全部制品（每个文件只读一次）。 */
export interface LoadedRun {
  results: Map<string, ResultLine>;
  aggregates: Record<string, number>;
  scores: Map<string, number>;
  scaleMax: number | undefined;
  purpose?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResultLine(raw: unknown): ResultLine {
  if (!isRecord(raw)) throw new Error('results.ndjson 行不是对象');
  const { item_id, item_rev, pass } = raw;
  if (typeof item_id !== 'string') throw new Error('results.ndjson 行缺少 item_id 字符串');
  if (typeof item_rev !== 'number') throw new Error('results.ndjson 行缺少 item_rev 数字');
  if (typeof pass !== 'boolean') throw new Error('results.ndjson 行缺少 pass 布尔');
  const out: ResultLine = { item_id, item_rev, pass };
  if (isRecord(raw.metrics)) {
    const metrics: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.metrics)) {
      if (typeof v === 'number') metrics[k] = v;
    }
    if (Object.keys(metrics).length > 0) out.metrics = metrics;
  }
  if (typeof raw.effect_pair === 'string') out.effect_pair = raw.effect_pair;
  if (typeof raw.pass_token === 'string') out.pass_token = raw.pass_token;
  if (typeof raw.pass_token_present === 'boolean') out.pass_token_present = raw.pass_token_present;
  return out;
}

function parseScoresFile(raw: unknown): ScoresFile {
  const out: ScoresFile = { scores: [] };
  if (!isRecord(raw)) return out;
  if (typeof raw.scale_max === 'number') out.scale_max = raw.scale_max;
  if (Array.isArray(raw.scores)) {
    for (const entry of raw.scores) {
      if (!isRecord(entry)) continue;
      const item_id = entry.item_id;
      const score = entry.score;
      if (typeof item_id !== 'string' || typeof score !== 'number') continue;
      const row: ScoreEntry = { item_id, score };
      if (typeof entry.note === 'string') row.note = entry.note;
      out.scores.push(row);
    }
  }
  return out;
}

function parseAggregates(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  const agg = raw.aggregates;
  if (!isRecord(agg)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(agg)) {
    if (typeof v === 'number') out[k] = v;
  }
  return out;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

/**
 * 读入一个 run 目录的全部制品，每个文件只读一次。
 * results.ndjson → 逐行验证的 ResultLine；metrics.json → aggregates；
 * scores.json → 一次读入后同时得出 scores 映射和 scale_max。
 */
export function loadRunArtifacts(runDir: string): LoadedRun {
  const resultsFile = join(runDir, 'results.ndjson');
  if (!existsSync(resultsFile)) throw new Error(`缺少 results.ndjson：${runDir}`);
  const results = new Map<string, ResultLine>();
  for (const line of readFileSync(resultsFile, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const row = parseResultLine(JSON.parse(line) as unknown);
    results.set(row.item_id, row);
  }

  const metricsFile = join(runDir, 'metrics.json');
  const aggregates = existsSync(metricsFile) ? parseAggregates(readJson(metricsFile)) : {};

  const scoresFile = join(runDir, 'scores.json');
  const scoresDoc = existsSync(scoresFile) ? parseScoresFile(readJson(scoresFile)) : { scores: [] };
  const scores = new Map<string, number>();
  for (const s of scoresDoc.scores) scores.set(s.item_id, s.score);

  const runFile = join(runDir, 'run.json');
  const meta = existsSync(runFile) ? readJson(runFile) : undefined;
  const purposeRaw = isRecord(meta) && typeof meta.purpose === 'string' ? meta.purpose : '';
  const purpose = purposeRaw.trim() ? purposeRaw.trim() : undefined;
  return {
    ...(purpose !== undefined ? { purpose } : {}),
    results,
    aggregates,
    scores,
    scaleMax: scoresDoc.scale_max,
  };
}

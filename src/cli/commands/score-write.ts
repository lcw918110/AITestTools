import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ScoreWriteOptions {
  run?: string;
  item?: string;
  value?: string;
  max?: string;
  note?: string;
  json: boolean;
}

/**
 * 写入/更新 run 目录下的 scores.json（参考分，不进硬门禁）。
 * 用法：proctor score write --run <dir> --item <id> --value <n> [--max 5] [--name 说明]
 */
export function runScoreWrite(options: ScoreWriteOptions): number {
  if (options.run === undefined || options.item === undefined || options.value === undefined) {
    console.error(
      '用法：proctor score write --run <run目录> --item <试题id> --value <分> [--max 5] [--name 说明]',
    );
    return 2;
  }
  const score = Number(options.value);
  if (!Number.isFinite(score)) {
    console.error(`无效分数：${options.value}`);
    return 2;
  }
  const dir = resolve(options.run);
  if (!existsSync(dir)) {
    console.error(`run 目录不存在：${dir}`);
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'scores.json');
  let doc: {
    scale_max?: number;
    scores: Array<{ item_id: string; score: number; note?: string }>;
  } = { scores: [] };
  if (existsSync(file)) {
    doc = JSON.parse(readFileSync(file, 'utf8')) as typeof doc;
    if (!Array.isArray(doc.scores)) doc.scores = [];
  }
  if (options.max !== undefined) {
    const m = Number(options.max);
    if (Number.isFinite(m)) doc.scale_max = m;
  }
  const note = options.note;
  const next = doc.scores.filter((s) => s.item_id !== options.item);
  const entry: { item_id: string; score: number; note?: string } = {
    item_id: options.item,
    score,
  };
  if (note !== undefined && note.length > 0) entry.note = note;
  next.push(entry);
  doc.scores = next.sort((a, b) => a.item_id.localeCompare(b.item_id));
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  if (options.json) {
    console.log(JSON.stringify(doc, null, 2));
  } else {
    console.log(`已写参考分：${file}（${options.item}=${score}）`);
  }
  return 0;
}

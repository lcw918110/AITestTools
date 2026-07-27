import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type FoldEvent = Record<string, unknown>;

/** 读取 NDJSON 事件序列；空行忽略。 */
export function loadEventSequence(projectRoot: string, ref: string): FoldEvent[] {
  const raw = readFileSync(resolve(projectRoot, ref), 'utf8');
  const events: FoldEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '') continue;
    events.push(JSON.parse(t) as FoldEvent);
  }
  return events;
}

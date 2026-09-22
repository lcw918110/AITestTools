import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type FoldEvent = Record<string, unknown>;

/** 事件序列解析失败：保留文件引用与行号，供上层按 HARNESS 归因。 */
export class LoadEventsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadEventsError';
  }
}

/** 读取 NDJSON 事件序列；空行忽略。 */
export function loadEventSequence(projectRoot: string, ref: string): FoldEvent[] {
  const raw = readFileSync(resolve(projectRoot, ref), 'utf8');
  const events: FoldEvent[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const t = raw.trim();
    if (t === '') continue;
    try {
      events.push(JSON.parse(t) as FoldEvent);
    } catch (e) {
      throw new LoadEventsError(
        `事件序列 ${ref} 第 ${i + 1} 行 NDJSON 解析失败：${(e as Error).message}`,
      );
    }
  }
  return events;
}

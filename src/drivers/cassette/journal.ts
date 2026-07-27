import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CassetteError } from './index.ts';

export interface JournalEntry {
  ts?: string;
  hook: string;
  cassette_id?: string | null;
  payload?: Record<string, unknown> | null;
}

/** 读取 cassette journal.ndjson。 */
export function loadJournal(projectRoot: string, ref: string): JournalEntry[] {
  const abs = resolve(projectRoot, ref);
  if (!existsSync(abs)) throw new CassetteError(`journal 不存在：${ref}`);
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  const out: JournalEntry[] = [];
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as JournalEntry;
      if (typeof row.hook !== 'string' || row.hook.length === 0) {
        throw new Error('缺 hook');
      }
      out.push(row);
    } catch (e) {
      throw new CassetteError(`journal 第 ${i + 1} 行无效：${(e as Error).message}`);
    }
  }
  return out;
}

export function hooksFromJournal(entries: JournalEntry[]): string[] {
  return entries.map((e) => e.hook);
}

/** 从 event hook 的 payload 提取 type（OpenCode event / 精简后的 event.type）。 */
export function eventTypesFromJournal(entries: JournalEntry[]): string[] {
  const types: string[] = [];
  for (const e of entries) {
    if (e.hook !== 'event') continue;
    const p = e.payload;
    if (!p || typeof p !== 'object') continue;
    const ev = p.event;
    if (ev && typeof ev === 'object' && typeof (ev as { type?: string }).type === 'string') {
      types.push((ev as { type: string }).type);
      continue;
    }
    if (typeof p.type === 'string') types.push(p.type);
  }
  return types;
}

/** 压缩连续重复，便于 expected_* 对拍。 */
export function compressConsecutive(seq: string[]): string[] {
  const out: string[] = [];
  for (const x of seq) {
    if (out[out.length - 1] !== x) out.push(x);
  }
  return out;
}

export function sealJournalToManifestFields(entries: JournalEntry[]): {
  expected_hooks: string[];
  expected_events: string[];
} {
  return {
    expected_hooks: compressConsecutive(hooksFromJournal(entries)),
    expected_events: compressConsecutive(eventTypesFromJournal(entries)),
  };
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface CassetteDoc {
  id: string;
  rev: number;
  host?: string;
  host_version?: string;
  /** scripted（默认）| journal（OpenCode 录制回放） */
  replay_mode?: 'scripted' | 'journal';
  /** 对拍用契约 id（相对考卷库 contracts/ 或引擎内置） */
  contract?: string;
  /** 对拍用剧本（相对考卷库）；journal 模式可不填 */
  script?: string;
  /** 期望 FakeHost 依次接受的 hook 名（可夹杂） */
  expected_hooks?: string[];
  /** 期望 timeline 事件 type 有序子序列 */
  expected_events?: string[];
  timeline_ref?: string;
  /** journal 模式：相对考卷库的 journal.ndjson */
  journal_ref?: string;
  digest?: string;
  [key: string]: unknown;
}

export class CassetteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CassetteError';
  }
}

/** 装载 cassette：支持单文件 manifest，或目录下的 manifest.json。 */
export function loadCassette(projectRoot: string, ref: string): CassetteDoc {
  const abs = resolve(projectRoot, ref);
  const manifestPath =
    existsSync(abs) && abs.endsWith('.json') ? abs : resolve(abs, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new CassetteError(`cassette 不存在：${ref}`);
  }
  let doc: CassetteDoc;
  try {
    doc = JSON.parse(readFileSync(manifestPath, 'utf8')) as CassetteDoc;
  } catch (e) {
    throw new CassetteError(`cassette JSON 无效：${ref}（${(e as Error).message}）`);
  }
  if (typeof doc.id !== 'string' || typeof doc.rev !== 'number') {
    throw new CassetteError(`cassette 缺少 id/rev：${ref}`);
  }
  return doc;
}

export function cassetteDir(projectRoot: string, ref: string): string {
  const abs = resolve(projectRoot, ref);
  return abs.endsWith('.json') ? dirname(abs) : abs;
}

export {
  compressConsecutive,
  eventTypesFromJournal,
  hooksFromJournal,
  loadJournal,
  sealJournalToManifestFields,
  type JournalEntry,
} from './journal.ts';

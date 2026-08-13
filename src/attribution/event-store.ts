/**
 * 万象术 0.8+ 耐久：Git EventStore（refs/wanxiang/store），不是 .wanxiangshu.ndjson。
 *
 * 只读面（git CLI，不 import Plugin）：
 * - 尖：`refs/wanxiang/store` → store root tree
 * - 事件：`events/<2-hex>/<EventId>.jsonl`（CanonicalEvent JSON + 单 LF）
 * - Journal 行：`event_type === "JournalEnvelope"`，payload 为 Envelope.serialize
 * - Fact 形如 `["Runtime", ["RuntimeStarted", {…}]]`
 *
 * Plugin 全量 import 仍缺模块时，本模块仍可解析已落盘的 store（fixture / 事后仓）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const WANXIANG_STORE_REF = 'refs/wanxiang/store';
export const JOURNAL_ENVELOPE_TYPE = 'JournalEnvelope';

export interface CanonicalEvent {
  event_id: string;
  stream_id: string;
  event_type: string;
  parents: string[];
  payload: unknown;
  payload_refs: string[];
}

export type EventStoreMiss = 'not-git' | 'no-store-ref' | 'empty' | 'git-error';

export interface EventStoreRead {
  present: boolean;
  reason?: EventStoreMiss;
  detail?: string;
  rootOid?: string;
  kinds: string[];
  events: CanonicalEvent[];
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

export function parseCanonicalEventText(text: string): CanonicalEvent | undefined {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text.trim();
  if (body.length === 0) return undefined;
  try {
    const row = JSON.parse(body) as Record<string, unknown>;
    if (typeof row.event_id !== 'string' || typeof row.event_type !== 'string') return undefined;
    if (typeof row.stream_id !== 'string') return undefined;
    return {
      event_id: row.event_id,
      stream_id: row.stream_id,
      event_type: row.event_type,
      parents: Array.isArray(row.parents) ? row.parents.map(String) : [],
      payload: row.payload,
      payload_refs: Array.isArray(row.payload_refs) ? row.payload_refs.map(String) : [],
    };
  } catch {
    return undefined;
  }
}

/** 归因 Kind：event_type + Fact 族 + Fact 个案（如 JournalEnvelope / Runtime / RuntimeStarted）。 */
export function extractAttributionKinds(event: CanonicalEvent): string[] {
  const kinds = [event.event_type];
  const payload = event.payload;
  if (payload === null || payload === undefined || typeof payload !== 'object' || Array.isArray(payload))
    return kinds;
  const fact = (payload as Record<string, unknown>).Fact;
  if (!Array.isArray(fact)) return kinds;
  const family = fact[0];
  if (typeof family === 'string' && family.length > 0) kinds.push(family);
  const inner = fact[1];
  if (Array.isArray(inner)) {
    const caseName = inner[0];
    if (typeof caseName === 'string' && caseName.length > 0) kinds.push(caseName);
  }
  return kinds;
}

export function collectEventStoreKinds(events: CanonicalEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    for (const k of extractAttributionKinds(e)) set.add(k);
  }
  return [...set].sort();
}

export function readWanxiangEventStore(workTree: string): EventStoreRead {
  // 只认该目录自己的 .git，不爬到父仓（hosted 隔离工作区 / 本仓子目录）。
  if (!existsSync(join(workTree, '.git'))) {
    return { present: false, reason: 'not-git', kinds: [], events: [] };
  }

  const tip = git(workTree, ['rev-parse', '--verify', '--quiet', WANXIANG_STORE_REF]);
  if (tip.status !== 0 || tip.stdout.trim().length === 0) {
    return { present: false, reason: 'no-store-ref', kinds: [], events: [] };
  }
  const rootOid = tip.stdout.trim();

  const listed = git(workTree, ['ls-tree', '-r', '--name-only', WANXIANG_STORE_REF]);
  if (listed.status !== 0) {
    return {
      present: false,
      reason: 'git-error',
      detail: listed.stderr.slice(0, 240),
      rootOid,
      kinds: [],
      events: [],
    };
  }

  const paths = listed.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((p) => /^events\/[0-9a-f]{2}\/.+\.jsonl$/i.test(p));

  const events: CanonicalEvent[] = [];
  for (const rel of paths) {
    const shown = git(workTree, ['show', `${WANXIANG_STORE_REF}:${rel}`]);
    if (shown.status !== 0) continue;
    const parsed = parseCanonicalEventText(shown.stdout);
    if (parsed) events.push(parsed);
  }

  if (events.length === 0) {
    return { present: false, reason: 'empty', rootOid, kinds: [], events: [] };
  }

  return {
    present: true,
    rootOid,
    kinds: collectEventStoreKinds(events),
    events,
  };
}

/** hosted 隔离工作区必须是 git 仓，EventStore 才写得进 refs/wanxiang/store。 */
export function ensureHostedGitRepo(workTree: string): { ok: boolean; error?: string } {
  const init = git(workTree, ['init', '--template=']);
  if (init.status !== 0) {
    return { ok: false, error: (init.stderr || init.stdout).slice(0, 200) };
  }
  git(workTree, ['config', 'user.email', 'proctor@test']);
  git(workTree, ['config', 'user.name', 'proctor']);
  return { ok: true };
}

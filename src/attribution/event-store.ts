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
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
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

/**
 * 事件有两种落点，缺一不可：
 * - `pending`：运行时先写 `<git-dir>/wanxiang/events/*.ndjson`，尚未收敛成 ref
 * - `ref`：git hook 收敛后进入 `refs/wanxiang/store`（需有 commit/push 触发）
 * 只读 ref 会把「插件正常工作但本题没触发 git 操作」误判成「插件没挂上」。
 */
export type EventStoreSource = 'ref' | 'pending' | 'ref+pending';

export interface EventStoreRead {
  present: boolean;
  reason?: EventStoreMiss;
  detail?: string;
  rootOid?: string;
  source?: EventStoreSource;
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
  if (
    payload === null ||
    payload === undefined ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  )
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

/**
 * 运行时未收敛的事件目录，每行一个 CanonicalEvent。
 *
 * 万象术 0.8+ 把运行时状态放在 `<worktree>/.Herdchestra/wanxiangshu/` 下
 * （`RuntimePath.stateRoot`：要求 `.Herdchestra` 为真目录、内含排除全部运行时数据的
 * `.gitignore`），事件落在其 `events/*.ndjson`。旧版 `<git-dir>/wanxiang/events`
 * 已不是写入面，仅作兼容回退保留。
 */
function pendingEventDirs(workTree: string): string[] {
  const dirs = [join(workTree, '.Herdchestra', 'wanxiangshu', 'events')];
  const dirOut = git(workTree, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const gitDir = dirOut.status === 0 ? dirOut.stdout.trim() : '';
  if (gitDir.length > 0) dirs.push(join(gitDir, 'wanxiang', 'events'));
  return dirs;
}

export function readPendingEventNdjson(workTree: string): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];
  const seen = new Set<string>();
  for (const eventsDir of pendingEventDirs(workTree)) {
    if (!existsSync(eventsDir)) continue;
    for (const name of readdirSync(eventsDir)) {
      if (!name.endsWith('.ndjson')) continue;
      let text: string;
      try {
        text = readFileSync(join(eventsDir, name), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length === 0) continue;
        const parsed = parseCanonicalEventText(line);
        if (parsed === undefined || seen.has(parsed.event_id)) continue;
        seen.add(parsed.event_id);
        events.push(parsed);
      }
    }
  }
  return events;
}

export function readWanxiangEventStore(workTree: string): EventStoreRead {
  // 只认该目录自己的 .git，不爬到父仓（hosted 隔离工作区 / 本仓子目录）。
  if (!existsSync(join(workTree, '.git'))) {
    return { present: false, reason: 'not-git', kinds: [], events: [] };
  }

  const pending = readPendingEventNdjson(workTree);

  const tip = git(workTree, ['rev-parse', '--verify', '--quiet', WANXIANG_STORE_REF]);
  const hasRef = tip.status === 0 && tip.stdout.trim().length > 0;
  if (!hasRef) {
    if (pending.length === 0) {
      return { present: false, reason: 'no-store-ref', kinds: [], events: [] };
    }
    return {
      present: true,
      source: 'pending',
      kinds: collectEventStoreKinds(pending),
      events: pending,
    };
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

  const merged = [...events];
  const seen = new Set(events.map((e) => e.event_id));
  for (const e of pending) {
    if (!seen.has(e.event_id)) merged.push(e);
  }

  if (merged.length === 0) {
    return { present: false, reason: 'empty', rootOid, kinds: [], events: [] };
  }

  return {
    present: true,
    rootOid,
    source: pending.length > 0 ? 'ref+pending' : 'ref',
    kinds: collectEventStoreKinds(merged),
    events: merged,
  };
}

/**
 * hosted 隔离工作区必须是 git 仓，EventStore 才写得进 refs/wanxiang/store。
 * 用空模板避免带入宿主机的 sample hooks，但 hooks 目录本身必须建：
 * 被测插件安装 git hook 时假设该目录存在，缺了会 durability-activation-failed。
 */
export function ensureHostedGitRepo(workTree: string): { ok: boolean; error?: string } {
  const init = git(workTree, ['init', '--template=']);
  if (init.status !== 0) {
    return { ok: false, error: (init.stderr || init.stdout).slice(0, 200) };
  }
  // 宿主可能有全局 core.hooksPath（如 ~/.git-templates/hooks）。它会被新仓继承，
  // 使被测插件把 hook 装到隔离工作区之外：沙箱内写入被拒、且污染宿主全局模板。
  // 显式把 hooksPath 归位到本仓 .git/hooks，保证 hook 落在隔离边界内。
  const hooksPath = git(workTree, ['config', 'core.hooksPath', '.git/hooks']);
  if (hooksPath.status !== 0) {
    return { ok: false, error: (hooksPath.stderr || hooksPath.stdout).slice(0, 200) };
  }
  const hooksDir = git(workTree, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
  if (hooksDir.status === 0) {
    const dir = hooksDir.stdout.trim();
    if (dir.length > 0) mkdirSync(dir, { recursive: true });
  }
  git(workTree, ['config', 'user.email', 'proctor@test']);
  git(workTree, ['config', 'user.name', 'proctor']);
  return { ok: true };
}

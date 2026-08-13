import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  collectEventStoreKinds,
  ensureHostedGitRepo,
  extractAttributionKinds,
  parseCanonicalEventText,
  readWanxiangEventStore,
  WANXIANG_STORE_REF,
} from '../../src/attribution/event-store.ts';

const EVENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function journalEnvelopeLine(): string {
  const payload = {
    EventId: ['EventId', 'evt-1'],
    Fact: [
      'Runtime',
      [
        'RuntimeStarted',
        {
          ProcessId: 1,
          RuntimeId: ['RuntimeId', 'rt-l1'],
          StartedAt: '2026-01-01T00:00:00.000+00:00',
        },
      ],
    ],
    LocalSeq: ['LocalSeq', '1'],
    ObservedAt: '2026-01-01T00:00:00.000+00:00',
    RuntimeId: ['RuntimeId', 'rt-l1'],
    Stream: 'Workspace',
  };
  const row = {
    event_id: EVENT_ID,
    event_type: 'JournalEnvelope',
    parents: [] as string[],
    payload,
    payload_refs: [] as string[],
    stream_id: 'journal/workspace',
  };
  return `${JSON.stringify(row)}\n`;
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout || '').slice(0, 300)}`);
  }
}

describe('EventStore 只读解析', () => {
  it('从 JournalEnvelope payload 抽出 RuntimeStarted', () => {
    const ev = parseCanonicalEventText(journalEnvelopeLine());
    expect(ev?.event_type).toBe('JournalEnvelope');
    expect(extractAttributionKinds(ev!)).toEqual(['JournalEnvelope', 'Runtime', 'RuntimeStarted']);
    expect(collectEventStoreKinds([ev!])).toEqual(['JournalEnvelope', 'Runtime', 'RuntimeStarted']);
  });

  it('无 git / 无 store ref 诚实缺席', () => {
    const dir = mkdtempSync(join(process.cwd(), 'tests/fixtures', 'proctor-es-miss-'));
    try {
      expect(readWanxiangEventStore(dir).reason).toBe('not-git');
      const inited = ensureHostedGitRepo(dir);
      expect(inited, inited.error ?? 'git init').toMatchObject({ ok: true });
      const empty = readWanxiangEventStore(dir);
      expect(empty.present).toBe(false);
      expect(empty.reason).toBe('no-store-ref');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fixture：refs/wanxiang/store + events 分片可读', () => {
    const dir = mkdtempSync(join(process.cwd(), 'tests/fixtures', 'proctor-es-hit-'));
    try {
      const inited = ensureHostedGitRepo(dir);
      expect(inited, inited.error ?? 'git init').toMatchObject({ ok: true });
      const shard = EVENT_ID.slice(0, 2);
      const relDir = join(dir, 'events', shard);
      mkdirSync(relDir, { recursive: true });
      writeFileSync(join(relDir, `${EVENT_ID}.jsonl`), journalEnvelopeLine());
      git(dir, ['add', 'events']);
      const tree = spawnSync('git', ['write-tree'], { cwd: dir, encoding: 'utf8' });
      expect(tree.status).toBe(0);
      git(dir, ['update-ref', WANXIANG_STORE_REF, tree.stdout.trim()]);

      const read = readWanxiangEventStore(dir);
      expect(read.present).toBe(true);
      expect(read.kinds).toEqual(['JournalEnvelope', 'Runtime', 'RuntimeStarted']);
      expect(read.events).toHaveLength(1);
      expect(read.events[0]?.stream_id).toBe('journal/workspace');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

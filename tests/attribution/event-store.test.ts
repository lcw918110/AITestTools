import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  collectEventStoreKinds,
  commitHostedSeed,
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

  // 回归：kinds 与 eventName 必须共用同一份 Fact 解析口径。
  // 曾出现 eventName 已认三级、kinds 仍只认两级，使 ManagerJobCreated 进不了
  // kinds 集合——任何把事件名当 protocol_probes 的题都会恒判缺失并归因 HARNESS。
  it('三级 Fact（Agent 族）的 kinds 含真实事件名', () => {
    const ev = parseCanonicalEventText(
      JSON.stringify({
        event_id: EVENT_ID,
        stream_id: 'journal/session/s1',
        event_type: 'JournalEnvelope',
        parents: [],
        payload: { Fact: ['Agent', ['Orchestrator', ['ManagerJobCreated', { job: 'j1' }]]] },
        payload_refs: [],
      }),
    );
    expect(ev).not.toBeNull();
    expect(extractAttributionKinds(ev!)).toEqual([
      'JournalEnvelope',
      'Agent',
      'Orchestrator',
      'ManagerJobCreated',
    ]);
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

  // 回归：万象术 ChangeRuntime.start 在建 manager 会话前先做脏检查
  // （wanxiangli/src/change/ChangeRuntime.fs:104-108），脏则 RejectedDirty，
  // commission 只能拿到兜底码 placement-failed（Command.fs:1123）。
  // ensureHostedGitRepo 只 init 不 commit，播种材料全是未跟踪文件，脏检查必然失败。
  it('播种后 commitHostedSeed 使工作区变干净（委派前置条件）', () => {
    const dir = mkdtempSync(join(process.cwd(), 'tests/fixtures', 'proctor-es-seed-'));
    try {
      const inited = ensureHostedGitRepo(dir);
      expect(inited, inited.error ?? 'git init').toMatchObject({ ok: true });

      // 模拟 hosted-runner 的播种：写题目材料，不提交。
      mkdirSync(join(dir, 'lib'), { recursive: true });
      mkdirSync(join(dir, 'tests'), { recursive: true });
      writeFileSync(join(dir, 'README.md'), '# proctor hosted workspace\n');
      writeFileSync(join(dir, 'lib', 'a.mjs'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'tests', 'a.test.mjs'), '// test\n');

      // 未提交时脏检查必然非空——这正是 commission 失败的根因。
      const dirtyBefore = execFileSync('git', ['status', '--porcelain'], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(
        dirtyBefore
          .trim()
          .split('\n')
          .filter((l) => l.length > 0).length,
      ).toBeGreaterThan(0);

      const committed = commitHostedSeed(dir);
      expect(committed, committed.error ?? 'git commit').toMatchObject({ ok: true });

      // 提交后必须干净，否则 ChangeRuntime.start 仍会 RejectedDirty。
      const dirtyAfter = execFileSync('git', ['status', '--porcelain'], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(dirtyAfter.trim()).toBe('');

      // 幂等：重复调用不应失败（空提交用 --allow-empty 兜住）。
      expect(commitHostedSeed(dir), '重复提交应幂等').toMatchObject({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // 回归：宿主机可能全局开启 commit.gpgsign，而隔离工作区没有可用密钥。
  // 若不显式关闭签名，git commit 会以 "gpg failed to sign the data" 失败，
  // 工作区重新变脏，委派再次被 RejectedDirty 拦住。
  it('宿主开启 commit.gpgsign 时仍能提交（隔离工作区无密钥）', () => {
    const dir = mkdtempSync(join(process.cwd(), 'tests/fixtures', 'proctor-es-gpg-'));
    const gpgConfig = join(dir, 'gpg-gitconfig');
    try {
      // 用独立 GIT_CONFIG_GLOBAL 模拟「宿主全局开启签名」，不污染真实用户配置。
      writeFileSync(gpgConfig, '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /bin/false\n');

      const inited = ensureHostedGitRepo(dir);
      expect(inited, inited.error ?? 'git init').toMatchObject({ ok: true });
      writeFileSync(join(dir, 'README.md'), '# proctor hosted workspace\n');

      const saved = process.env.GIT_CONFIG_GLOBAL;
      process.env.GIT_CONFIG_GLOBAL = gpgConfig;
      try {
        const committed = commitHostedSeed(dir);
        expect(committed, committed.error ?? 'git commit').toMatchObject({ ok: true });
      } finally {
        if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
        else process.env.GIT_CONFIG_GLOBAL = saved;
      }

      const dirtyAfter = execFileSync('git', ['status', '--porcelain'], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(dirtyAfter.trim()).toBe('');
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
      expect(read.source).toBe('ref');
      expect(read.kinds).toEqual(['JournalEnvelope', 'Runtime', 'RuntimeStarted']);
      expect(read.events).toHaveLength(1);
      expect(read.events[0]?.stream_id).toBe('journal/workspace');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 万象术运行时先写 <git-dir>/wanxiang/events/*.ndjson，只有 git 操作触发 hook 才收敛成 ref。
   * 只读 ref 会把「插件正常工作但本题没碰 git」误判成插件没挂上。
   */
  it('无 ref 但有运行时 pending 事件时认插件在工作', () => {
    const dir = mkdtempSync(join(process.cwd(), 'tests/fixtures', 'proctor-es-pending-'));
    try {
      const inited = ensureHostedGitRepo(dir);
      expect(inited, inited.error ?? 'git init').toMatchObject({ ok: true });
      const eventsDir = join(dir, '.git', 'wanxiang', 'events');
      mkdirSync(eventsDir, { recursive: true });
      writeFileSync(join(eventsDir, 'rt-l1.ndjson'), journalEnvelopeLine());

      const read = readWanxiangEventStore(dir);
      expect(read.present).toBe(true);
      expect(read.source).toBe('pending');
      expect(read.reason).toBeUndefined();
      expect(read.kinds).toEqual(['JournalEnvelope', 'Runtime', 'RuntimeStarted']);
      expect(read.events).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 万象术 0.8+ 把运行时事件写到 <worktree>/.Herdchestra/wanxiangshu/events/*.ndjson
   * （RuntimePath.stateRoot），不再写 <git-dir>/wanxiang/events。只读旧路径会让
   * ON 侧永远 no-store-ref，把「插件已落盘」误判成「插件没挂上」。
   */
  it('认 0.8+ 的 .Herdchestra/wanxiangshu/events 运行时事件', () => {
    const dir = mkdtempSync(join(process.cwd(), 'tests/fixtures', 'proctor-es-herdchestra-'));
    try {
      const inited = ensureHostedGitRepo(dir);
      expect(inited, inited.error ?? 'git init').toMatchObject({ ok: true });
      const eventsDir = join(dir, '.Herdchestra', 'wanxiangshu', 'events');
      mkdirSync(eventsDir, { recursive: true });
      writeFileSync(join(eventsDir, 'rt-l1-0000.ndjson'), journalEnvelopeLine());

      const read = readWanxiangEventStore(dir);
      expect(read.present).toBe(true);
      expect(read.source).toBe('pending');
      expect(read.kinds).toEqual(['JournalEnvelope', 'Runtime', 'RuntimeStarted']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('0.8+ 路径与旧路径同时存在时都读、按 event_id 去重', () => {
    const dir = mkdtempSync(join(process.cwd(), 'tests/fixtures', 'proctor-es-herd-both-'));
    try {
      const inited = ensureHostedGitRepo(dir);
      expect(inited, inited.error ?? 'git init').toMatchObject({ ok: true });
      const modern = join(dir, '.Herdchestra', 'wanxiangshu', 'events');
      const legacy = join(dir, '.git', 'wanxiang', 'events');
      mkdirSync(modern, { recursive: true });
      mkdirSync(legacy, { recursive: true });
      writeFileSync(join(modern, 'rt-l1-0000.ndjson'), journalEnvelopeLine());
      writeFileSync(join(legacy, 'rt-l1.ndjson'), journalEnvelopeLine());

      const read = readWanxiangEventStore(dir);
      expect(read.present).toBe(true);
      expect(read.events).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ref 与 pending 同时存在时按 event_id 去重', () => {
    const dir = mkdtempSync(join(process.cwd(), 'tests/fixtures', 'proctor-es-both-'));
    try {
      const inited = ensureHostedGitRepo(dir);
      expect(inited, inited.error ?? 'git init').toMatchObject({ ok: true });
      const shard = EVENT_ID.slice(0, 2);
      mkdirSync(join(dir, 'events', shard), { recursive: true });
      writeFileSync(join(dir, 'events', shard, `${EVENT_ID}.jsonl`), journalEnvelopeLine());
      git(dir, ['add', 'events']);
      const tree = spawnSync('git', ['write-tree'], { cwd: dir, encoding: 'utf8' });
      expect(tree.status).toBe(0);
      git(dir, ['update-ref', WANXIANG_STORE_REF, tree.stdout.trim()]);

      const eventsDir = join(dir, '.git', 'wanxiang', 'events');
      mkdirSync(eventsDir, { recursive: true });
      writeFileSync(join(eventsDir, 'rt-l1.ndjson'), journalEnvelopeLine());

      const read = readWanxiangEventStore(dir);
      expect(read.present).toBe(true);
      expect(read.source).toBe('ref+pending');
      expect(read.events).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

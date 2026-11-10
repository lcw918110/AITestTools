import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '../../src/attribution/event-store.ts';
import { captureDelegatedWorktrees } from '../../src/run/delegated-worktree-capture.ts';
import { materialsMutated, snapshotSeededFiles } from '../../src/run/hosted-workspace-state.ts';

function worktreeCreated(path: string): CanonicalEvent {
  return {
    event_id: 'e1',
    stream_id: 'journal/workspace',
    event_type: 'JournalEnvelope',
    parents: [],
    payload: {
      Fact: [
        'Agent',
        [
          'Orchestrator',
          [
            'WorktreeCreated',
            {
              WorktreePath: ['WorktreePath', path],
            },
          ],
        ],
      ],
    },
    payload_refs: [],
  };
}

describe('captureDelegatedWorktrees', () => {
  it('只抄播种材料同名文件，不把工作树改对当成播种目录已改', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-'));
    const tree = join(root, 'wanxiangshu-kzvbc2');
    const artifact = join(root, 'artifacts');
    mkdirSync(join(tree, 'lib'), { recursive: true });
    mkdirSync(join(tree, 'tests'), { recursive: true });
    writeFileSync(join(tree, 'lib', 'discount.mjs'), 'return cents - discount;\n');
    writeFileSync(join(tree, 'lib', 'tax.mjs'), 'return cents + tax;\n');
    writeFileSync(join(tree, 'tests', 'invoice.test.mjs'), 'not seeded\n');
    writeFileSync(join(tree, 'opencode.json'), '{}\n');
    const seed = join(root, 'seed');
    mkdirSync(join(seed, 'lib'), { recursive: true });
    writeFileSync(
      join(seed, 'lib', 'discount.mjs'),
      'return Math.floor((cents * percent) / 100);\n',
    );
    writeFileSync(join(seed, 'lib', 'tax.mjs'), 'return Math.floor((cents * bps) / 10000);\n');
    const snap = snapshotSeededFiles(seed, ['lib/discount.mjs', 'lib/tax.mjs']);

    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded: ['lib/discount.mjs', 'lib/tax.mjs'],
      artifactDir: artifact,
    });

    expect(captured).toEqual([
      {
        source: tree,
        copied: ['lib/discount.mjs', 'lib/tax.mjs'],
        missing: [],
        errors: [],
        changed: [],
        // 没给指纹与交付面信息，结论只能是「没采成」，不能报成「没搁浅」。
        strandedInWorktree: null,
      },
    ]);
    expect(
      readFileSync(join(artifact, 'delegated-worktrees', '1', 'lib', 'discount.mjs'), 'utf8'),
    ).toBe('return cents - discount;\n');
    expect(
      readFileSync(join(artifact, 'delegated-worktrees', '1', 'manifest.json'), 'utf8'),
    ).toContain(tree);
    expect(
      readFileSync(join(artifact, 'delegated-worktrees', '1', 'manifest.json'), 'utf8'),
    ).not.toContain('invoice.test.mjs');
    expect(materialsMutated(seed, ['lib/discount.mjs', 'lib/tax.mjs'], snap)).toBe(false);
  });

  it('路径不存在或不是 WorktreeCreated 时不抄', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-miss-'));
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(join(root, 'gone'))],
      seeded: ['lib/discount.mjs'],
      artifactDir: join(root, 'artifacts'),
    });
    expect(captured).toEqual([
      {
        source: join(root, 'gone'),
        copied: [],
        missing: ['lib/discount.mjs'],
        errors: ['工作树根不存在，无法比对'],
        changed: [],
        strandedInWorktree: null,
      },
    ]);
  });

  it('当前目录在临时目录下时，相对路径仍不得采集', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-cwd-'));
    const prev = process.cwd();
    try {
      process.chdir(root);
      mkdirSync(join(root, 'lib'), { recursive: true });
      writeFileSync(join(root, 'lib', 'discount.mjs'), 'cwd-secret\n');
      const captured = captureDelegatedWorktrees({
        events: [worktreeCreated('.')],
        seeded: ['lib/discount.mjs'],
        artifactDir: join(root, 'artifacts'),
      });
      expect(captured[0]?.copied).toEqual([]);
      expect(captured[0]?.errors[0]).toContain('拒绝采集');
      expect(
        existsSync(join(root, 'artifacts', 'delegated-worktrees', '1', 'lib', 'discount.mjs')),
      ).toBe(false);
    } finally {
      process.chdir(prev);
    }
  });

  it('临时目录内的符号链接指向外部时拒绝采集', () => {
    const outside = mkdtempSync(join(process.cwd(), '.proctor-capture-outside-'));
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-link-'));
    try {
      mkdirSync(join(outside, 'lib'), { recursive: true });
      writeFileSync(join(outside, 'lib', 'discount.mjs'), 'outside-secret\n');
      const link = join(root, 'tree');
      symlinkSync(outside, link);
      const captured = captureDelegatedWorktrees({
        events: [worktreeCreated(link)],
        seeded: ['lib/discount.mjs'],
        artifactDir: join(root, 'artifacts'),
      });
      expect(captured[0]?.copied).toEqual([]);
      expect(captured[0]?.errors[0]).toContain('拒绝采集');
      expect(
        existsSync(join(root, 'artifacts', 'delegated-worktrees', '1', 'lib', 'discount.mjs')),
      ).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('同名路径是目录时不抛错，也不把目录抄进产物', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-dir-'));
    const tree = join(root, 'tree');
    mkdirSync(join(tree, 'lib', 'discount.mjs'), { recursive: true });
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded: ['lib/discount.mjs'],
      artifactDir: join(root, 'artifacts'),
    });
    expect(captured[0]?.copied).toEqual([]);
    expect(captured[0]?.errors[0]).toContain('不是普通文件');
  });

  it('给了播种指纹时算出改动文件，并判定改动只停在委派分支', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-changed-'));
    const tree = join(root, 'wanxiangshu-zb27lx');
    const seed = join(root, 'seed');
    mkdirSync(join(tree, 'lib'), { recursive: true });
    mkdirSync(join(seed, 'lib'), { recursive: true });
    // 工作树里改了一个、留了一个没改。
    writeFileSync(join(tree, 'lib', 'discount.mjs'), 'return cents - amount;\n');
    writeFileSync(join(tree, 'lib', 'tax.mjs'), 'return Math.floor((cents * bps) / 10000);\n');
    writeFileSync(
      join(seed, 'lib', 'discount.mjs'),
      'return Math.floor((cents * percent) / 100);\n',
    );
    writeFileSync(join(seed, 'lib', 'tax.mjs'), 'return Math.floor((cents * bps) / 10000);\n');
    const seeded = ['lib/discount.mjs', 'lib/tax.mjs'];
    const snap = snapshotSeededFiles(seed, seeded);
    const artifact = join(root, 'artifacts');
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded,
      artifactDir: artifact,
      seedSnapshot: snap,
      mutatedInSeed: [],
    });
    expect(captured[0]?.changed).toEqual(['lib/discount.mjs']);
    expect(captured[0]?.strandedInWorktree).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(artifact, 'delegated-worktrees', '1', 'manifest.json'), 'utf8'),
    ) as { changed: string[]; strandedInWorktree: boolean | null };
    expect(manifest.changed).toEqual(['lib/discount.mjs']);
    expect(manifest.strandedInWorktree).toBe(true);
  });

  it('该文件在播种目录也变了时不算搁浅，但另一个没变的不掩盖', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-landed-'));
    const tree = join(root, 'tree');
    const seed = join(root, 'seed');
    mkdirSync(join(tree, 'lib'), { recursive: true });
    mkdirSync(join(seed, 'lib'), { recursive: true });
    writeFileSync(join(tree, 'lib', 'discount.mjs'), 'changed\n');
    writeFileSync(join(tree, 'lib', 'tax.mjs'), 'also-changed\n');
    writeFileSync(join(seed, 'lib', 'discount.mjs'), 'original\n');
    writeFileSync(join(seed, 'lib', 'tax.mjs'), 'original\n');
    const seeded = ['lib/discount.mjs', 'lib/tax.mjs'];
    const snap = snapshotSeededFiles(seed, seeded);
    // 播种目录里只有 discount 落了地，tax 仍停在分支。
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded,
      artifactDir: join(root, 'artifacts'),
      seedSnapshot: snap,
      mutatedInSeed: ['lib/discount.mjs'],
    });
    expect(captured[0]?.changed).toEqual(['lib/discount.mjs', 'lib/tax.mjs']);
    expect(captured[0]?.strandedInWorktree).toBe(true);
  });

  it('全部改动都已回到播种目录时不报搁浅', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-alllanded-'));
    const tree = join(root, 'tree');
    const seed = join(root, 'seed');
    mkdirSync(join(tree, 'lib'), { recursive: true });
    mkdirSync(join(seed, 'lib'), { recursive: true });
    writeFileSync(join(tree, 'lib', 'discount.mjs'), 'changed\n');
    writeFileSync(join(seed, 'lib', 'discount.mjs'), 'original\n');
    const seeded = ['lib/discount.mjs'];
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded,
      artifactDir: join(root, 'artifacts'),
      seedSnapshot: snapshotSeededFiles(seed, seeded),
      mutatedInSeed: ['lib/discount.mjs'],
    });
    expect(captured[0]?.strandedInWorktree).toBe(false);
  });

  it('工作树里删掉播种文件算改动，也算搁浅', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-deleted-'));
    const tree = join(root, 'tree');
    const seed = join(root, 'seed');
    mkdirSync(join(tree, 'lib'), { recursive: true });
    mkdirSync(join(seed, 'lib'), { recursive: true });
    writeFileSync(join(seed, 'lib', 'discount.mjs'), 'original\n');
    const seeded = ['lib/discount.mjs'];
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded,
      artifactDir: join(root, 'artifacts'),
      seedSnapshot: snapshotSeededFiles(seed, seeded),
      mutatedInSeed: [],
    });
    expect(captured[0]?.missing).toEqual(['lib/discount.mjs']);
    expect(captured[0]?.changed).toEqual(['lib/discount.mjs']);
    expect(captured[0]?.strandedInWorktree).toBe(true);
  });

  it('播种指纹缺 key 或未给交付面信息时不谎报结论', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-nosnap-'));
    const tree = join(root, 'tree');
    mkdirSync(join(tree, 'lib'), { recursive: true });
    writeFileSync(join(tree, 'lib', 'discount.mjs'), 'whatever\n');
    const noSnapshot = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded: ['lib/discount.mjs'],
      artifactDir: join(root, 'artifacts'),
      mutatedInSeed: [],
    });
    expect(noSnapshot[0]?.changed).toEqual([]);
    expect(noSnapshot[0]?.strandedInWorktree).toBeNull();

    const missingKey = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded: ['lib/discount.mjs'],
      artifactDir: join(root, 'artifacts2'),
      seedSnapshot: {
        digests: {},
        unreadable: [],
      },
      mutatedInSeed: [],
    });
    expect(missingKey[0]?.changed).toEqual([]);
    expect(missingKey[0]?.errors.some((error) => error.includes('播种指纹缺失'))).toBe(true);
    expect(missingKey[0]?.strandedInWorktree).toBeNull();
  });

  it('工作树路径被拒时结论为 null，不是 false', () => {
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated('/Users/example/not-temp')],
      seeded: ['lib/discount.mjs'],
      artifactDir: '/tmp/proctor-should-not-write',
      seedSnapshot: {
        digests: {},
        unreadable: [],
      },
      mutatedInSeed: [],
    });
    expect(captured[0]?.strandedInWorktree).toBeNull();
    expect(captured[0]?.errors[0]).toContain('拒绝采集');
  });

  it('指纹缺 key 且工作树里文件也缺失时，结论仍为 null', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-misskey-'));
    const tree = join(root, 'tree');
    mkdirSync(tree, { recursive: true });
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded: ['lib/discount.mjs'],
      artifactDir: join(root, 'artifacts'),
      // 空指纹：没有这个 rel 的 key。
      seedSnapshot: { digests: {}, unreadable: [] },
      mutatedInSeed: [],
    });
    expect(captured[0]?.changed).toEqual([]);
    expect(captured[0]?.strandedInWorktree).toBeNull();
    expect(captured[0]?.errors.some((error) => error.includes('播种指纹缺失'))).toBe(true);
  });

  it('工作树根不存在时不把「全都没了」当成「全部删除」', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-gone-'));
    const seed = join(root, 'seed');
    mkdirSync(join(seed, 'lib'), { recursive: true });
    writeFileSync(join(seed, 'lib', 'discount.mjs'), 'original\n');
    const seeded = ['lib/discount.mjs'];
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(join(join(root, 'already-cleaned')))],
      seeded,
      artifactDir: join(root, 'artifacts'),
      seedSnapshot: snapshotSeededFiles(seed, seeded),
      mutatedInSeed: [],
    });
    expect(captured[0]?.changed).toEqual([]);
    expect(captured[0]?.strandedInWorktree).toBeNull();
    expect(captured[0]?.errors.some((error) => error.includes('工作树根不存在'))).toBe(true);
  });

  it('上一次运行的旧副本不会与本轮混在一起', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-stale-'));
    const tree = join(root, 'tree');
    const artifact = join(root, 'artifacts');
    mkdirSync(join(tree, 'lib'), { recursive: true });
    writeFileSync(join(tree, 'lib', 'discount.mjs'), 'new\n');
    // 预置一份上一轮的残留。
    mkdirSync(join(artifact, 'delegated-worktrees', '1', 'lib'), { recursive: true });
    writeFileSync(join(artifact, 'delegated-worktrees', '1', 'lib', 'stale.mjs'), 'old\n');
    captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded: ['lib/discount.mjs'],
      artifactDir: artifact,
    });
    expect(existsSync(join(artifact, 'delegated-worktrees', '1', 'lib', 'stale.mjs'))).toBe(false);
  });

  it('播种时不存在、工作树里新增的文件算改动', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-added-'));
    const tree = join(root, 'tree');
    const seed = join(root, 'seed');
    mkdirSync(join(tree, 'lib'), { recursive: true });
    mkdirSync(join(seed, 'lib'), { recursive: true });
    writeFileSync(join(tree, 'lib', 'discount.mjs'), 'brand new\n');
    const seeded = ['lib/discount.mjs'];
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded,
      artifactDir: join(root, 'artifacts'),
      seedSnapshot: snapshotSeededFiles(seed, seeded),
      mutatedInSeed: [],
    });
    expect(captured[0]?.changed).toEqual(['lib/discount.mjs']);
    expect(captured[0]?.strandedInWorktree).toBe(true);
  });

  it('WorktreeCreated 事件解析不出路径时给 null，不当成没有委派', () => {
    const broken: CanonicalEvent = {
      event_id: 'e2',
      stream_id: 'journal/workspace',
      event_type: 'JournalEnvelope',
      parents: [],
      payload: { Fact: ['Agent', ['Orchestrator', ['WorktreeCreated', {}]]] },
      payload_refs: [],
    };
    const captured = captureDelegatedWorktrees({
      events: [broken],
      seeded: ['lib/discount.mjs'],
      artifactDir: '/tmp/proctor-should-not-write-2',
      seedSnapshot: { digests: {}, unreadable: [] },
      mutatedInSeed: [],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.strandedInWorktree).toBeNull();
    expect(captured[0]?.errors[0]).toContain('解析不出工作树路径');
  });

  it('材料名撞上原型链裸名时不误判为已改动', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-delegated-proto-'));
    const tree = join(root, 'tree');
    const seed = join(root, 'seed');
    mkdirSync(tree, { recursive: true });
    mkdirSync(seed, { recursive: true });
    writeFileSync(join(tree, 'constructor'), 'same\n');
    writeFileSync(join(seed, 'constructor'), 'same\n');
    const captured = captureDelegatedWorktrees({
      events: [worktreeCreated(tree)],
      seeded: ['constructor'],
      artifactDir: join(root, 'artifacts'),
      seedSnapshot: snapshotSeededFiles(seed, ['constructor']),
      mutatedInSeed: [],
    });
    expect(captured[0]?.changed).toEqual([]);
    expect(captured[0]?.strandedInWorktree).toBe(false);
  });
});

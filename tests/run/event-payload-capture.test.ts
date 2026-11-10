import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureEventPayloads, type CaptureLimits } from '../../src/run/event-payload-capture.ts';

const digestOf = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

interface Manifest {
  completed: boolean;
  captured: string[];
  missing: string[];
  invalid: string[];
  skipped: string[];
  writeFailed: string[];
  unreadEvents: string[];
  errors: string[];
  notes: string[];
  ignoredPayloadKeys: number;
  states: Array<{
    path: string;
    allowed: boolean;
    status: string;
    statusOk: boolean;
    statusError: string;
    logOk: boolean;
    logError: string;
  }>;
}

function readManifest(artifactDir: string): Manifest {
  return JSON.parse(
    readFileSync(join(artifactDir, 'event-payloads', 'manifest.json'), 'utf8'),
  ) as Manifest;
}

/** 只放宽测试关心的上限，其余保持生产口径。 */
function limits(overrides: Partial<CaptureLimits>): CaptureLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

const DEFAULT_LIMITS: CaptureLimits = {
  maxPayloadBytes: 8 * 1024 * 1024,
  maxTotalPayloadBytes: 64 * 1024 * 1024,
  maxPayloads: 2000,
  maxEventFiles: 2000,
  maxEventBytes: 64 * 1024 * 1024,
  maxErrors: 200,
  maxTracked: 5000,
};

function ndjson(rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function payloadRow(text: string): { ref: string; row: unknown } {
  const ref = digestOf(text);
  return {
    ref,
    row: { payload_refs: [ref], payloads: { [ref]: Buffer.from(text).toString('base64') } },
  };
}

/** 造一个带 pending ndjson 的隔离工作区。 */
function pendingWorkTree(prefix: string): { root: string; work: string; events: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const work = join(root, 'work');
  const events = join(work, '.Herdchestra', 'wanxiangshu', 'events');
  mkdirSync(events, { recursive: true });
  return { root, work, events };
}

describe('事件载荷诊断采集', () => {
  it('只保存摘要正确的内联载荷，并区分缺失、无效、空载荷与空载荷引用', () => {
    const { root, work, events } = pendingWorkTree('payload-test-');
    const text = '委派正文';
    const good = digestOf(text);
    const bad = 'a'.repeat(64);
    const missing = 'b'.repeat(64);
    // 空串的 sha256：空载荷不能算「已采集」。
    const empty = digestOf('');
    writeFileSync(
      join(events, 'one.ndjson'),
      ndjson([
        {
          payload_refs: [good, bad, missing, empty, 'not-a-digest'],
          payloads: {
            [good]: Buffer.from(text).toString('base64'),
            [bad]: Buffer.from(text).toString('base64'),
            [empty]: '',
            'not-a-digest': '忽略',
          },
        },
      ]),
    );
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, []);
    const dest = join(artifact, 'event-payloads');
    expect(readFileSync(join(dest, good), 'utf8')).toBe(text);
    // 摘要不匹配的载荷不得落盘。
    expect(existsSync(join(dest, bad))).toBe(false);
    expect(existsSync(join(dest, empty))).toBe(false);
    const manifest = readManifest(artifact);
    expect(manifest.completed).toBe(true);
    expect(manifest.captured).toEqual([good]);
    expect(manifest.invalid).toContain(bad);
    expect(manifest.invalid).toContain(empty);
    expect(manifest.missing).toContain(missing);
    // 非内容地址的键只计数，不进清单。
    expect(manifest.ignoredPayloadKeys).toBe(1);
  });

  it('值类型非法的键名合法载荷记为 invalid，不落进 missing', () => {
    const { root, work, events } = pendingWorkTree('payload-type-');
    const ref = digestOf('本应内联');
    writeFileSync(
      join(events, 'one.ndjson'),
      ndjson([{ payload_refs: [ref], payloads: { [ref]: 42 } }]),
    );
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, []);
    const manifest = readManifest(artifact);
    expect(manifest.invalid).toContain(ref);
    expect(manifest.missing).toEqual([]);
  });

  it('同一摘要先坏后好时，后续合法副本仍会被保存', () => {
    const { root, work, events } = pendingWorkTree('payload-retry-');
    const text = '后到的合法副本';
    const ref = digestOf(text);
    // 第一条把内容换成别的串，摘要必然不匹配；第二条才是真身。
    writeFileSync(
      join(events, 'one.ndjson'),
      ndjson([
        { payload_refs: [ref], payloads: { [ref]: Buffer.from('假内容').toString('base64') } },
        { payload_refs: [ref], payloads: { [ref]: Buffer.from(text).toString('base64') } },
      ]),
    );
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, []);
    const manifest = readManifest(artifact);
    expect(manifest.captured).toEqual([ref]);
    expect(manifest.invalid).toEqual([]);
    expect(readFileSync(join(artifact, 'event-payloads', ref), 'utf8')).toBe(text);
  });

  it('也能读 refs/wanxiang/store 里收敛后的事件', () => {
    const root = mkdtempSync(join(tmpdir(), 'payload-store-'));
    const work = join(root, 'work');
    mkdirSync(join(work, 'events', 'ab'), { recursive: true });
    const git = (args: string[]) =>
      execFileSync('git', args, {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
      });
    git(['init', '--template=']);
    const text = '收敛后的事件正文';
    const { ref, row } = payloadRow(text);
    writeFileSync(join(work, 'events', 'ab', 'ev.jsonl'), ndjson([row]));
    git(['add', '.']);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed']);
    git(['update-ref', 'refs/wanxiang/store', 'HEAD']);
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, []);
    expect(readFileSync(join(artifact, 'event-payloads', ref), 'utf8')).toBe(text);
    expect(readManifest(artifact).captured).toContain(ref);
  });

  it('git 不可用时明确记为失败，不落成「干净」', () => {
    const root = mkdtempSync(join(tmpdir(), 'payload-git-'));
    const work = join(root, 'work');
    mkdirSync(work, { recursive: true });
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, []);
    const state = readManifest(artifact).states[0];
    expect(state?.statusOk).toBe(false);
    expect(state?.statusError.length).toBeGreaterThan(0);
    expect(state?.logOk).toBe(false);
    expect(state?.logError.length).toBeGreaterThan(0);
  });

  it('播种目录不在隔离目录内时既跳过 git，也不读任何载荷', () => {
    const root = mkdtempSync(join(tmpdir(), 'payload-outside-'));
    const artifact = join(root, 'artifacts');
    captureEventPayloads('/Users/example/not-temp-repo', artifact, ['/Users/example/other']);
    const manifest = readManifest(artifact);
    expect(manifest.states.map((state) => state.allowed)).toEqual([false, false]);
    expect(manifest.states[0]?.status).toBe('');
    expect(manifest.captured).toEqual([]);
    expect(manifest.errors.some((error) => error.includes('未读取事件'))).toBe(true);
  });

  it('采集整体失败时仍有清单，可区分「没跑」与「跑失败」', () => {
    const root = mkdtempSync(join(tmpdir(), 'payload-fail-'));
    const work = join(root, 'work');
    mkdirSync(work, { recursive: true });
    // 用同名文件占住产物目录，使 mkdir 失败。
    const artifact = join(root, 'artifacts');
    mkdirSync(artifact, { recursive: true });
    writeFileSync(join(artifact, 'event-payloads'), '占位');
    captureEventPayloads(work, artifact, []);
    const manifest = JSON.parse(
      readFileSync(join(artifact, 'event-payloads-manifest.json'), 'utf8'),
    ) as Manifest;
    expect(manifest.completed).toBe(false);
    expect(manifest.errors.some((error) => error.includes('采集中断'))).toBe(true);
  });

  it('超过条数上限的已内联载荷记为 skipped，不算 missing', () => {
    const { root, work, events } = pendingWorkTree('payload-many-');
    const rows: unknown[] = [];
    for (let index = 0; index < 4; index += 1) rows.push(payloadRow(`第 ${index} 条`).row);
    writeFileSync(join(events, 'many.ndjson'), ndjson(rows));
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, [], limits({ maxPayloads: 2 }));
    const manifest = readManifest(artifact);
    expect(manifest.captured.length).toBe(2);
    expect(manifest.skipped.length).toBe(2);
    expect(manifest.missing).toEqual([]);
    expect(manifest.notes.some((note) => note.includes('触达上限'))).toBe(true);
  });

  it('超过总量上限的载荷同样记为 skipped', () => {
    const { root, work, events } = pendingWorkTree('payload-total-');
    const rows = [payloadRow('甲'.repeat(64)).row, payloadRow('乙'.repeat(64)).row];
    writeFileSync(join(events, 'total.ndjson'), ndjson(rows));
    const artifact = join(root, 'artifacts');
    // 单条 192 字节：第一条通过，累计到第二条超 200 字节上限。
    captureEventPayloads(work, artifact, [], limits({ maxTotalPayloadBytes: 200 }));
    const manifest = readManifest(artifact);
    expect(manifest.captured.length).toBe(1);
    expect(manifest.skipped.length).toBe(1);
    expect(manifest.missing).toEqual([]);
  });

  it('超过单条上限的载荷在解码前被拒，且记为 skipped', () => {
    const { root, work, events } = pendingWorkTree('payload-huge-');
    const encoded = 'A'.repeat(4096);
    const ref = digestOf(Buffer.from(encoded, 'base64'));
    writeFileSync(
      join(events, 'huge.ndjson'),
      ndjson([{ payload_refs: [ref], payloads: { [ref]: encoded } }]),
    );
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, [], limits({ maxPayloadBytes: 512 }));
    const manifest = readManifest(artifact);
    expect(manifest.captured).toEqual([]);
    expect(manifest.skipped).toContain(ref);
    expect(manifest.missing).toEqual([]);
    expect(manifest.errors.some((error) => error.includes('预估超过单条上限'))).toBe(true);
  });

  it('事件文件数超过上限时把被挡掉的文件记为 unreadEvents', () => {
    const { root, work, events } = pendingWorkTree('payload-files-');
    for (let index = 0; index < 3; index += 1) {
      writeFileSync(join(events, `${index}.ndjson`), '');
    }
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, [], limits({ maxEventFiles: 1 }));
    const manifest = readManifest(artifact);
    expect(manifest.unreadEvents.length).toBe(2);
    expect(manifest.notes.some((note) => note.includes('事件文件超过上限'))).toBe(true);
  });

  it('事件累计字节超过上限时把被挡掉的文件记为 unreadEvents', () => {
    const { root, work, events } = pendingWorkTree('payload-bytes-');
    writeFileSync(join(events, 'a.ndjson'), ndjson([payloadRow('甲').row]));
    writeFileSync(join(events, 'b.ndjson'), ndjson([payloadRow('乙').row]));
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, [], limits({ maxEventBytes: 10 }));
    const manifest = readManifest(artifact);
    expect(manifest.unreadEvents.length).toBe(2);
    expect(manifest.notes.some((note) => note.includes('累计读取超过上限'))).toBe(true);
  });

  it('载荷落盘失败记 writeFailed，不混进 unreadEvents 也不落进 missing', () => {
    const { root, work, events } = pendingWorkTree('payload-writefail-');
    const text = '写不进去的正文';
    const { ref, row } = payloadRow(text);
    writeFileSync(join(events, 'one.ndjson'), ndjson([row]));
    const artifact = join(root, 'artifacts');
    // 用同名目录占住目标载荷文件，使 writeFileSync 报 EISDIR。
    mkdirSync(join(artifact, 'event-payloads', ref), { recursive: true });
    captureEventPayloads(work, artifact, []);
    const manifest = readManifest(artifact);
    expect(manifest.captured).toEqual([]);
    expect(manifest.writeFailed).toEqual([ref]);
    expect(manifest.unreadEvents).toEqual([]);
    expect(manifest.missing).toEqual([]);
    expect(manifest.errors.some((error) => error.includes('载荷写入失败'))).toBe(true);
  });

  it('错误数量有上限，畸形输入不会把清单撑大', () => {
    const { root, work, events } = pendingWorkTree('payload-errors-');
    writeFileSync(join(events, 'bad.ndjson'), 'not json\n'.repeat(50));
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, [], limits({ maxErrors: 10 }));
    const manifest = readManifest(artifact);
    expect(manifest.errors.length).toBe(11);
    expect(manifest.errors.at(-1)).toContain('错误过多');
    expect(manifest.completed).toBe(true);
  });

  it('摘要集合到顶后停止记录，说明落在 notes 而不是被错误预算吞掉', () => {
    const { root, work, events } = pendingWorkTree('payload-tracked-');
    const rows: unknown[] = [];
    for (let index = 0; index < 5; index += 1) {
      rows.push({ payload_refs: [digestOf(`未内联 ${index}`)] });
    }
    writeFileSync(join(events, 'refs.ndjson'), ndjson(rows));
    const artifact = join(root, 'artifacts');
    // 摘要集合的实际上限取 max(maxTracked, maxPayloads)，故两者一起设小才能触发截断。
    captureEventPayloads(work, artifact, [], limits({ maxTracked: 2, maxPayloads: 2 }));
    const manifest = readManifest(artifact);
    expect(manifest.missing.length).toBe(2);
    expect(manifest.notes.some((note) => note.includes('引用摘要超过 2 条'))).toBe(true);
  });

  it('maxTracked 小于 maxPayloads 时仍能保存并如实登记，不出现「盘上有、清单说缺」', () => {
    const { root, work, events } = pendingWorkTree('payload-shrink-');
    const rows = [payloadRow('一').row, payloadRow('二').row, payloadRow('三').row];
    writeFileSync(join(events, 'three.ndjson'), ndjson(rows));
    const artifact = join(root, 'artifacts');
    captureEventPayloads(work, artifact, [], limits({ maxPayloads: 3, maxTracked: 1 }));
    const manifest = readManifest(artifact);
    expect(manifest.captured.length).toBe(3);
    expect(manifest.missing).toEqual([]);
  });
});

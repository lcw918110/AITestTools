import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  writeJsonAtomic,
  writeJsonAtomicCas,
  writeTextAtomic,
} from '../../apps/console/json-io.ts';

describe('json-io 原子写', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('writeJsonAtomic 写入合法 JSON 且不残留临时文件', () => {
    root = mkdtempSync(join(tmpdir(), 'json-io-'));
    const file = join(root, 'a.json');
    writeJsonAtomic(file, { a: 1, b: [2, 3] });
    const doc = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ a: 1, b: [2, 3] });
    // 目录内除目标文件外不应有临时文件残留
    expect(readdirSync(root)).toEqual(['a.json']);
  });

  it('writeJsonAtomic 序列化失败时错误带文件路径上下文', () => {
    root = mkdtempSync(join(tmpdir(), 'json-io-'));
    const file = join(root, 'bad.json');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => writeJsonAtomic(file, cyclic)).toThrow(/bad\.json/);
    // 序列化失败不应留下目标文件或临时文件
    expect(readdirSync(root)).toEqual([]);
  });

  it('writeTextAtomic 覆盖既有内容且原子替换', () => {
    root = mkdtempSync(join(tmpdir(), 'json-io-'));
    const file = join(root, 't.txt');
    writeFileSync(file, 'old');
    writeTextAtomic(file, 'new-content');
    expect(readFileSync(file, 'utf8')).toBe('new-content');
    expect(readdirSync(root)).toEqual(['t.txt']);
  });

  it('writeJsonAtomicCas mtime 未变时写入，变化时拒绝且不覆盖', () => {
    root = mkdtempSync(join(tmpdir(), 'json-io-'));
    const file = join(root, 'room.json');
    writeJsonAtomic(file, { host: { model: 'm1' } });
    const mtime = statSync(file).mtimeMs;

    // 未变：CAS 写入成功
    expect(writeJsonAtomicCas(file, { host: { model: 'm2' } }, mtime)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ host: { model: 'm2' } });

    // 模拟并发：写入前先记住 mtime，再由另一写入改变 mtime，旧 mtime 的 CAS 应被拒绝
    const concurrentMtime = statSync(file).mtimeMs;
    writeJsonAtomic(file, { host: { model: 'm3' } });
    expect(writeJsonAtomicCas(file, { host: { model: 'm4' } }, concurrentMtime)).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ host: { model: 'm3' } });
  });
});

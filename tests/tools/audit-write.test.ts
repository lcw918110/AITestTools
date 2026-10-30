import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { acquireLock, releaseLock, cmdWrite } from '../../_审视/tools/audit-write.mjs';

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-write-test-'));
}

// 找到确认不存在的 pid（process.kill 返回 ESRCH）
function deadPid(): number {
  for (let pid = 2 ** 22; pid > 1; pid -= 1) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return pid;
    }
  }
  throw new Error('未找到不存在的 pid');
}

type ErrWithCode = Error & {
  code?: string;
  details?: { target?: string; expected?: string; actualLatest?: string; attempts?: number };
};

describe('acquireLock 陈旧锁收割', () => {
  it('超时 + 死进程：安全接管陈旧锁', () => {
    const dir = tmpdir();
    const lockPath = path.join(dir, '.audit.lock');
    const oldAt = new Date(Date.now() - 10 * 60_000).toISOString();
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ owner: 'ghost', pid: deadPid(), at: oldAt }),
      'utf8',
    );
    const owner = acquireLock('new-owner', {}, { lockPath });
    expect(owner).toBe('new-owner');
    const holder = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { owner: string };
    expect(holder.owner).toBe('new-owner');
    releaseLock('new-owner', { lockPath });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('存活进程：即使超时也拒绝接管', () => {
    const dir = tmpdir();
    const lockPath = path.join(dir, '.audit.lock');
    const oldAt = new Date(Date.now() - 10 * 60_000).toISOString();
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ owner: 'alive', pid: process.pid, at: oldAt }),
      'utf8',
    );
    let code = '';
    try {
      acquireLock('intruder', {}, { lockPath });
    } catch (e) {
      code = (e as ErrWithCode).code ?? '';
    }
    expect(code).toBe('ELOCKED');
    const holder = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { owner: string };
    expect(holder.owner).toBe('alive');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('未超时：拒绝破坏（即使进程已死）', () => {
    const dir = tmpdir();
    const lockPath = path.join(dir, '.audit.lock');
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ owner: 'fresh', pid: deadPid(), at: new Date().toISOString() }),
      'utf8',
    );
    let code = '';
    try {
      acquireLock('intruder', {}, { lockPath });
    } catch (e) {
      code = (e as ErrWithCode).code ?? '';
    }
    expect(code).toBe('ELOCKED');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('破损 JSON 锁：陈旧时安全接管', () => {
    const dir = tmpdir();
    const lockPath = path.join(dir, '.audit.lock');
    fs.writeFileSync(lockPath, '{ 这不是合法 JSON ', 'utf8');
    const old = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(lockPath, old, old);
    const owner = acquireLock('reclaimer', {}, { lockPath });
    expect(owner).toBe('reclaimer');
    releaseLock('reclaimer', { lockPath });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('cmdWrite 指纹冲突退避', () => {
  it('指纹冲突自愈：重取后成功写入', async () => {
    const dir = tmpdir();
    const target = path.join(dir, 'out.md');
    const contentFile = path.join(dir, 'content.md');
    fs.writeFileSync(target, 'v1');
    const content = 'v2-content';
    fs.writeFileSync(contentFile, content);
    const expected = crypto.createHash('sha256').update(content).digest('hex');

    let slept = 0;
    const sleep = async (_ms: number) => {
      slept += 1;
      // 模拟外部收敛：退避期间目标已变成期望内容
      fs.writeFileSync(target, content);
    };
    const res = await cmdWrite(target, contentFile, expected, {
      lockPath: path.join(dir, '.audit.lock'),
      assertPath: (t: string) => path.resolve(t),
      sleep,
      random: () => 0,
      quiet: true,
    });
    expect(res.ok).toBe(true);
    expect(slept).toBeGreaterThan(0);
    expect(fs.readFileSync(target, 'utf8')).toBe(content);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('3 次重试超限：fail-closed 抛 ELOCKCONFLICT', async () => {
    const dir = tmpdir();
    const target = path.join(dir, 'out.md');
    const contentFile = path.join(dir, 'content.md');
    fs.writeFileSync(target, 'v1');
    const content = 'v2-content';
    fs.writeFileSync(contentFile, content);
    const expected = crypto.createHash('sha256').update('never-matches').digest('hex');

    let caught: ErrWithCode | null = null;
    try {
      await cmdWrite(target, contentFile, expected, {
        lockPath: path.join(dir, '.audit.lock'),
        assertPath: (t: string) => path.resolve(t),
        sleep: async () => {},
        random: () => 0,
        quiet: true,
      });
    } catch (e) {
      caught = e as ErrWithCode;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe('ELOCKCONFLICT');
    expect(caught!.details).toBeDefined();
    expect(caught!.details!.attempts).toBeGreaterThanOrEqual(3);
    expect(fs.readFileSync(target, 'utf8')).toBe('v1');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

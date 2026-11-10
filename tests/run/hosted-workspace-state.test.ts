import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { materialsMutated, snapshotSeededFiles } from '../../src/run/hosted-workspace-state.ts';
import {
  formatHostExitCell,
  formatTimedOutCell,
  formatWorkspaceCell,
  isHostCrashed,
  observeHostExit,
} from '../../src/run/hosted-host-exit.ts';

describe('observeHostExit', () => {
  it('ETIMEDOUT → timed_out', () => {
    const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    const obs = observeHostExit({ status: null, signal: 'SIGTERM', error: err });
    expect(obs.timed_out).toBe(true);
    expect(obs.host_exit).toBeNull();
    expect(obs.host_exit_role).toBe('auxiliary');
  });
  it('正常 0 退出', () => {
    const obs = observeHostExit({ status: 0, signal: null });
    expect(obs.timed_out).toBe(false);
    expect(obs.host_exit).toBe(0);
  });
  it('外部 SIGKILL（OOM killer）不得判成超时', () => {
    // Local Bugbot High：旧实现从 signal 反推超时，把 OOM killer 记成 timed_out，
    // 于是 isHostCrashed 返回 false，崩溃归因对最常见的 OOM 场景完全失效。
    const obs = observeHostExit({ status: null, signal: 'SIGKILL', error: null });
    expect(obs.timed_out).toBe(false);
    expect(isHostCrashed(obs)).toBe(true);
  });
  it('外部 SIGTERM（用户 kill）不得判成超时', () => {
    const obs = observeHostExit({ status: null, signal: 'SIGTERM', error: null });
    expect(obs.timed_out).toBe(false);
    expect(isHostCrashed(obs)).toBe(true);
  });
  it('平台 deadline 显式触发 → timed_out，且不算崩溃', () => {
    const obs = observeHostExit({ status: null, signal: 'SIGKILL', deadlineFired: true });
    expect(obs.timed_out).toBe(true);
    expect(isHostCrashed(obs)).toBe(false);
  });
});

describe('hosted host-exit 单元格', () => {
  it('工作区/超时/host_exit 可读', () => {
    expect(formatWorkspaceCell(true)).toBe('过');
    expect(formatWorkspaceCell(false)).toBe('挂');
    expect(formatTimedOutCell(true)).toBe('是');
    expect(formatTimedOutCell(false)).toBe('否');
    expect(formatHostExitCell({ timed_out: true, host_exit: null })).toBe('超时');
    expect(formatHostExitCell({ host_exit: 1 })).toBe('1');
    expect(formatHostExitCell({ host_exit: null, host_spawn_error: 'ENOENT' })).toBe('没起来');
  });
});

describe('materialsMutated', () => {
  it('播种后未改 → false；改内容 → true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-mut-'));
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib/a.mjs'), 'old\n');
    const snap = snapshotSeededFiles(dir, ['lib/a.mjs']);
    expect(materialsMutated(dir, ['lib/a.mjs'], snap)).toBe(false);
    writeFileSync(join(dir, 'lib/a.mjs'), 'new\n');
    expect(materialsMutated(dir, ['lib/a.mjs'], snap)).toBe(true);
  });
});

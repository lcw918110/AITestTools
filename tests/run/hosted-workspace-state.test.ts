import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { materialsMutated, snapshotSeededFiles } from '../../src/run/hosted-workspace-state.ts';
import {
  formatHostExitCell,
  formatTimedOutCell,
  formatWorkspaceCell,
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
});

describe('hosted host-exit 单元格', () => {
  it('工作区/超时/host_exit 可读', () => {
    expect(formatWorkspaceCell(true)).toBe('过');
    expect(formatWorkspaceCell(false)).toBe('挂');
    expect(formatTimedOutCell(true)).toBe('是');
    expect(formatTimedOutCell(false)).toBe('否');
    expect(formatHostExitCell({ timed_out: true, host_exit: null })).toBe('超时');
    expect(formatHostExitCell({ host_exit: 1 })).toBe('1');
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

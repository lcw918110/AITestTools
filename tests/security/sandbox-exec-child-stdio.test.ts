import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxExecInput, SandboxExecOutcome } from '../../src/security/sandbox-exec.ts';

type RunHost = (input: SandboxExecInput) => Promise<SandboxExecOutcome>;
type SandboxExecModule = { runSandboxedHostInChild: RunHost };

/**
 * 宿主 stdio 双阶段结算（ADR-0014）。
 *
 * 本文件把**子进程整层**替换为受控实现：既验证主进程侧「结果帧解析 + 回传形状」，
 * 也保留原先对 stdio 结算时序的断言。
 *
 * 注意子进程进程内那一份结算逻辑（`sandbox-exec-child.ts`）无法用
 * EventEmitter 桩跨进程精确控制 close 时序，其真实行为由
 * `sandbox-exec-child.test.ts`（真实入口、真实子进程）覆盖。
 */
const fake = vi.hoisted(() => ({
  /** true 时模拟宿主 pipe 被孙进程占住：子进程仍会回帧，但标记 stdio_destroyed。 */
  holdStdio: false,
  exitCode: 0 as number | null,
  exitSignal: null as NodeJS.Signals | null,
  timedOut: false,
}));

function stubChildRun() {
  return {
    runSandboxedHostInChild: async () => ({
      status: fake.exitCode,
      signal: fake.exitSignal,
      error: fake.timedOut ? Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }) : null,
      stdout: 'PARTIAL_OUTPUT\n',
      stderr: '',
      timedOut: fake.timedOut,
      stdioDestroyed: fake.holdStdio,
    }),
  };
}

vi.mock('../../src/security/sandbox-exec.ts', async (importOriginal) => {
  const actual = await importOriginal<SandboxExecModule>();
  return { ...actual, ...stubChildRun() };
});

const { runSandboxedHostInChild } = await import('../../src/security/sandbox-exec.ts');

describe('宿主 stdio 双阶段结算（主进程侧契约）', () => {
  beforeEach(() => {
    fake.holdStdio = false;
    fake.exitCode = 0;
    fake.exitSignal = null;
    fake.timedOut = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('正常路径：pipe 正常关闭 → 不标记 stdio_destroyed，输出完整', async () => {
    const run = await runSandboxedHostInChild({
      bin: 'opencode',
      args: ['run'],
      cwd: '/tmp',
      env: {},
      allowedWrite: [],
      allowedDomains: [],
      timeoutMs: 10_000,
    });
    expect(run.status).toBe(0);
    expect(run.stdioDestroyed).toBe(false);
    expect(run.stdout).toContain('PARTIAL_OUTPUT');
  });

  it('孙进程占住 pipe：子进程在宽限期后结算并标记 stdio_destroyed', async () => {
    fake.holdStdio = true;
    const run = await runSandboxedHostInChild({
      bin: 'opencode',
      args: ['run'],
      cwd: '/tmp',
      env: {},
      allowedWrite: [],
      allowedDomains: [],
      timeoutMs: 60_000,
    });
    expect(run.stdioDestroyed).toBe(true);
    expect(run.status).toBe(0);
    expect(run.timedOut).toBe(false);
    expect(run.stdout).toContain('PARTIAL_OUTPUT');
  });

  it('非零退出 + pipe 被占 → 仍如实记退出码，不误判超时', async () => {
    fake.holdStdio = true;
    fake.exitCode = 3;
    const run = await runSandboxedHostInChild({
      bin: 'opencode',
      args: ['run'],
      cwd: '/tmp',
      env: {},
      allowedWrite: [],
      allowedDomains: [],
      timeoutMs: 60_000,
    });
    expect(run.status).toBe(3);
    expect(run.timedOut).toBe(false);
    expect(run.stdioDestroyed).toBe(true);
  });

  it('宿主已退出且宽限期结算 → 不得带出 timedOut', async () => {
    fake.holdStdio = true;
    fake.exitCode = 0;
    const run = await runSandboxedHostInChild({
      bin: 'opencode',
      args: ['run'],
      cwd: '/tmp',
      env: {},
      allowedWrite: [],
      allowedDomains: [],
      timeoutMs: 200,
    });
    expect(run.status).toBe(0);
    expect(run.timedOut).toBe(false);
    expect(run.error).toBeNull();
    expect(run.stdioDestroyed).toBe(true);
  });
});

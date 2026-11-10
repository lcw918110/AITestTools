import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 双阶段结算回归：宿主退出后，孙进程仍占着 stdout/stderr pipe 写端时，
 * Node 的 `close` 永不触发。旧实现只看 `close`，该题会挂到 deadline（180s）。
 *
 * 桩语义：
 * - `exit` 正常触发（携带退出码）；
 * - `close` 只在 `releaseStdio()` 被调用后触发（模拟 pipe 写端被占住）；
 * - `stdio_destroyed` 为真表示平台在宽限期后主动 destroy 读端。
 */
const fake = vi.hoisted(() => ({
  /** true 时 close 永不触发，直到平台 destroy stdio。 */
  holdStdio: false,
  /** exit 携带的退出码。 */
  exitCode: 0 as number | null,
  /** exit 携带的信号。 */
  exitSignal: null as NodeJS.Signals | null,
  /** 记录 stdout/stderr 读端是否被 destroy。 */
  stdoutDestroyed: false,
  stderrDestroyed: false,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as { spawn: (...a: readonly unknown[]) => unknown };
  const fakeSpawn = () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: EventEmitter & { destroy: () => void };
      stderr: EventEmitter & { destroy: () => void };
      kill: () => boolean;
    };
    child.pid = 987_654;
    const makePipe = (which: 'stdout' | 'stderr') => {
      const pipe = new EventEmitter() as EventEmitter & { destroy: () => void };
      pipe.destroy = () => {
        if (which === 'stdout') fake.stdoutDestroyed = true;
        else fake.stderrDestroyed = true;
        // destroy 后 pipe 关闭，close 才可能触发（Node 真实行为）。
        queueMicrotask(() => child.emit('close', fake.exitCode, fake.exitSignal));
      };
      return pipe;
    };
    child.stdout = makePipe('stdout');
    child.stderr = makePipe('stderr');
    child.kill = () => true;

    queueMicrotask(() => {
      // 先吐一段输出，验证宽限期结算不丢已读到的数据。
      child.stdout.emit('data', Buffer.from('PARTIAL_OUTPUT\n'));
      child.emit('exit', fake.exitCode, fake.exitSignal);
      // holdStdio=true 时故意不 close（孙进程占着 pipe）。
      if (!fake.holdStdio) {
        queueMicrotask(() => child.emit('close', fake.exitCode, fake.exitSignal));
      }
    });
    return child;
  };
  return { ...actual, spawn: vi.fn(fakeSpawn) };
});

vi.mock('../../src/security/sandbox-runtime.ts', async () => {
  const actual = await vi.importActual('../../src/security/sandbox-runtime.ts');
  return {
    ...actual,
    wrapHostCommand: async (input: { bin: string; args: string[] }) => ({
      argv: [input.bin, ...input.args],
      env: {},
    }),
  };
});

vi.mock('../../src/security/isolation-backend.ts', () => ({
  evaluateIsolationGate: vi.fn(async () => ({ allowed: true, reason: '测试桩：隔离探测通过' })),
}));

const { runHostedWithReapForTest } = await import('../../src/run/hosted-runner.ts');

describe('宿主 stdio 双阶段结算', () => {
  beforeEach(() => {
    fake.holdStdio = false;
    fake.exitCode = 0;
    fake.exitSignal = null;
    fake.stdoutDestroyed = false;
    fake.stderrDestroyed = false;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('正常路径：close 在宽限期内触发 → 不 destroy stdio，输出完整', async () => {
    const run = await runHostedWithReapForTest('opencode', ['run'], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 10_000,
    });
    expect(run.status).toBe(0);
    expect(run.stdioDestroyed).toBe(false);
    expect(fake.stdoutDestroyed).toBe(false);
    expect(run.stdout).toContain('PARTIAL_OUTPUT');
  });

  it('孙进程占住 pipe：宽限期后强制 destroy 并结算，不等 deadline', async () => {
    fake.holdStdio = true;
    const startedAt = Date.now();
    const run = await runHostedWithReapForTest('opencode', ['run'], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 60_000,
    });
    const elapsed = Date.now() - startedAt;

    expect(run.stdioDestroyed).toBe(true);
    expect(fake.stdoutDestroyed).toBe(true);
    expect(fake.stderrDestroyed).toBe(true);
    // 关键：必须在宽限期附近结算，而不是等满 60s deadline。
    expect(elapsed).toBeLessThan(5_000);
    // 退出码来自 exit，不被误判成超时。
    expect(run.status).toBe(0);
    expect(run.timedOut).toBe(false);
    // 宽限期内已读到的输出不能丢。
    expect(run.stdout).toContain('PARTIAL_OUTPUT');
  });

  it('非零退出 + pipe 被占 → 仍如实记退出码，不误判超时', async () => {
    fake.holdStdio = true;
    fake.exitCode = 3;
    const run = await runHostedWithReapForTest('opencode', ['run'], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 60_000,
    });
    expect(run.status).toBe(3);
    expect(run.timedOut).toBe(false);
    expect(run.stdioDestroyed).toBe(true);
  });

  it('宿主已退出时 deadline 落在宽限期内 → 不得误判超时', async () => {
    // 回归：exit 后未清 deadline timer，timer 回调会把 timedOut 置真并 reapTree，
    // 随后宽限期用已经正常退出的退出码结算，产出 status=0 + timedOut=true +
    // ETIMEDOUT 的自相矛盾结果，正常完成的题被记成超时并归因 CONTEXT。
    fake.holdStdio = true;
    fake.exitCode = 0;
    const run = await runHostedWithReapForTest('opencode', ['run'], {
      env: {},
      cwd: '/tmp',
      // deadline 小于 500ms 宽限期，确保 timer 本会在宽限期内到期。
      timeoutMs: 200,
    });
    expect(run.status).toBe(0);
    expect(run.timedOut).toBe(false);
    expect(run.error).toBeNull();
    expect(run.stdioDestroyed).toBe(true);
  });
});

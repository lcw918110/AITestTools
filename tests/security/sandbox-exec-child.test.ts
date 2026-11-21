import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateIsolationGate } from '../../src/security/isolation-backend.ts';
import { runSandboxedHostInChild } from '../../src/security/sandbox-exec.ts';

/**
 * 真实入口回归：用 `SANDBOX_EXEC_CHILD_ENTRY` 起真子进程，验证
 * 「初始化沙箱 → 包裹 → 执行 → 回传」这条链在本机隔离后端可用时确实跑通。
 *
 * 本机未通过隔离探测时（例如平台不支持、缺少权限）整体跳过，
 * 不能把「没探测通过」写成「已隔离」。
 */
const gate = await evaluateIsolationGate().catch(() => ({
  allowed: false,
  reason: '探测异常',
}));

describe.skipIf(gate.allowed !== true)('沙箱执行子进程（真实隔离后端）', () => {
  it('沙箱内执行命令并把输出来回传主进程', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-child-real-'));
    try {
      const result = await runSandboxedHostInChild({
        bin: '/bin/sh',
        args: ['-c', 'echo SANDBOXED_OK; echo BODY 1>&2'],
        cwd: workDir,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
          HOME: homedir(),
        },
        allowedWrite: [workDir],
        allowedDomains: [],
        timeoutMs: 60_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('SANDBOXED_OK');
      expect(result.stderr).toContain('BODY');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('工作区外写入在沙箱内被拒（隔离确实生效，而不是只换了环境变量）', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-child-real-'));
    const outside = join(homedir(), `.srt-isolation-probe-${process.pid}.txt`);
    try {
      const result = await runSandboxedHostInChild({
        bin: '/bin/sh',
        args: ['-c', `echo LEAK > '${outside}' && echo WROTE`],
        cwd: workDir,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir() },
        allowedWrite: [workDir],
        allowedDomains: [],
        timeoutMs: 60_000,
      });
      expect(result.stdout).not.toContain('WROTE');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }
  }, 120_000);

  it('超时按 deadline 收场，并标记 timedOut', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-child-real-'));
    try {
      const result = await runSandboxedHostInChild({
        bin: '/bin/sh',
        args: ['-c', 'sleep 30'],
        cwd: workDir,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir() },
        allowedWrite: [workDir],
        allowedDomains: [],
        timeoutMs: 2_000,
      });
      expect(result.timedOut).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('子进程结束不留残留代理端口配置：每次调用都是全新进程', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-child-real-'));
    try {
      const env = {
        PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: homedir(),
      };
      const first = await runSandboxedHostInChild({
        bin: '/bin/sh',
        args: ['-c', 'echo PORT=$HTTP_PROXY'],
        cwd: workDir,
        env,
        allowedWrite: [workDir],
        allowedDomains: [],
        timeoutMs: 60_000,
      });
      const second = await runSandboxedHostInChild({
        bin: '/bin/sh',
        args: ['-c', 'echo PORT=$HTTP_PROXY'],
        cwd: workDir,
        env,
        allowedWrite: [workDir],
        allowedDomains: [],
        timeoutMs: 60_000,
      });
      const portOf = (out: string) => /PORT=.*:(\d+)/.exec(out)?.[1];
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      // 两次独立进程各自起代理：端口不应复用同一套全局状态。
      expect(portOf(first.stdout)).toBeDefined();
      expect(portOf(second.stdout)).toBeDefined();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 150_000);

  it('宿主秒退但孙进程占住 pipe → 宽限期结算，不误判超时且不丢输出', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-child-stdio-'));
    try {
      const startedAt = Date.now();
      const result = await runSandboxedHostInChild({
        bin: '/bin/sh',
        // `sleep 5 &` 是孙进程，继承 stdout 写端；宿主自身立刻 exit 0。
        args: ['-c', 'sleep 5 & echo HOST_DONE; exit 0'],
        cwd: workDir,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir() },
        allowedWrite: [workDir],
        allowedDomains: [],
        timeoutMs: 30_000,
      });
      const elapsed = Date.now() - startedAt;
      expect(result.status).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.stdioDestroyed).toBe(true);
      expect(result.stdout).toContain('HOST_DONE');
      // 必须在宽限期附近结算，不能等满 30s deadline。
      expect(elapsed).toBeLessThan(10_000);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('中文 stdout/stderr 完整拼回，尾部半个字符被 end() 冲出', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-child-utf8-'));
    try {
      const full = '错误输出';
      const result = await runSandboxedHostInChild({
        bin: process.execPath,
        args: [
          '-e',
          [
            `process.stdout.write('正常输出');`,
            `process.stderr.write(${JSON.stringify(full)});`,
            `process.stderr.write(Buffer.from('暗', 'utf8').subarray(0, 2));`,
          ].join('\n'),
        ],
        cwd: workDir,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir() },
        allowedWrite: [workDir],
        allowedDomains: [],
        timeoutMs: 30_000,
      });
      expect(result.stdout).toBe('正常输出');
      expect(result.stderr).toBe(`${full}\uFFFD`);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('deadline 到达后忽略 SIGTERM 的孙进程必须被强制结束', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-child-reap-'));
    const marker = `proctor-reap-${String(Date.now())}`;
    const script = join(workDir, 'hold.py');
    writeFileSync(
      script,
      [
        'import signal, time',
        'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
        'time.sleep(30)',
        '',
      ].join('\n'),
    );
    try {
      const result = await runSandboxedHostInChild({
        bin: '/bin/sh',
        args: ['-c', `python3 ${JSON.stringify(script)} ${marker} & echo HOST_DONE; sleep 30`],
        cwd: workDir,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir() },
        allowedWrite: [workDir],
        allowedDomains: [],
        timeoutMs: 2_000,
      });
      expect(result.timedOut).toBe(true);
      const until = Date.now() + 3_000;
      let left = 'pending';
      while (Date.now() < until) {
        left = spawnSync('pgrep', ['-f', marker], { encoding: 'utf8' }).stdout.trim();
        if (left === '') break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
      expect(left).toBe('');
    } finally {
      spawnSync('pkill', ['-9', '-f', script]);
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});

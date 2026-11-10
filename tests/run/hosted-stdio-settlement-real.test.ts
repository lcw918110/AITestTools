import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHostedWithReapForTest } from '../../src/run/hosted-runner.ts';

/**
 * 真实子进程回归：不 mock `node:child_process`，用 `sh` 验证双阶段结算。
 *
 * 与 `hosted-stdio-settlement.test.ts` 互补——那个文件用 EventEmitter 桩
 * 精确控制 close 时序，这里验证真实 Node 行为下也成立。
 */
describe('宿主 stdio 双阶段结算（真实子进程）', () => {
  it('宿主秒退但孙进程占 pipe → 宽限期结算，不误判超时', async () => {
    // `sleep 5 &` 是孙进程，继承 stdout 写端；宿主自身立刻 exit 0。
    // 旧实现只看 close，会一直挂到 deadline。
    const startedAt = Date.now();
    const run = await runHostedWithReapForTest('sh', ['-c', 'sleep 5 & echo HOST_DONE; exit 0'], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });
    const elapsed = Date.now() - startedAt;

    expect(run.status).toBe(0);
    expect(run.timedOut).toBe(false);
    expect(run.stdioDestroyed).toBe(true);
    // 宽限期内已读到的输出不能丢。
    expect(run.stdout).toContain('HOST_DONE');
    // 必须在宽限期附近结算，不能等满 30s deadline。
    expect(elapsed).toBeLessThan(10_000);
  }, 40_000);

  it('宿主秒退且无残留孙进程 → 走 close 正常路径，不 destroy stdio', async () => {
    const run = await runHostedWithReapForTest('sh', ['-c', 'echo CLEAN_EXIT; exit 0'], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });
    expect(run.status).toBe(0);
    expect(run.timedOut).toBe(false);
    expect(run.stdioDestroyed).toBe(false);
    expect(run.stdout).toContain('CLEAN_EXIT');
  }, 40_000);

  it('截止时间到达后，忽略 SIGTERM 的孙进程必须被强制结束', async () => {
    const marker = `proctor-reap-${String(Date.now())}`;
    const dir = mkdtempSync(join(tmpdir(), 'proctor-reap-'));
    const script = join(dir, 'hold.py');
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
      const run = await runHostedWithReapForTest(
        'sh',
        ['-c', `python3 ${JSON.stringify(script)} ${marker} & echo HOST_DONE; sleep 30`],
        { env: {}, cwd: '/tmp', timeoutMs: 300 },
      );
      expect(run.timedOut).toBe(true);
      const deadline = Date.now() + 2_000;
      let left = 'pending';
      while (Date.now() < deadline) {
        left = spawnSync('pgrep', ['-f', marker], { encoding: 'utf8' }).stdout.trim();
        if (left === '') break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
      expect(left).toBe('');
    } finally {
      spawnSync('pkill', ['-9', '-f', script]);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it('宿主非零退出 + 孙进程占 pipe → 如实记退出码', async () => {
    const run = await runHostedWithReapForTest('sh', ['-c', 'sleep 5 & echo FAILED_RUN; exit 7'], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });
    expect(run.status).toBe(7);
    expect(run.timedOut).toBe(false);
    expect(run.stdioDestroyed).toBe(true);
  }, 40_000);
});

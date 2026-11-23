import { spawn, spawnSync } from 'node:child_process';
import type { Readable } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateIsolationGate } from '../../src/security/isolation-backend.ts';
import { runSandboxedHostInChild } from '../../src/security/sandbox-exec.ts';
import { SANDBOX_EXEC_CHILD_ENTRY } from '../../src/security/sandbox-exec-child.ts';

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

  it('结果管道在上层放弃读取时，宿主进程树被带走且子进程不留孤儿', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-child-pipe-'));
    // 用 exec -a 打唯一标记：pgrep -x 只认进程名，避免误伤本机同名 sleep。
    const tag = `proctor-pipe-${String(Date.now())}`;
    try {
      await expectAbandonedPipeReapsHost(workDir, tag);
    } finally {
      spawnSync('pkill', ['-9', '-f', tag]);
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('父进程在宿主退出后立刻关闭读端：宿主进程组被带走，不靠子进程退出钩子', async () => {
    // 结算之后（结果帧已写出、监视已停）父进程仍可能先关读端：
    // 此时子进程已无可用的同步补刀时机，只有父进程侧按登记的宿主 pid 兜底才不会留孤儿。
    const workDir = mkdtempSync(join(tmpdir(), 'sandbox-child-postsettle-'));
    const tag = `proctor-postsettle-${String(Date.now())}`;
    try {
      await expectParentReapsAfterReadingFrame(workDir, tag);
    } finally {
      spawnSync('pkill', ['-9', '-f', tag]);
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

/**
 * 直接拉起子进程入口，宿主跑起来后把结果读端 destroy 掉（模拟上层放弃/进程被回收），
 * 断言两件事：①宿主进程按标记被带走；②子进程自己收场退出，不靠外部 kill。
 */
async function expectAbandonedPipeReapsHost(workDir: string, tag: string): Promise<void> {
  const request = {
    bin: '/bin/sh',
    args: ['-c', `exec -a ${tag} sleep 30`],
    cwd: workDir,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir() },
    allowedWrite: [workDir],
    allowedDomains: [],
    timeoutMs: 120_000,
  };
  const child = spawn(process.execPath, ['--experimental-strip-types', SANDBOX_EXEC_CHILD_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, SRT_ISOLATION_CHILD_ENTRY: '1' },
  });
  // 探针通道与真实主进程一致：只持有读端、不读。上层消失后它随读端关闭而 EPIPE。
  const probeReader = child.stdio[3] as Readable | undefined;
  probeReader?.on('error', () => undefined);
  // 不消费 stdout：管道缓冲区未满前不会触发 EPIPE，正是要验证的「静默断开」场景。
  child.stderr.resume();
  child.stdout.pause();
  const closed = new Promise<number | null>((resolve) => child.on('close', resolve));
  // 请求写一行、不 end：主进程侧要留住 stdin 承载心跳确认（见 sandbox-exec.ts）。
  child.stdin.write(`${JSON.stringify(request)}\n`);
  try {
    await waitFor(() => hostPids(tag).length > 0, 15_000);
    expect(hostPids(tag).length).toBeGreaterThan(0);
    child.stdout.destroy();
    // 关键在这一步：上层彻底走了（结果读端与探针读端一起关），
    // 子进程只能靠探针写 EPIPE 得知没人要结果，进而带走宿主进程树。
    probeReader?.destroy();
    // 断言必须发生在 finally 的 pkill 之前：否则等待超时也照样是空列表，用例形同虚设。
    const reaped = await waitFor(() => hostPids(tag).length === 0, 10_000);
    expect(reaped, `宿主进程未被带走：${hostPids(tag).join(',')}`).toBe(true);
    expect(hostPids(tag)).toEqual([]);
    // 子进程必须自己退出：留着的子进程会在批量跑卷时累积成僵尸。
    await expect(closed).resolves.toBeDefined();
  } finally {
    child.kill('SIGKILL');
  }
}

/**
 * 模拟「父进程读到结果帧就立刻关闭读端」：帧一到手就 destroy stdout。
 *
 * 宿主在被包裹后刻意比探测标记晚一点退出，让「结果帧已写出」与「宿主仍有存活进程」
 * 同时成立，从而暴露「结算后关读端 → 子进程来不及补刀」的窗口。
 * 断言：帧仍可解析，且宿主进程组最终被父进程侧兜底带走。
 */
async function expectParentReapsAfterReadingFrame(workDir: string, tag: string): Promise<void> {
  const request = {
    bin: '/bin/sh',
    // 宿主延后退出：结果帧先回到父进程，宿主进程组此刻仍然存活，
    // 于是「父进程读到帧就关读端」正好落在「宿主还活着」的窗口里。
    args: ['-c', `echo HOST_OUT; sleep 3`],
    cwd: workDir,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir() },
    allowedWrite: [workDir],
    allowedDomains: [],
    timeoutMs: 120_000,
  };
  const child = spawn(process.execPath, ['--experimental-strip-types', SANDBOX_EXEC_CHILD_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, SRT_ISOLATION_CHILD_ENTRY: '1' },
  });
  child.stderr.resume();
  const probeReader = child.stdio[3] as Readable | undefined;
  probeReader?.on('error', () => undefined);
  const closed = new Promise<number | null>((resolve) => child.on('close', resolve));
  let frame = '';
  await new Promise<void>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      frame += chunk.toString('utf8');
      if (frame.includes('\n')) {
        child.stdout.destroy();
        resolve();
      }
    });
    // 与主进程一致：请求写一行即止，stdin 保持打开以承载心跳确认。
    child.stdin.write(`${JSON.stringify(request)}\n`);
  });
  child.stdin.destroy();
  try {
    expect(frame.startsWith('{')).toBe(true);
    expect(frame).toContain('HOST_OUT');
    // 帧已交出后上层才关管道：这是「读者走了」，不是「观测作废」。
    // 若这里被标成断管，上层会把一次正常观测判成功装故障。
    const reply = JSON.parse(frame.split('\n')[0] ?? '{}') as { pipeBroken?: boolean };
    expect(reply.pipeBroken).toBe(false);
    // 帧里登记的宿主 pid 必须真的消失了：父进程关读端之后靠它兜底回收。
    const hostPid = Number(/"hostPid":(\d+)/.exec(frame)?.[1] ?? 0);
    expect(hostPid).toBeGreaterThan(1);
    const gone = await waitFor(() => !pidAlive(hostPid), 10_000);
    expect(gone, `宿主 pid ${hostPid} 仍存活`).toBe(true);
    expect(pidAlive(hostPid)).toBe(false);
    expect(hostPids(tag)).toEqual([]);
    await expect(closed).resolves.toBeDefined();
  } finally {
    child.kill('SIGKILL');
  }
}

/** 进程是否仍存活（`kill -0` 只看是否存在，不发送信号）。 */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hostPids(tag: string): string[] {
  return spawnSync('pgrep', ['-x', tag], { encoding: 'utf8' })
    .stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // 超时返回 false，让调用方用断言把它变成失败——静默返回会把「没等到」伪装成「等到了」。
  return check();
}

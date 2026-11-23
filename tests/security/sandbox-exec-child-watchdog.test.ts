import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isPeerGone, SANDBOX_EXEC_CHILD_ENTRY } from '../../src/security/sandbox-exec-child.ts';

/**
 * 对端（父进程）生死判定的两段约定：
 *
 * 1. 纯判据 `isPeerGone`：心跳「落地」与「确认」是两条独立证据，任何一条在宽限内失效都判死；
 * 2. 真进程：父进程把心跳读走后**从不回确认**、或**把读端晾着不读**，
 *    只要心跳还在动（子进程自己没被堵住），就**不能**判死、不能杀宿主。
 *
 * 第 2 段是踩过坑之后收紧的口径：父进程的事件循环会被 HTTP 代理等同步调用占住，
 * 「读一拍、隔几拍才回确认」是常态，按确认单一路径判死会把正常观测误杀。
 * 心跳彻底堵死（`writeStuckAge` / `landedAge`）仍会判死，见上面的纯函数用例。
 */
describe('对端判死（isPeerGone）', () => {
  const base = {
    ackAge: 0,
    probeAge: 500,
    stdinAge: 0,
    stdinClosed: false,
    writeStuckAge: 0,
    landedAge: 0,
    graceMs: 1000,
  };

  it('stdin 已关闭：父进程彻底离开，立即判死', () => {
    expect(isPeerGone({ ...base, stdinClosed: true })).toBe(true);
  });

  it('心跳在宽限内一次都没落地：写端没人消费，判死', () => {
    expect(isPeerGone({ ...base, landedAge: 1200, writeStuckAge: 1200 })).toBe(true);
  });

  it('落定探针读到 EOF：对端读端全没了，过了宽限判死（无需等确认）', () => {
    expect(
      isPeerGone({ ...base, peerReaderGone: true, readerGoneAge: 11_000, drainGraceMs: 10_000 }),
    ).toBe(true);
    // 刚看到 EOF：给正常收尾留时间，不立刻改判。
    expect(
      isPeerGone({ ...base, peerReaderGone: true, readerGoneAge: 200, drainGraceMs: 10_000 }),
    ).toBe(false);
  });

  it('心跳写一直背压超过宽限：判死，不必等确认世代', () => {
    expect(isPeerGone({ ...base, writeStuckAge: 1200 })).toBe(true);
  });

  it('三路信号都在动：不判死，宁可多等一拍也不误伤慢对端', () => {
    expect(isPeerGone({ ...base, ackAge: 900, probeAge: 200, stdinAge: 900 })).toBe(false);
  });

  it('落定探针读到 EOF：缺省 `drainGraceMs` 时按 `graceMs` 兜底判死', () => {
    expect(isPeerGone({ ...base, peerReaderGone: true, readerGoneAge: 1200 })).toBe(true);
    expect(isPeerGone({ ...base, peerReaderGone: true, readerGoneAge: 900 })).toBe(false);
  });

  it('结果管道没人读优先于落定探针：两者同时命中仍判死', () => {
    expect(isPeerGone({ ...base, stdoutGone: true, peerReaderGone: true, readerGoneAge: 0 })).toBe(
      true,
    );
  });

  it('心跳落地正常但确认停摆、stdin 静默：宽限后判死', () => {
    expect(isPeerGone({ ...base, ackAge: 1100, probeAge: 1100, stdinAge: 1100 })).toBe(true);
  });
});

/** 拉起真实子进程入口；父进程侧读心跳/回确认的行为由具体用例决定。 */
function startChild(tag: string) {
  const workDir = mkdtempSync(join(tmpdir(), 'sandbox-watchdog-'));
  const child = spawn(process.execPath, ['--experimental-strip-types', SANDBOX_EXEC_CHILD_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    // 入口只认 `SRT_ISOLATION_CHILD_ENTRY`（`SR_SPAWN_CHILD` 会被 `childEnv` 剥掉，
    // 不能再用它当启动标记，否则测试里的子进程根本不会进入 `main()`）。
    env: { ...process.env, SRT_ISOLATION_CHILD_ENTRY: '1' },
  });
  const probe = child.stdio[3] as NodeJS.ReadableStream;
  probe.on('error', () => undefined);
  // stderr 透传便于排障；`PEERDBG` 是心跳判据的逐拍诊断，跑测试时没有必要刷屏。
  child.stderr?.on('data', (buf: Buffer) => {
    const text = buf.toString();
    if (text.includes('PEERDBG') || text.includes('GUARD-DIR')) return;
    process.stderr.write(text);
  });
  let frames = '';
  child.stdout?.on('data', (buf: Buffer) => {
    frames += buf.toString();
  });
  const request = {
    bin: '/bin/sh',
    // 用 argv[0] 打标记，靠 `pgrep -f` 精确找到这一条宿主，不按进程名误伤别的 sleep。
    args: ['-c', `exec -a ${tag} sleep 60`],
    cwd: workDir,
    env: { PATH: '/usr/bin:/bin', HOME: homedir() },
    allowedWrite: [workDir],
    allowedDomains: [],
    timeoutMs: 120_000,
  };
  child.stdin.write(`${JSON.stringify(request)}\n`);
  return {
    child,
    probe,
    frames: () => frames,
    alive: () => spawnSync('pgrep', ['-f', tag], { encoding: 'utf8' }).stdout.trim() !== '',
    cleanup: () => {
      child.stdin.destroy();
      child.kill('SIGKILL');
      spawnSync('pkill', ['-9', '-f', tag]);
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

describe('对端判死（真实子进程）', () => {
  let current: ReturnType<typeof startChild> | undefined;
  afterEach(() => {
    current?.cleanup();
    current = undefined;
  });

  /**
   * 观察 1.6s（远超判死宽限 1s）后断言：子进程还在、宿主也还在——没有误判死、没有误杀宿主。
   *
   * 不断言「没有帧」：`emit` 只在观测结束时才写帧；这里若冒出帧，本身就说明本进程提前
   * 收场了，上面那条进程存活断言会先失败。心跳由调用方决定读法（只读 / 干脆不读）。
   */
  const expectPeerAlive = async () => {
    await new Promise((r) => setTimeout(r, 2500));
    expect(current!.alive(), '宿主没有被拉起，用例前提不成立').toBe(true);
    await new Promise((r) => setTimeout(r, 2500));
    // 静默窗口：子进程仍应存活、宿主不被带走（`isPeerGone` 不因单一路径静默而判死）。
    expect(
      current!.child.exitCode === null && current!.child.signalCode === null,
      `子进程在父进程仍在读心跳时提前收场（${String(current!.child.exitCode)}/${String(current!.child.signalCode)}）：${current!.frames()}`,
    ).toBe(true);
    expect(current!.alive(), '父进程还在读心跳，宿主却被本进程带走了').toBe(true);
  };

  it('父进程读走心跳但不回确认：本进程不据此判死，宿主保留', async () => {
    const tag = `watchdog-noack-${Date.now()}`;
    current = startChild(tag);
    // 只读不确认：确认世代完全停摆，但探针管道健康、stdin 也没关。
    current.probe.on('data', () => undefined);
    await expectPeerAlive();
  }, 40_000);

  it('父进程把探针读端晾着不看：短时静默不判死，宿主保留', async () => {
    const tag = `watchdog-noread-${Date.now()}`;
    current = startChild(tag);
    // 完全不读：`pause()` 让父进程侧不再消费，心跳会先落在内核缓冲、再被堵住。
    (current.probe as unknown as { pause(): void }).pause();
    await expectPeerAlive();
  }, 40_000);
});

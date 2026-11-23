import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { planPipeBroken } from '../../src/security/sandbox-exec-child.ts';

/**
 * 子进程协议的两条约定：请求行不必等 EOF、断管判据不能把正常观测判作废。
 *
 * 这两处都被踩过：请求读成 `for await … stdin` 会一直等到父进程关 stdin，
 * 而协议改成「交完请求不关、继续用 stdin 回确认」之后，请求永远交不出去；
 * 断管判据若把「读到帧就关读端」算断管，一次完整观测会被上当成工装故障丢掉。
 */
describe('断管判据（planPipeBroken）', () => {
  it('帧已交出后上层关读端：不算断管（读者读完就走）', () => {
    expect(planPipeBroken(true, true, false)).toBe(false);
  });

  it('主动收场（deadline / 断管回收）造成探针停摆：不算断管', () => {
    expect(planPipeBroken(true, false, true)).toBe(false);
  });

  it('帧交出前上层消失、宿主被连带杀死：算断管，观测作废', () => {
    expect(planPipeBroken(true, false, false)).toBe(true);
  });

  it('探针始终健康：任何时机都不算断管', () => {
    expect(planPipeBroken(false, false, false)).toBe(false);
    expect(planPipeBroken(false, true, false)).toBe(false);
  });
});

/**
 * 子进程在写出某一帧之后「自己收场」而非死于外部信号。
 *
 * 为什么不能只看 `code === 0`：写端被对端先关掉时，Node 在写失败路径上会在 libuv 的轮询里
 * 撞上 `SIGPIPE`，退出信号是 `SIGABRT`（本机 macOS 的 Node 24 证实）。帧已经是完整的一帧，
 * 结论线由父进程手里的帧决定，这里只验证「它没有等 stdin EOF，也没有被测试自己杀掉」。
 */
function expectSelfSettled(out: { code: number | null; signal: string | null }): void {
  expect(out.signal === null || out.signal === 'SIGABRT').toBe(true);
  if (out.signal === null) expect(out.code).toBe(0);
}

describe('请求读取：不等 stdin EOF', () => {
  it('子进程写帧不等 stdin EOF：交完请求后 stdin 一直开着，它照样回帧并正常退出', async () => {
    const { SANDBOX_EXEC_CHILD_ENTRY } = await import('../../src/security/sandbox-exec-child.ts');
    const request = {
      bin: '/bin/echo',
      args: ['handshake-ok'],
      cwd: homedir(),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      allowedWrite: [],
      allowedDomains: [],
      timeoutMs: 20_000,
      // 旁路只跳过包裹，进程边界与协议不变，因此在任意机器上都能跑。
      sandboxBypass: true,
    };
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', SANDBOX_EXEC_CHILD_ENTRY],
      {
        // fd 4（生命期探针）不提供：这一路只用于「对端读端全没了」的判死，与请求读取无关。
        // fd 3（心跳探针）保留并照常回确认：否则子进程会按「对端不回确认」自己判死。
        // 子进程必然先吐出请求结果帧，上一轮观测的 `deny` 在它发出第一拍心跳之前不会被采信
        // （见 `PeerWatchdog.didDeny`），所以上一条用例留下的状态不影响这一条。
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        env: { ...process.env, SRT_ISOLATION_CHILD_ENTRY: '1' },
      },
    );
    const probe = child.stdio[3] as Readable | null | undefined;
    probe?.on('error', () => undefined);
    let ack = 0;
    probe?.on('data', () => {
      ack += 1;
      if (!child.stdin.writableEnded && !child.stdin.destroyed) child.stdin.write(`${ack}\n`);
    });
    probe?.resume();

    let frames = '';
    // 与真实主进程一致：读到结果帧就放弃结果通道（见 `sandbox-exec.ts` 的 `settle`），
    // 这里同时关掉探针读端与 stdin，避免子进程把「结算之后的确认」当成还没收场。
    child.stdout?.on('data', (chunk: Buffer) => {
      frames += chunk.toString('utf8');
      if (!frames.includes('\n')) return;
      probe?.destroy();
      child.stdin.destroy();
    });
    const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      child.on('close', (code, signal) => resolve({ code, signal })),
    );

    // 交完请求**不 end** stdin：这就是要验证的条件（stdin 还要继续承载确认）。
    child.stdin.write(`${JSON.stringify(request)}\n`);
    const deadline = Date.now() + 15_000;
    while (!frames.includes('\n') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const { code, signal } = await closed;
    child.stdin.destroy();

    const reply = JSON.parse(frames.split('\n')[0] ?? '{}') as {
      ok?: boolean;
      stdout?: string;
      pipeBroken?: boolean;
    };
    expect(reply.ok, `子进程没有在 stdin 保持打开时回出成功帧：${frames}`).toBe(true);
    expect(reply.stdout).toContain('handshake-ok');
    expect(reply.pipeBroken).toBe(false);
    expectSelfSettled({ code, signal });
  }, 30_000);
});

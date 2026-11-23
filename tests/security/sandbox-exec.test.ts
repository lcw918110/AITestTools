import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runSandboxedHostInChild,
  SandboxExecHarnessError,
} from '../../src/security/sandbox-exec.ts';

/**
 * ADR-0014 回归：包裹与执行放进短命子进程。
 *
 * 这里只验证**跨进程契约**（请求送达、结果回传、故障分层），不验证 Seatbelt 本身
 * ——后者由 `sandbox-exec-child.test.ts` 在本机探测通过时覆盖。
 */
const stubEntry = resolve('tests/fixtures/sandbox-exec-child-stub.ts');

const workDir = mkdtempSync(join(tmpdir(), 'sandbox-exec-'));

afterEach(() => {
  delete process.env.FAKE_CHILD_MODE;
  delete process.env.FAKE_CHILD_ECHO_PROXY;
});

function run(
  overrides: Partial<Parameters<typeof runSandboxedHostInChild>[0]> = {},
  entry: string = stubEntry,
) {
  return runSandboxedHostInChild(
    {
      bin: 'echo',
      args: ['hello-child'],
      cwd: workDir,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      allowedWrite: [workDir],
      allowedDomains: [],
      timeoutMs: 30_000,
      ...overrides,
    },
    entry,
  );
}

describe('沙箱执行子进程契约', () => {
  it('宿主输出与退出码整包回传，主进程不自己起宿主', async () => {
    const result = await run();
    expect(result.status).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.error).toBeNull();
    // 探针字节只走 fd 3：结果帧必须纯净，任何混入都会让「首行合法帧」解析落空。
    expect(result.pipeBroken).toBe(false);
    expect(result.stdout).toContain('hello-child');
    expect(result.stderr).toContain('HOST_STDERR');
  }, 60_000);

  it('包裹层产出的环境随请求进入子进程（HTTP_PROXY 不被主进程剥掉）', async () => {
    process.env.FAKE_CHILD_ECHO_PROXY = '1';
    const result = await run({
      // 模拟包裹层环境：真实场景里由 SandboxManager 产出，含本机代理端口。
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HTTP_PROXY: 'http://127.0.0.1:54321' },
    });
    expect(result.stdout).toContain('HTTP_PROXY=http://127.0.0.1:54321');
  }, 60_000);

  it('尾部恰好是 JSON 的日志不得劫持结果帧（取首帧，不取最后一行）', async () => {
    process.env.FAKE_CHILD_MODE = 'noisy';
    const result = await run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('hello-child');
  }, 60_000);

  it('子进程没回结果帧 → HARNESS 工装故障，不是被测系统失败', async () => {
    process.env.FAKE_CHILD_MODE = 'silent';
    await expect(run()).rejects.toBeInstanceOf(SandboxExecHarnessError);
  }, 60_000);

  it('回包不可解析 → HARNESS 工装故障，并保留 stage=protocol', async () => {
    process.env.FAKE_CHILD_MODE = 'garbage';
    await expect(run()).rejects.toMatchObject({ stage: 'protocol' });
  }, 60_000);

  it('包裹失败 → 归 stage=wrap，由上层按 HARNESS 归因', async () => {
    process.env.FAKE_CHILD_MODE = 'wrap-fail';
    await expect(run()).rejects.toMatchObject({ stage: 'wrap' });
  }, 60_000);

  it('宿主起不来 → 归 stage=spawn', async () => {
    process.env.FAKE_CHILD_MODE = 'spawn-fail';
    await expect(run()).rejects.toMatchObject({ stage: 'spawn' });
  }, 60_000);

  it('子进程等待被杀死时不会串题：报告里带上子进程 stderr 便于定位', async () => {
    // 用一个会立即退出的入口脚本，验证「无结果帧」不会挂到远端超时。
    const bogus = join(workDir, 'bogus-entry.ts');
    writeFileSync(bogus, 'process.exit(0);\n', 'utf8');
    await expect(run({}, bogus)).rejects.toMatchObject({ stage: 'protocol' });
    rmSync(bogus, { force: true });
  }, 60_000);
});

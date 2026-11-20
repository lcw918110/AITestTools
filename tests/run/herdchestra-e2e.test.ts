import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { HerdchestraAdapter } from '../../src/run/herdchestra-adapter.ts';
import { resolveEndpointPath } from '../../src/run/loopback-transport.ts';
import type { AdapterContext, PreparedState } from '../../src/run/execution-adapter.ts';

/**
 * 端到端冒烟测试：用假 SUT（真子进程 + 真 TCP + 真写盘）跑完整链路。
 *
 * 与 `herdchestra-evaluate.test.ts` 的区别：那里直接喂 collected 数据，验证的是
 * 判定逻辑；这里从 `launchInstance` 真拉起进程开始，验证**链路本身**——就绪探测、
 * 握手、会话创建、命令投递、工作区 diff、断言判定、清理。任何一环断掉都会红。
 */

const FAKE_SUT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-herdchestra.mjs');

/** 每个用例独占一套目录，避免并发用例互相踩踏。 */
interface Sandbox {
  base: string;
  /** endpoint 目录的**根**；实际路径会再拼 `herdchestra-<user>`。 */
  endpointDir: string;
}

const sandboxes: Sandbox[] = [];

function makeSandbox(): Sandbox {
  const base = mkdtempSync(join(tmpdir(), 'aitest-e2e-'));
  const sandbox: Sandbox = { base, endpointDir: join(base, 'endpoint-root') };
  sandboxes.push(sandbox);
  return sandbox;
}

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox.base, { recursive: true, force: true });
  }
});

/** 造 adapter：把命令换成假 SUT 脚本，并把 endpoint 目录隔离到沙箱内。 */
function makeAdapter(
  sandbox: Sandbox,
  overrides: Partial<Record<string, unknown>> = {},
): HerdchestraAdapter {
  return new HerdchestraAdapter({
    repoRoot: sandbox.base,
    // 假 SUT 由 node 直接执行，不依赖 clojure 环境
    command: process.execPath,
    commandArgs: [FAKE_SUT],
    endpointDir: sandbox.endpointDir,
    readyTimeoutMs: 15_000,
    pollIntervalMs: 100,
    collectTimeoutMs: 8_000,
    settleMs: 300,
    ...overrides,
  } as never);
}

interface RunOptions {
  oracles: unknown[];
  env?: Record<string, string>;
}

/**
 * 跑完整链路：prepare → submit → collect → evaluate → cleanup。
 *
 * 每次都必须在 finally 里清理，否则子进程与临时目录会泄漏到后续用例。
 */
async function runFullChain(
  sandbox: Sandbox,
  options: RunOptions,
  adapterOptions: Partial<Record<string, unknown>> = {},
): Promise<{
  results: Awaited<ReturnType<HerdchestraAdapter['evaluate']>>;
  collected: Record<string, unknown>;
}> {
  const previousEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options.env ?? {})) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }

  const adapter = makeAdapter(sandbox, adapterOptions);
  const ctx = {
    sutRoot: sandbox.base,
    artifactDir: join(sandbox.base, 'artifacts'),
    revision: {
      case_id: 'E2E-01',
      case_revision_id: 'E2E-01',
      revision_number: 1,
      content_hash: 'h',
      stimulus: { ref: '写一个文件' },
      expect: { oracles: options.oracles },
    },
    facts: { observe: () => undefined, resolve: () => undefined },
  } as unknown as AdapterContext;

  let prepared: PreparedState | undefined;
  try {
    const discovered = await adapter.discover(ctx);
    prepared = await adapter.prepare(ctx, discovered);
    const handle = await adapter.submit(ctx, prepared);
    const collected = (await adapter.collect(ctx, handle)) as Record<string, unknown>;
    const results = await adapter.evaluate(ctx, collected as never);
    return { results, collected };
  } finally {
    if (prepared !== undefined) {
      try {
        await adapter.cleanup?.(ctx, prepared);
      } catch {
        /* 清理失败不掩盖用例本身的断言 */
      }
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('HerdchestraAdapter 端到端（假 SUT）', () => {
  it('模型写了正确文件时整条链路判通过', async () => {
    const sandbox = makeSandbox();
    const { results, collected } = await runFullChain(sandbox, {
      oracles: [{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello world' }],
      env: { FAKE_SUT_MODE: 'ok', FAKE_SUT_WRITE: 'out.txt', FAKE_SUT_CONTENT: 'hello world' },
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.pass).toBe(true);
    expect(results[0]?.attribution).toBeUndefined();

    // 链路中间产物也要对：diff 真的抓到了新文件
    const workspace = collected.workspace as { added: string[] };
    expect(workspace.added).toContain('out.txt');
    expect(collected.replied).toBe(true);
  }, 40_000);

  it('模型写的文件内容不对时判失败并归因 TOOL', async () => {
    const sandbox = makeSandbox();
    const { results } = await runFullChain(sandbox, {
      oracles: [{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: '期望的内容' }],
      env: { FAKE_SUT_MODE: 'ok', FAKE_SUT_WRITE: 'out.txt', FAKE_SUT_CONTENT: '完全不同的内容' },
    });

    expect(results[0]?.pass).toBe(false);
    // 文件确实被创建了，只是内容不对——这是模型的活没干对
    expect(results[0]?.attribution).toBe('TOOL');
  });

  it('模型什么都没写时判失败，不因「有回复」就放行', async () => {
    const sandbox = makeSandbox();
    const { results, collected } = await runFullChain(sandbox, {
      oracles: [{ type: 'workspace_assert', id: 'w1', path: 'never.txt' }],
      env: { FAKE_SUT_MODE: 'ok', FAKE_SUT_WRITE: 'other.txt', FAKE_SUT_CONTENT: 'x' },
    });

    expect(collected.replied).toBe(true);
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('TOOL');
  }, 40_000);

  it('模型只收命令不回复时归 CONTEXT，不判通过', async () => {
    const sandbox = makeSandbox();
    const { results, collected } = await runFullChain(sandbox, {
      oracles: [],
      env: { FAKE_SUT_MODE: 'no_reply' },
    });

    expect(collected.replied).toBe(false);
    expect(collected.timedOut).toBe(true);
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('CONTEXT');
  }, 30_000);

  it('实例永不就绪时 prepare 如实报错，不误报成被测系统失败', async () => {
    const sandbox = makeSandbox();
    const adapter = makeAdapter(sandbox, { readyTimeoutMs: 2000 });
    const ctx = {
      sutRoot: sandbox.base,
      revision: {
        case_id: 'E2E-02',
        case_revision_id: 'E2E-02',
        revision_number: 1,
        content_hash: 'h',
        stimulus: { ref: '做点事' },
        expect: { oracles: [] },
      },
      facts: { observe: () => undefined, resolve: () => undefined },
    } as unknown as AdapterContext;

    process.env.FAKE_SUT_MODE = 'silent';
    try {
      const discovered = await adapter.discover(ctx);
      await expect(adapter.prepare(ctx, discovered)).rejects.toMatchObject({
        kind: 'prepare_failed',
        // 实例起不来是环境问题，不是模型的活没干对
        attribution: 'HARNESS',
      });
    } finally {
      delete process.env.FAKE_SUT_MODE;
    }
  }, 30_000);

  it('结束后实例目录与 endpoint 文件都被清理，不留残留', async () => {
    const sandbox = makeSandbox();
    const { results, collected } = await runFullChain(sandbox, {
      oracles: [{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }],
      env: { FAKE_SUT_MODE: 'ok', FAKE_SUT_CONTENT: 'hello' },
    });

    expect(results[0]?.pass).toBe(true);
    // workspaceRoot 是 <rootDir>/work，据此反推实例根目录
    const workspaceRoot = String(collected.workspaceRoot ?? '');
    expect(workspaceRoot.length).toBeGreaterThan(0);
    const rootDir = dirname(workspaceRoot);
    // 与真实 cleanup 一致：实例目录删掉、endpoint 文件消失
    expect(existsSync(rootDir)).toBe(false);
    expect(existsSync(resolveEndpointPath({ tmpDir: sandbox.endpointDir }))).toBe(false);
  }, 40_000);

  it('工作区里预先存在的文件被修改时能被识别为 modified 而不是 added', async () => {
    const sandbox = makeSandbox();
    const { results, collected } = await runFullChain(sandbox, {
      oracles: [{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: '新内容' }],
      env: {
        FAKE_SUT_MODE: 'ok',
        // 实例启动时先写一次（基线快照之前），命令执行时再覆盖
        FAKE_SUT_SEED: '旧内容\n',
        FAKE_SUT_WRITE: 'out.txt',
        FAKE_SUT_CONTENT: '新内容',
      },
    });

    const workspace = collected.workspace as { added: string[]; modified: string[] };
    expect(workspace.modified).toContain('out.txt');
    expect(workspace.added).not.toContain('out.txt');
    expect(results[0]?.pass).toBe(true);
  }, 40_000);
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseRevision } from '../../src/domain/types.ts';
import { FoldResolveError } from '../../src/drivers/fold/resolve-entry.ts';
import { runFold } from '../../src/drivers/fold/run-fold.ts';

/**
 * `runFold` 是 L1 折叠执行的唯一入口，错误分支决定上层归因
 * （`FoldResolveError` → HARNESS，被测逻辑抛错 → PROTOCOL）。
 * 这些语义此前只被 CLI 端到端间接覆盖，出错时容易把「配置写错」误判成「被测逻辑有问题」。
 */
let workDir: string;

/** 在临时目录写一个 fold 模块，返回可直接 import 的 URL。 */
function writeModule(name: string, source: string): string {
  const file = join(workDir, name);
  writeFileSync(file, source);
  return pathToFileURL(file).href;
}

function resolved(
  moduleUrl: string,
  overrides: Partial<{
    exportName: string;
    signature: 'session_fold_v1' | 'pure_fold_v1';
    normalize: 'json_clone' | 'none';
  }> = {},
) {
  return {
    logicalName: 'test-fold',
    spec: {
      module: 'test-fold.mjs',
      export: overrides.exportName ?? 'fold',
      signature: overrides.signature ?? ('pure_fold_v1' as const),
      event_schema: 'demo-events-v1',
    },
    moduleUrl,
    normalize: overrides.normalize ?? ('json_clone' as const),
  };
}

const profile = (overrides: Record<string, unknown> = {}) =>
  ({
    mode: 'fold',
    layer: 'L1',
    fold_entry: 'test-fold',
    event_schema: 'demo-events-v1',
    ...overrides,
  }) as NonNullable<CaseRevision['execution_profile']>;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'run-fold-test-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('runFold 模块解析失败归 HARNESS', () => {
  it('模块不存在时抛 FoldResolveError，消息含模块名', async () => {
    const url = pathToFileURL(join(workDir, 'no-such-module.mjs')).href;
    // 必须断言类型：上层 l1-runner 按 `instanceof FoldResolveError` 归 HARNESS，
    // 若实现误抛普通 Error，消息正则照样匹配但归因会静默降为 PROTOCOL。
    await expect(
      runFold({ resolved: resolved(url), events: [], execution_profile: profile() }),
    ).rejects.toBeInstanceOf(FoldResolveError);
    await expect(
      runFold({ resolved: resolved(url), events: [], execution_profile: profile() }),
    ).rejects.toThrow(/无法 import Fold 模块/);
  });

  it('模块存在但未导出指定函数时抛 FoldResolveError，消息含导出名', async () => {
    const url = writeModule('no-export.mjs', 'export const other = (e) => e;\n');
    const run = runFold({
      resolved: resolved(url, { exportName: 'fold' }),
      events: [],
      execution_profile: profile(),
    });
    await expect(run).rejects.toBeInstanceOf(FoldResolveError);
    await expect(
      runFold({
        resolved: resolved(url, { exportName: 'fold' }),
        events: [],
        execution_profile: profile(),
      }),
    ).rejects.toThrow(/模块未导出函数 "fold"/);
  });

  it('导出同名但不是函数时同样拒绝', async () => {
    const url = writeModule('not-a-function.mjs', 'export const fold = 42;\n');
    const run = runFold({
      resolved: resolved(url),
      events: [],
      execution_profile: profile(),
    });
    await expect(run).rejects.toBeInstanceOf(FoldResolveError);
    await expect(
      runFold({ resolved: resolved(url), events: [], execution_profile: profile() }),
    ).rejects.toThrow(/模块未导出函数/);
  });
});

describe('runFold 签名校验', () => {
  it('pure_fold_v1 期望 1 个参数，函数声明 2 个时拒绝并说明期望值', async () => {
    const url = writeModule('arity-2.mjs', 'export function fold(a, b) { return a; }\n');
    const run = runFold({
      resolved: resolved(url),
      events: [],
      execution_profile: profile(),
    });
    await expect(run).rejects.toBeInstanceOf(FoldResolveError);
    await expect(
      runFold({ resolved: resolved(url), events: [], execution_profile: profile() }),
    ).rejects.toThrow(/期望 1 个，实际 2 个/);
  });

  it('session_fold_v1 期望 2 个参数，函数声明 1 个时拒绝', async () => {
    const url = writeModule('arity-1.mjs', 'export function fold(a) { return a; }\n');
    const run = runFold({
      resolved: resolved(url, { signature: 'session_fold_v1' }),
      events: [],
      execution_profile: profile({ session_id: 's1' }),
    });
    await expect(run).rejects.toBeInstanceOf(FoldResolveError);
    await expect(
      runFold({
        resolved: resolved(url, { signature: 'session_fold_v1' }),
        events: [],
        execution_profile: profile({ session_id: 's1' }),
      }),
    ).rejects.toThrow(/期望 2 个，实际 1 个/);
  });
});

describe('runFold session_fold_v1 的 session 选取', () => {
  it('execution_profile.session_id 优先于事件里的 Session', async () => {
    const url = writeModule(
      'echo-session.mjs',
      'export function fold(sessionId, events) { return { sessionId, n: events.length }; }\n',
    );
    const out = await runFold({
      resolved: resolved(url, { signature: 'session_fold_v1' }),
      events: [{ Session: 'from-event' }, { Session: 'from-event' }],
      execution_profile: profile({ session_id: 'from-profile' }),
    });
    expect(out).toEqual({ sessionId: 'from-profile', n: 2 });
  });

  it('无 session_id 时取事件中出现次数最多的 Session', async () => {
    const url = writeModule(
      'echo-session2.mjs',
      'export function fold(sessionId, events) { return sessionId; }\n',
    );
    const out = await runFold({
      resolved: resolved(url, { signature: 'session_fold_v1' }),
      events: [{ Session: 'a' }, { Session: 'b' }, { Session: 'b' }],
      execution_profile: profile(),
    });
    expect(out).toBe('b');
  });

  it('同时兼容小写 session 字段', async () => {
    const url = writeModule(
      'echo-session3.mjs',
      'export function fold(sessionId, events) { return sessionId; }\n',
    );
    const out = await runFold({
      resolved: resolved(url, { signature: 'session_fold_v1' }),
      events: [{ session: 'lower' }],
      execution_profile: profile(),
    });
    expect(out).toBe('lower');
  });

  it('既无 session_id 也无 Session 字段时抛 FoldResolveError', async () => {
    const url = writeModule(
      'echo-session4.mjs',
      'export function fold(sessionId, events) { return sessionId; }\n',
    );
    // 单次执行后同时断言类型与消息：session 缺失发生在 fold 调用之前，
    // 但保持单次写法可避免后续改动引入重复执行。
    const err = await runFold({
      resolved: resolved(url, { signature: 'session_fold_v1' }),
      events: [{ other: 1 }],
      execution_profile: profile(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FoldResolveError);
    expect((err as Error).message).toMatch(/需要 session_id 或事件中的 Session 字段/);
  });

  it('空字符串 Session 不算有效值', async () => {
    const url = writeModule(
      'echo-session5.mjs',
      'export function fold(sessionId, events) { return sessionId; }\n',
    );
    await expect(
      runFold({
        resolved: resolved(url, { signature: 'session_fold_v1' }),
        events: [{ Session: '' }],
        execution_profile: profile(),
      }),
    ).rejects.toBeInstanceOf(FoldResolveError);
  });
});

describe('runFold 被测逻辑抛错归 PROTOCOL', () => {
  it('折叠函数抛普通错误时包装为 Error 并带 attribution=PROTOCOL', async () => {
    const url = writeModule(
      'throws.mjs',
      'export function fold(events) { throw new Error("业务断言失败"); }\n',
    );
    // 单次执行后同时断言消息与归因：避免 fold 被调用两次（有副作用的 fold 会重复执行）。
    const err = (await runFold({
      resolved: resolved(url),
      events: [],
      execution_profile: profile(),
    }).catch((e: unknown) => e)) as Error & { attribution?: string };
    expect(err.message).toMatch(/Fold 执行抛错：业务断言失败/);
    expect(err.attribution).toBe('PROTOCOL');
    expect(err).not.toBeInstanceOf(FoldResolveError);
  });

  it('折叠函数抛真实 FoldResolveError 时原样透传，不包装成 PROTOCOL', async () => {
    // 契约：run-fold.ts 的 `if (e instanceof FoldResolveError) throw e`。
    // 模块必须 import 同一个源文件，才能拿到同一个类实例（同名 Error 不满足 instanceof）。
    // 路径用 import.meta.url 定位，避免依赖 vitest 的 cwd（--root 或子目录运行会失效）。
    const resolveEntryUrl = new URL('../../src/drivers/fold/resolve-entry.ts', import.meta.url)
      .href;
    const url = writeModule(
      'throws-real-resolve.mjs',
      `import { FoldResolveError } from ${JSON.stringify(resolveEntryUrl)};\n` +
        'export function fold(events) { throw new FoldResolveError("入口配置缺失"); }\n',
    );
    const err = (await runFold({
      resolved: resolved(url),
      events: [],
      execution_profile: profile(),
    }).catch((e: unknown) => e)) as Error & { attribution?: string };
    expect(err).toBeInstanceOf(FoldResolveError);
    expect(err.message).toBe('入口配置缺失');
    expect(err.attribution).toBeUndefined();
  });
});

describe('runFold 支持 async 折叠函数', () => {
  it('fold 返回 Promise 时等待其解析，不把 Promise 序列化成空对象', async () => {
    // 若实现漏掉 `await Promise.resolve(fn(...))`，json_clone 会把 pending Promise
    // 序列化成 `{}`，静默返回空对象且不报错——这是最危险的假通过形态。
    const url = writeModule(
      'async-fold.mjs',
      'export async function fold(events) { await Promise.resolve(); return { n: events.length }; }\n',
    );
    const out = await runFold({
      resolved: resolved(url),
      events: [{ kind: 'a' }, { kind: 'b' }],
      execution_profile: profile(),
    });
    expect(out).toEqual({ n: 2 });
  });

  it('async 折叠函数 reject 时同样归 PROTOCOL', async () => {
    const url = writeModule(
      'async-throws.mjs',
      'export async function fold(events) { throw new Error("异步失败"); }\n',
    );
    const err = (await runFold({
      resolved: resolved(url),
      events: [],
      execution_profile: profile(),
    }).catch((e: unknown) => e)) as Error & { attribution?: string };
    expect(err.message).toMatch(/Fold 执行抛错：异步失败/);
    expect(err.attribution).toBe('PROTOCOL');
  });
});

describe('runFold 结果归一化', () => {
  it('json_clone 模式下结果与原型断开，不可序列化时抛 FoldResolveError', async () => {
    const url = writeModule(
      'circular.mjs',
      'export function fold(events) { const a = {}; a.self = a; return a; }\n',
    );
    const err = await runFold({
      resolved: resolved(url, { normalize: 'json_clone' }),
      events: [],
      execution_profile: profile(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FoldResolveError);
    expect((err as Error).message).toMatch(/json_clone 失败/);
  });

  it('none 模式下原样返回，不做序列化', async () => {
    const url = writeModule(
      'circular2.mjs',
      'export function fold(events) { const a = {}; a.self = a; return a; }\n',
    );
    const out = (await runFold({
      resolved: resolved(url, { normalize: 'none' }),
      events: [],
      execution_profile: profile(),
    })) as { self?: unknown };
    expect(out.self).toBe(out);
  });

  it('纯函数收到完整事件数组', async () => {
    const url = writeModule(
      'echo-events.mjs',
      'export function fold(events) { return events.map((e) => e.kind); }\n',
    );
    const out = await runFold({
      resolved: resolved(url),
      events: [{ kind: 'a' }, { kind: 'b' }],
      execution_profile: profile(),
    });
    expect(out).toEqual(['a', 'b']);
  });

  it('moduleUrl 为 data: URL 时同样可执行', async () => {
    const url =
      'data:text/javascript,' +
      encodeURIComponent('export function fold(events) { return events.length; }');
    const out = await runFold({
      resolved: resolved(url),
      events: [{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }],
      execution_profile: profile(),
    });
    expect(out).toBe(3);
  });
});

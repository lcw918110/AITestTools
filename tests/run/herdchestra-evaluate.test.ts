import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HerdchestraAdapter } from '../../src/run/herdchestra-adapter.ts';
import type { AdapterContext } from '../../src/run/execution-adapter.ts';

/**
 * service 形态的 evaluate：只按 `workspace_assert` 判工作区，归因区分
 * 「模型没做到」(TOOL)、「环境没跑起来」(CONTEXT)、「试题配错」(HARNESS)。
 */

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'aitest-eval-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** 造上下文：只填 evaluate 真正读到的字段。 */
function makeCtx(oracles: unknown[]): AdapterContext {
  return {
    sutRoot: '/tmp',
    revision: {
      case_id: 'EVAL-SERVICE-01',
      case_revision_id: 'EVAL-SERVICE-01',
      revision_number: 1,
      content_hash: 'h',
      stimulus: { ref: '做点事' },
      expect: { oracles },
    },
    facts: { observe: () => undefined, resolve: () => undefined },
  } as unknown as AdapterContext;
}

/** 造 collect 产物。 */
function makeCollected(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    replied: true,
    timedOut: false,
    elapsedMs: 1000,
    assistantText: '已完成',
    workspace: { added: ['out.txt'], modified: [], removed: [] },
    changedFiles: { 'out.txt': 'hello world\n' },
    workspaceRoot: workspace,
    ...overrides,
  };
}

/** 造 collect 需要的上下文（命令被拒路径在读取会话前就返回）。 */
function makeCollectedContext(): AdapterContext {
  return {
    sutRoot: '/tmp',
    revision: {
      case_id: 'EVAL-SERVICE-01',
      case_revision_id: 'EVAL-SERVICE-01',
      revision_number: 1,
      content_hash: 'h',
      stimulus: { ref: '做点事' },
      expect: { oracles: [] },
    },
    facts: { observe: () => undefined, resolve: () => undefined },
  } as unknown as AdapterContext;
}

describe('HerdchestraAdapter.evaluate（service 形态）', () => {
  it('workspace_assert 全部通过时判 pass', async () => {
    writeFileSync(join(workspace, 'out.txt'), 'hello world\n');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }]),
      makeCollected() as never,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.pass).toBe(true);
    expect(results[0]?.oracle_failures).toEqual([]);
    expect(results[0]?.not_implemented).toBeUndefined();
  });

  it('workspace_assert 失败时判 fail 并归因 TOOL（模型没做到）', async () => {
    // 文件存在但不含期望内容
    writeFileSync(join(workspace, 'out.txt'), 'wrong content\n');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }]),
      makeCollected() as never,
    );

    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('TOOL');
    // 首条 'harness' 是整体原因，其后才是具体失败的 oracle
    const failingOracles = results[0]?.oracle_failures
      .map((f) => f.oracle_id)
      .filter((id) => id !== 'harness');
    expect(failingOracles).toEqual(['w1']);
  });

  it('期望的文件根本没被创建时判 fail 并归因 TOOL', async () => {
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'never-created.txt' }]),
      makeCollected() as never,
    );

    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('TOOL');
  });

  it('模型没回复（超时）时归因 CONTEXT，不归 TOOL', async () => {
    writeFileSync(join(workspace, 'out.txt'), 'hello world\n');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }]),
      makeCollected({
        replied: false,
        timedOut: true,
        workspace: { added: [], modified: [], removed: [] },
        changedFiles: {},
      }) as never,
    );

    expect(results[0]?.pass).toBe(false);
    // 环境/模型没跑起来，不是模型能力问题
    expect(results[0]?.attribution).toBe('CONTEXT');
  });

  it('命令未被接受时归因 HARNESS（试题/环境配错）', async () => {
    writeFileSync(join(workspace, 'out.txt'), 'hello world\n');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }]),
      makeCollected({ commandAccepted: false, commandError: 'MODEL_TOOLS_UNAVAILABLE' }) as never,
    );

    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('HARNESS');
  });

  it('oracle 自身配错（缺 path）时归因 HARNESS，不算模型失败', async () => {
    const adapter = new HerdchestraAdapter();
    // 真实的配错形状：完全没有 path 字段，而不是给个空串
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1' }]),
      makeCollected() as never,
    );

    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('HARNESS');
  });

  it('无 workspace_assert 时不判工作区，只看是否回复', async () => {
    const adapter = new HerdchestraAdapter();
    const okResults = await adapter.evaluate(makeCtx([]), makeCollected() as never);
    expect(okResults[0]?.pass).toBe(true);

    const noReply = await adapter.evaluate(
      makeCtx([]),
      makeCollected({ replied: false, timedOut: true }) as never,
    );
    expect(noReply[0]?.pass).toBe(false);
    expect(noReply[0]?.attribution).toBe('CONTEXT');
  });

  it('多条 workspace_assert 只要有一条失败就判 fail，失败项全部列出', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'aaa');
    writeFileSync(join(workspace, 'b.txt'), 'bbb');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([
        { type: 'workspace_assert', id: 'ok', path: 'a.txt', contains: 'aaa' },
        { type: 'workspace_assert', id: 'bad1', path: 'b.txt', contains: 'zzz' },
        { type: 'workspace_assert', id: 'bad2', path: 'missing.txt' },
      ]),
      makeCollected() as never,
    );

    expect(results[0]?.pass).toBe(false);
    expect(
      results[0]?.oracle_failures.map((f) => f.oracle_id).filter((id) => id !== 'harness').sort(),
    ).toEqual(['bad1', 'bad2']);
  });

  it('非 workspace_assert 类型的 oracle 记 HARNESS，不静默跳过', async () => {
    writeFileSync(join(workspace, 'out.txt'), 'hello world\n');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([
        { type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' },
        { type: 'exit_code', id: 'e1', equals: 0 },
      ]),
      makeCollected() as never,
    );

    // service 形态没有进程退出码，遇到就如实报「该形态不支持」，不假装通过
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('HARNESS');
    expect(results[0]?.oracle_failures.some((f) => f.oracle_id === 'e1')).toBe(true);
  });

  it('工作区目录不存在时如实失败，不崩溃', async () => {
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt' }]),
      makeCollected({ workspaceRoot: join(workspace, 'not-there') }) as never,
    );

    expect(results[0]?.pass).toBe(false);
  });

  it('配错与模型失败的归因链不串味：命令被拒一律 HARNESS，工作区写错才是 TOOL', async () => {
    writeFileSync(join(workspace, 'out.txt'), 'hello world\n');
    const adapter = new HerdchestraAdapter();
    const oracle = [{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }];

    // 同一条 oracle、同一份工作区，唯一差别是命令是否被接受
    const rejected = await adapter.evaluate(
      makeCtx(oracle),
      makeCollected({ commandAccepted: false, commandError: 'MODEL_TOOLS_UNAVAILABLE' }) as never,
    );
    const modelWrong = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: '完全不同的内容' }]),
      makeCollected() as never,
    );

    expect(rejected[0]?.attribution).toBe('HARNESS');
    expect(modelWrong[0]?.attribution).toBe('TOOL');
    // 两者都必须是 fail，不能因为归因不同就把配错算成通过
    expect(rejected[0]?.pass).toBe(false);
    expect(modelWrong[0]?.pass).toBe(false);
  });

  it('命令被拒时即使工作区恰好符合预期，也不判通过（避免空跑假绿）', async () => {
    writeFileSync(join(workspace, 'out.txt'), 'hello world\n');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }]),
      makeCollected({ commandAccepted: false, commandError: 'MODEL_TOOLS_UNAVAILABLE' }) as never,
    );

    expect(results[0]?.pass).toBe(false);
  });

  it('基线不可靠时即使读到回复也不判通过（可能是上一轮的旧回复）', async () => {
    writeFileSync(join(workspace, 'out.txt'), 'hello world\n');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }]),
      makeCollected({ baselineReliable: false, baselineError: 'ECONNREFUSED' }) as never,
    );

    // 基线不可靠 → 分不清新旧回复 → 结论不可信，必须报出来而不是直接绿
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('HARNESS');
  });

  it('缺少工作区路径时归 HARNESS，不拿进程当前目录当工作区', async () => {
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'package.json', exists: true }]),
      makeCollected({ workspaceRoot: '' }) as never,
    );

    // 空路径 resolve 后是进程 cwd，会读到仓库自己的文件造成误判
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('HARNESS');
  });

  it('超时但缺耗时数据时不编造「等待 0 秒」', async () => {
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([]),
      makeCollected({ replied: false, timedOut: true, elapsedMs: undefined }) as never,
    );

    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.oracle_failures[0]?.message).not.toContain('0 秒');
  });

  it('collect 遇到未被接受的命令时返回占位采集结果而不抛错', async () => {    const adapter = new HerdchestraAdapter();
    const collected = (await adapter.collect(
      makeCollectedContext(),
      {
        sessionId: 'sess-1',
        commandAccepted: false,
        commandError: 'MODEL_TOOLS_UNAVAILABLE',
        workspaceDir: workspace,
      } as never,
    )) as Record<string, unknown>;

    expect(collected.commandAccepted).toBe(false);
    expect(collected.replied).toBe(false);
    expect(collected.workspace).toEqual({ added: [], modified: [], removed: [] });
  });

  it('通过结果带正确的 item_rev（真实字段名是 revision_number）', async () => {
    writeFileSync(join(workspace, 'out.txt'), 'hello world\n');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }]),
      makeCollected() as never,
    );

    expect(results[0]?.item_id).toBe('EVAL-SERVICE-01');
    expect(results[0]?.item_rev).toBe(1);
  });

  it('整个等待期读不到会话时归因 HARNESS（通道坏了，不是模型没做到）', async () => {
    writeFileSync(join(workspace, 'out.txt'), 'hello world\n');
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([{ type: 'workspace_assert', id: 'w1', path: 'out.txt', contains: 'hello' }]),
      makeCollected({ replied: false, timedOut: true, readFailed: true, elapsedMs: 300_000 }) as never,
    );

    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('HARNESS');
  });

  it('基线不可靠且未回复时归 HARNESS，不冒充「模型没产出」', async () => {
    const adapter = new HerdchestraAdapter();
    const results = await adapter.evaluate(
      makeCtx([]),
      makeCollected({
        replied: false,
        timedOut: true,
        baselineReliable: false,
        baselineError: 'ECONNREFUSED',
      }) as never,
    );

    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('HARNESS');
    expect(results[0]?.oracle_failures[0]?.message).toContain('基线不可靠');
  });
});

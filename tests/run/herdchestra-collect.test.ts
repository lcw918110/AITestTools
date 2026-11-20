import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  diffWorkspace,
  readAssistantBaseline,
  readSessionMessages,
  renderModelConfig,
  assistantSignature,
  snapshotWorkspace,
  waitForAssistantReply,
} from '../../src/run/herdchestra-instance.ts';
import type { LoopbackEndpoint } from '../../src/run/loopback-transport.ts';
import { runWorkspaceAssertOracle } from '../../src/oracles/workspace-assert.ts';

describe('snapshotWorkspace', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aitest-snap-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('读出文本文件内容，路径用正斜杠', () => {
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'hello');
    writeFileSync(join(dir, 'src', 'deep', 'b.ts'), 'export const x = 1;\n');

    const snapshot = snapshotWorkspace(dir);

    expect(snapshot.get('a.txt')).toBe('hello');
    expect(snapshot.get('src/deep/b.ts')).toBe('export const x = 1;\n');
  });

  it('跳过 .git 与 node_modules', () => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: main');
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports=1');
    writeFileSync(join(dir, 'keep.txt'), 'k');

    const snapshot = snapshotWorkspace(dir);

    expect([...snapshot.keys()]).toEqual(['keep.txt']);
  });

  it('含 NUL 字节的二进制文件不进快照', () => {
    writeFileSync(join(dir, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47]));
    writeFileSync(join(dir, 'text.txt'), 'plain');

    const snapshot = snapshotWorkspace(dir);

    expect(snapshot.has('image.bin')).toBe(false);
    expect(snapshot.get('text.txt')).toBe('plain');
  });

  it('目录不存在时返回空快照，不抛错', () => {
    const snapshot = snapshotWorkspace(join(dir, 'not-there'));
    expect(snapshot.size).toBe(0);
  });

  it('空文件也能被记录（空内容与不存在是两回事）', () => {
    writeFileSync(join(dir, 'empty.txt'), '');
    const snapshot = snapshotWorkspace(dir);
    expect(snapshot.get('empty.txt')).toBe('');
  });
});

describe('diffWorkspace', () => {
  it('分别列出新增、修改、删除', () => {
    const before = new Map([
      ['same.txt', 'same'],
      ['changed.txt', 'old'],
      ['gone.txt', 'bye'],
    ]);
    const after = new Map([
      ['same.txt', 'same'],
      ['changed.txt', 'new'],
      ['fresh.txt', 'hi'],
    ]);

    const diff = diffWorkspace(before, after);

    expect(diff.added).toEqual(['fresh.txt']);
    expect(diff.modified).toEqual(['changed.txt']);
    expect(diff.removed).toEqual(['gone.txt']);
  });

  it('没有变化时三项全空', () => {
    const snapshot = new Map([['a.txt', 'x']]);
    const diff = diffWorkspace(snapshot, new Map(snapshot));
    expect(diff).toEqual({ added: [], modified: [], removed: [] });
  });

  it('内容相同但对象不同不算修改', () => {
    const diff = diffWorkspace(new Map([['a', 'v']]), new Map([['a', 'v']]));
    expect(diff.modified).toEqual([]);
  });

  it('只改内容结尾空白也算修改（不忽略任何差异）', () => {
    const diff = diffWorkspace(new Map([['a', 'x']]), new Map([['a', 'x ']]));
    expect(diff.modified).toEqual(['a']);
  });
});

/** 造一个假 endpoint：`sendControlRequest` 会连本地端口，这里用不可达端口触发失败路径。 */
function deadEndpoint(): LoopbackEndpoint {
  return { port: 1, token: 't', pid: 0, file: '' } as LoopbackEndpoint;
}

/**
 * 起一个只应答 `:history/messages` 的假控制通道。
 *
 * `messages` 是每次应答返回的消息数组，可变——测试借此模拟「旧回复 → 新回复」
 * 的时间推进，验证判据必须按基线过滤而不是「有任意助手消息就算回了」。
 */
async function startHistoryServer(messages: () => unknown[]): Promise<{
  endpoint: LoopbackEndpoint;
  close: () => Promise<void>;
}> {
  const server = createServer((socket: Socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl >= 0) buffer = buffer.slice(nl + 1);

      // 回执形状对齐实测：value.receipt.{:status, :session-id, :messages}
      const receipt = JSON.stringify({
        status: ':accepted',
        'session-id': 'sess-1',
        messages: messages(),
      });
      // EDN 与 JSON 对字符串的写法一致，键必须转成关键词才能被严格解析器接受
      socket.write(`{:ok? true, :receipt ${toEdnMap(receipt)}}\n`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    endpoint: { port, token: 't', pid: 0, file: '' } as LoopbackEndpoint,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** 把 JSON 对象重写成 EDN map（顶层键加冒号）。 */
function toEdnMap(json: string): string {
  return json.replaceAll(/"([a-z][a-z0-9-]*)":/g, ':$1 ');
}

describe('service 形态端到端：工作区变更 → collect → evaluate', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'aitest-e2e-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('模型改了工作区文件时，collect 捕获到变更并能被 workspace_assert 判定为通过', async () => {
    // 起点：工作区里有一个待改的文件
    writeFileSync(join(workspace, 'notes.txt'), '原始内容\n');
    const before = snapshotWorkspace(workspace);

    // 模拟被测系统在等待回复期间写盘（真实场景由模型自己写）
    writeFileSync(join(workspace, 'notes.txt'), '原始内容\n新增一行\n');
    writeFileSync(join(workspace, 'created.txt'), 'hello world\n');

    const diff = diffWorkspace(before, snapshotWorkspace(workspace));
    expect(diff.added).toContain('created.txt');
    expect(diff.modified).toContain('notes.txt');

    // 断言层：新建的文件内容正确、旧文件确实被追加
    const created = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'created.txt', contains: 'hello world' },
      workspace,
    });
    expect(created.pass).toBe(true);

    const appended = runWorkspaceAssertOracle({
      oracle_id: 'w2',
      oracle: { type: 'workspace_assert', path: 'notes.txt', contains: '新增一行' },
      workspace,
    });
    expect(appended.pass).toBe(true);

    // 反证：内容没写对时必须红，不能因为文件存在就绿
    const wrong = runWorkspaceAssertOracle({
      oracle_id: 'w3',
      oracle: { type: 'workspace_assert', path: 'created.txt', contains: '这段不存在' },
      workspace,
    });
    expect(wrong.pass).toBe(false);
  });

  it('工作区没被改动时 diff 为空（不把「没做事」误判成做了事）', async () => {
    writeFileSync(join(workspace, 'notes.txt'), '原始内容\n');
    const before = snapshotWorkspace(workspace);
    const diff = diffWorkspace(before, snapshotWorkspace(workspace));
    expect(diff).toEqual({ added: [], modified: [], removed: [] });
  });

  it('模型删了文件时 diff 记为 removed', async () => {
    writeFileSync(join(workspace, 'tmp.txt'), 'x');
    const before = snapshotWorkspace(workspace);
    rmSync(join(workspace, 'tmp.txt'));
    const diff = diffWorkspace(before, snapshotWorkspace(workspace));
    expect(diff.removed).toEqual(['tmp.txt']);
  });
});

describe('waitForAssistantReply 的基线过滤（防假绿）', () => {
  let closer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closer !== null) await closer();
    closer = null;
  });

  it('会话里只有旧助手消息时不得判 replied（否则把上一轮当本轮）', async () => {
    const server = await startHistoryServer(() => [
      { role: ':user', 'message-id': 'u1', content: '上一轮提问' },
      { role: ':assistant', 'message-id': 'a-old', content: '上一轮回复' },
    ]);
    closer = server.close;

    const outcome = await waitForAssistantReply(server.endpoint, 'sess-1', {
      timeoutMs: 200,
      pollIntervalMs: 40,
      baselineMessageIds: new Set(['a-old']),
      settleMs: 200,
    });

    expect(outcome.replied).toBe(false);
    expect(outcome.timedOut).toBe(true);
    expect(outcome.assistantMessages).toEqual([]);
  });

  it('出现基线之外的新助手消息时判 replied，且只返回新消息', async () => {
    let current: unknown[] = [{ role: ':assistant', 'message-id': 'a-old', content: '上一轮回复' }];
    const server = await startHistoryServer(() => current);
    closer = server.close;

    // 150ms 后推入新回复，模拟模型本轮返回
    const timer = setTimeout(() => {
      current = [...current, { role: ':assistant', 'message-id': 'a-new', content: '本轮回复' }];
    }, 150);

    const outcome = await waitForAssistantReply(server.endpoint, 'sess-1', {
      timeoutMs: 3000,
      pollIntervalMs: 40,
      baselineMessageIds: new Set(['a-old']),
      settleMs: 200,
    });
    clearTimeout(timer);

    expect(outcome.replied).toBe(true);
    expect(outcome.timedOut).toBe(false);
    expect(outcome.assistantMessages.map((m) => m.messageId)).toEqual(['a-new']);
    expect(outcome.assistantMessages[0]?.content).toBe('本轮回复');
  });

  it('只有 user 消息时不判 replied', async () => {
    const server = await startHistoryServer(() => [
      { role: ':user', 'message-id': 'u1', content: '本轮提问' },
    ]);
    closer = server.close;

    const outcome = await waitForAssistantReply(server.endpoint, 'sess-1', {
      timeoutMs: 150,
      pollIntervalMs: 40,
      baselineMessageIds: new Set(),
      settleMs: 100,
    });

    expect(outcome.replied).toBe(false);
    expect(outcome.timedOut).toBe(true);
  });

  it('取消信号生效时立即返回，不等到超时', async () => {
    const server = await startHistoryServer(() => []);
    closer = server.close;

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const started = Date.now();
    const outcome = await waitForAssistantReply(server.endpoint, 'sess-1', {
      timeoutMs: 10_000,
      pollIntervalMs: 40,
      baselineMessageIds: new Set(),
      signal: controller.signal,
    });

    expect(outcome.replied).toBe(false);
    expect(outcome.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('waitForAssistantReply 的稳定窗口（防截断假绿）', () => {
  let closer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closer !== null) await closer();
    closer = null;
  });

  it('回复还在增长时不判写完，等稳定后才返回完整内容', async () => {
    // 模拟流式：内容分三次增长，之后不再变化（updated-at 同步冻结）
    const stages = ['我把', '我把文件', '我把文件写好了'];
    let calls = 0;
    const server = await startHistoryServer(() => {
      // 前 3 次各返回一阶段，之后固定返回最后一阶段（内容与时间都不再变）
      const index = Math.min(Math.floor(calls / 2), stages.length - 1);
      calls += 1;
      return [
        {
          role: ':assistant',
          'message-id': 'a1',
          content: stages[index],
          'updated-at': index + 1,
        },
      ];
    });
    closer = server.close;

    const outcome = await waitForAssistantReply(server.endpoint, 'sess-1', {
      timeoutMs: 5000,
      pollIntervalMs: 30,
      settleMs: 300,
      baselineMessageIds: new Set(),
    });

    expect(outcome.replied).toBe(true);
    // 必须是最后一次的内容，不能停在「我把」
    expect(outcome.assistantMessages[0]?.content).toBe('我把文件写好了');
  });

  it('内容相同但 updated-at 在变，说明还在改写，不判写完', async () => {
    let updates = 0;
    const server = await startHistoryServer(() => {
      updates += 1;
      return [
        { role: ':assistant', 'message-id': 'a1', content: '固定文本', 'updated-at': updates },
      ];
    });
    closer = server.close;

    // 稳定 3 次才返回；updated-at 每轮都变，所以永远不会稳定 → 只能超时
    const outcome = await waitForAssistantReply(server.endpoint, 'sess-1', {
      timeoutMs: 400,
      pollIntervalMs: 30,
      settleMs: 300,
      baselineMessageIds: new Set(),
    });

    expect(outcome.replied).toBe(false);
    expect(outcome.timedOut).toBe(true);
  });

  it('带 error 的消息不算成功回复', async () => {
    const server = await startHistoryServer(() => [
      {
        role: ':assistant',
        'message-id': 'a1',
        content: '',
        'updated-at': 1,
        error: { code: 'MODEL_CALL_FAILED', message: '端点超时' },
      },
    ]);
    closer = server.close;

    const outcome = await waitForAssistantReply(server.endpoint, 'sess-1', {
      timeoutMs: 3000,
      pollIntervalMs: 30,
      settleMs: 200,
      baselineMessageIds: new Set(),
    });

    expect(outcome.replied).toBe(false);
    // 消息已稳定，所以不是超时，而是「确定失败」
    expect(outcome.timedOut).toBe(false);
    expect(outcome.assistantMessages[0]?.error?.code).toBe('MODEL_CALL_FAILED');
  });

  it('内容稳定达到阈值后立即返回，不干等到超时', async () => {
    const server = await startHistoryServer(() => [
      { role: ':assistant', 'message-id': 'a1', content: '完成', 'updated-at': 1 },
    ]);
    closer = server.close;

    const started = Date.now();
    const outcome = await waitForAssistantReply(server.endpoint, 'sess-1', {
      timeoutMs: 10_000,
      pollIntervalMs: 30,
      settleMs: 200,
      baselineMessageIds: new Set(),
    });

    expect(outcome.replied).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('renderModelConfig', () => {
  it('生成合法形状：模型是对象数组，且声明 tools 能力', () => {
    const config = renderModelConfig({
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-abc',
      model: 'some-model',
    });

    expect(config).toContain(':capabilities #{:tools :streaming}');
    expect(config).toContain(':model-name "some-model"');
    expect(config).toContain(':api-key "sk-abc"');
    expect(config).toContain(':roles {:main {:connection "eval" :model "main"}}');
    // 新行成对：括号数量平衡是最低限度的语法健全性检查
    expect((config.match(/\{/g) ?? []).length).toBe((config.match(/\}/g) ?? []).length);
    expect((config.match(/\[/g) ?? []).length).toBe((config.match(/\]/g) ?? []).length);
  });

  it('密钥含引号与反斜杠时被转义，不会破坏结构', () => {
    const config = renderModelConfig({
      baseUrl: 'https://example.test/v1',
      apiKey: 'a"b\\c',
      model: 'm',
    });

    expect(config).toContain(':api-key "a\\"b\\\\c"');
    expect((config.match(/\{/g) ?? []).length).toBe((config.match(/\}/g) ?? []).length);
  });

  it('控制字符被转义，不留裸控制字符（否则 EDN 读不出来）', () => {
    const config = renderModelConfig({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k\u0001\u0007',
      model: 'm',
    });

    // 只有 \n 是 config.edn 的合法换行，其余控制字符（含 \t）都必须转义
    const offending = [...config]
      .map((ch, i) => ({ code: ch.codePointAt(0) ?? 0, i }))
      .filter((x) => (x.code < 0x20 || x.code === 0x7f) && x.code !== 0x0a);
    expect(offending, `config=${JSON.stringify(config)}`).toEqual([]);
    // 密钥里的控制字符应以 \u00XX 文本形式出现
    expect(config).toContain('\\u0001');
    expect(config).toContain('\\u0007');
  });
});

describe('waitForAssistantReply 的等长替换', () => {
  let closer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closer !== null) await closer();
    closer = null;
  });

  it('内容等长但不同时，被视为不同（不改判为「无变化」）', async () => {
    // 这条不测时序，只测「等长会不会被当成相等」这个纯判定性质：
    // 同一 messageId、同 updated-at、等长但内容不同的两条消息，
    // 若签名只比长度就会相等，从而把改写当成静止。
    const a = { role: 'assistant' as const, messageId: 'a1', content: '草稿稿', updatedAt: 1 };
    const b = { role: 'assistant' as const, messageId: 'a1', content: '最终稿', updatedAt: 1 };
    expect(assistantSignature([a])).not.toBe(assistantSignature([b]));
    expect(assistantSignature([a])).toBe(assistantSignature([{ ...a }]));
  });
});

describe('readSessionMessages 的形状校验', () => {
  let closer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closer !== null) await closer();
    closer = null;
  });

  it('按 receipt.messages 取值，能读出消息与角色', async () => {
    const server = await startHistoryServer(() => [
      { role: ':assistant', 'message-id': 'a1', content: '你好' },
    ]);
    closer = server.close;

    const messages = await readSessionMessages(server.endpoint, 'sess-1');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: '你好',
      messageId: 'a1',
      updatedAt: 0,
    });
  });
});

describe('readAssistantBaseline', () => {
  let closer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closer !== null) await closer();
    closer = null;
  });

  it('读通道失败时返回空集并标 reliable=false，不静默降级', async () => {
    const result = await readAssistantBaseline(deadEndpoint(), 's1');
    expect(result.reliable).toBe(false);
    expect(result.ids.size).toBe(0);
    expect(result.error).toBeTruthy();
  });

  it('只收集助手消息 id', async () => {
    const server = await startHistoryServer(() => [
      { role: ':user', 'message-id': 'u1', content: '问' },
      { role: ':assistant', 'message-id': 'a1', content: '答' },
    ]);
    closer = server.close;

    const result = await readAssistantBaseline(server.endpoint, 'sess-1');

    expect(result.reliable).toBe(true);
    expect([...result.ids]).toEqual(['a1']);
  });
});

describe('waitForAssistantReply（通道不可达）', () => {
  it('读不到 history 时到点返回 timedOut，不抛错', async () => {
    const outcome = await waitForAssistantReply(deadEndpoint(), 's1', {
      timeoutMs: 120,
      pollIntervalMs: 40,
      baselineMessageIds: new Set(),
    });
    expect(outcome.replied).toBe(false);
    expect(outcome.timedOut).toBe(true);
    expect(outcome.assistantMessages).toEqual([]);
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(100);
  });

  it('超时为 0 时立即返回，不做无谓等待', async () => {
    const started = Date.now();
    const outcome = await waitForAssistantReply(deadEndpoint(), 's1', {
      timeoutMs: 0,
      pollIntervalMs: 40,
      baselineMessageIds: new Set(),
    });
    expect(outcome.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('readSessionMessages', () => {
  it('通道不可达时抛 LoopbackError，不返回空数组冒充「没有消息」', async () => {
    await expect(readSessionMessages(deadEndpoint(), 's1')).rejects.toMatchObject({
      name: 'LoopbackError',
    });
  });
});

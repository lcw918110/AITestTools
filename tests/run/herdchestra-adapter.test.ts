import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterContext } from '../../src/run/execution-adapter.ts';
import { AdapterError } from '../../src/run/execution-adapter.ts';
import {
  HerdchestraAdapter,
  buildCommandPayload,
  isCommandAccepted,
} from '../../src/run/herdchestra-adapter.ts';
import {
  HerdchestraLaunchError,
  createSession,
  launchInstance,
} from '../../src/run/herdchestra-instance.ts';
import { EdnSymbol, encodeRequest } from '../../src/run/loopback-transport.ts';
import type { CaseRevision } from '../../src/domain/types.ts';

/**
 * `HerdchestraAdapter` 是服务类 SUT 的入口，`prepare` 的失败路径决定归因：
 * 实例起不来必须是 HARNESS（测试环境问题），不能算成被测系统缺陷。
 *
 * 测试用假实例脚本驱动，不起真实 Herdchestra——后者单次启动 24 秒，且需要
 * Clojure 环境，不适合放进常规测试。
 */

const tempDirs: string[] = [];
const servers: Server[] = [];
const stops: Array<() => Promise<void>> = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hc-adapter-test-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * 写一个假实例脚本：参数里解析 `--data-dir`，在其 `herdchestra-<user>` 子目录下
 * 写 endpoint 文件，然后起一个控制通道服务端。
 *
 * 注意：endpoint 路径由 `java.io.tmpdir` 决定，这里用 TMPDIR 环境变量把它
 * 指到测试目录，避免污染真实 tmp。
 */
function writeFakeInstance(
  dir: string,
  behavior: 'ok' | 'exit' | 'never-ready' | 'ignore-sigterm',
  scriptPidOffset = 0,
): string {
  const script = join(dir, 'fake-instance.mjs');
  const source = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const behavior = ${JSON.stringify(behavior)};
if (behavior === 'exit') {
  console.error('fake: exiting before ready');
  process.exit(3);
}
if (behavior === 'never-ready') {
  console.error('fake: never publishing endpoint');
  setInterval(() => {}, 1000);
} else {
  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf('\\n');
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let reply;
      if (line.includes(':op "ping"')) {
        reply = '{:ok? true, :pid ' + process.pid + ', :sessions 0}';
      } else if (line.includes(':op "create-session"')) {
        reply = '{:ok? true, :session-id "sess-1"}';
      } else if (line.includes(':op "focus-or-create"')) {
        reply = '{:ok? true, :active-session-id "sess-1"}';
      } else if (line.includes(':op "command"')) {
        reply = '{:ok? true, :accepted true}';
      } else {
        reply = '{:ok? false, :error {:code :UNKNOWN_OP, :message "unknown"}}';
      }
      socket.write(reply + '\\n');
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const tmpRoot = process.env.TMPDIR || '/tmp';
    const user = (process.env.USER || 'u').replace(/[^A-Za-z0-9._-]/g, '_');
    const endpointDir = join(tmpRoot, 'herdchestra-' + user);
    mkdirSync(endpointDir, { recursive: true });
    // pid 写成 process.pid + offset，用于模拟「endpoint 指向别的实例」
    writeFileSync(join(endpointDir, 'instance.edn'),
      '{:port ' + port + ', :token "tok", :pid ' + (process.pid + ${scriptPidOffset}) + '}');
  });
  if (behavior === 'ignore-sigterm') {
    process.on('SIGTERM', () => { /* 故意不退出，逼出 SIGKILL 分支 */ });
  } else {
    const stop = () => process.exit(0);
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }
}
`;
  writeFileSync(script, source);
  chmodSync(script, 0o755);
  return script;
}

/** 造一个最小 AdapterContext，只填 adapter 会用到的字段。 */
function makeContext(overrides: { sutRoot?: string; stimulusRef?: string } = {}): AdapterContext {
  const revision = {
    case_id: 'case-1',
    case_revision_id: 'case-1.r1',
    revision_number: 1,
    content_hash: 'h',
    stimulus: { kind: 'task_prompt', ref: overrides.stimulusRef ?? '把 README 改一句话' },
    expect: { oracles: [] },
    attribution_focus: 'PROTOCOL',
    execution: { deadline_ms: 60000, requires_network: false },
  } as unknown as CaseRevision;

  const facts: Array<{ kind: string; key: string; value: unknown }> = [];
  return {
    revision,
    environment: { environment_id: 'env-1', name: 'herdchestra' } as unknown as AdapterContext['environment'],
    projectRoot: '/tmp',
    models: [],
    ...(overrides.sutRoot !== undefined ? { sutRoot: overrides.sutRoot } : {}),
    run: {} as AdapterContext['run'],
    caseExecution: {} as AdapterContext['caseExecution'],
    attempt: {} as AdapterContext['attempt'],
    facts: {
      resolve: (kind, key, value) => facts.push({ kind, key, value }),
      observe: (kind, key, value) => facts.push({ kind, key, value }),
      snapshot: () => ({ resolved: [], observed: [] }),
    },
  };
}

afterEach(async () => {
  while (stops.length > 0) {
    const stop = stops.pop();
    await stop?.();
  }
  while (servers.length > 0) {
    servers.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildCommandPayload', () => {
  it('把任务描述包装成 send-message 命令，:kind 为关键词', () => {
    const payload = buildCommandPayload('改 README', 'sess-1');
    const kind = payload['kind'];
    expect(kind).toBeInstanceOf(EdnSymbol);
    expect((kind as EdnSymbol).name).toBe(':send-message');
    expect(payload['session-id']).toBe('sess-1');
    expect(payload['text']).toBe('改 README');
  });

  it('编码后 :kind 是关键词而非字符串', () => {
    const line = encodeRequest({ payload: buildCommandPayload('改 README', 's') }, 'tok');
    expect(line).toContain(':kind :send-message');
    expect(line).not.toContain(':kind "send-message"');
  });

  it('完整请求报文里 :kind 位于 :payload 内部且为关键词', () => {
    // 真实实例实测：:kind 传字符串会被拒绝为 COMMAND_KIND_REQUIRED，
    // 故这里锁死报文形态，防止退回字符串写法。
    const payload = buildCommandPayload('msg', 'sess-1');
    const line = encodeRequest(
      { op: 'command', 'session-id': 'sess-1', payload },
      'tok',
    );
    expect(line).toMatch(/:payload \{[^}]*:kind :send-message/);
    expect(line).not.toMatch(/:kind "/);
  });
});

describe('launchInstance', () => {
  it('实例提前退出时报 PROCESS_EXITED 并带上输出', async () => {
    const dir = makeTempDir();
    const script = writeFakeInstance(dir, 'exit');
    const rootDir = join(dir, 'instance');
    await expect(
      launchInstance({
        repoRoot: dir,
        rootDir,
        command: script,
        commandArgs: [],
        readyTimeoutMs: 5000,
        pollIntervalMs: 100,
      }),
    ).rejects.toMatchObject({ code: 'PROCESS_EXITED' });
    // 失败后实例目录应被清理
    expect(existsSync(rootDir)).toBe(false);
  });

  it('实例始终不就绪时报 READY_TIMEOUT', async () => {
    const dir = makeTempDir();
    const script = writeFakeInstance(dir, 'never-ready');
    const rootDir = join(dir, 'instance');
    try {
      await launchInstance({
        repoRoot: dir,
        rootDir,
        command: script,
        commandArgs: [],
        readyTimeoutMs: 800,
        pollIntervalMs: 100,
      });
      throw new Error('应当超时');
    } catch (error) {
      expect(error).toBeInstanceOf(HerdchestraLaunchError);
      expect((error as HerdchestraLaunchError).code).toBe('READY_TIMEOUT');
    }
    expect(existsSync(rootDir)).toBe(false);
  });

  it('clojure 可执行文件不存在时报 SPAWN_FAILED', async () => {
    const dir = makeTempDir();
    const rootDir = join(dir, 'instance');
    await expect(
      launchInstance({ repoRoot: dir, rootDir, readyTimeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: 'SPAWN_FAILED' });
    // 早退路径也不能留下空目录
    expect(existsSync(rootDir)).toBe(false);
  });

  it('已有实例存活时报 INSTANCE_OCCUPIED，不抢锁', async () => {
    const dir = makeTempDir();
    // 先起一个真实假实例占住控制通道
    const script = writeFakeInstance(dir, 'ok');
    const firstRoot = join(dir, 'first');
    const first = await launchInstance({
      repoRoot: dir,
      rootDir: firstRoot,
      command: script,
      commandArgs: [],
      readyTimeoutMs: 15000,
      pollIntervalMs: 100,
    });
    stops.push(first.stop);

    const secondRoot = join(dir, 'second');
    try {
      await launchInstance({
        repoRoot: dir,
        rootDir: secondRoot,
        command: script,
        commandArgs: [],
        readyTimeoutMs: 5000,
        pollIntervalMs: 100,
      });
      throw new Error('应当报占用');
    } catch (error) {
      expect((error as HerdchestraLaunchError).code).toBe('INSTANCE_OCCUPIED');
    }
    // 第二个实例的目录根本没建
    expect(existsSync(secondRoot)).toBe(false);
  });

  it('endpoint 的 pid 与本次 spawn 不符时不认作自己的实例', async () => {
    const dir = makeTempDir();
    // pid 加 1：模拟「控制通道回复的是别的实例」
    const script = writeFakeInstance(dir, 'ok', 1);
    const rootDir = join(dir, 'instance');
    try {
      await launchInstance({
        repoRoot: dir,
        rootDir,
        command: script,
        commandArgs: [],
        readyTimeoutMs: 1500,
        pollIntervalMs: 100,
      });
      throw new Error('应当超时而不是认错实例');
    } catch (error) {
      expect((error as HerdchestraLaunchError).code).toBe('READY_TIMEOUT');
      // 诊断信息里要能看出 pid 不匹配
      expect((error as HerdchestraLaunchError).detail).toContain('期望 pid=');
    }
  });

  it('stop 对忽略 SIGTERM 的实例走 SIGKILL 分支并清理目录', async () => {
    const dir = makeTempDir();
    const script = writeFakeInstance(dir, 'ignore-sigterm');
    const rootDir = join(dir, 'instance');
    const instance = await launchInstance({
      repoRoot: dir,
      rootDir,
      command: script,
      commandArgs: [],
      readyTimeoutMs: 15000,
      pollIntervalMs: 100,
    });
    expect(existsSync(rootDir)).toBe(true);

    await instance.stop();
    // 目录必须被删掉，且 stop 不能永久挂住（由测试超时兜底）
    expect(existsSync(rootDir)).toBe(false);
    expect(instance.child.killed || instance.child.exitCode !== null).toBe(true);
  }, 30000);

  it('stop 幂等，重复调用不抛错', async () => {
    const dir = makeTempDir();
    const script = writeFakeInstance(dir, 'ok');
    const rootDir = join(dir, 'instance');
    const instance = await launchInstance({
      repoRoot: dir,
      rootDir,
      command: script,
      commandArgs: [],
      readyTimeoutMs: 15000,
      pollIntervalMs: 100,
    });
    await instance.stop();
    await expect(instance.stop()).resolves.toBeUndefined();
  }, 30000);
});

describe('createSession', () => {
  it('从创建会话回执里取到 session-id', async () => {
    const { port } = await startControlServer();
    const id = await createSession({ port, token: 'tok' }, '标题');
    expect(id).toBe('sess-1');
  });

  it('创建失败时抛错并带错误码', async () => {
    const { port } = await startControlServer('create-fail');
    await expect(createSession({ port, token: 'tok' }, '标题')).rejects.toMatchObject({
      code: 'CREATE_SESSION_FAILED',
    });
  });

  it('回执里没有 session-id 时回落到 focus-or-create', async () => {
    const { port } = await startControlServer('no-id');
    expect(await createSession({ port, token: 'tok' }, '标题')).toBe('sess-1');
  });
});

describe('HerdchestraAdapter', () => {
  it('缺少 sutRoot 时 preflight 归因 HARNESS', async () => {
    const adapter = new HerdchestraAdapter();
    const ctx = makeContext();
    await expect(adapter.discover(ctx)).rejects.toMatchObject({
      attribution: 'HARNESS',
      kind: 'preflight_failed',
    });
  });

  it('缺少任务描述时 preflight 返回 not ok', async () => {
    const adapter = new HerdchestraAdapter();
    const ctx = makeContext({ sutRoot: '/tmp', stimulusRef: '' });
    const discovered = await adapter.discover(ctx);
    discovered.taskPrompt = '';
    const result = await adapter.preflight(ctx, discovered);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('任务描述');
  });

  it('实例起不来时 prepare 归因 HARNESS 并清理目录', async () => {
    const dir = makeTempDir();
    const script = writeFakeInstance(dir, 'exit');
    const adapter = new HerdchestraAdapter({
      command: script,
      readyTimeoutMs: 5000,
    });
    const ctx = makeContext({ sutRoot: dir });
    const discovered = await adapter.discover(ctx);
    try {
      await adapter.prepare(ctx, discovered);
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as AdapterError).kind).toBe('prepare_failed');
      expect((error as AdapterError).attribution).toBe('HARNESS');
      expect((error as AdapterError).message).toContain('实例输出');
    }
  });

  it('collect 未实现时显式报错，不返回假绿', async () => {
    const adapter = new HerdchestraAdapter();
    const ctx = makeContext({ sutRoot: '/tmp' });
    await expect(adapter.collect(ctx, {})).rejects.toMatchObject({
      kind: 'collect_failed',
      attribution: 'HARNESS',
    });
  });

  it('evaluate 对空采集结果判失败并归因 CONTEXT（没跑起来不算模型失败）', async () => {
    const adapter = new HerdchestraAdapter();
    const ctx = makeContext({ sutRoot: '/tmp' });
    const results = await adapter.evaluate(ctx, {});
    expect(results).toHaveLength(1);
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('CONTEXT');
    expect(results[0]?.not_implemented).toBeUndefined();
  });

  it('cleanup 对缺实例的准备态返回 ok', async () => {
    const adapter = new HerdchestraAdapter();
    const ctx = makeContext({ sutRoot: '/tmp' });
    expect(await adapter.cleanup(ctx, {})).toEqual({ ok: true });
  });
});

describe('isCommandAccepted', () => {
  it('只在 commandAccepted 为 true 时返回 true', () => {
    expect(isCommandAccepted({ commandAccepted: true })).toBe(true);
    expect(isCommandAccepted({ commandAccepted: false })).toBe(false);
    expect(isCommandAccepted({})).toBe(false);
  });
});

/** 起一个控制通道服务端，行为由 MODE 决定。 */
async function startControlServer(
  mode: 'ok' | 'create-fail' | 'no-id' = 'ok',
): Promise<{ port: number }> {
  const server = createServer((socket: Socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let reply: string;
      if (line.includes(':op "ping"')) {
        reply = '{:ok? true, :pid 1}';
      } else if (line.includes(':op "create-session"')) {
        reply =
          mode === 'create-fail'
            ? '{:ok? false, :error {:code :CREATE_SESSION_FAILED, :message "拒绝"}}'
            : mode === 'no-id'
              ? '{:ok? true, :accepted true}'
              : '{:ok? true, :session-id "sess-1"}';
      } else if (line.includes(':op "focus-or-create"')) {
        reply = '{:ok? true, :active-session-id "sess-1"}';
      } else {
        reply = '{:ok? true}';
      }
      socket.write(`${reply}\n`);
    });
  });
  servers.push(server);
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('未能取得端口'));
    });
  });
  return { port };
}

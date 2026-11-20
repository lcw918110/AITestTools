import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LoopbackError,
  ednKeyword,
  encodeRequest,
  parseEdn,
  parseEndpointState,
  parseReply,
  probeInstance,
  readEndpointState,
  resolveEndpointDir,
  resolveEndpointPath,
  sendControlRequest,
} from '../../src/run/loopback-transport.ts';

/**
 * `LoopbackTransport` 是服务类 SUT 的唯一驱动入口，其解析与容错分支决定
 * 上层归因：把「实例没起来」误判成「被测逻辑有问题」会让整份报告失真。
 *
 * 重点覆盖「假绿」路径——畸形或失败的回复必须被判为不可用，而不是被
 * 宽松解析成 `ok: true`。
 */

const tempDirs: string[] = [];
const servers: Server[] = [];

/** 建一个临时目录，测试结束统一清理。 */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'loopback-test-'));
  tempDirs.push(dir);
  return dir;
}

/** 在临时目录下写一份 endpoint 文件，返回传给被测函数的选项。 */
function writeEndpointFile(content: string): {
  tmpDir: string;
  userName: string;
} {
  const dir = makeTempDir();
  const userName = 'u';
  const endpointDir = join(dir, `herdchestra-${userName}`);
  mkdirSync(endpointDir, { recursive: true });
  writeFileSync(join(endpointDir, 'instance.edn'), content);
  return { tmpDir: dir, userName };
}

/** 起一个假的控制通道服务端，按 HANDLER 回复单行 EDN。 */
async function startFakeServer(
  handler: (line: string) => string | null,
): Promise<{ port: number; received: string[] }> {
  const received: string[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newlineAt = buffer.indexOf('\n');
      if (newlineAt < 0) return;
      const line = buffer.slice(0, newlineAt);
      received.push(line);
      const reply = handler(line);
      if (reply === null) {
        socket.destroy();
        return;
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
      else reject(new Error('假服务端未能取得端口'));
    });
  });
  return { port, received };
}

afterEach(() => {
  while (servers.length > 0) {
    const server = servers.pop();
    server?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveEndpointDir / resolveEndpointPath', () => {
  it('按 singleton.clj 的 default-dir 规则拼接目录', () => {
    expect(resolveEndpointDir({ tmpDir: '/tmp', userName: 'Licw' })).toBe(
      join('/tmp', 'herdchestra-Licw'),
    );
  });

  it('用户名中的非法字符替换为下划线', () => {
    expect(resolveEndpointDir({ tmpDir: '/tmp', userName: 'a b/c@d' })).toBe(
      join('/tmp', 'herdchestra-a_b_c_d'),
    );
  });

  it('endpoint 文件名为 instance.edn', () => {
    expect(resolveEndpointPath({ tmpDir: '/tmp', userName: 'u' })).toBe(
      join('/tmp', 'herdchestra-u', 'instance.edn'),
    );
  });
});

describe('parseEdn', () => {
  it('解析扁平 map', () => {
    expect(parseEdn('{:port 62640, :token "abc"}')).toEqual({
      port: 62640,
      token: 'abc',
    });
  });

  it('解析嵌套 map 与 vector', () => {
    expect(parseEdn('{:a {:b [1 2 "x"]}}')).toEqual({
      a: { b: [1, 2, 'x'] },
    });
  });

  it('解析布尔与 nil', () => {
    expect(parseEdn('{:ok? true, :x nil, :y false}')).toEqual({
      'ok?': true,
      x: null,
      y: false,
    });
  });

  it('解析字符串转义', () => {
    expect(parseEdn('{:msg "say \\"hi\\"\\nbye"}')).toEqual({
      msg: 'say "hi"\nbye',
    });
  });

  it('解析 \\u 转义', () => {
    expect(parseEdn('{:msg "\\u4e2d"}')).toEqual({ msg: '中' });
  });

  it('拒绝未闭合的 map', () => {
    expect(() => parseEdn('{:port 1')).toThrowError(/未闭合/);
  });

  it('拒绝未闭合的字符串', () => {
    expect(() => parseEdn('{:token "abc}')).toThrowError(/字符串未闭合/);
  });

  it('拒绝尾部多余内容', () => {
    expect(() => parseEdn('{:a 1} garbage')).toThrowError(/多余内容/);
  });

  it('拒绝非关键词键', () => {
    expect(() => parseEdn('{"a" 1}')).toThrowError(/键必须是关键词/);
  });

  it('拒绝不支持的原子值', () => {
    expect(() => parseEdn('{:a foo}')).toThrowError(/不支持的原子值/);
  });
});

describe('parseEndpointState', () => {
  it('解析 port / token / pid', () => {
    const state = parseEndpointState(
      '{:port 62640, :token "05e18a59-c3cf-43b5-bd77-ec118c26c288", :pid 36082, :started-at "2026-11-17T14:16:48Z"}',
    );
    expect(state).toEqual({
      port: 62640,
      token: '05e18a59-c3cf-43b5-bd77-ec118c26c288',
      pid: 36082,
    });
  });

  it('缺 pid 时仍有效，只是不带 pid 字段', () => {
    const state = parseEndpointState('{:port 1234, :token "abc"}');
    expect(state).toEqual({ port: 1234, token: 'abc' });
    expect(state).not.toHaveProperty('pid');
  });

  it('token 中含转义引号时完整保留，不被截断', () => {
    // pr-str 写出的 token 可能含 \" —— 正则 [^"]+ 会在此截断
    const state = parseEndpointState('{:port 1234, :token "a\\"b"}');
    expect(state?.token).toBe('a"b');
  });

  it('字符串字段中出现 :port 字样时不被误取', () => {
    const state = parseEndpointState(
      '{:started-at "note :port 9999", :port 1234, :token "abc"}',
    );
    expect(state?.port).toBe(1234);
  });

  it('缺 port 或 token 时视为无效', () => {
    expect(parseEndpointState('{:token "abc"}')).toBeNull();
    expect(parseEndpointState('{:port 1234}')).toBeNull();
  });

  it('端口越界或非数字时视为无效', () => {
    expect(parseEndpointState('{:port 0, :token "abc"}')).toBeNull();
    expect(parseEndpointState('{:port 70000, :token "abc"}')).toBeNull();
    expect(parseEndpointState('{:port "1234", :token "abc"}')).toBeNull();
  });

  it('空 token 视为无效', () => {
    expect(parseEndpointState('{:port 1234, :token ""}')).toBeNull();
  });

  it('畸形文本视为无效，不抛错', () => {
    expect(parseEndpointState('')).toBeNull();
    expect(parseEndpointState('not edn')).toBeNull();
    expect(parseEndpointState('{:port 1234, :token "abc"')).toBeNull();
  });
});

describe('readEndpointState', () => {
  it('文件不存在时返回 null，不抛错', () => {
    expect(readEndpointState({ tmpDir: makeTempDir(), userName: 'u' })).toBeNull();
  });

  it('文件存在且合法时返回解析结果', () => {
    const options = writeEndpointFile('{:port 4321, :token "tok"}');
    expect(readEndpointState(options)).toEqual({ port: 4321, token: 'tok' });
  });
});

describe('encodeRequest', () => {
  it('把请求 map 序列化为单行 EDN 并附带 token', () => {
    expect(encodeRequest({ op: 'ping' }, 'tok')).toBe('{:op "ping", :token "tok"}\n');
  });

  it('字符串中的引号与反斜杠被转义', () => {
    expect(encodeRequest({ title: 'a"b\\c' }, 'tok')).toContain(':title "a\\"b\\\\c"');
  });

  it('换行被转义，不产生第二条请求行（防请求注入）', () => {
    const line = encodeRequest({ title: 'a\n:token "evil"' }, 'tok');
    expect(line.split('\n')).toHaveLength(2);
    expect(line.endsWith('\n')).toBe(true);
    expect(line).toContain('\\n');
  });

  it('回车与制表符被转义', () => {
    const line = encodeRequest({ title: 'a\rb\tc' }, 'tok');
    expect(line).toContain('\\r');
    expect(line).toContain('\\t');
  });

  it('控制字符被转义为 \\u 形式', () => {
    const line = encodeRequest({ title: '\u0001' }, 'tok');
    expect(line).toContain('\\u0001');
  });

  it('数字、布尔、nil 直出', () => {
    const line = encodeRequest({ n: 3, flag: true, empty: null }, 'tok');
    expect(line).toContain(':n 3');
    expect(line).toContain(':flag true');
    expect(line).toContain(':empty nil');
  });

  it('EdnSymbol 编码为关键词而非字符串', () => {
    const line = encodeRequest({ kind: ednKeyword('send-message') }, 'tok');
    expect(line).toContain(':kind :send-message');
    expect(line).not.toContain('"send-message"');
  });

  it('带命名空间的关键词完整编码', () => {
    const line = encodeRequest({ kind: ednKeyword('session/create') }, 'tok');
    expect(line).toContain(':kind :session/create');
  });

  it('非法关键词名抛 UNSUPPORTED_VALUE', () => {
    expect(() => ednKeyword('has space')).toThrowError(LoopbackError);
    expect(() => ednKeyword('')).toThrowError(LoopbackError);
  });

  it('嵌套 map 与数组递归编码', () => {
    const line = encodeRequest({ payload: { kind: 'session/create' }, list: [1, 2] }, 'tok');
    expect(line).toContain(':payload {:kind "session/create"}');
    expect(line).toContain(':list [1 2]');
  });

  it('非有限数字抛 UNSUPPORTED_VALUE', () => {
    expect(() => encodeRequest({ bad: Number.NaN }, 'tok')).toThrowError(LoopbackError);
  });

  it('不支持的值类型抛 UNSUPPORTED_VALUE', () => {
    try {
      encodeRequest({ bad: () => 1 }, 'tok');
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as LoopbackError).code).toBe('UNSUPPORTED_VALUE');
    }
  });

  it('编码结果可被 parseEdn 原样解析回来', () => {
    const line = encodeRequest({ op: 'command', payload: { title: 'a"b\nc' } }, 'tok');
    const parsed = parseEdn(line.trim());
    expect(parsed).toEqual({
      op: 'command',
      payload: { title: 'a"b\nc' },
      token: 'tok',
    });
  });
});

describe('parseReply', () => {
  it('解析成功回复', () => {
    const reply = parseReply('{:ok? true, :pid 36082, :url "http://127.0.0.1:62639/"}');
    expect(reply.ok).toBe(true);
  });

  it('解析失败回复的 code 与 message', () => {
    const reply = parseReply(
      '{:ok? false, :error {:code :SINGLETON_UNAUTHORIZED, :message "control token mismatch"}}',
    );
    expect(reply.ok).toBe(false);
    expect(reply.code).toBe('SINGLETON_UNAUTHORIZED');
    expect(reply.message).toBe('control token mismatch');
  });

  it('message 含转义引号时完整保留，不被截断', () => {
    const reply = parseReply('{:ok? false, :error {:code :X, :message "say \\"hi\\""}}');
    expect(reply.message).toBe('say "hi"');
  });

  // —— 假绿路径：这些输入曾因正则扫描被误判为成功 ——

  it('ok? 为 true 但同时带 error 时仍按顶层 ok? 判真（协议如此）', () => {
    const reply = parseReply('{:ok? true, :error {:code :X}}');
    expect(reply.ok).toBe(true);
  });

  it('顶层 ok? 为 false 而嵌套 map 里有 ok? true 时判假', () => {
    const reply = parseReply('{:error {:ok? true}, :ok? false}');
    expect(reply.ok).toBe(false);
  });

  it('ok? 值非布尔时抛 BAD_REPLY，不猜真', () => {
    expect(() => parseReply('{:ok? trueish}')).toThrowError(LoopbackError);
  });

  it('截断行抛 BAD_REPLY', () => {
    expect(() => parseReply('{:ok? true')).toThrowError(LoopbackError);
  });

  it('缺少顶层 ok? 时抛 BAD_REPLY', () => {
    expect(() => parseReply('{:pid 1}')).toThrowError(LoopbackError);
  });

  it('非 map 回复抛 BAD_REPLY', () => {
    expect(() => parseReply('not-a-map')).toThrowError(LoopbackError);
  });
});

describe('sendControlRequest', () => {
  it('投递请求并收到成功回复', async () => {
    const { port, received } = await startFakeServer(() => '{:ok? true, :pid 1, :sessions 2}');
    const reply = await sendControlRequest({ port, token: 'tok' }, { op: 'ping' });
    expect(reply.ok).toBe(true);
    expect(received[0]).toContain(':op "ping"');
    expect(received[0]).toContain(':token "tok"');
  });

  it('服务端不回行直接关连接时抛 EMPTY_REPLY', async () => {
    const { port } = await startFakeServer(() => null);
    await expect(
      sendControlRequest({ port, token: 'tok' }, { op: 'ping' }),
    ).rejects.toMatchObject({ code: 'EMPTY_REPLY' });
  });

  it('端口无人监听时抛 UNREACHABLE', async () => {
    const { port } = await startFakeServer(() => '{:ok? true}');
    const server = servers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await expect(
      sendControlRequest({ port, token: 'tok' }, { op: 'ping' }, { timeoutMs: 2000 }),
    ).rejects.toMatchObject({ code: 'UNREACHABLE' });
  });

  it('服务端迟迟不回行时抛 TIMEOUT', async () => {
    // 收到请求后既不回行也不关连接，模拟实例卡住
    const server = createServer((socket: Socket) => {
      socket.on('data', () => {
        /* 故意不回复 */
      });
    });
    servers.push(server);
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('假服务端未能取得端口'));
      });
    });
    await expect(
      sendControlRequest({ port, token: 'tok' }, { op: 'ping' }, { timeoutMs: 150 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('回复超过上限时抛 REPLY_TOO_LARGE', async () => {
    const huge = `{:ok? true, :pad "${'x'.repeat(1024 * 1024 + 1)}"}`;
    const { port } = await startFakeServer(() => huge);
    await expect(
      sendControlRequest({ port, token: 'tok' }, { op: 'ping' }),
    ).rejects.toMatchObject({ code: 'REPLY_TOO_LARGE' });
  });

  it('回复为畸形 EDN 时抛 BAD_REPLY', async () => {
    const { port } = await startFakeServer(() => '{:ok? tru');
    await expect(
      sendControlRequest({ port, token: 'tok' }, { op: 'ping' }),
    ).rejects.toMatchObject({ code: 'BAD_REPLY' });
  });
});

describe('probeInstance', () => {
  it('没有 endpoint 文件时返回 null', async () => {
    expect(await probeInstance({ tmpDir: makeTempDir(), userName: 'u' })).toBeNull();
  });

  it('endpoint 存在但实例不可达时返回 null', async () => {
    const options = writeEndpointFile('{:port 1, :token "tok"}');
    expect(await probeInstance({ ...options, timeoutMs: 500 })).toBeNull();
  });

  it('endpoint 存在且 ping 成功时返回 endpoint', async () => {
    const { port } = await startFakeServer(() => '{:ok? true, :pid 1}');
    const options = writeEndpointFile(`{:port ${port}, :token "tok", :pid 1}`);
    expect(await probeInstance(options)).toEqual({ port, token: 'tok', pid: 1 });
  });

  it('ping 回复 ok? false 时返回 null', async () => {
    const { port } = await startFakeServer(() =>
      '{:ok? false, :error {:code :SINGLETON_UNAUTHORIZED}}',
    );
    const options = writeEndpointFile(`{:port ${port}, :token "tok"}`);
    expect(await probeInstance(options)).toBeNull();
  });

  it('ping 回复畸形时返回 null，不误判为可用', async () => {
    const { port } = await startFakeServer(() => '{:ok? trueish}');
    const options = writeEndpointFile(`{:port ${port}, :token "tok"}`);
    expect(await probeInstance(options)).toBeNull();
  });

  it('token 含转义引号时仍能正常鉴权', async () => {
    const { port, received } = await startFakeServer((line) =>
      line.includes(':token "a\\"b"') ? '{:ok? true}' : '{:ok? false, :error {:code :BAD}}',
    );
    const options = writeEndpointFile(`{:port ${port}, :token "a\\"b"}`);
    expect(await probeInstance(options)).toEqual({ port, token: 'a"b' });
    expect(received[0]).toContain(':token "a\\"b"');
  });
});

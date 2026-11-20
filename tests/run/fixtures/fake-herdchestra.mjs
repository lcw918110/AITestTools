/**
 * 假 Herdchestra 实例：用于端到端冒烟测试。
 *
 * 目的不是模拟模型能力，而是验证评测链路本身——真实启动子进程、写
 * `instance.edn`、走 TCP 控制通道、真的改工作区文件、真的断电退出。这条链路
 * 上任何一环（握手、基线、diff、断言、清理）出问题，测试都会红。
 *
 * 脚本契约与真实实例对齐：
 * - 由 `options.command` 拉起，参数里带 `--data-dir` / `--workspace-root` / `--port`；
 * - 就绪后把 `instance.edn` 写进 `--endpoint-dir`（父进程据此探测）；
 * - 只接受带正确 token 的请求；
 * - `:command` 后改工作区文件，再把回复写进 `:history/messages`。
 *
 * 行为开关由环境变量控制，便于在同一个脚本里造出各种失败场景：
 * - `FAKE_SUT_WRITE`：写进工作区的文件名（默认 `out.txt`）
 * - `FAKE_SUT_CONTENT`：写入内容（默认 `hello world`）
 * - `FAKE_SUT_REPLY`：助手回复正文
 * - `FAKE_SUT_MODE`：`ok`（默认）/ `no_reply`（只收命令不回复）/ `silent`（不写 instance.edn）
 */
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 从 argv 里取 `--key value` 形式的参数。 */
function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined ? null : value;
}

const mode = process.env.FAKE_SUT_MODE ?? 'ok';
const workspaceRoot = argValue('workspace-root');
const endpointDir = argValue('endpoint-dir');
const dataDir = argValue('data-dir');
const token = 'fake-token-for-test';

if (workspaceRoot === null) {
  process.stderr.write('假实例缺少 --workspace-root\n');
  process.exit(2);
}
if (endpointDir === null) {
  process.stderr.write('假实例缺少 --endpoint-dir\n');
  process.exit(2);
}

// 与真实实例一致：data/ 与 work/ 都在 rootDir 下，测试要验证工作区基线不受
// 实例自身初始化干扰，故这里也真的建出 data 目录。
if (dataDir !== null) mkdirSync(dataDir, { recursive: true });
mkdirSync(workspaceRoot, { recursive: true });
mkdirSync(endpointDir, { recursive: true });

// 启动时预置文件：用来验证「原本就存在的文件被修改」记为 modified 而不是 added。
// 这个写入发生在基线快照之前，所以不会被算进本轮产出。
if (process.env.FAKE_SUT_SEED !== undefined) {
  const seedName = process.env.FAKE_SUT_WRITE ?? 'out.txt';
  writeFileSync(join(resolve(workspaceRoot), seedName), process.env.FAKE_SUT_SEED);
}

/** 极简 EDN 值编码：只支持字符串、数字、布尔与简单数组/对象。 */
function encodeEdn(value) {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'nil';
  if (typeof value === 'string') {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  if (Array.isArray(value)) return `[${value.map(encodeEdn).join(' ')}]`;
  const parts = Object.entries(value).map(([key, item]) => `:${key} ${encodeEdn(item)}`);
  return `{${parts.join(', ')}}`;
}

/**
 * 极简 EDN 解析器：支持 map、vector、字符串、关键词、数字、布尔、nil。
 *
 * 用递归解析而不是正则扫描：`{:payload {:kind :send-message …}}` 是嵌套结构，
 * 正则会把内层的键当成外层的，导致命令类型判断错位。
 */
function parseEdn(text) {
  let pos = 0;

  function skipWhitespace() {
    while (pos < text.length && /[\s,]/.test(text[pos])) pos += 1;
  }

  function readString() {
    pos += 1; // 开头的引号
    let out = '';
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === '\\') {
        const next = text[pos + 1];
        if (next === 'n') out += '\n';
        else if (next === 'r') out += '\r';
        else if (next === 't') out += '\t';
        else if (next === '"') out += '"';
        else if (next === '\\') out += '\\';
        else if (next === 'u') {
          out += String.fromCharCode(parseInt(text.slice(pos + 2, pos + 6), 16));
          pos += 4;
        } else out += next ?? '';
        pos += 2;
        continue;
      }
      if (ch === '"') {
        pos += 1;
        return out;
      }
      out += ch;
      pos += 1;
    }
    return out;
  }

  function readToken() {
    const start = pos;
    while (pos < text.length && !/[\s,\]}()]/.test(text[pos])) pos += 1;
    return text.slice(start, pos);
  }

  function readValue() {
    skipWhitespace();
    const ch = text[pos];
    if (ch === '{') {
      pos += 1;
      const map = {};
      for (;;) {
        skipWhitespace();
        if (text[pos] === '}') {
          pos += 1;
          return map;
        }
        if (pos >= text.length) return map;
        const keyRaw = readToken();
        const key = keyRaw.replace(/^:/, '');
        map[key] = readValue();
      }
    }
    if (ch === '[') {
      pos += 1;
      const arr = [];
      for (;;) {
        skipWhitespace();
        if (text[pos] === ']') {
          pos += 1;
          return arr;
        }
        if (pos >= text.length) return arr;
        arr.push(readValue());
      }
    }
    if (ch === '"') return readString();
    const token = readToken();
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'nil') return null;
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    return token;
  }

  return readValue();
}

/** 解析请求行；解析不出来返回 null。 */
function parseRequest(line) {
  const text = line.trim();
  if (!text.startsWith('{')) return null;
  try {
    const parsed = parseEdn(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** 每个会话的消息列表；`create-session` 时建空数组。 */
const messagesBySession = new Map();
let sessionCounter = 0;

function makeEndpointPayload(port) {
  return {
    port,
    token,
    pid: process.pid,
    'started-at': new Date().toISOString(),
  };
}

const sockets = new Set();

const server = createServer((socket) => {
  sockets.add(socket);
  socket.setEncoding('utf8');
  let buffer = '';

  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => sockets.delete(socket));

  socket.on('data', (chunk) => {
    buffer += chunk;

    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim().length === 0) continue;

      const request = parseRequest(line);
      if (request === null) {
        socket.write(`${encodeEdn({ 'ok?': false, code: 'BAD_REQUEST' })}\n`);
        continue;
      }
      // token 不对一律拒绝，与真实实例的安全语义一致
      if (request.token !== token) {
        socket.write(`${encodeEdn({ 'ok?': false, code: 'UNAUTHORIZED' })}\n`);
        continue;
      }

      const op = request.op?.replace(/^:/, '');
      const reply = handleRequest(op, request);
      socket.write(`${encodeEdn(reply)}\n`);
    }
  });
});

function handleRequest(op, request) {
  if (op === 'ping') {
    return { 'ok?': true };
  }

  if (op === 'create-session') {
    sessionCounter += 1;
    const sessionId = `fake-session-${sessionCounter}`;
    messagesBySession.set(sessionId, []);
    return { 'ok?': true, value: { 'session-id': sessionId } };
  }

  if (op === 'focus-or-create') {
    const existing = [...messagesBySession.keys()][0];
    if (existing !== undefined) return { 'ok?': true, value: { 'active-session-id': existing } };
    sessionCounter += 1;
    const sessionId = `fake-session-${sessionCounter}`;
    messagesBySession.set(sessionId, []);
    return { 'ok?': true, value: { 'active-session-id': sessionId } };
  }

  if (op === 'command') {
    // 真实形状是嵌套的：`{:op :command, :payload {:kind :send-message, …}}`。
    // 读历史也是走这条路（payload 的 kind 为 `history/messages`），不是独立 op。
    const payload = request.payload ?? {};
    const kind = String(payload.kind ?? request.kind ?? '').replace(/^:/, '');
    const sessionId = payload['session-id'] ?? request['session-id'];
    if (kind === 'history/messages') {
      return readHistory(sessionId);
    }
    if (kind !== 'send-message') {
      return {
        'ok?': false,
        code: 'UNSUPPORTED_COMMAND_KIND',
        message: `假实例不支持的命令：${kind}`,
      };
    }

    const sessionMessages = sessionId !== undefined ? messagesBySession.get(sessionId) : undefined;
    if (sessionMessages === undefined) {
      return { 'ok?': false, code: 'SESSION_NOT_FOUND', message: `未知会话：${String(sessionId)}` };
    }

    if (mode === 'no_reply') {
      // 只收不回：专门用来验证「模型没产出」不会被误判成通过
      return { 'ok?': true, receipt: { status: ':accepted', 'session-id': sessionId } };
    }

    // 真的改工作区文件——这是端到端测试的核心：判据必须来自磁盘事实
    const writeName = process.env.FAKE_SUT_WRITE ?? 'out.txt';
    const content = process.env.FAKE_SUT_CONTENT ?? 'hello world';
    const target = join(resolve(workspaceRoot), writeName);
    if (process.env.FAKE_SUT_APPEND === '1' && existsSync(target)) {
      // 追加模式：用来验证「已有文件被修改」记为 modified 而不是 added
      writeFileSync(target, `${readFileSync(target, 'utf8')}${content}`);
    } else {
      writeFileSync(target, content);
    }

    const replyText = process.env.FAKE_SUT_REPLY ?? '已完成';
    sessionMessages.push({
      role: ':user',
      'message-id': `user-${sessionMessages.length + 1}`,
      content: payload.text ?? '',
    });
    sessionMessages.push({
      role: ':assistant',
      'message-id': `assistant-${sessionMessages.length + 1}`,
      content: replyText,
    });

    return { 'ok?': true, receipt: { status: ':accepted', 'session-id': sessionId } };
  }

  return { 'ok?': false, code: 'UNKNOWN_OP', message: `不支持的操作：${String(op)}` };
}

/** 读会话历史：回复形状与真实实例一致（`receipt.messages`）。 */
function readHistory(sessionId) {
  const sessionMessages = sessionId !== undefined ? messagesBySession.get(sessionId) : undefined;
  if (sessionMessages === undefined) {
    return { 'ok?': false, code: 'SESSION_NOT_FOUND', message: `未知会话：${String(sessionId)}` };
  }
  return {
    'ok?': true,
    receipt: { status: ':accepted', 'session-id': sessionId, messages: sessionMessages },
  };
}

/** 收尾：清 socket、删 instance.edn（真实实例 `release!` 的等价行为）。 */
function shutdown() {
  for (const socket of sockets) socket.destroy();
  try {
    rmSync(join(endpointDir, 'instance.edn'), { force: true });
  } catch {
    /* 删除失败不影响退出 */
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  if (mode === 'silent') {
    // 不写 instance.edn：验证「实例永远不就绪」会被如实超时，而不是卡死或假绿
    return;
  }
  writeFileSync(join(endpointDir, 'instance.edn'), `${encodeEdn(makeEndpointPayload(port))}\n`);
});

import { existsSync, readFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { connect, type Socket } from 'node:net';

/**
 * Herdchestra loopback 控制通道客户端（12 §6 D4）。
 *
 * 协议：TCP + EDN 行协议，请求与回复均为单行 EDN map；请求必须带 `:token`。
 * endpoint 文件：`<java.io.tmpdir>/herdchestra-<user>/instance.edn`，含 `:port` `:token` `:pid`。
 *
 * 本模块只做「连上并投递一条指令」，不负责启动实例——实例生命周期由
 * `LoopbackTransport.open()` 的调用方在同一进程内持有子进程句柄。
 *
 * 编解码刻意不引第三方 EDN 库：协议面只有「扁平 map + 字符串/数字/布尔/
 * 关键词/嵌套 map」这几种形态，自带一个最小解析器比多一个依赖更可控，
 * 且能精确控制「畸形输入一律拒绝」的边界——这正是判活可靠性的前提。
 */

/** endpoint 状态（对应 `instance.edn` 的字段）。 */
export interface LoopbackEndpoint {
  port: number;
  token: string;
  pid?: number;
}

/** 控制通道回复。成功时 `ok` 为 `true`，失败时带 `code` / `message`。 */
export interface LoopbackReply {
  ok: boolean;
  code?: string;
  message?: string;
  value: EdnValue;
}

/** 控制通道错误：区分「连不上」「鉴权失败」「协议不符」，便于归因。 */
export class LoopbackError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LoopbackError';
    this.code = code;
  }
}

/** 最小 EDN 值域：够表达控制通道的请求与回复。 */
export type EdnValue =
  | string
  | number
  | boolean
  | null
  | EdnKeyword
  | EdnValue[]
  | { [key: string]: EdnValue };

/** EDN 关键词，保留为带前缀的字符串以便区分 `"ping"` 与 `:ping`。 */
export type EdnKeyword = `:${string}`;

/** 单次请求超时（毫秒）。与 Herdchestra 侧 `setSoTimeout 15000` 对齐。 */
const REQUEST_TIMEOUT_MS = 15000;

/** 单行回复上限，与 Herdchestra 侧 `max-line-chars` 对齐。 */
const MAX_LINE_CHARS = 1024 * 1024;

/**
 * 计算 endpoint 目录，与 `singleton.clj` 的 `default-dir` 保持一致：
 * `java.io.tmpdir` + `herdchestra-` + 用户名（非 `[A-Za-z0-9._-]` 替换为 `_`）。
 *
 * 注意：Java 的 `java.io.tmpdir` 在 macOS 上带结尾分隔符，Node 的 `tmpdir()`
 * 不带；`join` 会归一化，故二者结果一致。
 */
export function resolveEndpointDir(
  options: { tmpDir?: string; userName?: string } = {},
): string {
  const base = options.tmpDir ?? tmpdir();
  const rawUser = options.userName ?? userInfo().username;
  const safeUser = rawUser.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(base, `herdchestra-${safeUser}`);
}

/** endpoint 文件路径。 */
export function resolveEndpointPath(options: { tmpDir?: string; userName?: string } = {}): string {
  return join(resolveEndpointDir(options), 'instance.edn');
}

/**
 * 解析 `instance.edn` 文本。
 *
 * 走完整 EDN 解析而非正则扫描：token 由 `pr-str` 写出，可能含 `\"` 转义，
 * 正则 `[^"]+` 会在第一个 `\"` 处截断；且正则无锚点，`:started-at` 之类
 * 字符串里若出现 `:port 1234` 会被误取。缺任一必需字段视为无效，返回
 * `null`（与 `singleton/read-state` 同口径）。
 */
export function parseEndpointState(text: string): LoopbackEndpoint | null {
  let parsed: EdnValue;
  try {
    parsed = parseEdn(text);
  } catch {
    return null;
  }
  if (!isEdnMap(parsed)) return null;

  const port = parsed.port;
  const token = parsed.token;
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  if (typeof token !== 'string' || token.length === 0) return null;

  const endpoint: LoopbackEndpoint = { port, token };
  const pid = parsed.pid;
  if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) endpoint.pid = pid;
  return endpoint;
}

/**
 * 读取 endpoint 状态。
 *
 * 三条硬约束之一：进程退出时 Herdchestra 会删除 `instance.edn`，故
 * 「文件不存在」等价于「没有可用实例」，返回 `null` 而不是抛错。
 */
export function readEndpointState(
  options: { tmpDir?: string; userName?: string } = {},
): LoopbackEndpoint | null {
  const path = resolveEndpointPath(options);
  if (!existsSync(path)) return null;
  try {
    return parseEndpointState(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** 把请求 map 序列化为单行 EDN。只支持本模块用到的值类型。 */
export function encodeRequest(request: Record<string, unknown>, token: string): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(request)) {
    parts.push(`:${key} ${encodeEdnValue(value)}`);
  }
  parts.push(`:token ${encodeEdnValue(token)}`);
  return `{${parts.join(', ')}}\n`;
}

/**
 * EDN 值编码。
 *
 * 字符串必须转义换行与其它控制字符：协议按行切分，裸换行会提前终止该行，
 * 剩余内容被服务端当成下一条请求解析——这构成请求注入。
 */
function encodeEdnValue(value: unknown): string {
  if (typeof value === 'string') return encodeEdnString(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new LoopbackError('UNSUPPORTED_VALUE', `控制通道不接受非有限数字：${String(value)}`);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'nil';
  if (isEdnSymbol(value)) return value.name;
  if (Array.isArray(value)) {
    return `[${value.map((item) => encodeEdnValue(item)).join(' ')}]`;
  }
  if (typeof value === 'object') {
    // 只把「普通对象」当 map 编码：Map/Set/Date/类实例一律拒绝，
    // 否则它们会被静默序列化成看似合法的 map 发给服务端。
    if (!isPlainObject(value)) {
      throw new LoopbackError(
        'UNSUPPORTED_VALUE',
        `控制通道请求不支持该对象类型：${value.constructor?.name ?? '未知'}`,
      );
    }
    const entries = Object.entries(value).map(
      ([key, item]) => `:${key} ${encodeEdnValue(item)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  throw new LoopbackError('UNSUPPORTED_VALUE', `控制通道请求不支持该值类型：${typeof value}`);
}

/** 判断是否为普通对象（原型为 Object 或 null）。 */
function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * EDN 关键词值。
 *
 * 控制通道的 `:kind` 等字段要求关键词（`:send-message`），字符串
 * `"send-message"` 会被服务端拒绝为 `COMMAND_KIND_REQUIRED`。
 *
 * 用显式类型区分，并携带一个稳定的标记字段：只靠 `instanceof` 会在
 * `structuredClone` / JSON 往返 / 跨 realm 后失效，届时关键词会退化成普通
 * 对象被编码成 `{:name ":send-message"}`，服务端同样拒绝且难以定位。
 */
export class EdnSymbol {
  /** 稳定标记，供 `isEdnSymbol` 在 `instanceof` 失效时识别。 */
  readonly __ednSymbol = true;
  readonly name: `:${string}`;

  constructor(name: string) {
    if (!/^[A-Za-z][A-Za-z0-9/*_-]*(\/[A-Za-z][A-Za-z0-9/*_-]*)?$/.test(name)) {
      throw new LoopbackError('UNSUPPORTED_VALUE', `非法的 EDN 关键词名：${name}`);
    }
    this.name = `:${name}`;
  }
}

/** 造一个 EDN 关键词值。 */
export function ednKeyword(name: string): EdnSymbol {
  return new EdnSymbol(name);
}

/** 判断是否为 EDN 关键词值，兼容 `instanceof` 失效的场景。 */
function isEdnSymbol(value: unknown): value is EdnSymbol {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value instanceof EdnSymbol ||
      ((value as { __ednSymbol?: unknown }).__ednSymbol === true &&
        typeof (value as { name?: unknown }).name === 'string'))
  );
}

/** EDN 字符串字面量编码，含全部控制字符转义。 */
export function encodeEdnString(text: string): string {
  let escaped = '';
  for (const char of text) {
    switch (char) {
      case '\\':
        escaped += '\\\\';
        break;
      case '"':
        escaped += '\\"';
        break;
      case '\n':
        escaped += '\\n';
        break;
      case '\r':
        escaped += '\\r';
        break;
      case '\t':
        escaped += '\\t';
        break;
      case '\f':
        escaped += '\\f';
        break;
      case '\b':
        escaped += '\\b';
        break;
      default: {
        // 协议按行切分，其余控制字符也必须转义，否则会截断该行并注入下一条请求。
        const code = char.codePointAt(0) ?? 0;
        escaped += code < 0x20 || code === 0x7f
          ? `\\u${code.toString(16).padStart(4, '0')}`
          : char;
      }
    }
  }
  return `"${escaped}"`;
}

/**
 * 解析回复的单行 EDN。
 *
 * 必须走完整解析：用正则扫 `:ok?` 会把 `{:ok? true, :error {...}}`、
 * `{:error {:ok? true}, :ok? false}`、截断行 `{:ok? true` 全部判成成功，
 * 导致 `probeInstance` 把鉴权失败或畸形回复当成「实例可用」。
 */
export function parseReply(line: string): LoopbackReply {
  const trimmed = line.trim();
  let parsed: EdnValue;
  try {
    parsed = parseEdn(trimmed);
  } catch (error) {
    throw new LoopbackError(
      'BAD_REPLY',
      `控制通道回复不是合法 EDN：${(error as Error).message}；原文：${trimmed.slice(0, 200)}`,
    );
  }
  if (!isEdnMap(parsed)) {
    throw new LoopbackError('BAD_REPLY', `控制通道回复不是 EDN map：${trimmed.slice(0, 200)}`);
  }

  // 顶层 :ok? 必须是布尔；缺失或非布尔一律视为协议不符，不猜。
  const ok = parsed['ok?'];
  if (typeof ok !== 'boolean') {
    throw new LoopbackError(
      'BAD_REPLY',
      `控制通道回复缺少布尔型顶层 :ok? 字段：${trimmed.slice(0, 200)}`,
    );
  }

  const reply: LoopbackReply = { ok, value: parsed };
  if (!ok) {
    const error = parsed.error;
    if (isEdnMap(error)) {
      const code = error.code;
      if (typeof code === 'string' && code.startsWith(':')) {
        reply.code = code.slice(1);
      }
      const message = error.message;
      if (typeof message === 'string') reply.message = message;
    }
  }
  return reply;
}

/** 判断是否为 EDN map。 */
function isEdnMap(value: unknown): value is { [key: string]: EdnValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 最小 EDN 解析器：支持 map / vector / list / string / number / boolean / nil / keyword。
 *
 * 严格模式——尾部有多余内容、字符串未闭合、map 键非关键词等一律抛错，
 * 让「畸形回复」显式失败而不是被宽松解析成看似合理的值。
 */
export function parseEdn(text: string): EdnValue {
  const parser = new EdnParser(text);
  const value = parser.readValue();
  parser.expectEnd();
  return value;
}

class EdnParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  readValue(): EdnValue {
    this.skipWhitespace();
    const char = this.text[this.pos];
    if (char === undefined) throw new Error('输入意外结束');

    if (char === '{') return this.readMap();
    if (char === '[') return this.readVector(']');
    if (char === '(') return this.readVector(')');
    if (char === '"') return this.readString();
    if (char === ':') return this.readKeyword();
    return this.readAtom();
  }

  expectEnd(): void {
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      throw new Error(`第 ${this.pos} 字符处存在多余内容`);
    }
  }

  private readMap(): { [key: string]: EdnValue } {
    this.pos += 1; // 跳过 {
    const result: { [key: string]: EdnValue } = {};
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] === '}') {
        this.pos += 1;
        return result;
      }
      if (this.pos >= this.text.length) throw new Error('map 未闭合');

      const key = this.readValue();
      if (typeof key !== 'string' || !key.startsWith(':')) {
        throw new Error(`map 的键必须是关键词，实际为 ${JSON.stringify(key)}`);
      }
      const value = this.readValue();
      result[key.slice(1)] = value;
    }
  }

  private readVector(closer: string): EdnValue[] {
    this.pos += 1;
    const result: EdnValue[] = [];
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] === closer) {
        this.pos += 1;
        return result;
      }
      if (this.pos >= this.text.length) throw new Error('序列未闭合');
      result.push(this.readValue());
    }
  }

  private readString(): string {
    this.pos += 1; // 跳过开引号
    let result = '';
    for (;;) {
      const char = this.text[this.pos];
      if (char === undefined) throw new Error('字符串未闭合');
      this.pos += 1;
      if (char === '"') return result;
      if (char !== '\\') {
        result += char;
        continue;
      }
      const escape = this.text[this.pos];
      if (escape === undefined) throw new Error('字符串转义未完成');
      this.pos += 1;
      switch (escape) {
        case 'n':
          result += '\n';
          break;
        case 'r':
          result += '\r';
          break;
        case 't':
          result += '\t';
          break;
        case 'f':
          result += '\f';
          break;
        case 'b':
          result += '\b';
          break;
        case '\\':
          result += '\\';
          break;
        case '"':
          result += '"';
          break;
        case 'u': {
          const hex = this.text.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('\\u 转义需要 4 位十六进制');
          result += String.fromCharCode(Number.parseInt(hex, 16));
          this.pos += 4;
          break;
        }
        default:
          throw new Error(`不支持的转义字符 \\${escape}`);
      }
    }
  }

  private readKeyword(): EdnKeyword {
    const start = this.pos;
    this.pos += 1; // 跳过 :
    while (this.pos < this.text.length && !isDelimiter(this.text[this.pos] as string)) {
      this.pos += 1;
    }
    const keyword = this.text.slice(start, this.pos);
    if (keyword.length === 1) throw new Error('关键词缺少名称');
    return keyword as EdnKeyword;
  }

  private readAtom(): EdnValue {
    const start = this.pos;
    while (this.pos < this.text.length && !isDelimiter(this.text[this.pos] as string)) {
      this.pos += 1;
    }
    const token = this.text.slice(start, this.pos);
    if (token === '') throw new Error(`第 ${start} 字符处无法解析`);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'nil') return null;

    const number = Number(token);
    if (Number.isFinite(number) && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(token)) {
      return number;
    }
    throw new Error(`不支持的原子值：${token}`);
  }

  private skipWhitespace(): void {
    for (;;) {
      const char = this.text[this.pos];
      if (char === undefined) return;
      if (char === ',' || /\s/.test(char)) {
        this.pos += 1;
        continue;
      }
      return;
    }
  }
}

/** EDN 分隔符：空白、逗号与各类括号。 */
function isDelimiter(char: string): boolean {
  return char === ',' || /[\s{}[\]()"]/.test(char);
}

/**
 * 向 endpoint 投递一次请求并读取单行回复。
 *
 * 每次请求独立建连（与 Herdchestra 侧 `send-request!` 一致），不做连接复用：
 * 控制通道是低频短请求，复用带来的生命周期复杂度不值得。
 */
export async function sendControlRequest(
  endpoint: LoopbackEndpoint,
  request: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<LoopbackReply> {
  const payload = encodeRequest(request, endpoint.token);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return await new Promise<LoopbackReply>((resolve, reject) => {
    const socket: Socket = connect({ host: '127.0.0.1', port: endpoint.port });
    let buffer = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.write(payload, (error) => {
        if (error) {
          finish(() =>
            reject(new LoopbackError('UNREACHABLE', `控制通道写入失败：${error.message}`)),
          );
        }
      });
    });

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE_CHARS) {
        finish(() => reject(new LoopbackError('REPLY_TOO_LARGE', '控制通道回复超过上限')));
        return;
      }
      const newlineAt = buffer.indexOf('\n');
      if (newlineAt < 0) return;
      const line = buffer.slice(0, newlineAt);
      finish(() => {
        try {
          resolve(parseReply(line));
        } catch (error) {
          reject(error);
        }
      });
    });

    socket.on('timeout', () => {
      finish(() =>
        reject(new LoopbackError('TIMEOUT', `控制通道请求超时（${timeoutMs}ms）`)),
      );
    });

    socket.on('error', (error: Error) => {
      finish(() =>
        reject(new LoopbackError('UNREACHABLE', `控制通道不可达：${error.message}`)),
      );
    });

    socket.on('close', () => {
      // 服务端未回行就关连接（`singleton.clj` 的 `SINGLETON_EMPTY_REPLY`）。
      finish(() =>
        reject(new LoopbackError('EMPTY_REPLY', '控制通道在回复前关闭了连接')),
      );
    });
  });
}

/**
 * 探测实例是否可用。
 *
 * 三条硬约束之一：不能只看 `instance.edn` 是否存在——进程崩溃时文件可能
 * 残留，故必须实际 `:ping` 一次。返回 `null` 表示没有可用实例。
 */
export async function probeInstance(
  options: { tmpDir?: string; userName?: string; timeoutMs?: number } = {},
): Promise<LoopbackEndpoint | null> {
  const endpoint = readEndpointState(options);
  if (!endpoint) return null;
  try {
    const reply = await sendControlRequest(endpoint, { op: 'ping' }, options);
    return reply.ok ? endpoint : null;
  } catch {
    return null;
  }
}

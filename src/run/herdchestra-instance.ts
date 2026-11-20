import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import {
  LoopbackError,
  ednKeyword,
  encodeEdnString,
  probeInstance,
  readEndpointState,
  resolveEndpointDir,
  sendControlRequest,
  type EdnSymbol,
  type LoopbackEndpoint,
  type LoopbackReply,
} from './loopback-transport.ts';

/**
 * Herdchestra 实例生命周期管理（12 §6 D4「每 case 一实例」）。
 *
 * 与 `loopback-transport.ts` 的分工：那边只管「怎么连、怎么收发」，这边管
 * 「怎么起、怎么等、怎么关」。分开的理由是前者可纯单测，后者必然依赖
 * 真实子进程，测试成本完全不同。
 *
 * 三条硬约束在这里的具体落法：
 *
 * 1. **孤儿看门狗**：`spawn` 由调用方（Node 主进程）持有，不 detach、不 unref，
 *    子进程的父进程始终存活，看门狗不会触发。
 * 2. **单例锁**：起之前先 `:ping` 探测。已有实例存活说明上一个 case 没清理干净，
 *    直接报错而不是抢锁——抢锁会让两个 case 的结果混在一起。
 * 3. **退出即删 state**：`stop()` 必须等 `exit` 事件，不能发完信号就删目录，
 *    否则 Datalevin 的 LMDB 锁文件可能残留。
 */

/**
 * 生成 Herdchestra 的 `config.edn`：只声明模型连接，其余用默认值。
 *
 * 连接里的 `:models` 是**对象数组**而不是字符串数组，每个对象要有 `:id`
 * （被 `:roles` 引用的逻辑名）、`:model-name`（真正发给端点的名字）与
 * `:capabilities`。漏声明 `:tools` 会让 Herdchestra 以
 * `MODEL_TOOLS_UNAVAILABLE` 拒绝投递——它要求模型能调用工具才能执行任务。
 *
 * EDN 字符串必须转义反斜杠与双引号，否则 base-url 里带特殊字符时会写出语法
 * 错误的文件，实例直接起不来。
 */
export function renderModelConfig(model: HerdchestraModelConfig): string {
  const connectionId = model.connectionId ?? 'eval';
  const modelId = model.modelId ?? 'main';
  const timeoutMs = model.timeoutMs ?? 180000;
  const connection = [
    `{:id ${encodeEdnString(connectionId)}`,
    ':name "评测用连接"',
    ':kind :openai-compatible',
    `:base-url ${encodeEdnString(model.baseUrl)}`,
    `:api-key ${encodeEdnString(model.apiKey)}`,
    `:timeout-ms ${timeoutMs}`,
    ':enabled? true',
    `:models [{:id ${encodeEdnString(modelId)}`,
    `          :model-name ${encodeEdnString(model.model)}`,
    '          :capabilities #{:tools :streaming}}]}',
  ].join('\n   ');
  const roles = `{:main {:connection ${encodeEdnString(connectionId)} :model ${encodeEdnString(modelId)}}}`;
  return `{:models {:connections [\n   ${connection}]\n :roles ${roles}}}\n`;
}

/** 启动配置。字段与 Herdchestra 命令行参数一一对应。 */
export interface HerdchestraLaunchOptions {
  /** 仓库根目录（`clojure` 可执行文件与 `deps.edn` 所在处）。 */
  repoRoot: string;
  /** 本次实例独占的根目录，其下建 `data/` 与 `work/`。 */
  rootDir: string;
  /** 启动命令，默认直接调 pixi 环境里的 clojure，绕过 `pixi run` 包装。 */
  command?: string;
  /** 启动参数前缀，默认 `['-M:server', '-m', 'hc.server.app']`。 */
  commandArgs?: string[];
  /** 额外命令行参数（如 `--model-stream? false`），追加在默认参数之后。 */
  extraArgs?: string[];
  /** 等待 endpoint 就绪的超时（毫秒）。默认 120000，覆盖实测 24 秒并留足余量。 */
  readyTimeoutMs?: number;
  /** 轮询间隔（毫秒）。默认 500。 */
  pollIntervalMs?: number;
  /**
   * endpoint 所在目录的**根**（对应 `java.io.tmpdir`）。
   *
   * 真实运行留空即可（用系统临时目录）。测试注入假实例时必须给一个独立根目录，
   * 否则假实例会与真实实例写同一个 `instance.edn`，既污染真实环境又让并发用例
   * 互相踩踏。实际路径由 `resolveEndpointDir` 在其下拼 `herdchestra-<user>` 得出。
   */
  endpointDir?: string;
  /**
   * 模型连接。给了就写一份 `config.edn` 用 `--config` 传入，不给则用
   * Herdchestra 的默认配置（没有模型，投递的消息永远不会被执行）。
   */
  model?: HerdchestraModelConfig;
}

/**
 * 模型连接配置。
 *
 * 只收 OpenAI 兼容连接：Herdchestra 的 `:models` 支持多连接多角色，评测场景
 * 只需要一个 `main` 角色，收窄形状可以让密钥来源与作用范围一目了然。
 */
export interface HerdchestraModelConfig {
  baseUrl: string;
  apiKey: string;
  /** 端点真实模型名。 */
  model: string;
  /** 连接名，默认 `eval`。 */
  connectionId?: string;
  /** 模型在本连接内的逻辑 id，默认 `main`。 */
  modelId?: string;
  /** 单次请求超时（毫秒），默认 180000。 */
  timeoutMs?: number;
}

/** 运行中的实例句柄。`cleanup` 需要它来释放资源。 */
export interface HerdchestraInstance {
  /** 子进程句柄，供 `cleanup` 终止。 */
  readonly child: ChildProcess;
  /** 实例独占根目录。 */
  readonly rootDir: string;
  /** 工作区目录（`<rootDir>/work`），黑盒断言的对象。 */
  readonly workspaceDir: string;
  /** 就绪后的控制通道 endpoint。 */
  readonly endpoint: LoopbackEndpoint;
  /** 子进程的标准输出累计（截断保留，用于失败诊断）。 */
  output(): string;
  /** 终止实例并删除根目录。幂等。 */
  stop(): Promise<void>;
}

/** 启动失败：区分「超时未就绪」「进程提前退出」「已有实例占用」。 */
export class HerdchestraLaunchError extends Error {
  readonly code: 'READY_TIMEOUT' | 'PROCESS_EXITED' | 'INSTANCE_OCCUPIED' | 'SPAWN_FAILED';
  readonly detail: string;

  constructor(code: HerdchestraLaunchError['code'], message: string, detail = '') {
    super(message);
    this.name = 'HerdchestraLaunchError';
    this.code = code;
    this.detail = detail;
  }
}

/** 输出保留上限，避免长时间运行的实例把内存吃满。 */
const MAX_OUTPUT_CHARS = 64 * 1024;

/** 等待子进程退出的上限；超时后强杀。 */
const EXIT_GRACE_MS = 10000;

/** SIGKILL 之后的最终等待上限。超过即放弃等待，避免 stop() 永久挂住。 */
const EXIT_GIVE_UP_MS = 5000;

/** 默认启动命令：直接调 pixi 环境里的 clojure，实测与 `pixi run` 等价且少一层包装。 */
const DEFAULT_COMMAND = '.pixi/envs/default/bin/clojure';

/** 默认启动参数。 */
const DEFAULT_ARGS = ['-M:server', '-m', 'hc.server.app'];

/** 建实例独占的目录结构，返回路径。 */
function prepareDirs(rootDir: string): { dataDir: string; workspaceDir: string } {
  const dataDir = join(rootDir, 'data');
  const workspaceDir = join(rootDir, 'work');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  return { dataDir, workspaceDir };
}

/** 把子进程输出挂到累计缓冲上，只保留尾部。 */
function captureOutput(child: ChildProcess): {
  text: () => string;
  append: (chunk: string) => void;
} {
  let buffer = '';
  const append = (chunk: string): void => {
    buffer += chunk;
    if (buffer.length > MAX_OUTPUT_CHARS) {
      buffer = buffer.slice(-MAX_OUTPUT_CHARS);
    }
  };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return { text: () => buffer, append };
}

/** 睡一会。 */
async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * 等待实例就绪。
 *
 * 判据是 endpoint 文件出现**且** `:ping` 成功**且** endpoint 里的 pid 等于本次
 * spawn 的子进程 pid——三者缺一不可。只信 `:ping` 会把「上一轮残留实例」或
 * 「并发起的别人的实例」当成就绪态，后续命令投到错误的实例与 workspace 上，
 * 两个 case 的结果就混在一起了。
 */
async function waitUntilReady(
  options: {
    readyTimeoutMs: number;
    pollIntervalMs: number;
    expectedPid: number | undefined;
    /** endpoint 所在目录；不传则用全局默认目录。 */
    endpointDir?: string;
  },
  output: () => string,
  /** 返回非 null 表示子进程已终止，值即归因码。 */
  exitReason: () => 'SPAWN_FAILED' | 'PROCESS_EXITED' | null,
): Promise<LoopbackEndpoint> {
  const probeOptions = {
    ...(options.endpointDir !== undefined ? { tmpDir: options.endpointDir } : {}),
  };
  const deadline = Date.now() + options.readyTimeoutMs;
  for (;;) {
    const reason = exitReason();
    if (reason !== null) {
      throw new HerdchestraLaunchError(
        reason,
        reason === 'SPAWN_FAILED' ? 'Herdchestra 进程启动失败' : 'Herdchestra 进程在就绪前退出',
        output(),
      );
    }
    const endpoint = await probeInstance({ ...probeOptions, timeoutMs: 2000 });
    if (endpoint && endpointMatches(endpoint, options.expectedPid)) return endpoint;

    if (Date.now() >= deadline) {
      const detail = [
        output(),
        options.expectedPid !== undefined
          ? `期望 pid=${options.expectedPid}，实际 endpoint=${JSON.stringify(await probeInstance({ ...probeOptions, timeoutMs: 1000 }))}`
          : '',
      ]
        .filter((part) => part.length > 0)
        .join('\n');
      throw new HerdchestraLaunchError(
        'READY_TIMEOUT',
        `等待 Herdchestra 就绪超时（${options.readyTimeoutMs}ms）`,
        detail,
      );
    }
    await sleep(options.pollIntervalMs);
  }
}

/**
 * 判断 endpoint 是否属于本次 spawn 的进程。
 *
 * `pid` 缺失时无法证明身份，一律判为不匹配——宁可超时报错，也不把命令投到
 * 来源不明的实例上。
 */
function endpointMatches(endpoint: LoopbackEndpoint, expectedPid: number | undefined): boolean {
  if (expectedPid === undefined) return false;
  return endpoint.pid === expectedPid;
}

/**
 * 启动一个实例并等它就绪。
 *
 * 调用方必须在同一进程内存活到 `stop()`——孤儿看门狗会在父进程消失 3 秒后
 * 让实例自杀。
 */
export async function launchInstance(
  options: HerdchestraLaunchOptions,
): Promise<HerdchestraInstance> {
  const readyTimeoutMs = options.readyTimeoutMs ?? 120000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;

  // 单例锁约束：已有实例存活时必须报错，不能抢锁
  const existing = await probeInstance({
    ...(options.endpointDir !== undefined ? { tmpDir: options.endpointDir } : {}),
    timeoutMs: 1500,
  });
  if (existing) {
    throw new HerdchestraLaunchError(
      'INSTANCE_OCCUPIED',
      `已有 Herdchestra 实例存活（pid=${String(existing.pid ?? '未知')}），上一 case 可能未清理干净`,
    );
  }

  const { dataDir, workspaceDir } = prepareDirs(options.rootDir);
  const command = options.command ?? join(options.repoRoot, DEFAULT_COMMAND);
  if (options.command === undefined && !existsSync(command)) {
    // 目录已建出来，早退前要清掉，否则 tmp 里留一堆空 data/work
    try {
      rmSync(options.rootDir, { recursive: true, force: true });
    } catch {
      /* 清理失败不覆盖真正的失败原因 */
    }
    throw new HerdchestraLaunchError(
      'SPAWN_FAILED',
      `未找到 clojure 可执行文件：${command}`,
      '请在被测仓执行 pixi install 建立环境',
    );
  }

  // 模型配置写进 rootDir 下的 config.edn，用 --config 传入。写在这里而不是
  // 让调用方自己拼参数：密钥只存在于本次实例的临时目录，随 cleanup 一起删掉。
  let configPath: string | null = null;
  if (options.model !== undefined) {
    configPath = join(options.rootDir, 'config.edn');
    writeFileSync(configPath, renderModelConfig(options.model));
  }

  const args = [
    ...(options.commandArgs ?? DEFAULT_ARGS),
    ...(configPath !== null ? ['--config', configPath] : []),
    '--data-dir',
    dataDir,
    ...(options.endpointDir !== undefined
      ? // 传给子进程的是推导后的最终目录：真实实例本就用默认目录，假实例则直接写这里
        ['--endpoint-dir', resolveEndpointDir({ tmpDir: options.endpointDir })]
      : []),
    '--workspace-root',
    workspaceDir,
    '--port',
    '0',
    ...(options.extraArgs ?? []),
  ];

  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd: options.repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 不 detach、不 unref：父进程必须活着，否则孤儿看门狗会杀掉实例
      detached: false,
    });
  } catch (error) {
    throw new HerdchestraLaunchError(
      'SPAWN_FAILED',
      `启动 Herdchestra 失败：${(error as Error).message}`,
    );
  }

  const captured = captureOutput(child);
  let exited = false;
  /** 子进程是否曾成功启动（`spawn` 事件到达）。用于区分「启动失败」与「运行中退出」。 */
  let spawnFailed = false;
  const exitPromise = new Promise<void>((resolve) => {
    child.once('spawn', () => {
      spawnFailed = false;
    });
    child.once('exit', () => {
      exited = true;
      resolve();
    });
    child.once('error', (error: Error) => {
      // `error` 与 `exit` 可能先后到达；只置位并 resolve，
      // 由调用方按 spawnFailed 决定归因码。
      if (!exited) spawnFailed = true;
      exited = true;
      captured.append(`\n[spawn] ${error.message}`);
      resolve();
    });
  });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;

    if (!exited) {
      child.kill('SIGTERM');
      const timedOut = await Promise.race([
        exitPromise.then(() => false),
        sleep(EXIT_GRACE_MS).then(() => true),
      ]);
      if (timedOut && !exited) {
        child.kill('SIGKILL');
        // SIGKILL 也可能因 D 态或不可中断 IO 迟迟不返回；给硬上限，
        // 否则 stop() 会永久挂住并把整个 run 拖死。
        await Promise.race([exitPromise, sleep(EXIT_GIVE_UP_MS)]);
      }
    }
    // 等 exit 之后才删目录：Datalevin 的 LMDB 锁文件需要进程释放。
    // 删除失败不抛错——`stopped` 已置 true，再抛会让调用方拿到
    // 「清理失败」而掩盖真正的失败归因，且后续无法重试删除。
    try {
      rmSync(options.rootDir, { recursive: true, force: true });
    } catch (error) {
      captured.append(`\n[cleanup] 删除实例目录失败：${(error as Error).message}`);
    }
  };

  try {
    const endpoint = await waitUntilReady(
      {
        readyTimeoutMs,
        pollIntervalMs,
        expectedPid: child.pid,
        ...(options.endpointDir !== undefined ? { endpointDir: options.endpointDir } : {}),
      },
      captured.text,
      () => (spawnFailed ? 'SPAWN_FAILED' : exited ? 'PROCESS_EXITED' : null),
    );
    return {
      child,
      rootDir: options.rootDir,
      workspaceDir,
      endpoint,
      output: captured.text,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/**
 * 在实例上创建一个会话，返回 `session-id`。
 *
 * `:create-session` 的回复形状是 Herdchestra 的命令回执，不保证直接给出
 * `session-id`；拿不到时回落到 `:focus-or-create`（它会返回
 * `:active-session-id`），再不行就报错——**绝不猜测 id**，猜错会让后续
 * 命令投递到别的会话上。
 */
export async function createSession(endpoint: LoopbackEndpoint, title: string): Promise<string> {
  const reply = await sendControlRequest(endpoint, {
    op: 'create-session',
    title,
  });
  if (!reply.ok) {
    throw new LoopbackError(
      reply.code ?? 'CREATE_SESSION_FAILED',
      `创建会话失败：${reply.message ?? '未给出原因'}`,
    );
  }

  const direct = extractSessionId(reply.value);
  if (direct !== null) return direct;

  const focused = await sendControlRequest(endpoint, { op: 'focus-or-create' });
  if (focused.ok) {
    const active = extractSessionId(focused.value);
    if (active !== null) return active;
  }
  throw new LoopbackError(
    'SESSION_ID_MISSING',
    '创建会话的回执中找不到 session-id，无法安全投递命令',
  );
}

/** 从回复的 EDN map 中找会话 id；支持常见字段名。 */
function extractSessionId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const map = value as Record<string, unknown>;
  for (const key of ['session-id', 'active-session-id', 'id']) {
    const candidate = map[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  // 回执可能把新增的会话包在嵌套 map 里
  for (const nested of Object.values(map)) {
    const found = extractSessionId(nested);
    if (found !== null) return found;
  }
  return null;
}

/**
 * 控制通道命令载荷。
 *
 * `kind` 必须是 **EDN 关键词**——传字符串会被服务端拒绝为
 * `COMMAND_KIND_REQUIRED`（实测确认，对 `:command` 下所有 kind 都成立）。
 * 这里用类型强制，避免调用方手写字符串而在运行时才发现。
 */
export interface ControlCommandPayload extends Record<string, unknown> {
  kind: EdnSymbol;
  'session-id': string;
}

/** 向会话投递一条命令，返回完整回复（含 `value`，供读取 history 等数据）。 */
export async function submitCommand(
  endpoint: LoopbackEndpoint,
  sessionId: string,
  payload: ControlCommandPayload,
): Promise<LoopbackReply> {
  return await sendControlRequest(endpoint, {
    op: 'command',
    'session-id': sessionId,
    payload,
  });
}

/** 读当前实例的 endpoint（不给就绪探测，只读文件）。 */
export function currentEndpoint(): LoopbackEndpoint | null {
  return readEndpointState();
}

/** 一条会话消息（只取判定需要的字段）。 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'unknown';
  content: string;
  messageId: string;
  /**
   * 最近更新时间。Herdchestra 每次改写内容都会刷新它，用于判断流式生成是否
   * 还在推进。实测是 epoch 毫秒数字，但 EDN 也可能给 `#inst`/rfc3339 文本，
   * 因此保留原始字符串参与签名比较——**不降级成 0**，否则字符串形态的时间戳
   * 会让稳定判定退化成「只看内容」，等长改写的改动就检不出来。
   */
  updatedAt: number | string;
  /**
   * 消息自带的错误（`{:code, :message}`）。模型调用失败时 Herdchestra 会写入
   * 这条消息，此时它**不是**成功回复，不能当成「本轮已完成」。
   */
  error?: { code: string; message: string };
}

/**
 * 读会话消息窗口。
 *
 * 走 `:history/messages`（`app/commands.clj` `handle-history-window!`）。返回
 * 按时间正序的消息数组；回复形状不符时抛 `LoopbackError`，不返回空数组假装
 * 「没有消息」——后者会让 collect 误判「模型没回复」。
 */
export async function readSessionMessages(
  endpoint: LoopbackEndpoint,
  sessionId: string,
  limit = 200,
): Promise<SessionMessage[]> {
  const reply = await submitCommand(endpoint, sessionId, {
    kind: ednKeyword('history/messages'),
    'session-id': sessionId,
    limit,
  });
  if (!reply.ok) {
    throw new LoopbackError(
      reply.code ?? 'HISTORY_READ_FAILED',
      `读取会话消息失败：${reply.message ?? '未给出原因'}`,
    );
  }

  // 回复形状实测为 `value.receipt = {:status …, :session-id …, :messages [...]}`。
  // 不用递归找同名键：reply 里若有别的 `messages`（如嵌套的会话列表）会被
  // 误取，且不会报错——那会让 collect 拿错消息集合并判错。
  const receipt = findKey(reply.value, 'receipt');
  const messages = findKey(receipt, 'messages');
  if (!Array.isArray(messages)) {
    throw new LoopbackError(
      'HISTORY_SHAPE_INVALID',
      'history/messages 的回复里找不到 receipt.messages 数组',
    );
  }
  return messages.map((item) => toSessionMessage(item));
}

/** 把一条消息实体归一化成最小形状。 */
function toSessionMessage(item: unknown): SessionMessage {
  const map = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
  const rawRole = map['role'];
  const roleText = typeof rawRole === 'string' ? rawRole.replace(/^:/, '') : '';
  const role: SessionMessage['role'] =
    roleText === 'user' || roleText === 'assistant' || roleText === 'system' ? roleText : 'unknown';
  const content = typeof map['content'] === 'string' ? map['content'] : '';
  const messageId =
    typeof map['message-id'] === 'string'
      ? map['message-id']
      : typeof map['id'] === 'string'
        ? map['id']
        : '';
  const rawUpdated = map['updated-at'];
  const updatedAt: number | string =
    typeof rawUpdated === 'number' || typeof rawUpdated === 'string' ? rawUpdated : 0;
  const message: SessionMessage = { role, content, messageId, updatedAt };
  const rawError = map['error'];
  if (typeof rawError === 'object' && rawError !== null) {
    const errMap = rawError as Record<string, unknown>;
    message.error = {
      code: typeof errMap['code'] === 'string' ? errMap['code'] : 'UNKNOWN',
      message: typeof errMap['message'] === 'string' ? errMap['message'] : '',
    };
  }
  return message;
}

/**
 * 取顶层键的值（只看第一层，不递归）。
 *
 * 递归查找会命中任意嵌套的同名键；回复形状是固定的，按层取才能在上层缺失
 * 时明确报错，而不是取到别处的同名数组。
 */
function findKey(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** 工作区文件快照：相对路径 → 内容。二进制或读取失败的文件不进快照。 */
export type WorkspaceSnapshot = Map<string, string>;

/** 单个文件的内容上限，避免把大文件整个读进内存。 */
const MAX_FILE_BYTES = 512 * 1024;

/** 不纳入快照的目录：版本库元数据与依赖目录。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.pixi', 'target']);

/**
 * 读工作区文件快照。
 *
 * 只取文本文件：内容是判定依据，二进制读成乱码反而干扰断言。含 NUL 字节的
 * 按二进制处理；超过 `MAX_FILE_BYTES` 的不纳入；单个文件读失败（权限、被删、
 * 正在写）时跳过该文件。跳过的文件不记录——快照只表达「读到了什么」，所以
 * 这类文件既不算新增也不算修改，边界情况见 §下方 TOCTOU 说明。
 *
 * 注意 `statSync` 与 `readFileSync` 之间存在 TOCTOU：模型正在写文件时可能读到
 * 半截内容并判为 `modified`。这是可接受的误差——判定用的是「文件变化了」，
 * 而不是「某个时刻的精确字节」。
 */
export function snapshotWorkspace(rootDir: string): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = new Map();
  collectFiles(rootDir, '', snapshot, 0);
  return snapshot;
}

/** 递归深度上限：防止异常目录树把同步递归拖死事件循环。 */
const MAX_DEPTH = 32;

function collectFiles(dir: string, prefix: string, out: WorkspaceSnapshot, depth: number): void {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const relative = prefix.length > 0 ? join(prefix, entry.name) : entry.name;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      collectFiles(full, relative, out, depth + 1);
      continue;
    }
    // `Dirent` 不跟随软链：指向文件的软链 `isFile()` 为 true，按内容读取，
    // 不会穿透到目录树之外。
    if (!entry.isFile()) continue;

    try {
      const stat = statSync(full);
      if (stat.size > MAX_FILE_BYTES) continue;
      const buffer = readFileSync(full);
      // 含 NUL 字节的按二进制处理，不纳入快照
      if (buffer.includes(0)) continue;
      out.set(relative.split(sep).join('/'), buffer.toString('utf8'));
    } catch {
      /* 读不了就跳过，不阻断整次采集 */
    }
  }
}

/** 工作区变化：新增 / 修改 / 删除。 */
export interface WorkspaceDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

/** 比较两次快照，得出变化。 */
export function diffWorkspace(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspaceDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [path, content] of after) {
    const previous = before.get(path);
    if (previous === undefined) added.push(path);
    else if (previous !== content) modified.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push(path);
  }
  added.sort();
  modified.sort();
  removed.sort();
  return { added, modified, removed };
}

/** 判定「本轮跑完」的结果。 */
export interface TurnOutcome {
  /** 是否观察到**写完的**助手回复。 */
  replied: boolean;
  /** 等到的助手消息（可能为空）。 */
  assistantMessages: SessionMessage[];
  /** 是否因超时结束。 */
  timedOut: boolean;
  /** 已等待时长（毫秒）。 */
  elapsedMs: number;
  /**
   * 整个等待期内**一次都没能读**到会话。
   *
   * 这既可能是模型确实没回复，也可能是控制通道坏了。归因必须区分：通道故障算
   * 环境问题（HARNESS），不能记成模型没做到。
   */
  readFailed?: boolean;
}

/**
 * 把一组消息压成签名，用于判断「还在写」还是「已静止」。
 *
 * 用**整串内容**而不是长度：模型改写时可能保持等长（换词、改错字），只比长度
 * 会把这种改写当成静止，采到改写前的内容。
 */
export function assistantSignature(messages: readonly SessionMessage[]): string {
  return messages
    .map((m) => `${m.messageId}:${m.content}:${String(m.updatedAt)}:${m.error?.code ?? ''}`)
    .join('\u0000');
}

/**
 * 等本轮助手回复**写完**。
 *
 * 两个判据缺一不可：
 *
 * 1. **出现了基线之外**的 `role: assistant` 成功消息。没有基线就分不清「本轮
 *    回复」与「会话里早就存在的旧回复」，后者会让采集在第一次轮询就判成功。
 * 2. **这些消息已经停止变化**且持续够久。Herdchestra 流式写入：内容与
 *    `updated-at` 每次追加都会变。只看「出现了消息」会在生成到一半时判完成
 *    ——实测抓到过只返回「我把」两个字的半截回复。
 *
 * 稳定窗用**毫秒**而不是轮询次数：次数会随 `pollIntervalMs` 缩水（间隔调到
 * 200ms 时 3 次只有 0.6 秒），模型两次追加之间的停顿就会被误判成写完。
 *
 * 内容用整串比较而不是长度：模型做等长替换（改错字、换占位符）时长度不变，
 * 只比长度会漏判。
 *
 * 不用「工作区不再变化」作判据：模型可能先写文件再补充说明，文件静止不代表
 * 本轮结束；反之只回文字不改文件也是合法结果。
 */
export async function waitForAssistantReply(
  endpoint: LoopbackEndpoint,
  sessionId: string,
  options: {
    timeoutMs: number;
    pollIntervalMs?: number;
    /** 投递前已存在的助手消息 id，用于排除旧回复。 */
    baselineMessageIds: ReadonlySet<string>;
    /** 内容需连续静止多久才算写完（毫秒，默认 6000）。 */
    settleMs?: number;
    /** 取消信号：编排层放弃本 case 时立刻返回，不等满超时。 */
    signal?: AbortSignal;
  },
): Promise<TurnOutcome> {
  // 轮询间隔给下限：0 或负数会退化成忙等，把事件循环占死
  const pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 2000);
  const settleMs = Math.max(pollIntervalMs, options.settleMs ?? 6000);
  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutMs;

  let previousSignature: string | null = null;
  let unchangedSince: number | null = null;
  let latest: SessionMessage[] = [];
  let everRead = false;

  for (;;) {
    if (options.signal?.aborted === true) {
      return {
        replied: false,
        assistantMessages: [],
        timedOut: false,
        elapsedMs: Date.now() - startedAt,
      };
    }

    let messages: SessionMessage[] | null = null;
    try {
      messages = await readSessionMessages(endpoint, sessionId);
      everRead = true;
    } catch {
      // 读失败不等于没回复，继续重试到超时
      messages = null;
    }

    const fresh =
      messages?.filter(
        (m) => m.role === 'assistant' && !options.baselineMessageIds.has(m.messageId),
      ) ?? [];
    // 语义按「存在成功消息」定，而不是「全部失败才失败」：模型可能先报错再
    // 重试成功，此时最终结果以成功那条为准。只有全是失败消息才算本轮失败。
    const successes = fresh.filter((m) => m.error === undefined);
    if (fresh.length > 0) {
      latest = fresh;
      const signature = assistantSignature(fresh);
      const now = Date.now();
      if (signature !== previousSignature) {
        previousSignature = signature;
        unchangedSince = now;
      } else if (unchangedSince !== null && now - unchangedSince >= settleMs) {
        return {
          replied: successes.length > 0,
          assistantMessages: latest,
          timedOut: false,
          elapsedMs: now - startedAt,
        };
      }
    }

    if (Date.now() >= deadline) {
      return {
        replied: false,
        assistantMessages: latest,
        timedOut: true,
        elapsedMs: Date.now() - startedAt,
        // 一次都没读到：通道可能坏了，交由上层区分归因
        ...(everRead ? {} : { readFailed: true }),
      };
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * 读当前会话里已存在的助手消息 id 集合，作为「本轮新回复」的基线。
 *
 * 读不到时返回空集而不是抛错：空基线只会让判定更宽松（可能把旧回复当本轮），
 * 所以这里必须让调用方知道——返回值带 `reliable` 标记，调用方可据此在事实里
 * 留下记录，避免悄悄降级。
 */
export async function readAssistantBaseline(
  endpoint: LoopbackEndpoint,
  sessionId: string,
): Promise<{ ids: Set<string>; reliable: boolean; error?: string }> {
  try {
    const messages = await readSessionMessages(endpoint, sessionId);
    return {
      ids: new Set(messages.filter((m) => m.role === 'assistant').map((m) => m.messageId)),
      reliable: true,
    };
  } catch (error) {
    return {
      ids: new Set(),
      reliable: false,
      error: (error as Error).message,
    };
  }
}

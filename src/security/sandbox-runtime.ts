/**
 * 把真实宿主命令包进已通过探测的 sandbox-runtime。
 * 这里不重新判定安全；调用方必须先拿到 allowed=true 的隔离门禁。
 */
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

export interface WrappedHostCommand {
  argv: string[];
  env: NodeJS.ProcessEnv;
}

export async function wrapHostCommand(input: {
  bin: string;
  args: string[];
  cwd: string;
  allowedWrite: string[];
  allowedDomains: string[];
}): Promise<WrappedHostCommand> {
  const command = [input.bin, ...input.args].map(shellQuote).join(' ');
  // 写入白名单必须按真实路径授权：
  // - macOS 上 /var 是 /private/var 的符号链接，mkdtemp 返回 /var/...，
  //   而 Seatbelt 按 /private/var/... 判定，直接传原路径匹配不上（EPERM mkdir）。
  // - 路径授权不继承新建子目录，opencode 会在隔离 HOME 里逐层建目录
  //   （.local/share/opencode/log、.cache/opencode/bin 等），故每根再补递归通配。
  const writeRoots = new Set<string>();
  for (const entry of input.allowedWrite) {
    const real = safeRealpath(entry);
    writeRoots.add(real);
    writeRoots.add(join(real, '**'));
  }
  const config: SandboxRuntimeConfig = {
    network: {
      allowedDomains: input.allowedDomains,
      deniedDomains: [],
      // opencode 是 client-server 架构，启动即在本机 listen（HTTP + Unix socket），
      // 缺这项会在沙箱内 init 挂起。只放开本机绑定；不放开 allowAllUnixSockets，
      // 否则沙箱内进程可连宿主任意 Unix socket（docker.sock、ssh-agent 等），
      // 等于绕过文件系统 denyRead 拿到宿主级能力。A/B 实测关掉它依然正常跑通。
      allowLocalBinding: true,
    },
    filesystem: {
      denyRead: credentialDenyPaths(),
      allowWrite: [...writeRoots],
      denyWrite: [],
    },
  };
  // SandboxManager 是进程级单例：initialize() 在 initializationPromise 已存在时
  // 直接返回、忽略新传入的配置。批量跑卷时每个 case 有独立的隔离 HOME 与工作区，
  // 若不 reset 就复用首次配置，只有第一个 case 的路径在白名单里，其余全部
  // EPERM / FileSystem.open 失败。故每次包裹前先 reset，确保本次配置真正生效。
  //
  // reset 会关掉 mux/http/socks 代理，而先前 spawn 的沙箱子进程其 Seatbelt profile
  // 已在 spawn 时固化旧端口 —— 并发跑到这里会让在跑的 case 出站全断（或串用他人的
  // allowedDomains）。因此 reset→initialize→wrap 必须整体串行；wrap 之后才放锁，
  // 使后一个 case 不会在本次会话仍在使用时替换掉配置。
  //
  // 兜底超时：SandboxManager.reset() 内部 await 各 server.close() 回调，若上一题
  // 沙箱子进程经 mux 代理留下的 in-flight 连接半开（对端不回 FIN），close 回调可能
  // 永不触发，整条 reset→initialize→wrap 链随之永久挂起（实测 ON 侧全量跑第 72 题
  // 卡死 80+ 分钟，deadline 兜底因卡在 submit 内层而不生效）。这里给整链加
  // SANDBOX_WRAP_TIMEOUT_MS（默认 60s）硬上限：超时后按 HARNESS 故障抛出，由上层
  // 归因为 HARNESS 并继续跑后续试题，绝不无限等待。
  const release = await acquireWrapLock();
  try {
    const wrapTimeoutMs = Number(process.env.SANDBOX_WRAP_TIMEOUT_MS ?? 60_000);
    const wrapped = await withTimeout(
      (async () => {
        await SandboxManager.reset().catch(() => undefined);
        await SandboxManager.initialize(config);
        return SandboxManager.wrapWithSandboxArgv(
          command,
          undefined,
          undefined,
          undefined,
          input.cwd,
        );
      })(),
      wrapTimeoutMs,
      'SandboxManager reset→initialize→wrap',
    );
    const bin = wrapped.argv[0];
    if (bin === undefined) {
      throw new Error('隔离后端没有返回可执行命令');
    }
    return { argv: wrapped.argv, env: wrapped.env };
  } finally {
    release();
  }
}

/** 给 Promise 加硬超时；超时抛 Error（上层按 HARNESS 故障归因）。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`${label} 超过 ${ms}ms 未完成（疑似沙箱代理连接排水挂起），已按超时失败处理`),
      );
    }, ms);
    timer.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 进程内串行队列：保证同一时刻只有一个调用在改全局 SandboxManager 配置。 */
let wrapLockTail: Promise<void> = Promise.resolve();

async function acquireWrapLock(): Promise<() => void> {
  const previous = wrapLockTail;
  let release!: () => void;
  wrapLockTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}

export function allowedDomainsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const domains = new Set<string>();
  for (const key of ['OPENAI_BASE_URL', 'PROCTOR_HOSTED_BASE_URL']) {
    const raw = env[key];
    if (raw === undefined || raw.trim() === '') continue;
    try {
      const host = new URL(raw).hostname;
      if (host !== '') domains.add(host);
    } catch {
      /* 非法地址不放行，留待宿主自身报错。 */
    }
  }
  // opencode 启动期固定依赖（拉取失败只 WARN 不阻塞，但沙箱内会持续重试拖满 deadline）。
  domains.add('models.opencode.ai');
  return [...domains];
}

/**
 * 从 provider 声明里取模型端点的 host（含显式端口）。
 * 考场模型形如 `providerID/modelID`；端点地址来自本机受控的 provider 配置，
 * 不是被测对象输入，可以放行。取不到就返回 undefined，由调用方按「无端点域名」处理。
 *
 * 保留显式端口：sandbox 的域名条目支持 `host:port`，只写 host 会把该主机的所有端口
 * 一起放行，比端点实际需要的更宽。明文 http 端点同样会被放行（由 provider 配置决定），
 * 但不在本函数内静默升级或拒绝。
 */
export function modelEndpointHost(
  providerConfig: unknown,
  modelId: string | undefined,
): string | undefined {
  if (providerConfig === null || typeof providerConfig !== 'object') return undefined;
  if (modelId === undefined || !modelId.includes('/')) return undefined;
  const providerId = modelId.slice(0, modelId.indexOf('/'));
  if (providerId === '') return undefined;
  const entry = (providerConfig as Record<string, unknown>)[providerId];
  if (entry === null || typeof entry !== 'object') return undefined;
  const options = (entry as { options?: unknown }).options;
  if (options === null || typeof options !== 'object') return undefined;
  const baseURL = (options as { baseURL?: unknown }).baseURL;
  if (typeof baseURL !== 'string' || baseURL.trim() === '') return undefined;
  try {
    const url = new URL(baseURL);
    if (url.hostname === '') return undefined;
    // URL.port 在默认端口（80/443）时为空串，此时按 hostname 放行即可；
    // 非默认端口必须带上，否则放行面会扩到该主机的全部端口。
    return url.port === '' ? url.hostname : `${url.hostname}:${url.port}`;
  } catch {
    /* 非法地址不放行 */
    return undefined;
  }
}

function credentialDenyPaths(): string[] {
  const home = homedir();
  return [join(home, '.ssh'), join(home, '.aws'), join(home, '.config', 'gh')];
}

/** 归一化到真实路径；路径不存在时退回原值（不要因为一条路径让整次执行失败）。 */
function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

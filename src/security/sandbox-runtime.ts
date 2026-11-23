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
  /**
   * 上游（父）代理。沙箱自身无法直连外网时（例如端点域名被本机 DNS 污染、
   * 必须借宿主机器的全局代理出网）由此交给 sandbox-runtime 的 parentProxy，
   * 由它统一出网；沙箱内进程仍然拿不到任何本机端口访问权。
   */
  parentProxy?: { http?: string; https?: string; noProxy?: string } | undefined;
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
      // 传给 sandbox-runtime 的 parentProxy 是「沙箱代理自己的出口」，
      // 与被测进程无关：被测进程依旧只能访问 allowedDomains，本机端口依旧不可达。
      ...(input.parentProxy !== undefined ? { parentProxy: input.parentProxy } : {}),
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
  // 全局状态只在子进程里存活（ADR-0014）：本函数由短命子进程调用，进程退出即回收
  // 代理端口与单例状态，因此不需要包裹串行锁、不需要 reset()、也不需要兜底超时。
  // 保留一次防御性 reset：若调用方在同一进程内多次调用，也能拿到本次配置。
  await SandboxManager.reset().catch(() => undefined);
  await SandboxManager.initialize(config);
  const wrapped = await SandboxManager.wrapWithSandboxArgv(
    command,
    undefined,
    undefined,
    undefined,
    input.cwd,
  );
  const bin = wrapped.argv[0];
  if (bin === undefined) {
    throw new Error('隔离后端没有返回可执行命令');
  }
  return { argv: wrapped.argv, env: wrapped.env };
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

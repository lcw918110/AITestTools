import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allowedDomainsFromEnv, modelEndpointHost } from '../../src/security/sandbox-runtime.ts';

describe('真实宿主沙箱包装', () => {
  it('只从已声明的模型地址提取允许域名，并固定附带 opencode 元数据域', () => {
    expect(
      allowedDomainsFromEnv({
        OPENAI_BASE_URL: 'https://ai.example.test:20000/v1',
        PROCTOR_HOSTED_BASE_URL: 'not a url',
        PATH: '/usr/bin',
      }),
    ).toEqual(['ai.example.test', 'models.opencode.ai']);
  });

  it('没有模型地址时仍固定放行 opencode 元数据域，不放大到任意域名', () => {
    expect(allowedDomainsFromEnv({})).toEqual(['models.opencode.ai']);
  });

  it('真实宿主包装显式拒绝常见凭据目录', () => {
    const source = readFileSync(
      new URL('../../src/security/sandbox-runtime.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("join(home, '.ssh')");
    expect(source).toContain('denyRead: credentialDenyPaths()');
  });

  it('模型端点域名从受控 provider 声明里取，用于并进沙箱放行名单', () => {
    const provider = {
      'kw92.cyou': { options: { baseURL: 'https://ai.kw92.cyou:20000/v1' } },
      openai: { options: { baseURL: 'https://api.deepseek.com' } },
    };
    // 非默认端口必须保留，否则放行面会扩到该主机的全部端口。
    expect(modelEndpointHost(provider, 'kw92.cyou/lazy/task')).toBe('ai.kw92.cyou:20000');
    expect(modelEndpointHost(provider, 'openai/deepseek-chat')).toBe('api.deepseek.com');
  });

  it('模型端点域名取不到时返回 undefined，不猜也不放宽', () => {
    expect(modelEndpointHost({}, 'kw92.cyou/lazy/task')).toBeUndefined();
    expect(modelEndpointHost(null, 'kw92.cyou/lazy/task')).toBeUndefined();
    expect(modelEndpointHost({ a: { options: { baseURL: 'not a url' } } }, 'a/m')).toBeUndefined();
    expect(modelEndpointHost({ a: { options: {} } }, 'a/m')).toBeUndefined();
    expect(
      modelEndpointHost({ a: { options: { baseURL: 'https://x.test' } } }, 'no-slash'),
    ).toBeUndefined();
  });

  it('端口只在非默认时出现，默认端口不额外限定', () => {
    expect(modelEndpointHost({ a: { options: { baseURL: 'https://x.test:443/v1' } } }, 'a/m')).toBe(
      'x.test',
    );
    expect(modelEndpointHost({ a: { options: { baseURL: 'http://x.test:80/v1' } } }, 'a/m')).toBe(
      'x.test',
    );
    expect(modelEndpointHost({ a: { options: { baseURL: 'http://x.test:8080/v1' } } }, 'a/m')).toBe(
      'x.test:8080',
    );
  });

  it('包裹前先 reset 再 initialize，且不再引入进程内串行锁与兜底超时', () => {
    // ADR-0014：包裹与执行整体放进短命子进程，全局状态随进程消亡。
    // 进程内串行锁与 60s 兜底超时的前提（同进程复用 SandboxManager）已不存在，
    // 留着只会掩盖问题：锁会把批量跑串成严格串行，超时会把正常慢题判成 HARNESS。
    const source = readFileSync(
      new URL('../../src/security/sandbox-runtime.ts', import.meta.url),
      'utf8',
    );
    const resetIdx = source.indexOf('await SandboxManager.reset()');
    const initIdx = source.indexOf('await SandboxManager.initialize(config)');
    expect(resetIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(resetIdx);
    expect(source).not.toContain('acquireWrapLock');
    expect(source).not.toContain('SANDBOX_WRAP_TIMEOUT_MS');
  });

  it('只放开本机绑定，不放开全部 Unix socket（避免连宿主任意 socket）', () => {
    const source = readFileSync(
      new URL('../../src/security/sandbox-runtime.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('allowLocalBinding: true');
    expect(source).not.toContain('allowAllUnixSockets: true');
  });

  it('执行子进程的 stdin 必须是 ignore，否则 opencode 等输入直到 deadline', () => {
    const source = readFileSync(
      new URL('../../src/security/sandbox-exec-child.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("stdio: ['ignore', 'pipe', 'pipe']");
  });

  it('主进程不再自己初始化沙箱，也不再自己启动宿主（避免拿到已关闭代理端口）', () => {
    const source = readFileSync(new URL('../../src/run/hosted-runner.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('SandboxManager.wrapWithSandboxArgv');
    expect(source).toContain('runSandboxedHostInChild');
    // 进程树回收只保留一份实现：主进程里不得再有 reapTree / pgrep 兜底。
    expect(source).not.toContain('function reapTree(');
    expect(source).not.toContain('runHostedWithReap');
  });

  it('旁路诊断同样在子进程内执行，不退回主进程起宿主', () => {
    const source = readFileSync(new URL('../../src/run/hosted-runner.ts', import.meta.url), 'utf8');
    const bypassBlock = source.slice(
      source.indexOf('if (sandboxBypass)'),
      source.indexOf('} else {'),
    );
    expect(bypassBlock).toContain('runSandboxedHostInChild');
    expect(bypassBlock).toContain('sandboxBypass: true');
  });
});

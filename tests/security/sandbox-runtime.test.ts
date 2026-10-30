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

  it('每次包裹前先 reset 且被串行锁包住，避免并发 case 互相破坏代理', () => {
    const source = readFileSync(
      new URL('../../src/security/sandbox-runtime.ts', import.meta.url),
      'utf8',
    );
    const lockIdx = source.indexOf('const release = await acquireWrapLock()');
    const resetIdx = source.indexOf('await SandboxManager.reset()');
    const initIdx = source.indexOf('await SandboxManager.initialize(config)');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(lockIdx);
    expect(initIdx).toBeGreaterThan(resetIdx);
    // 锁必须在 finally 里释放，否则一次异常会永久堵住后续所有 case。
    expect(source).toContain('} finally {\n    release();');
  });

  it('只放开本机绑定，不放开全部 Unix socket（避免连宿主任意 socket）', () => {
    const source = readFileSync(
      new URL('../../src/security/sandbox-runtime.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('allowLocalBinding: true');
    expect(source).not.toContain('allowAllUnixSockets: true');
  });

  it('子进程 stdin 必须是 ignore，否则 opencode 等输入直到 deadline', () => {
    const source = readFileSync(new URL('../../src/run/hosted-runner.ts', import.meta.url), 'utf8');
    expect(source).toContain("stdio: ['ignore', 'pipe', 'pipe']");
  });
});

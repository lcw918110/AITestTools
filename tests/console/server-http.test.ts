/**
 * HTTP 层集成测试：用 node:http createServer 包裹 handleRequest，经真实 socket + fetch 验证。
 * 覆盖：GET 正常/404、POST/PUT 入参错误路径、静态文件 MIME、作业查询生命周期。
 * 只测只读与入参校验路径，不触发真实命令执行、不写入真实 product-eval 项目。
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../apps/console/job-queue.ts';
import type { jobs as JobsMap } from '../../apps/console/job-queue.ts';
import type { handleRequest as HandleRequest } from '../../apps/console/router.ts';

const isolationGate = vi.hoisted(() => ({ allowed: false, reason: '测试桩：隔离探测未通过' }));
vi.mock('../../src/security/isolation-backend.ts', () => ({
  evaluateIsolationGate: vi.fn(async () => isolationGate),
}));

let server: Server;
let baseUrl = '';
let testJobsDir = '';
let jobs: typeof JobsMap;
let handleRequest: typeof HandleRequest;

beforeAll(async () => {
  testJobsDir = mkdtempSync(join(tmpdir(), 'proctor-server-http-jobs-'));
  process.env.PROCTOR_CONSOLE_JOBS_DIR = testJobsDir;
  vi.resetModules();
  const router = await import('../../apps/console/router.ts');
  const queue = await import('../../apps/console/job-queue.ts');
  handleRequest = router.handleRequest;
  jobs = queue.jobs;
  server = createServer((req, res) => {
    void handleRequest(req, res).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: msg }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((res, reject) => {
    server.close((err) => (err ? reject(err) : res()));
  });
  delete process.env.PROCTOR_CONSOLE_JOBS_DIR;
  vi.resetModules();
  if (testJobsDir) rmSync(testJobsDir, { recursive: true, force: true });
});

afterEach(() => {
  jobs.clear();
});

async function request(path: string, init?: Parameters<typeof fetch>[1]) {
  return fetch(`${baseUrl}${path}`, init);
}

describe('HTTP 层集成测试', () => {
  it('GET /api/health 返回 200 与 ok 标记', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; project: string };
    expect(body.ok).toBe(true);
    expect(body.project).toBe(resolve('examples/product-eval'));
  });

  it('GET /api/presets 返回 200 与三个预设项', async () => {
    const res = await request('/api/presets');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { presets: Array<{ id: string }> };
    expect(body.presets.map((p) => p.id)).toEqual(['model', 'plugin', 'agent']);
  });

  it('GET /api/test-sets 返回 200 与 testSets 数组', async () => {
    const res = await request('/api/test-sets');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { testSets: unknown[] };
    expect(Array.isArray(body.testSets)).toBe(true);
  });

  it('GET 未知 API 路径落入静态文件服务，返回 404', async () => {
    const res = await request('/api/definitely-not-exists');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not found');
  });

  it('GET /api/jobs/unknown 返回 404 job not found', async () => {
    const res = await request('/api/jobs/unknown');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('job not found');
  });

  it('GET /api/runs/view 路径无效返回 404', async () => {
    const res = await request('/api/runs/view?path=not-exists-run');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('run not found');
  });

  it('POST /api/test-sets 非法 JSON 返回 400 invalid json', async () => {
    const res = await request('/api/test-sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid json');
  });

  it('POST /api/test-sets 缺 name 返回 400', async () => {
    const res = await request('/api/test-sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: '无名称' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('请填写测试集名称');
  });

  it('POST /api/env/verify 非法 kind 返回 400', async () => {
    const res = await request('/api/env/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'bogus', id: 'x' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('kind 须为 model 或 agent');
  });

  it('POST /api/run 缺 experiment 返回 400 unknown experiment', async () => {
    const res = await request('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unknown experiment');
  });

  it('PUT /api/env/environments/不存在 返回 404 environment not found', async () => {
    const res = await request('/api/env/environments/not-exists-environment', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipe: {} }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('environment not found');
  });

  it('POST /api/compare 缺 baseline 返回 400', async () => {
    const res = await request('/api/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('baseline / candidate 路径无效');
  });

  it('GET / 返回 text/html', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('GET /styles.css 返回 text/css', async () => {
    const res = await request('/styles.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('GET /app.js 返回 text/javascript', async () => {
    const res = await request('/app.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
  });

  it('作业查询生命周期：注入内存 job 后 GET /api/jobs/:id 返回该 job', async () => {
    const job: Job = {
      id: 'job-test-lifecycle',
      experiment: 'model',
      status: 'queued',
      startedAt: new Date().toISOString(),
      log: ['line1'],
    };
    jobs.set(job.id, job);
    const res = await request('/api/jobs/job-test-lifecycle');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Job;
    expect(body.id).toBe('job-test-lifecycle');
    expect(body.status).toBe('queued');
  });

  it('安全响应头：API 与静态文件均附带 nosniff 与 no-referrer', async () => {
    const apiRes = await request('/api/health');
    expect(apiRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(apiRes.headers.get('referrer-policy')).toBe('no-referrer');

    const staticRes = await request('/');
    expect(staticRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(staticRes.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('跨源防护：POST 携带外部 Origin 返回 403', async () => {
    const res = await request('/api/run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ experiment: 'model' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('cross-origin');
  });

  it('真实运行缺操作系统级隔离后端时返回 400 阻断，不启动作业', async () => {
    const res = await request('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ experiment: 'model', live: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('操作系统级隔离');
  });

  it('本机隔离探测通过后才接受真实运行', async () => {
    isolationGate.allowed = true;
    const res = await request('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ experiment: 'model', live: true }),
    });
    isolationGate.allowed = false;
    expect(res.status).not.toBe(400);
  });

  it('跨站点防护：POST 携带 Sec-Fetch-Site: cross-site 返回 403', async () => {
    const res = await request('/api/run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({ experiment: 'model' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('cross-site');
  });

  it('请求体上限：POST 超过 1 MiB 返回 413 payload too large', async () => {
    const hugeBody = JSON.stringify({ padding: 'x'.repeat(1024 * 1024 + 128) });
    const res = await request('/api/test-sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: hugeBody,
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('payload too large');
  });

  it('作业取消：DELETE /api/jobs/:id 将 queued 作业转为 cancelled', async () => {
    const job: Job = {
      id: 'job-test-cancel-01',
      experiment: 'model',
      status: 'queued',
      startedAt: new Date().toISOString(),
      log: [],
    };
    jobs.set(job.id, job);
    const res = await request('/api/jobs/job-test-cancel-01', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Job;
    expect(body.status).toBe('cancelled');
  });

  it('作业 ID 校验：含非法路径字符的 job ID 返回 404', async () => {
    const res = await request('/api/jobs/bad..id');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('job not found');
  });

  it('畸形百分号编码：/api/jobs/:id 返回 404 而非 500', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/%E0%A4%A`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('job not found');
  });
});

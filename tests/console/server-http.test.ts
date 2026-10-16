/**
 * HTTP 层集成测试：用 node:http createServer 包裹 handleRequest，经真实 socket + fetch 验证。
 * 覆盖：GET 正常/404、POST/PUT 入参错误路径、静态文件 MIME、作业查询生命周期。
 * 只测只读与入参校验路径，不触发真实命令执行、不写入真实 product-eval 项目。
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { handleRequest } from '../../apps/console/router.ts';
import { jobs, type Job } from '../../apps/console/job-queue.ts';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
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
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
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
    expect(body.project).toBe('examples/product-eval');
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

  it('PUT /api/env/rooms/不存在 返回 404 room not found', async () => {
    const res = await request('/api/env/rooms/not-exists-room', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: {} }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('room not found');
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
});

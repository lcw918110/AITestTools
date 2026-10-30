/**
 * 作业日志增量接口测试：
 * 1. getJobLogs 单元行为（内存内、滑动窗口、游标越界重置）。
 * 2. HTTP 集成（经真实 socket + fetch）：GET /api/jobs/:id/logs?offset=N
 *    覆盖内存命中、磁盘回退、404、405、非法 offset。
 * 不触发真实命令执行，不写入真实 product-eval 项目。
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// JOBS_DIR 是 job-queue.ts 模块加载时固化的常量，必须在 import 之前设置
// PROCTOR_CONSOLE_JOBS_DIR。注意：ESM 的 import 会被静态提升到文件顶部，
// 先于任何顶层语句执行，因此这里不能依赖 vi.stubEnv（它也在 import 之后）。
// 唯一可靠的做法是在 vi.hoisted 回调里直接改 process.env，因为该回调
// 确实先于 import 执行；回调内也不能引用顶部 import 的符号，需自行 require。
const { jobsDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dir = join(mkdtempSync(join(tmpdir(), 'proctor-logs-')), 'jobs');
  process.env.PROCTOR_CONSOLE_JOBS_DIR = dir;
  return { jobsDir: dir };
});

import { handleRequest } from '../../apps/console/router.ts';
import { appendLog, getJobLogs, jobs, type Job } from '../../apps/console/job-queue.ts';

describe('getJobLogs 单元行为', () => {
  function makeJob(log: string[], logOffset?: number, status: Job['status'] = 'running'): Job {
    return {
      id: 'job-logs-unit',
      experiment: 'model',
      status,
      startedAt: new Date().toISOString(),
      log,
      ...(logOffset !== undefined ? { logOffset } : {}),
    };
  }

  it('空日志 offset=0 返回空增量，游标 0，不重置', () => {
    const r = getJobLogs(makeJob([]), 0);
    expect(r.lines).toEqual([]);
    expect(r.nextOffset).toBe(0);
    expect(r.totalLines).toBe(0);
    expect(r.reset).toBe(false);
    expect(r.status).toBe('running');
  });

  it('offset=0 首次拉取返回全部行，游标推进到总行数', () => {
    const r = getJobLogs(makeJob(['a', 'b', 'c']), 0);
    expect(r.lines).toEqual(['a', 'b', 'c']);
    expect(r.nextOffset).toBe(3);
    expect(r.totalLines).toBe(3);
    expect(r.reset).toBe(false);
  });

  it('offset=总行数 无新行时返回空增量', () => {
    const r = getJobLogs(makeJob(['a', 'b']), 2);
    expect(r.lines).toEqual([]);
    expect(r.nextOffset).toBe(2);
    expect(r.reset).toBe(false);
  });

  it('offset 在中间时返回自 offset 起的增量', () => {
    const r = getJobLogs(makeJob(['a', 'b', 'c', 'd']), 2);
    expect(r.lines).toEqual(['c', 'd']);
    expect(r.nextOffset).toBe(4);
    expect(r.reset).toBe(false);
  });

  it('负数或 NaN offset 视为 0', () => {
    const neg = getJobLogs(makeJob(['a']), -5);
    expect(neg.lines).toEqual(['a']);
    const nan = getJobLogs(makeJob(['a']), Number.NaN);
    expect(nan.lines).toEqual(['a']);
  });

  it('游标超前于总行数时全量重置（reset=true，返回当前全部行与新游标）', () => {
    const r = getJobLogs(makeJob(['a', 'b']), 99);
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(['a', 'b']);
    expect(r.nextOffset).toBe(2);
  });

  it('appendLog 超 500 行截断后 logOffset 推进，游标增量不丢新行', () => {
    const job = makeJob([]);
    for (let i = 0; i < 505; i++) {
      appendLog(job, `line-${i}`);
    }
    // 内存/磁盘真相：至多 500 行
    expect(job.log.length).toBe(500);
    expect(job.logOffset).toBe(5);
    // 客户端持续以绝对行号游标拉取，未错过任何新行
    const r = getJobLogs(job, 503);
    expect(r.reset).toBe(false);
    expect(r.lines).toEqual(['line-503', 'line-504']);
    expect(r.nextOffset).toBe(505);
    // 游标落后于已淘汰区间时触发重置
    const stale = getJobLogs(job, 2);
    expect(stale.reset).toBe(true);
    expect(stale.lines.length).toBe(500);
    expect(stale.nextOffset).toBe(505);
  });
});

describe('HTTP /api/jobs/:id/logs 集成', () => {
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
    rmSync(jobsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jobs.clear();
  });

  afterEach(() => {
    jobs.clear();
  });

  async function request(path: string, init?: Parameters<typeof fetch>[1]) {
    return fetch(`${baseUrl}${path}`, init);
  }

  it('内存作业：返回增量行与新游标', async () => {
    const job: Job = {
      id: 'job-logs-mem',
      experiment: 'model',
      status: 'running',
      startedAt: new Date().toISOString(),
      log: ['a', 'b', 'c'],
    };
    jobs.set(job.id, job);
    const res = await request('/api/jobs/job-logs-mem/logs?offset=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: string[]; nextOffset: number; reset: boolean; status: string };
    expect(body.lines).toEqual(['b', 'c']);
    expect(body.nextOffset).toBe(3);
    expect(body.reset).toBe(false);
    expect(body.status).toBe('running');
  });

  it('磁盘回退：内存无此作业但 JOBS_DIR 有 json 时按文件内容返回', async () => {
    mkdirSync(jobsDir, { recursive: true });
    const onDisk = {
      id: 'job-logs-disk',
      experiment: 'model',
      status: 'done',
      startedAt: new Date().toISOString(),
      log: ['x', 'y'],
    };
    writeFileSync(join(jobsDir, 'job-logs-disk.json'), JSON.stringify(onDisk));
    const res = await request('/api/jobs/job-logs-disk/logs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: string[]; nextOffset: number; status: string };
    expect(body.lines).toEqual(['x', 'y']);
    expect(body.nextOffset).toBe(2);
    expect(body.status).toBe('done');
  });

  it('未知作业返回 404', async () => {
    const res = await request('/api/jobs/job-logs-unknown/logs');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('job not found');
  });

  it('非法作业 ID 返回 404', async () => {
    const res = await request('/api/jobs/bad..id/logs');
    expect(res.status).toBe(404);
  });

  it('非 GET 方法返回 405', async () => {
    const job: Job = {
      id: 'job-logs-405',
      experiment: 'model',
      status: 'done',
      startedAt: new Date().toISOString(),
      log: [],
    };
    jobs.set(job.id, job);
    const res = await request('/api/jobs/job-logs-405/logs', { method: 'DELETE' });
    expect(res.status).toBe(405);
  });

  it('缺失或非法 offset 默认按 0 处理', async () => {
    const job: Job = {
      id: 'job-logs-offset',
      experiment: 'model',
      status: 'running',
      startedAt: new Date().toISOString(),
      log: ['a', 'b'],
    };
    jobs.set(job.id, job);
    const missing = await request('/api/jobs/job-logs-offset/logs');
    expect(((await missing.json()) as { lines: string[] }).lines).toEqual(['a', 'b']);
    const junk = await request('/api/jobs/job-logs-offset/logs?offset=abc');
    expect(((await junk.json()) as { lines: string[] }).lines).toEqual(['a', 'b']);
  });

  it('原 GET /api/jobs/:id 与 DELETE 取消路径不受影响', async () => {
    const job: Job = {
      id: 'job-logs-regression',
      experiment: 'model',
      status: 'queued',
      startedAt: new Date().toISOString(),
      log: ['line1'],
    };
    jobs.set(job.id, job);
    const got = await request('/api/jobs/job-logs-regression');
    expect(got.status).toBe(200);
    expect(((await got.json()) as { id: string }).id).toBe('job-logs-regression');

    const del = await request('/api/jobs/job-logs-regression', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { status: string }).status).toBe('cancelled');
  });
});

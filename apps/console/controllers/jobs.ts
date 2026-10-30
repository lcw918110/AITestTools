/**
 * 作业查询与取消（controller）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpResponse } from '../http.ts';
import { JOBS_DIR } from '../config.ts';
import { safeUnder } from '../bank.ts';
import { parseJsonObject } from '../parse.ts';
import { cancelJob, getJobLogs, jobs, type Job } from '../job-queue.ts';

function isSafeJobId(id: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(id) && !id.includes('..');
}

/** GET /api/jobs/:id */
export async function jobsGet(id: string): Promise<HttpResponse> {
  if (!isSafeJobId(id)) {
    return { status: 404, body: { error: 'job not found' } };
  }
  const job = jobs.get(id);
  if (!job) {
    const file = safeUnder(JOBS_DIR, join(JOBS_DIR, `${id}.json`));
    if (file && existsSync(file)) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (e) {
        return {
          status: 500,
          body: { error: `读取作业文件失败（${id}.json）：${(e as Error).message}` },
        };
      }
      const parsed = parseJsonObject(text, `${id}.json`);
      if (!parsed.ok) {
        return { status: 500, body: { error: `作业文件损坏：${parsed.error}` } };
      }
      return { status: 200, body: parsed.value };
    }
    return { status: 404, body: { error: 'job not found' } };
  }
  return { status: 200, body: job };
}

/** GET /api/jobs/:id/logs?offset=N */
export async function jobsLogsGet(id: string, offset: number): Promise<HttpResponse> {
  if (!isSafeJobId(id)) {
    return { status: 404, body: { error: 'job not found' } };
  }
  let job = jobs.get(id);
  if (!job) {
    const file = safeUnder(JOBS_DIR, join(JOBS_DIR, `${id}.json`));
    if (file && existsSync(file)) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (e) {
        return {
          status: 500,
          body: { error: `读取作业文件失败（${id}.json）：${(e as Error).message}` },
        };
      }
      const parsed = parseJsonObject(text, `${id}.json`);
      if (!parsed.ok) {
        return { status: 500, body: { error: `作业文件损坏：${parsed.error}` } };
      }
      const d = parsed.value;
      const logArr = Array.isArray(d.log)
        ? (d.log as unknown[]).filter((x) => typeof x === 'string').map(String)
        : [];
      const logOffset =
        typeof d.logOffset === 'number' && Number.isFinite(d.logOffset) && d.logOffset >= 0
          ? d.logOffset
          : 0;
      job = {
        id,
        experiment: typeof d.experiment === 'string' ? d.experiment : '',
        status: (d.status as Job['status']) ?? 'done',
        startedAt: typeof d.startedAt === 'string' ? d.startedAt : '',
        log: logArr,
        logOffset,
        ...(typeof d.error === 'string' ? { error: d.error } : {}),
        ...(typeof d.exitCode === 'number' ? { exitCode: d.exitCode } : {}),
        ...(typeof d.resultHint === 'string' ? { resultHint: d.resultHint } : {}),
      };
    } else {
      return { status: 404, body: { error: 'job not found' } };
    }
  }
  return { status: 200, body: getJobLogs(job, offset) };
}

/** DELETE /api/jobs/:id */
export async function jobsCancel(id: string): Promise<HttpResponse> {
  if (!isSafeJobId(id)) {
    return { status: 404, body: { error: 'job not found' } };
  }
  const res = cancelJob(id);
  if (!res.ok) {
    return { status: res.code, body: { error: res.error } };
  }
  return { status: 200, body: res.job };
}

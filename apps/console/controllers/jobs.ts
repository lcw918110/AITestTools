/**
 * 作业查询与取消（controller）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpResponse } from '../http.ts';
import { JOBS_DIR } from '../config.ts';
import { safeUnder } from '../bank.ts';
import { parseJsonObject } from '../parse.ts';
import { cancelJob, jobs } from '../job-queue.ts';

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

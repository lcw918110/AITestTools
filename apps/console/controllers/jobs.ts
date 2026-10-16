/**
 * 作业查询（controller）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpResponse } from '../http.ts';
import { JOBS_DIR } from '../config.ts';
import { jobs } from '../job-queue.ts';

/** GET /api/jobs/:id */
export async function jobsGet(id: string): Promise<HttpResponse> {
  const job = jobs.get(id);
  if (!job) {
    const file = join(JOBS_DIR, `${id}.json`);
    if (existsSync(file)) {
      return { status: 200, body: JSON.parse(readFileSync(file, 'utf8')) };
    }
    return { status: 404, body: { error: 'job not found' } };
  }
  return { status: 200, body: job };
}

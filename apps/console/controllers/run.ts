/**
 * 提交运行任务 POST /api/run（controller）。
 */
import { join } from 'node:path';
import type { HttpResponse } from '../http.ts';
import { PROJECT, JOBS_DIR } from '../config.ts';
import { isExperimentId, resolveRunPlan } from '../run-plan.ts';
import { getTestSet } from '../test-sets.ts';
import { isVerified } from '../env-catalog.ts';
import { assertSafeTaskId, listTasks } from '../bank.ts';
import { getEvalTask } from '../eval-tasks.ts';
import { writeJsonAtomic } from '../json-io.ts';
import { executeJob, jobs, type Job } from '../job-queue.ts';
import { loadPapersetIndex } from '../project-reader.ts';

export interface RunBody {
  experiment?: string;
  live?: boolean;
  model?: string;
  agent?: string;
  sutRoot?: string;
  examMode?: string;
  paperset?: string;
  testSetId?: string;
  taskIds?: string[];
  evalTaskId?: string;
}

export async function run(body: RunBody): Promise<HttpResponse> {
  const experiment = body.experiment ?? '';
  if (!isExperimentId(experiment)) {
    return { status: 400, body: { error: 'unknown experiment' } };
  }
  let paperset = body.paperset;
  if (body.testSetId !== undefined && body.testSetId.trim()) {
    const ts = getTestSet(PROJECT, body.testSetId.trim());
    if ('error' in ts) {
      return { status: ts.code, body: { error: ts.error } };
    }
    paperset = ts.offPaperset;
  }
  const live = Boolean(body.live);
  if (live) {
    const model = (body.model ?? '').trim();
    const agent = (body.agent ?? '').trim();
    if (!model || !isVerified(PROJECT, 'model', model)) {
      return { status: 400, body: { error: '请到运行环境页验证并选择模型' } };
    }
    if (!agent || !isVerified(PROJECT, 'agent', agent)) {
      return { status: 400, body: { error: '请到运行环境页验证并选择 Agent' } };
    }
  }
  if (body.taskIds !== undefined) {
    if (!Array.isArray(body.taskIds)) {
      return { status: 400, body: { error: 'taskIds 须为人题号数组' } };
    }
    for (const tid of body.taskIds) {
      const bad = assertSafeTaskId(tid);
      if (bad) {
        return { status: 400, body: { error: bad } };
      }
    }
  }
  const bankTasks = listTasks(PROJECT);
  const resolved = resolveRunPlan({
    experiment,
    ...(body.examMode !== undefined ? { examMode: body.examMode } : {}),
    ...(paperset !== undefined ? { paperset } : {}),
    ...(body.taskIds !== undefined ? { taskIds: body.taskIds } : {}),
    papersets: loadPapersetIndex(),
    tasks: bankTasks.map((t) => ({
      taskId: t.taskId,
      ...(t.offId !== undefined ? { offId: t.offId } : {}),
      ...(t.onId !== undefined ? { onId: t.onId } : {}),
    })),
  });
  if (!resolved.ok) {
    return { status: 400, body: { error: resolved.error } };
  }
  let evalTaskId: string | undefined;
  if (body.evalTaskId !== undefined && body.evalTaskId !== '') {
    const row = getEvalTask(PROJECT, body.evalTaskId);
    if ('error' in row) {
      return { status: row.code, body: { error: row.error } };
    }
    evalTaskId = row.id;
  }
  const id = `job-${Date.now().toString(36)}`;
  const job: Job = {
    id,
    experiment,
    status: 'queued',
    startedAt: new Date().toISOString(),
    log: [],
    ...(evalTaskId !== undefined ? { evalTaskId } : {}),
  };
  jobs.set(id, job);
  writeJsonAtomic(join(JOBS_DIR, `${id}.json`), job);
  executeJob(job, {
    experiment,
    live: Boolean(body.live),
    plan: resolved.plan,
    ...(body.model !== undefined ? { model: body.model } : {}),
    ...(body.agent !== undefined ? { agent: body.agent } : {}),
    ...(body.sutRoot !== undefined ? { sutRoot: body.sutRoot } : {}),
    ...(evalTaskId !== undefined ? { evalTaskId } : {}),
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    job.status = 'error';
    job.error = msg;
    job.finishedAt = job.finishedAt ?? new Date().toISOString();
    console.error(`executeJob ${job.id} 未捕获异常：`, e);
    try {
      writeJsonAtomic(join(JOBS_DIR, `${job.id}.json`), job);
    } catch {
      /* 落盘失败仅记录，不再抛出 */
    }
  });
  return { status: 202, body: { jobId: id } };
}

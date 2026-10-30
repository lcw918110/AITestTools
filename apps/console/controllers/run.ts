/**
 * 提交运行任务 POST /api/run（controller）。
 */
import type { HttpResponse } from '../http.ts';
import { PROJECT } from '../config.ts';
import { isExperimentId, resolveRunPlan } from '../run-plan.ts';
import { getTestSet } from '../test-sets.ts';
import { assertSafeTaskId, listTasks } from '../bank.ts';
import { freezeEvalTaskPurpose, type TaskPurpose } from '../eval-tasks.ts';
import { executeJob, getInstanceToken, jobs, persistJob, type Job } from '../job-queue.ts';
import { loadReleaseIndex } from '../project-reader.ts';
import { evaluateIsolationGate } from '../../../src/security/isolation-backend.ts';

export interface RunBody {
  experiment?: string;
  live?: boolean;
  model?: string;
  agent?: string;
  sutRoot?: string;
  examMode?: string;
  release?: string;
  testSetId?: string;
  taskIds?: string[];
  evalTaskId?: string;
}

export async function run(body: RunBody): Promise<HttpResponse> {
  const experiment = body.experiment ?? '';
  if (!isExperimentId(experiment)) {
    return { status: 400, body: { error: 'unknown experiment' } };
  }
  let release = body.release;
  if (body.testSetId !== undefined && body.testSetId.trim()) {
    const ts = getTestSet(PROJECT, body.testSetId.trim());
    if ('error' in ts) {
      return { status: ts.code, body: { error: ts.error } };
    }
    release = ts.offRelease;
  }
  const live = Boolean(body.live);
  if (live) {
    const gate = await evaluateIsolationGate();
    if (!gate.allowed) {
      return {
        status: 400,
        body: {
          error: `当前缺少经验证的操作系统级隔离后端，已拒绝启动真实宿主任务：${gate.reason}；请先勾选预检（仅校验题库）`,
        },
      };
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
    ...(release !== undefined ? { release } : {}),
    ...(body.taskIds !== undefined ? { taskIds: body.taskIds } : {}),
    releases: loadReleaseIndex(),
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
  let purpose: TaskPurpose | undefined;
  if (body.evalTaskId !== undefined && body.evalTaskId !== '') {
    const row = freezeEvalTaskPurpose(PROJECT, body.evalTaskId);
    if ('error' in row) {
      return { status: row.code, body: { error: row.error } };
    }
    evalTaskId = row.id;
    purpose = row.purpose;
  }
  const id = `job-${Date.now().toString(36)}`;
  const job: Job = {
    id,
    experiment,
    status: 'queued',
    startedAt: new Date().toISOString(),
    log: [],
    managedByInstanceToken: getInstanceToken(),
    ...(purpose !== undefined ? { purpose } : {}),
    ...(evalTaskId !== undefined ? { evalTaskId } : {}),
  };
  jobs.set(id, job);
  persistJob(job);
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
      persistJob(job);
    } catch {
      /* 落盘失败仅记录，不再抛出 */
    }
  });
  return { status: 202, body: { jobId: id } };
}

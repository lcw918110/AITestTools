/**
 * 测试任务 CRUD（controller）。
 */
import type { HttpResponse } from '../http.ts';
import { PROJECT } from '../config.ts';
import {
  createEvalTask,
  deleteEvalTask,
  getEvalTask,
  listEvalTasks,
  updateEvalTask,
  type EvalTaskInput,
} from '../eval-tasks.ts';

export { type EvalTaskInput } from '../eval-tasks.ts';

export async function evalTasksList(): Promise<HttpResponse> {
  const { tasks, errors } = listEvalTasks(PROJECT);
  return { status: 200, body: { tasks, errors } };
}

export async function evalTasksCreate(body: EvalTaskInput): Promise<HttpResponse> {
  const created = createEvalTask(PROJECT, body);
  if ('error' in created) {
    return { status: created.code, body: { error: created.error } };
  }
  return { status: 201, body: created };
}

export async function evalTaskGet(id: string): Promise<HttpResponse> {
  const row = getEvalTask(PROJECT, id);
  if ('error' in row) {
    return { status: row.code, body: { error: row.error } };
  }
  return { status: 200, body: row };
}

export async function evalTaskUpdate(id: string, body: EvalTaskInput): Promise<HttpResponse> {
  const updated = updateEvalTask(PROJECT, id, body);
  if ('error' in updated) {
    return { status: updated.code, body: { error: updated.error } };
  }
  return { status: 200, body: updated };
}

export async function evalTaskDelete(id: string): Promise<HttpResponse> {
  const result = deleteEvalTask(PROJECT, id);
  if ('error' in result) {
    return { status: result.code, body: { error: result.error } };
  }
  return { status: 200, body: result };
}

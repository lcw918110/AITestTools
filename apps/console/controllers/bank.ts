/**
 * 题库管理 API：任务 CRUD 与校验（controller）。
 */
import type { HttpResponse } from '../http.ts';
import { PROJECT, REPO_ROOT } from '../config.ts';
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  nextCreateTaskId,
  updateTask,
  validateBank,
  type CreateTaskBody,
  type UpdateTaskBody,
} from '../bank.ts';

/** GET /api/bank/tasks */
export async function bankTasksList(): Promise<HttpResponse> {
  return {
    status: 200,
    body: { tasks: listTasks(PROJECT), nextTaskId: nextCreateTaskId(PROJECT) },
  };
}

/** GET /api/bank/tasks/:taskId */
export async function bankTaskGet(taskId: string): Promise<HttpResponse> {
  const detail = getTask(PROJECT, taskId);
  if ('error' in detail) {
    return { status: detail.code, body: { error: detail.error } };
  }
  return { status: 200, body: detail };
}

/** PUT /api/bank/tasks/:taskId */
export async function bankTaskUpdate(taskId: string, body: UpdateTaskBody): Promise<HttpResponse> {
  const result = await updateTask(PROJECT, REPO_ROOT, taskId, body);
  if ('error' in result) {
    return { status: result.code, body: { error: result.error, log: result.log } };
  }
  return { status: 200, body: result };
}

/** POST /api/bank/tasks */
export async function bankTaskCreate(body: CreateTaskBody): Promise<HttpResponse> {
  const result = await createTask(PROJECT, body, {
    validate: () => validateBank(REPO_ROOT),
  });
  if ('error' in result) {
    return { status: result.code, body: { error: result.error, log: result.log } };
  }
  return { status: 201, body: result };
}

/** DELETE /api/bank/tasks/:taskId */
export async function bankTaskDelete(
  taskId: string,
  confirmId: string | undefined,
): Promise<HttpResponse> {
  const result = deleteTask(PROJECT, taskId, confirmId);
  if ('error' in result) {
    return { status: result.code, body: { error: result.error } };
  }
  return { status: 200, body: result };
}

/** POST /api/bank/validate */
export async function bankValidate(): Promise<HttpResponse> {
  const result = await validateBank(REPO_ROOT);
  return { status: 200, body: result };
}

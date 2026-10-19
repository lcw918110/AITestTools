/**
 * 路由分发：URL → controller 映射。
 * 只做路由匹配、请求体读取与 JSON 解析、响应写出；不写业务逻辑。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { json } from './http.ts';
import { readBody, parseJsonBody } from './request.ts';
import { HOST, PORT, PUBLIC } from './config.ts';
import { serveStatic } from './static-server.ts';
import * as healthController from './controllers/health.ts';
import {
  testSetsList,
  testSetsCreate,
  testSetsGet,
  type TestSetCreateBody,
} from './controllers/test-sets.ts';
import {
  envAddAgent,
  envAddModel,
  envCatalog,
  envEnvironmentsList,
  envEnvironmentsUpdate,
  envManifest,
  envVerify,
} from './controllers/env.ts';
import {
  evalTaskDelete,
  evalTaskGet,
  evalTaskUpdate,
  evalTasksCreate,
  evalTasksList,
  type EvalTaskInput,
} from './controllers/eval-tasks.ts';
import { baselinesList, baselinesPin, compare, runsList, runsView } from './controllers/runs.ts';
import { jobsGet } from './controllers/jobs.ts';
import { run, type RunBody } from './controllers/run.ts';
import {
  bankTaskCreate,
  bankTaskDelete,
  bankTaskGet,
  bankTasksList,
  bankTaskTransition,
  bankTaskUpdate,
  bankValidate,
} from './controllers/bank.ts';
import type { CreateTaskBody, UpdateTaskBody } from './bank.ts';
import {
  modelPoolDelete,
  modelPoolList,
  modelPoolUpsert,
  type ModelEntryBody,
} from './controllers/model-pool.ts';
import { triggerJudge, type TriggerJudgeBody } from './controllers/judge.ts';

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/health') {
    const r = await healthController.health();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/presets') {
    const r = await healthController.presets();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/project') {
    const r = await healthController.project();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/test-sets') {
    const r = await testSetsList();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/test-sets') {
    const parsed = parseJsonBody<TestSetCreateBody>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await testSetsCreate(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/test-sets/')) {
    const id = decodeURIComponent(pathname.slice('/api/test-sets/'.length));
    const r = await testSetsGet(id);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/env/catalog') {
    const r = await envCatalog();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/env/models') {
    const parsed = parseJsonBody<{ id?: string }>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await envAddModel(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/env/agents') {
    const parsed = parseJsonBody<{ id?: string }>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await envAddAgent(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/env/verify') {
    const parsed = parseJsonBody<{ kind?: string; id?: string }>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await envVerify(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/env/environments') {
    const r = await envEnvironmentsList();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/env/manifest') {
    const r = envManifest();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'PUT' && pathname.startsWith('/api/env/environments/')) {
    const environmentName = decodeURIComponent(pathname.slice('/api/env/environments/'.length));
    const parsed = parseJsonBody<{
      host?: Record<string, unknown>;
      workspace?: unknown;
      network?: unknown;
    }>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await envEnvironmentsUpdate(environmentName, parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/eval-tasks') {
    const r = await evalTasksList();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/eval-tasks') {
    const parsed = parseJsonBody<EvalTaskInput>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await evalTasksCreate(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (pathname.startsWith('/api/eval-tasks/')) {
    const id = decodeURIComponent(pathname.slice('/api/eval-tasks/'.length));
    if (req.method === 'GET') {
      const r = await evalTaskGet(id);
      json(res, r.status, r.body);
      return;
    }
    if (req.method === 'PUT') {
      const parsed = parseJsonBody<EvalTaskInput>(await readBody(req));
      if (!parsed.ok) {
        json(res, 400, { error: parsed.error });
        return;
      }
      const r = await evalTaskUpdate(id, parsed.value);
      json(res, r.status, r.body);
      return;
    }
    if (req.method === 'DELETE') {
      const r = await evalTaskDelete(id);
      json(res, r.status, r.body);
      return;
    }
    json(res, 405, { error: 'method not allowed' });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/runs') {
    const r = await runsList();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/runs/view') {
    const raw = url.searchParams.get('path') ?? '';
    const r = await runsView(raw);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/baselines') {
    const r = await baselinesList();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/baselines/pin') {
    const parsed = parseJsonBody<{ runPath?: string; name?: string }>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await baselinesPin(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/compare') {
    const parsed = parseJsonBody<{
      baseline?: string;
      candidate?: string;
      writeMd?: boolean;
    }>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await compare(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
    const id = pathname.slice('/api/jobs/'.length);
    const r = await jobsGet(id);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/run') {
    const parsed = parseJsonBody<RunBody>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await run(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/bank/tasks') {
    const r = await bankTasksList();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/bank/tasks/')) {
    const taskId = decodeURIComponent(pathname.slice('/api/bank/tasks/'.length));
    const r = await bankTaskGet(taskId);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'PUT' && pathname.startsWith('/api/bank/tasks/')) {
    const taskId = decodeURIComponent(pathname.slice('/api/bank/tasks/'.length));
    const parsed = parseJsonBody<UpdateTaskBody>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await bankTaskUpdate(taskId, parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/bank/tasks') {
    const parsed = parseJsonBody<CreateTaskBody>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await bankTaskCreate(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'DELETE' && pathname.startsWith('/api/bank/tasks/')) {
    const taskId = decodeURIComponent(pathname.slice('/api/bank/tasks/'.length));
    let confirmId = url.searchParams.get('confirmId') ?? undefined;
    if (confirmId === undefined) {
      const raw = await readBody(req);
      if (raw.trim()) {
        let body: { confirmId?: string };
        try {
          body = JSON.parse(raw) as { confirmId?: string };
        } catch {
          json(res, 400, { error: 'invalid json' });
          return;
        }
        confirmId = body.confirmId;
      }
    }
    const r = await bankTaskDelete(taskId, confirmId);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/bank/validate') {
    const r = await bankValidate();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname.endsWith('/lifecycle')) {
    const taskId = decodeURIComponent(
      pathname.slice('/api/bank/tasks/'.length, -'/lifecycle'.length),
    );
    const parsed = parseJsonBody<{ to?: string; reason?: string }>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await bankTaskTransition(taskId, parsed.value);
    json(res, r.status, r.body);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/model-pool') {
    const r = await modelPoolList();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/model-pool') {
    const parsed = parseJsonBody<ModelEntryBody>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await modelPoolUpsert(parsed.value);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'DELETE' && pathname.startsWith('/api/model-pool/')) {
    const modelId = decodeURIComponent(pathname.slice('/api/model-pool/'.length));
    const r = await modelPoolDelete(modelId);
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/judge') {
    const parsed = parseJsonBody<TriggerJudgeBody>(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    const r = await triggerJudge(parsed.value);
    json(res, r.status, r.body);
    return;
  }

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    serveStatic(res, join(PUBLIC, 'index.html'));
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/')) {
    serveStatic(res, join(PUBLIC, pathname.slice(1)));
    return;
  }
  json(res, 405, { error: 'method not allowed' });
}

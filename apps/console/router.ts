/**
 * 路由分发：URL → controller 映射。
 * 只做路由匹配、请求体读取与 JSON 解析、响应写出；不写业务逻辑。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { json } from './http.ts';
import { readBody, parseJsonBody, RequestBodyTooLargeError } from './request.ts';
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
import {
  baselinesList,
  baselinesPin,
  compare,
  runsList,
  runsTrend,
  runsView,
} from './controllers/runs.ts';
import { jobsCancel, jobsGet } from './controllers/jobs.ts';
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
import { triggerJudge, judgeAgreement, type TriggerJudgeBody } from './controllers/judge.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** 解码 URL 路径片段；畸形百分号编码返回 null，交由调用方映射为 404/400。 */
function safeDecodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function parseHostname(hostHeader: string): string | null {
  const trimmed = hostHeader.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end === -1) return null;
    return trimmed.slice(0, end + 1);
  }
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/**
 * 校验本地 Console 请求边界（REQ-CONSOLE-SEC-001）：
 * 1. Host 头必须为本机回环地址（防 DNS Rebinding）
 * 2. 状态变更请求（非 GET/HEAD/OPTIONS）若携带 Origin / Referer，必须为本机回环源（防跨站 CSRF）
 */
export function verifyRequestOriginAndHost(
  req: IncomingMessage,
): { ok: true } | { ok: false; status: number; error: string } {
  const hostHeader = req.headers.host;
  if (typeof hostHeader === 'string' && hostHeader.trim() !== '') {
    const hostName = parseHostname(hostHeader);
    if (!hostName || !LOOPBACK_HOSTS.has(hostName)) {
      return { ok: false, status: 403, error: 'forbidden host' };
    }
  }

  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const originHeader = req.headers.origin;
    if (typeof originHeader === 'string' && originHeader.trim() !== '') {
      try {
        const originUrl = new URL(originHeader);
        if (
          (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') ||
          !LOOPBACK_HOSTS.has(originUrl.hostname.toLowerCase())
        ) {
          return { ok: false, status: 403, error: 'cross-origin write forbidden' };
        }
      } catch {
        return { ok: false, status: 403, error: 'invalid origin header' };
      }
    }

    const refererHeader = req.headers.referer;
    if (typeof refererHeader === 'string' && refererHeader.trim() !== '') {
      try {
        const refUrl = new URL(refererHeader);
        if (
          (refUrl.protocol !== 'http:' && refUrl.protocol !== 'https:') ||
          !LOOPBACK_HOSTS.has(refUrl.hostname.toLowerCase())
        ) {
          return { ok: false, status: 403, error: 'cross-origin referer forbidden' };
        }
      } catch {
        return { ok: false, status: 403, error: 'invalid referer header' };
      }
    }

    const secFetchSite = req.headers['sec-fetch-site'];
    if (secFetchSite === 'cross-site') {
      return { ok: false, status: 403, error: 'cross-site write forbidden' };
    }
  }

  return { ok: true };
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sec = verifyRequestOriginAndHost(req);
  if (!sec.ok) {
    json(res, sec.status, { error: sec.error });
    return;
  }
  try {
    await dispatchRequest(req, res);
  } catch (e) {
    if (e instanceof RequestBodyTooLargeError) {
      json(res, 413, { error: e.message });
      return;
    }
    // 畸形百分号编码（如 %E0%A4%A）会让 decodeURIComponent 抛 URIError；
    // 统一收口为结构化 400，避免 500 与内部错误文本外泄。
    if (e instanceof URIError) {
      json(res, 400, { error: 'invalid url encoding' });
      return;
    }
    throw e;
  }
}

async function dispatchRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/health') {
    const r = await healthController.health();
    json(res, r.status, r.body);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/health/check') {
    const r = await healthController.healthCheck();
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
  if (req.method === 'GET' && pathname === '/api/runs/trend') {
    const r = await runsTrend({
      dataset: url.searchParams.get('dataset') ?? undefined,
      metric: url.searchParams.get('metric') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
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
  if (pathname.startsWith('/api/jobs/')) {
    const id = safeDecodeSegment(pathname.slice('/api/jobs/'.length));
    if (id === null) {
      json(res, 404, { error: 'job not found' });
      return;
    }
    if (req.method === 'GET') {
      const r = await jobsGet(id);
      json(res, r.status, r.body);
      return;
    }
    if (req.method === 'DELETE') {
      const r = await jobsCancel(id);
      json(res, r.status, r.body);
      return;
    }
    json(res, 405, { error: 'method not allowed' });
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
  if (req.method === 'GET' && pathname === '/api/judge/agreement') {
    const raw = url.searchParams.get('runPath') ?? '';
    const r = judgeAgreement(raw);
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

/**
 * 产品控制台本地服务：编排 proctor / 读 product-eval 产物。
 * 仅绑定 127.0.0.1。
 */
import { spawn } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optStr, parseJsonObject, str, strArray } from './parse.ts';
import {
  assertSafeTaskId,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  nextCreateTaskId,
  safeUnder,
  updateTask,
  validateBank,
} from './bank.ts';
import {
  buildRunSummary,
  listBaselineNames,
  parseBaselinePathFromEffectMd,
} from './run-summary.ts';
import { buildRunDashboard, readHostedSnaps } from './dashboard.ts';
import {
  isExperimentId,
  resolveRunPlan,
  taskIdsOfItems,
  type ExperimentId,
  type PapersetIndex,
  type RunPlan,
} from './run-plan.ts';
import {
  appendEvalTaskRun,
  createEvalTask,
  deleteEvalTask,
  getEvalTask,
  listEvalTasks,
  updateEvalTask,
} from './eval-tasks.ts';
import { createTestSet, getTestSet, listTestSets } from './test-sets.ts';
import {
  addEnvAgent,
  addEnvModel,
  loadEnvCatalog,
  verifyEnvEntry,
  isVerified,
} from './env-catalog.ts';
import { runBaselinePin } from '../../src/cli/commands/baseline-pin.ts';
import { compareRuns, writeEffectCompareMarkdown } from '../../src/report/compare.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const PUBLIC = join(__dirname, 'public');
const PROJECT = join(REPO_ROOT, 'examples/product-eval');
const JOBS_DIR = join(__dirname, '.jobs');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PROCTOR_CONSOLE_PORT ?? 8787);

mkdirSync(JOBS_DIR, { recursive: true });

const PRESETS = [
  {
    id: 'model',
    label: '测模型',
    description: '同一 Agent、无插件、同一任务；换模型',
    paperset: 'paired-off',
    room: 'hosted-plain-v1',
    needsLive: true,
    defaultExamMode: 'off' as const,
    defaultPaperset: 'paired-off',
    defaultTestSetId: 'full',
  },
  {
    id: 'plugin',
    label: '测万象术',
    description: '同一 Agent、同一模型、同一批题目；只变有无插件',
    paperset: 'paired-off + paired-on',
    room: 'plain / plugin',
    needsLive: true,
    paired: true,
    defaultExamMode: 'both' as const,
    defaultPaperset: 'paired-off',
    defaultTestSetId: 'full',
  },
  {
    id: 'agent',
    label: '测 Agent',
    description: '同一模型、无插件、同一任务',
    paperset: 'paired-off',
    room: 'hosted-plain-v1',
    needsLive: true,
    defaultExamMode: 'off' as const,
    defaultPaperset: 'paired-off',
    defaultTestSetId: 'full',
  },
] as const;

type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'interrupted';

interface Job {
  id: string;
  experiment: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  log: string[];
  exitCode?: number;
  resultHint?: string;
  error?: string;
  evalTaskId?: string;
}

const jobs = new Map<string, Job>();

function reconcileJobs(): void {
  if (!existsSync(JOBS_DIR)) return;
  for (const name of readdirSync(JOBS_DIR)) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    const file = join(JOBS_DIR, name);
    let job: Job | undefined;
    try {
      const text = readFileSync(file, 'utf8');
      const parsed = parseJsonObject(text, name);
      if (!parsed.ok) continue;
      const d = parsed.value;
      const jid = str(d.id);
      if (jid === undefined) continue;
      const st = str(d.status);
      if (st !== 'queued' && st !== 'running' && st !== 'done' && st !== 'error') continue;
      const exp = str(d.experiment) ?? '';
      const started = str(d.startedAt) ?? new Date().toISOString();
      const logArr = Array.isArray(d.log)
        ? (d.log as unknown[]).filter((x) => typeof x === 'string').map(String)
        : [];
      job = {
        id: jid,
        experiment: exp,
        status: st as JobStatus,
        startedAt: started,
        log: logArr,
      };
      const evalTaskId = optStr(d, 'evalTaskId');
      if (evalTaskId !== undefined) job.evalTaskId = evalTaskId;
      const finishedAt = optStr(d, 'finishedAt');
      if (finishedAt !== undefined) job.finishedAt = finishedAt;
      if (typeof d.exitCode === 'number') job.exitCode = d.exitCode;
      const resultHint = optStr(d, 'resultHint');
      if (resultHint !== undefined) job.resultHint = resultHint;
      const error = optStr(d, 'error');
      if (error !== undefined) job.error = error;
    } catch {
      continue;
    }
    if (job === undefined) continue;
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'interrupted';
      if (!job.error) job.error = '服务重启，任务中断（未恢复运行）';
      job.finishedAt = job.finishedAt ?? new Date().toISOString();
      writeFileSync(file, `${JSON.stringify(job, null, 2)}\n`);
    }
    jobs.set(id, job);
  }
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listRuns(limit = 20): Array<{ path: string; name: string; mtime: number }> {
  const runsDir = join(PROJECT, 'runs');
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .map((name) => {
      const path = join(runsDir, name);
      try {
        const st = statSync(path);
        if (!st.isDirectory()) return undefined;
        return { path, name, mtime: st.mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((x): x is { path: string; name: string; mtime: number } => x !== undefined)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

function projectSummary() {
  const errors: string[] = [];
  let examName = '';
  let examDescription = '';
  try {
    const examRaw = readFileSync(join(PROJECT, 'exam.json'), 'utf8');
    const parsed = parseJsonObject(examRaw, 'exam.json');
    if (parsed.ok) {
      examName = str(parsed.value.name) ?? '';
      examDescription = str(parsed.value.description) ?? '';
    } else {
      errors.push(parsed.error);
    }
  } catch (e) {
    errors.push(`exam.json：读取失败（${(e as Error).message}）`);
  }

  const papersetsDir = join(PROJECT, 'papersets');
  const papersets = readdirSync(papersetsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const text = readFileSync(join(papersetsDir, f), 'utf8');
        const parsed = parseJsonObject(text, `papersets/${f}`);
        if (!parsed.ok) {
          errors.push(parsed.error);
          return undefined;
        }
        const doc = parsed.value;
        const name = str(doc.name);
        if (name === undefined) {
          errors.push(`papersets/${f}：缺少 name`);
          return undefined;
        }
        const desc = str(doc.description) ?? '';
        const room = str(doc.room) ?? '';
        const items = strArray(doc.items) ?? [];
        return {
          file: f.replace(/\.json$/, ''),
          name,
          description: desc,
          room,
          itemCount: items.length,
          taskIds: taskIdsOfItems(items),
        };
      } catch (e) {
        errors.push(`papersets/${f}：读取失败（${(e as Error).message}）`);
        return undefined;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  const roomsDir = join(PROJECT, 'rooms');
  const rooms = readdirSync(roomsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const text = readFileSync(join(roomsDir, f), 'utf8');
        const parsed = parseJsonObject(text, `rooms/${f}`);
        if (!parsed.ok) {
          errors.push(parsed.error);
          return undefined;
        }
        const doc = parsed.value;
        const name = str(doc.name);
        if (name === undefined) {
          errors.push(`rooms/${f}：缺少 name`);
          return undefined;
        }
        const desc = str(doc.description) ?? '';
        const host = doc.host;
        let model = '';
        let hasPlugin = false;
        if (typeof host === 'object' && host !== null && !Array.isArray(host)) {
          const h = host as Record<string, unknown>;
          model = str(h.model) ?? '';
          hasPlugin = typeof h.plugin === 'string' && h.plugin.length > 0;
        }
        return { name, description: desc, model, hasPlugin };
      } catch (e) {
        errors.push(`rooms/${f}：读取失败（${(e as Error).message}）`);
        return undefined;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  const materials = existsSync(join(PROJECT, 'bank/materials'))
    ? readdirSync(join(PROJECT, 'bank/materials')).filter((n) => !n.startsWith('.'))
    : [];
  return {
    project: 'examples/product-eval',
    exam: examName,
    description: examDescription,
    papersets,
    testSets: listTestSets(PROJECT),
    rooms,
    tasks: materials,
    defaults: {
      sutRoot: process.env.SUT_ROOT ?? '',
      model: process.env.PROCTOR_HOSTED_MODEL ?? '',
    },
    errors,
  };
}

function appendLog(job: Job, line: string): void {
  job.log.push(line);
  if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
  writeFileSync(join(JOBS_DIR, `${job.id}.json`), `${JSON.stringify(job, null, 2)}\n`);
}

function runCommand(
  job: Job,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolveExit) => {
    appendLog(job, `$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      shell: false,
    });
    child.stdout.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line.length) appendLog(job, line);
      }
    });
    child.stderr.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line.length) appendLog(job, line);
      }
    });
    child.on('close', (code) => resolveExit(code ?? 1));
    child.on('error', (err) => {
      appendLog(job, `spawn error: ${err.message}`);
      resolveExit(1);
    });
  });
}

function loadPapersetIndex(): PapersetIndex[] {
  const dir = join(PROJECT, 'papersets');
  if (!existsSync(dir)) return [];
  const out: PapersetIndex[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const parsed = parseJsonObject(readFileSync(join(dir, f), 'utf8'), `papersets/${f}`);
      if (!parsed.ok) continue;
      const name = str(parsed.value.name);
      if (name === undefined) continue;
      const items = strArray(parsed.value.items) ?? [];
      out.push({ name, items, taskIds: taskIdsOfItems(items) });
    } catch {
      continue;
    }
  }
  return out;
}

function lastRunDirFromLog(job: Job): string | undefined {
  for (let i = job.log.length - 1; i >= 0; i--) {
    const line = job.log[i];
    if (line !== undefined && line.startsWith('run 完成：')) {
      return line.slice('run 完成：'.length).trim();
    }
  }
  return undefined;
}

function proctorRunArgs(paperset: string, itemIds: string[]): string[] {
  const args = [
    'run',
    'proctor',
    '--',
    'run',
    '--axis',
    'B',
    '--paperset',
    paperset,
    '--project',
    'examples/product-eval',
  ];
  for (const id of itemIds) {
    args.push('--only', id);
  }
  return args;
}
async function executeJob(
  job: Job,
  opts: {
    experiment: ExperimentId;
    live: boolean;
    plan: RunPlan;
    model?: string;
    agent?: string;
    sutRoot?: string;
    evalTaskId?: string;
  },
): Promise<void> {
  job.status = 'running';
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: process.env.PATH };
  if (opts.sutRoot) env.SUT_ROOT = opts.sutRoot;
  if (opts.model) env.PROCTOR_HOSTED_MODEL = opts.model;
  else delete env.PROCTOR_HOSTED_MODEL;
  if (opts.agent) env.PROCTOR_HOSTED_AGENT = opts.agent;
  else delete env.PROCTOR_HOSTED_AGENT;
  if (opts.live) env.PROCTOR_EVAL_LIVE = '1';
  else delete env.PROCTOR_EVAL_LIVE;
  delete env.PROCTOR_HOSTED_PLUGIN;

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let code = 0;

  try {
    if (!opts.live) {
      if (opts.experiment === 'model') {
        appendLog(job, '离线提示：产品测模型为 hosted 直播；先跑 demo schema fixture');
        code = await runCommand(job, npm, ['run', 'eval:model:demo-schema'], env);
      } else {
        appendLog(
          job,
          opts.experiment === 'plugin'
            ? '离线：仅校验 product-eval（真跑请取消「只检查题库」）'
            : '离线：校验试题（Agent 跑卷需直播）',
        );
        code = await runCommand(
          job,
          npm,
          [
            'run',
            'proctor',
            '--',
            'item',
            'validate',
            '--project',
            'examples/product-eval',
            '--check-fixtures',
          ],
          env,
        );
      }
    } else if (opts.plan.legacy === 'paired') {
      if (!opts.sutRoot && !env.SUT_ROOT) {
        throw new Error('测万象术真跑需要填写万象术仓库路径');
      }
      code = await runCommand(job, npm, ['run', 'eval:paired'], env);
    } else if (opts.plan.legacy === 'model') {
      code = await runCommand(
        job,
        npm,
        [
          'run',
          'proctor',
          '--',
          'run',
          '--axis',
          'B',
          '--paperset',
          'eval-model',
          '--project',
          'examples/product-eval',
        ],
        env,
      );
    } else if (opts.plan.legacy === 'agent') {
      code = await runCommand(
        job,
        npm,
        [
          'run',
          'proctor',
          '--',
          'run',
          '--axis',
          'B',
          '--paperset',
          'eval-agent',
          '--project',
          'examples/product-eval',
        ],
        env,
      );
    } else {
      if (opts.plan.needsSut && !opts.sutRoot && !env.SUT_ROOT) {
        throw new Error('有插件真跑需要填写万象术仓库路径');
      }
      for (const note of opts.plan.skipped) appendLog(job, `跳过：${note}`);
      const runDirs: string[] = [];
      for (const step of opts.plan.steps) {
        if (step.itemIds.length === 0) {
          appendLog(job, `跳过空侧：${step.paperset}`);
          continue;
        }
        code = await runCommand(job, npm, proctorRunArgs(step.paperset, step.itemIds), env);
        const dir = lastRunDirFromLog(job);
        if (dir) runDirs.push(dir);
        if (code !== 0) break;
      }
      if (code === 0 && opts.plan.compare && runDirs.length >= 2) {
        const offDir = runDirs[0];
        const onDir = runDirs[1];
        if (offDir !== undefined && onDir !== undefined) {
          appendLog(job, '对照 OFF → ON');
          code = await runCommand(
            job,
            npm,
            ['run', 'proctor', '--', 'compare', '--baseline', offDir, '--candidate', onDir],
            env,
          );
        }
      }
    }

    job.exitCode = code;
    job.status = code === 0 ? 'done' : 'error';
    const latest = listRuns(1)[0];
    if (latest) job.resultHint = latest.path;
    if (code !== 0) job.error = `退出码 ${code}`;
    if (opts.evalTaskId && opts.live && job.resultHint) {
      appendEvalTaskRun(PROJECT, opts.evalTaskId, {
        path: job.resultHint,
        startedAt: job.startedAt,
        jobId: job.id,
      });
    }
  } catch (e) {
    job.status = 'error';
    job.error = (e as Error).message;
    appendLog(job, job.error);
  } finally {
    job.finishedAt = new Date().toISOString();
    writeFileSync(join(JOBS_DIR, `${job.id}.json`), `${JSON.stringify(job, null, 2)}\n`);
  }
}

function serveStatic(res: ServerResponse, filePath: string): void {
  const abs = safeUnder(PUBLIC, filePath);
  if (!abs || !existsSync(abs) || statSync(abs).isDirectory()) {
    json(res, 404, { error: 'not found' });
    return;
  }
  const ext = abs.split('.').pop() ?? '';
  const types: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    svg: 'image/svg+xml',
  };
  res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' });
  createReadStream(abs).pipe(res);
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/health') {
    json(res, 200, { ok: true, project: 'examples/product-eval' });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/presets') {
    json(res, 200, { presets: PRESETS });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/project') {
    json(res, 200, projectSummary());
    return;
  }
  if (req.method === 'GET' && pathname === '/api/test-sets') {
    json(res, 200, { testSets: listTestSets(PROJECT) });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/test-sets') {
    const raw = await readBody(req);
    let body: { name?: string; description?: string; id?: string };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const created = createTestSet(PROJECT, body);
    if ('error' in created) {
      json(res, created.code, { error: created.error });
      return;
    }
    json(res, 201, created);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/env/catalog') {
    json(res, 200, loadEnvCatalog(PROJECT));
    return;
  }
  if (req.method === 'POST' && pathname === '/api/env/models') {
    const raw = await readBody(req);
    let body: { id?: string };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const result = addEnvModel(PROJECT, body.id ?? '');
    if ('error' in result) {
      json(res, result.code, { error: result.error });
      return;
    }
    json(res, 201, result);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/env/agents') {
    const raw = await readBody(req);
    let body: { id?: string };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const result = addEnvAgent(PROJECT, body.id ?? '');
    if ('error' in result) {
      json(res, result.code, { error: result.error });
      return;
    }
    json(res, 201, result);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/env/verify') {
    const raw = await readBody(req);
    let body: { kind?: string; id?: string };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    if (body.kind !== 'model' && body.kind !== 'agent') {
      json(res, 400, { error: 'kind 须为 model 或 agent' });
      return;
    }
    const result = verifyEnvEntry(PROJECT, body.kind, (body.id ?? '').trim());
    if ('error' in result) {
      json(res, result.code, { error: result.error });
      return;
    }
    json(res, 200, result);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/env/rooms') {
    const roomsDir = join(PROJECT, 'rooms');
    const roomFiles: Array<{ name: string; host: Record<string, unknown>; workspace?: unknown; network?: unknown }> = [];
    if (existsSync(roomsDir)) {
      for (const f of readdirSync(roomsDir)) {
        if (!f.endsWith('.json') || f.startsWith('.')) continue;
        const name = f.replace(/\.json$/, '');
        const abs = safeUnder(roomsDir, f);
        if (!abs) continue;
        try {
          const text = readFileSync(abs, 'utf8');
          const parsed = parseJsonObject(text, `rooms/${f}`);
          if (!parsed.ok) continue;
          const doc = parsed.value;
          const host = typeof doc.host === 'object' && doc.host !== null && !Array.isArray(doc.host)
            ? doc.host as Record<string, unknown>
            : {};
          roomFiles.push({
            name,
            host,
            ...(doc.workspace !== undefined ? { workspace: doc.workspace } : {}),
            ...(doc.network !== undefined ? { network: doc.network } : {}),
          });
        } catch {
          continue;
        }
      }
    }
    json(res, 200, { rooms: roomFiles });
    return;
  }
  if (req.method === 'PUT' && pathname.startsWith('/api/env/rooms/')) {
    const roomName = decodeURIComponent(pathname.slice('/api/env/rooms/'.length));
    const roomsDir = join(PROJECT, 'rooms');
    const fileName = `${roomName}.json`;
    const abs = safeUnder(roomsDir, fileName);
    if (!abs || !existsSync(abs)) {
      json(res, 404, { error: 'room not found' });
      return;
    }
    const raw = await readBody(req);
    let body: { host?: Record<string, unknown>; workspace?: unknown; network?: unknown };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    try {
      const existingText = readFileSync(abs, 'utf8');
      const existing = JSON.parse(existingText) as Record<string, unknown>;
      if (body.host !== undefined) {
        existing.host = { ...(existing.host as Record<string, unknown> ?? {}), ...body.host };
      }
      if (body.workspace !== undefined) {
        existing.workspace = body.workspace;
      }
      if (body.network !== undefined) {
        existing.network = body.network;
      }
      writeFileSync(abs, `${JSON.stringify(existing, null, 2)}\n`);
      const resultHost = typeof existing.host === 'object' && existing.host !== null && !Array.isArray(existing.host)
        ? existing.host as Record<string, unknown>
        : {};
      json(res, 200, {
        name: roomName,
        host: resultHost,
        ...(existing.workspace !== undefined ? { workspace: existing.workspace } : {}),
        ...(existing.network !== undefined ? { network: existing.network } : {}),
      });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
    return;
  }
  if (req.method === 'GET' && pathname === '/api/eval-tasks') {
    const { tasks, errors } = listEvalTasks(PROJECT);
    json(res, 200, { tasks, errors });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/eval-tasks') {
    const raw = await readBody(req);
    let body: {
      name?: string;
      kind?: string;
      paperset?: string;
      testSetId?: string;
      taskIds?: string[];
      examMode?: string;
      live?: boolean;
      sutRoot?: string;
      model?: string;
      agent?: string;
    };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const created = createEvalTask(PROJECT, body);
    if ('error' in created) {
      json(res, created.code, { error: created.error });
      return;
    }
    json(res, 201, created);
    return;
  }
  if (pathname.startsWith('/api/eval-tasks/')) {
    const id = decodeURIComponent(pathname.slice('/api/eval-tasks/'.length));
    if (req.method === 'GET') {
      const row = getEvalTask(PROJECT, id);
      if ('error' in row) {
        json(res, row.code, { error: row.error });
        return;
      }
      json(res, 200, row);
      return;
    }
    if (req.method === 'PUT') {
      const raw = await readBody(req);
      let body: {
        name?: string;
        kind?: string;
        paperset?: string;
        testSetId?: string;
        taskIds?: string[];
        examMode?: string;
        live?: boolean;
        sutRoot?: string;
        model?: string;
        agent?: string;
      };
      try {
        body = JSON.parse(raw || '{}') as typeof body;
      } catch {
        json(res, 400, { error: 'invalid json' });
        return;
      }
      const updated = updateEvalTask(PROJECT, id, body);
      if ('error' in updated) {
        json(res, updated.code, { error: updated.error });
        return;
      }
      json(res, 200, updated);
      return;
    }
    if (req.method === 'DELETE') {
      const result = deleteEvalTask(PROJECT, id);
      if ('error' in result) {
        json(res, result.code, { error: result.error });
        return;
      }
      json(res, 200, result);
      return;
    }
    json(res, 405, { error: 'method not allowed' });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/runs') {
    json(res, 200, { runs: listRuns(30) });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/runs/view') {
    const raw = url.searchParams.get('path') ?? '';
    const abs = safeUnder(join(PROJECT, 'runs'), raw) ?? safeUnder(PROJECT, raw);
    if (!abs || !existsSync(abs)) {
      json(res, 404, { error: 'run not found' });
      return;
    }
    const dir = statSync(abs).isDirectory() ? abs : dirname(abs);
    const readMaybe = (name: string) => {
      const p = join(dir, name);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    };
    const metrics = readMaybe('metrics.json');
    const resultsRaw = readMaybe('results.ndjson');
    const scores = readMaybe('scores.json');
    const effectMd = readMaybe('effect_compare.md');
    const summary = buildRunSummary({
      resultsText: resultsRaw,
      metricsText: metrics,
      scoresText: scores,
    });
    let effect_structured: ReturnType<typeof compareRuns> | null = null;
    let baselineResults: string | null = null;
    if (effectMd) {
      const basePath = parseBaselinePathFromEffectMd(effectMd);
      if (basePath && existsSync(basePath) && existsSync(join(basePath, 'results.ndjson'))) {
        try {
          effect_structured = compareRuns(basePath, dir);
        } catch {
          effect_structured = null;
        }
        try {
          baselineResults = readFileSync(join(basePath, 'results.ndjson'), 'utf8');
        } catch {
          baselineResults = null;
        }
      }
    }
    const dashboard = buildRunDashboard({
      runJsonText: readMaybe('run.json'),
      resultsText: resultsRaw,
      metricsText: metrics,
      hostedSnaps: readHostedSnaps(dir),
      baselineResultsText: baselineResults,
      effect: effect_structured?.effect ?? null,
    });
    json(res, 200, {
      dir,
      run: readMaybe('run.json'),
      metrics,
      report: readMaybe('report.md'),
      effect_compare: effectMd,
      effect_structured,
      dashboard,
      summary,
      scores,
      results_preview: (resultsRaw ?? '').split(/\n/).filter(Boolean).slice(0, 50),
    });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/baselines') {
    json(res, 200, { baselines: listBaselineNames(PROJECT) });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/baselines/pin') {
    const raw = await readBody(req);
    let body: { runPath?: string; name?: string };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const name = (body.name ?? '').trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
      json(res, 400, { error: 'baseline 名称须为 1–64 位字母数字._-' });
      return;
    }
    const runRaw = body.runPath ?? '';
    const runAbs =
      safeUnder(join(PROJECT, 'runs'), runRaw) ??
      safeUnder(PROJECT, runRaw) ??
      (runRaw ? safeUnder(REPO_ROOT, runRaw) : undefined);
    if (!runAbs || !existsSync(join(runAbs, 'results.ndjson'))) {
      json(res, 400, { error: '无效 run 路径' });
      return;
    }
    const code = runBaselinePin({
      run: runAbs,
      name,
      project: PROJECT,
      json: false,
    });
    if (code !== 0) {
      json(res, 500, { error: `baseline pin 失败 exit=${code}` });
      return;
    }
    json(res, 200, {
      ok: true,
      name,
      dest: join(PROJECT, 'baselines', name),
      source: runAbs,
    });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/compare') {
    const raw = await readBody(req);
    let body: { baseline?: string; candidate?: string; writeMd?: boolean };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const resolveRunOrBaseline = (rawPath: string): string | undefined => {
      const t = rawPath.trim();
      if (!t) return undefined;
      // 允许 baselines/<name>
      const asBaseline = safeUnder(join(PROJECT, 'baselines'), t);
      if (asBaseline && existsSync(join(asBaseline, 'results.ndjson'))) return asBaseline;
      const named = join(PROJECT, 'baselines', t);
      if (existsSync(join(named, 'results.ndjson'))) return named;
      const asRun =
        safeUnder(join(PROJECT, 'runs'), t) ?? safeUnder(PROJECT, t) ?? safeUnder(REPO_ROOT, t);
      if (asRun && existsSync(join(asRun, 'results.ndjson'))) return asRun;
      return undefined;
    };
    const baseAbs = resolveRunOrBaseline(body.baseline ?? '');
    const candAbs = resolveRunOrBaseline(body.candidate ?? '');
    if (!baseAbs || !candAbs) {
      json(res, 400, { error: 'baseline / candidate 路径无效' });
      return;
    }
    try {
      const report = compareRuns(baseAbs, candAbs);
      if (body.writeMd !== false) {
        writeEffectCompareMarkdown(report, join(candAbs, 'effect_compare.md'));
      }
      json(res, 200, { ok: true, report });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
    const id = pathname.slice('/api/jobs/'.length);
    const job = jobs.get(id);
    if (!job) {
      const file = join(JOBS_DIR, `${id}.json`);
      if (existsSync(file)) {
        json(res, 200, JSON.parse(readFileSync(file, 'utf8')));
        return;
      }
      json(res, 404, { error: 'job not found' });
      return;
    }
    json(res, 200, job);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/run') {
    const raw = await readBody(req);
    let body: {
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
    };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const experiment = body.experiment ?? '';
    if (!isExperimentId(experiment)) {
      json(res, 400, { error: 'unknown experiment' });
      return;
    }
    let paperset = body.paperset;
    if (body.testSetId !== undefined && body.testSetId.trim()) {
      const ts = getTestSet(PROJECT, body.testSetId.trim());
      if ('error' in ts) {
        json(res, ts.code, { error: ts.error });
        return;
      }
      paperset = ts.offPaperset;
    }
    const live = Boolean(body.live);
    if (live) {
      const model = (body.model ?? '').trim();
      const agent = (body.agent ?? '').trim();
      if (!model || !isVerified(PROJECT, 'model', model)) {
        json(res, 400, { error: '请到运行环境页验证并选择模型' });
        return;
      }
      if (!agent || !isVerified(PROJECT, 'agent', agent)) {
        json(res, 400, { error: '请到运行环境页验证并选择 Agent' });
        return;
      }
    }
    if (body.taskIds !== undefined) {
      if (!Array.isArray(body.taskIds)) {
        json(res, 400, { error: 'taskIds 须为人题号数组' });
        return;
      }
      for (const tid of body.taskIds) {
        const bad = assertSafeTaskId(tid);
        if (bad) {
          json(res, 400, { error: bad });
          return;
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
      json(res, 400, { error: resolved.error });
      return;
    }
    let evalTaskId: string | undefined;
    if (body.evalTaskId !== undefined && body.evalTaskId !== '') {
      const row = getEvalTask(PROJECT, body.evalTaskId);
      if ('error' in row) {
        json(res, row.code, { error: row.error });
        return;
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
    writeFileSync(join(JOBS_DIR, `${id}.json`), `${JSON.stringify(job, null, 2)}\n`);
    void executeJob(job, {
      experiment,
      live: Boolean(body.live),
      plan: resolved.plan,
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.agent !== undefined ? { agent: body.agent } : {}),
      ...(body.sutRoot !== undefined ? { sutRoot: body.sutRoot } : {}),
      ...(evalTaskId !== undefined ? { evalTaskId } : {}),
    });
    json(res, 202, { jobId: id });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bank/tasks') {
    json(res, 200, { tasks: listTasks(PROJECT), nextTaskId: nextCreateTaskId(PROJECT) });
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/bank/tasks/')) {
    const taskId = decodeURIComponent(pathname.slice('/api/bank/tasks/'.length));
    const detail = getTask(PROJECT, taskId);
    if ('error' in detail) {
      json(res, detail.code, { error: detail.error });
      return;
    }
    json(res, 200, detail);
    return;
  }
  if (req.method === 'PUT' && pathname.startsWith('/api/bank/tasks/')) {
    const taskId = decodeURIComponent(pathname.slice('/api/bank/tasks/'.length));
    const raw = await readBody(req);
    let body: {
      prompt?: string;
      passToken?: string;
      hosted_pass_token?: string;
      notes?: string;
      tags?: string[] | string;
      changeName?: string;
    };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const result = await updateTask(PROJECT, REPO_ROOT, taskId, body);
    if ('error' in result) {
      json(res, result.code, { error: result.error, log: result.log });
      return;
    }
    json(res, 200, result);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/bank/tasks') {
    const raw = await readBody(req);
    let body: {
      taskId?: string;
      prompt?: string;
      passToken?: string;
      hosted_pass_token?: string;
      notes?: string | null;
      tags?: string[] | string;
      contains?: string | string[];
      notContains?: string | string[];
      not_contains?: string | string[];
      allowSmokeTextOnly?: boolean;
      testSetId?: string;
    };
    try {
      body = JSON.parse(raw || '{}') as typeof body;
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const result = await createTask(PROJECT, body, {
      validate: () => validateBank(REPO_ROOT),
    });
    if ('error' in result) {
      json(res, result.code, { error: result.error, log: result.log });
      return;
    }
    json(res, 201, result);
    return;
  }
  if (req.method === 'DELETE' && pathname.startsWith('/api/bank/tasks/')) {
    const taskId = decodeURIComponent(pathname.slice('/api/bank/tasks/'.length));
    let confirmId = url.searchParams.get('confirmId') ?? undefined;
    if (confirmId === undefined) {
      const raw = await readBody(req);
      if (raw.trim()) {
        try {
          const body = JSON.parse(raw) as { confirmId?: string };
          confirmId = body.confirmId;
        } catch {
          json(res, 400, { error: 'invalid json' });
          return;
        }
      }
    }
    const result = deleteTask(PROJECT, taskId, confirmId);
    if ('error' in result) {
      json(res, result.code, { error: result.error });
      return;
    }
    json(res, 200, result);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/bank/validate') {
    const result = await validateBank(REPO_ROOT);
    json(res, 200, result);
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

const server = createServer((req, res) => {
  void handler(req, res).catch((e) => {
    json(res, 500, { error: (e as Error).message });
  });
});

reconcileJobs();

server.listen(PORT, HOST, () => {
  console.log(`proctor console: http://${HOST}:${PORT}`);
  console.log(`project: ${PROJECT}`);
});

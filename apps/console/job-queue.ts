/**
 * 作业队列：内存 jobs 表、重启协调、命令执行与作业生命周期。
 * 支持超时回收与进程树取消（FR-10 / FR-16 / ISSUE-0002）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { optStr, parseJsonObject, str } from './parse.ts';
import { writeJsonAtomic } from './json-io.ts';
import { appendEvalTaskRun } from './eval-tasks.ts';
import { type ExperimentId, type RunPlan } from './run-plan.ts';
import { listRuns } from './project-reader.ts';
import { JOBS_DIR, PROJECT, REPO_ROOT } from './config.ts';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'interrupted' | 'cancelled';

export interface Job {
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

/** 默认单条命令执行超时上限（可通过 PROCTOR_CONSOLE_JOB_TIMEOUT_MS 覆盖，默认 30 分钟） */
export const DEFAULT_JOB_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

/** 内存作业表（shared mutable state） */
export const jobs = new Map<string, Job>();

/** 活跃子进程表：用于取消或超时时按进程组回收 */
const activeChildren = new Map<string, ChildProcess>();

/** 已请求取消的作业集合 */
const cancelledJobs = new Set<string>();

/** 服务启动时从磁盘恢复作业，将 queued/running 标记为 interrupted */
export function reconcileJobs(): void {
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
      if (
        st !== 'queued' &&
        st !== 'running' &&
        st !== 'done' &&
        st !== 'error' &&
        st !== 'interrupted' &&
        st !== 'cancelled'
      ) {
        continue;
      }
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
      writeJsonAtomic(file, job);
    }
    jobs.set(id, job);
  }
}

/** 确保作业目录存在：取消等路径可能在 server.ts 建目录之前被直接调用（单测、CLI 复用）。 */
function ensureJobsDir(): void {
  mkdirSync(JOBS_DIR, { recursive: true });
}

/** 落盘作业状态（自动确保作业目录存在；供控制器与队列共用）。 */
export function persistJob(job: Job): void {
  ensureJobsDir();
  writeJsonAtomic(join(JOBS_DIR, `${job.id}.json`), job);
}

function appendLog(job: Job, line: string): void {
  job.log.push(line);
  if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
  persistJob(job);
}

/** 终止子进程及其进程组（POSIX 负 PID 杀进程组；Windows taskkill /T /F） */
export function terminateChildProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* ignore */
    }
  }
}

/** 取消正在排队或运行中的作业，回收子进程树并落盘 cancelled 状态 */
export function cancelJob(
  id: string,
): { ok: true; job: Job } | { ok: false; code: number; error: string } {
  const job = jobs.get(id);
  if (!job) {
    return { ok: false, code: 404, error: 'job not found' };
  }
  if (job.status !== 'queued' && job.status !== 'running') {
    return { ok: false, code: 409, error: `作业已处于终态（${job.status}），无法取消` };
  }
  cancelledJobs.add(id);
  job.status = 'cancelled';
  job.error = '用户取消作业';
  job.finishedAt = new Date().toISOString();
  appendLog(job, '[cancelled] 已收到取消请求，正在终止子进程树');
  const child = activeChildren.get(id);
  if (child) {
    terminateChildProcessTree(child, 'SIGTERM');
    const killTimer = setTimeout(() => {
      if (activeChildren.has(id)) {
        terminateChildProcessTree(child, 'SIGKILL');
      }
    }, 500);
    killTimer.unref();
  }
  return { ok: true, job };
}

function resolveTimeoutMs(overrideMs?: number): number {
  if (overrideMs !== undefined && Number.isFinite(overrideMs) && overrideMs > 0) {
    return overrideMs;
  }
  const envVal = Number(process.env.PROCTOR_CONSOLE_JOB_TIMEOUT_MS);
  if (Number.isFinite(envVal) && envVal > 0) {
    return envVal;
  }
  return DEFAULT_JOB_COMMAND_TIMEOUT_MS;
}

export function runCommand(
  job: Job,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs?: number,
): Promise<number> {
  const effectiveTimeoutMs = resolveTimeoutMs(timeoutMs);
  return new Promise((resolveExit) => {
    if (cancelledJobs.has(job.id) || job.status === 'cancelled') {
      resolveExit(130);
      return;
    }
    appendLog(job, `$ ${command} ${args.join(' ')}`);
    const isPosix = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      shell: false,
      detached: isPosix,
    });
    activeChildren.set(job.id, child);

    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      appendLog(job, `[timeout] 命令执行超过 ${effectiveTimeoutMs}ms，正在终止进程树`);
      terminateChildProcessTree(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => {
        terminateChildProcessTree(child, 'SIGKILL');
      }, 500);
      forceKillTimer.unref();
    }, effectiveTimeoutMs);
    timer.unref();

    const cleanupTimers = () => {
      clearTimeout(timer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      activeChildren.delete(job.id);
    };

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
    child.on('close', (code) => {
      cleanupTimers();
      if (timedOut) {
        job.error = `命令执行超时（>${effectiveTimeoutMs}ms）`;
        resolveExit(124);
        return;
      }
      resolveExit(code ?? 1);
    });
    child.on('error', (err) => {
      cleanupTimers();
      appendLog(job, `spawn error: ${err.message}`);
      resolveExit(1);
    });
  });
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

/** side → environment 名（cases-v1：off 无插件、on 有插件）。 */
function environmentForSide(side: 'off' | 'on'): string {
  return side === 'on' ? 'hosted-plugin-v1' : 'hosted-plain-v1';
}

function proctorRunArgs(dataset: string, environment: string, itemIds: string[]): string[] {
  const args = [
    'run',
    'proctor',
    '--',
    'run',
    '--dataset',
    dataset,
    '--environment',
    environment,
    '--project',
    'examples/product-eval',
  ];
  for (const id of itemIds) {
    args.push('--only', id);
  }
  return args;
}

export async function executeJob(
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
          '--dataset',
          'eval-model',
          '--environment',
          'hosted-plain-v1',
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
          '--dataset',
          'eval-agent',
          '--environment',
          'hosted-plain-v1',
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
          appendLog(job, `跳过空侧：${step.release}`);
          continue;
        }
        code = await runCommand(
          job,
          npm,
          proctorRunArgs(step.release, environmentForSide(step.side), step.itemIds),
          env,
        );
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
    if (cancelledJobs.has(job.id) || (job.status as Job['status']) === 'cancelled') {
      job.status = 'cancelled';
      if (!job.error) job.error = '用户取消作业';
    } else {
      job.status = code === 0 ? 'done' : 'error';
      const latest = listRuns(1)[0];
      if (latest) job.resultHint = latest.path;
      if (code !== 0 && !job.error) job.error = `退出码 ${code}`;
      if (opts.evalTaskId && opts.live && job.resultHint) {
        appendEvalTaskRun(PROJECT, opts.evalTaskId, {
          path: job.resultHint,
          startedAt: job.startedAt,
          jobId: job.id,
        });
      }
    }
  } catch (e) {
    if (!cancelledJobs.has(job.id) && job.status !== 'cancelled') {
      job.status = 'error';
      job.error = (e as Error).message;
      appendLog(job, job.error);
    }
  } finally {
    cancelledJobs.delete(job.id);
    job.finishedAt = job.finishedAt ?? new Date().toISOString();
    persistJob(job);
  }
}

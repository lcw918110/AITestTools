/**
 * 作业队列：内存 jobs 表、重启协调、命令执行与作业生命周期。
 * 从原 server.ts 精确迁移，不改变调度或落盘行为。
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { optStr, parseJsonObject, str } from './parse.ts';
import { writeJsonAtomic } from './json-io.ts';
import { appendEvalTaskRun } from './eval-tasks.ts';
import { type ExperimentId, type RunPlan } from './run-plan.ts';
import { listRuns } from './project-reader.ts';
import { JOBS_DIR, PROJECT, REPO_ROOT } from './config.ts';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'interrupted';

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

/** 内存作业表（shared mutable state） */
export const jobs = new Map<string, Job>();

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
      writeJsonAtomic(file, job);
    }
    jobs.set(id, job);
  }
}

function appendLog(job: Job, line: string): void {
  job.log.push(line);
  if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
  writeJsonAtomic(join(JOBS_DIR, `${job.id}.json`), job);
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
    '--axis',
    'B',
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
          '--axis',
          'B',
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
          '--axis',
          'B',
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
    writeJsonAtomic(join(JOBS_DIR, `${job.id}.json`), job);
  }
}

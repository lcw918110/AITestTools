/**
 * 作业队列：内存 jobs 表、重启协调、命令执行与作业生命周期。
 * 支持超时回收与进程树取消（FR-10 / FR-16 / ISSUE-0002）。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { optStr, parseJsonObject, str } from './parse.ts';
import { writeJsonAtomic } from './json-io.ts';
import { appendEvalTaskRun, TASK_PURPOSES, type TaskPurpose } from './eval-tasks.ts';
import { type ExperimentId, type RunPlan } from './run-plan.ts';
import { listRuns } from './project-reader.ts';
import { DEFAULT_JOBS_DIR, JOBS_DIR, PROJECT, REPO_ROOT } from './config.ts';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'interrupted' | 'cancelled';

export interface Job {
  id: string;
  experiment: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  log: string[];
  /** 前置因 500 行限制已丢弃的日志行偏移量（与磁盘/内存一致） */
  logOffset?: number;
  exitCode?: number;
  resultHint?: string;
  error?: string;
  evalTaskId?: string;
  purpose?: TaskPurpose;
  /** 实例归属标识：进程启动生成并落盘，用于区分本实例遗留与他实例/无标识作业 */
  managedByInstanceToken?: string;
}

/** 默认单条命令执行超时上限（可通过 PROCTOR_CONSOLE_JOB_TIMEOUT_MS 覆盖，默认 30 分钟） */
export const DEFAULT_JOB_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

/** 内存作业表（shared mutable state） */
export const jobs = new Map<string, Job>();

/** 活跃子进程表：用于取消或超时时按进程组回收 */
const activeChildren = new Map<string, ChildProcess>();

/** 已请求取消的作业集合 */
const cancelledJobs = new Set<string>();

/** 实例标识元数据落盘文件名（点文件，不以 .json 结尾，自动被作业扫描忽略） */
export const INSTANCE_TOKEN_FILENAME = '.instance-token';

let currentInstanceToken: string | undefined;
let previousInstanceToken: string | undefined;
let isPeerInstanceActive = false;
let instanceTokenInitialized = false;

function isProcessAlive(pid: number): boolean {
  if (pid <= 0 || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 判定是否处于测试上下文（NODE_ENV=test / VITEST / PLAYWRIGHT / PROCTOR_TEST_CONTEXT） */
export function isTestContext(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.PROCTOR_TEST) ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.PLAYWRIGHT) ||
    Boolean(process.env.PLAYWRIGHT_TEST) ||
    Boolean(process.env.PROCTOR_TEST_CONTEXT)
  );
}

/** 判定给定路径是否指向源码树内正式作业目录 apps/console/.jobs */
export function isFormalJobsDir(dir: string = JOBS_DIR): boolean {
  const resolvedTarget = resolve(dir);
  const formalDefault = resolve(DEFAULT_JOBS_DIR);
  return resolvedTarget === formalDefault || resolvedTarget.startsWith(formalDefault + '/');
}

/** 工作区写保护哨兵：测试上下文指向正式 JOBS_DIR 时抛致命错误阻断 */
export function assertJobsDirSecurityGuard(targetDir: string = JOBS_DIR): void {
  if (isTestContext() && isFormalJobsDir(targetDir)) {
    const reasons: string[] = [];
    if (process.env.NODE_ENV === 'test') reasons.push('NODE_ENV=test');
    if (process.env.PROCTOR_TEST) reasons.push('PROCTOR_TEST');
    if (process.env.VITEST) reasons.push('VITEST');
    if (process.env.PLAYWRIGHT || process.env.PLAYWRIGHT_TEST) reasons.push('PLAYWRIGHT');
    if (process.env.PROCTOR_TEST_CONTEXT) reasons.push('PROCTOR_TEST_CONTEXT');
    const reasonStr = reasons.join(', ') || 'test-context';
    throw new Error(
      '[FATAL_WORKSPACE_GUARD] 检测到测试上下文 (' +
        reasonStr +
        ') 却指向源码树内正式作业目录 (' +
        resolve(targetDir) +
        ')。为防止测试实例篡改、中断或污染生产作业，已阻断队列初始化。' +
        '请在测试中配置 PROCTOR_CONSOLE_JOBS_DIR 环境变量指向独立临时目录（如 tmpdir）。',
    );
  }
}

/** 重置实例 token 内存状态（仅供单元测试模拟进程重启生命周期） */
export function _resetInstanceTokenForTest(): void {
  currentInstanceToken = undefined;
  previousInstanceToken = undefined;
  isPeerInstanceActive = false;
  instanceTokenInitialized = false;
}

/**
 * 确保本进程实例归属标识已生成并落盘。
 * 返回当前 token 与检测到的上次遗留 token（若上次记录的 PID 仍存活则视为活跃对等实例，上次 token 记为 undefined）。
 */
export function ensureInstanceToken(): {
  currentToken: string;
  previousToken: string | undefined;
} {
  if (instanceTokenInitialized && currentInstanceToken !== undefined) {
    return { currentToken: currentInstanceToken, previousToken: previousInstanceToken };
  }
  assertJobsDirSecurityGuard();

  const tokenFilePath = join(JOBS_DIR, INSTANCE_TOKEN_FILENAME);
  let prevToken: string | undefined;
  let prevPid: number | undefined;

  if (existsSync(tokenFilePath)) {
    try {
      const parsed = JSON.parse(readFileSync(tokenFilePath, 'utf8')) as {
        token?: unknown;
        pid?: unknown;
      };
      if (typeof parsed.token === 'string' && parsed.token.trim()) {
        prevToken = parsed.token.trim();
      }
      if (typeof parsed.pid === 'number') {
        prevPid = parsed.pid;
      }
    } catch {
      // 损坏或不可解析，视为无上次遗留标识
    }
  }

  if (prevPid !== undefined && prevPid !== process.pid && isProcessAlive(prevPid)) {
    previousInstanceToken = undefined;
    isPeerInstanceActive = true;
  } else {
    previousInstanceToken = prevToken;
    isPeerInstanceActive = false;
  }

  const configured = process.env.PROCTOR_CONSOLE_INSTANCE_TOKEN;
  currentInstanceToken =
    configured && configured.trim() ? configured.trim() : 'inst_' + randomUUID();
  instanceTokenInitialized = true;

  try {
    mkdirSync(JOBS_DIR, { recursive: true });
    writeJsonAtomic(tokenFilePath, {
      token: currentInstanceToken,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // 落盘失败不阻断；后续 persistJob 写入作业时会暴露确切错误
  }

  return { currentToken: currentInstanceToken, previousToken: previousInstanceToken };
}

/** 获取本进程绑定的实例归属标识 */
export function getInstanceToken(): string {
  if (currentInstanceToken === undefined) {
    ensureInstanceToken();
  }
  return currentInstanceToken as string;
}

/** 获取启动时检测到的上次运行遗留标识（无或上次实例仍活跃时为 undefined） */
export function getPreviousInstanceToken(): string | undefined {
  if (!instanceTokenInitialized) {
    ensureInstanceToken();
  }
  return previousInstanceToken;
}

/**
 * 服务启动时从磁盘恢复作业。
 * 仅协调本实例上次遗留的未完结作业（queued/running 转 interrupted）；
 * 对无标识或他实例持有的未完结作业只读载入内存，不改状态、不写盘。
 */
export function reconcileJobs(): void {
  assertJobsDirSecurityGuard();
  if (!existsSync(JOBS_DIR)) return;

  const { currentToken, previousToken } = ensureInstanceToken();
  const reconcileTargetToken = isPeerInstanceActive
    ? undefined
    : (previousToken ?? (process.env.PROCTOR_CONSOLE_INSTANCE_TOKEN ? currentToken : undefined));

  for (const name of readdirSync(JOBS_DIR)) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
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
      const logOffset =
        typeof d.logOffset === 'number' && Number.isFinite(d.logOffset) && d.logOffset >= 0
          ? d.logOffset
          : 0;
      job = {
        id: jid,
        experiment: exp,
        status: st as JobStatus,
        startedAt: started,
        log: logArr,
        ...(logOffset > 0 ? { logOffset } : {}),
      };
      const purpose = TASK_PURPOSES.find((value) => value === d.purpose);
      if (purpose !== undefined) job.purpose = purpose;
      const evalTaskId = optStr(d, 'evalTaskId');
      if (evalTaskId !== undefined) job.evalTaskId = evalTaskId;
      const finishedAt = optStr(d, 'finishedAt');
      if (finishedAt !== undefined) job.finishedAt = finishedAt;
      if (typeof d.exitCode === 'number') job.exitCode = d.exitCode;
      const resultHint = optStr(d, 'resultHint');
      if (resultHint !== undefined) job.resultHint = resultHint;
      const error = optStr(d, 'error');
      if (error !== undefined) job.error = error;
      const token = optStr(d, 'managedByInstanceToken');
      if (token !== undefined) job.managedByInstanceToken = token;
    } catch {
      continue;
    }
    if (job === undefined) continue;

    // 仅协调本实例上次遗留的未完结作业；无标识或他实例持有的保持只读
    const isUnfinished = job.status === 'running' || job.status === 'queued';
    const isOurPrevious = Boolean(
      reconcileTargetToken &&
      job.managedByInstanceToken &&
      job.managedByInstanceToken === reconcileTargetToken,
    );

    if (isUnfinished && isOurPrevious) {
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
  assertJobsDirSecurityGuard();
  mkdirSync(JOBS_DIR, { recursive: true });
}

/** 落盘作业状态（自动确保作业目录存在；供控制器与队列共用）。 */
export function persistJob(job: Job): void {
  ensureJobsDir();
  if (!job.managedByInstanceToken) {
    job.managedByInstanceToken = getInstanceToken();
  }
  writeJsonAtomic(join(JOBS_DIR, `${job.id}.json`), job);
}

export function appendLog(job: Job, line: string): void {
  job.log.push(line);
  if (job.log.length > 500) {
    const drop = job.log.length - 500;
    job.log.splice(0, drop);
    job.logOffset = (job.logOffset ?? 0) + drop;
  }
  persistJob(job);
}

export interface JobLogsResult {
  id: string;
  status: JobStatus;
  lines: string[];
  nextOffset: number;
  reset: boolean;
  totalLines: number;
  error?: string;
  exitCode?: number;
  resultHint?: string;
}

/**
 * 增量读取作业日志（GET /api/jobs/:id/logs?offset=N）。
 * 遵循 Kolmogorov 极简权威边界：以磁盘与内存中唯一的 500 行滑动日志为事实，不另造第二真相。
 */
export function getJobLogs(job: Job, rawOffset: number): JobLogsResult {
  const logOffset = job.logOffset ?? 0;
  const availableLength = job.log.length;
  const totalLines = logOffset + availableLength;

  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;

  // 若游标落后于当前保留窗口的起点（请求的历史行已被淘汰），或游标超前于实际总行数，全量重置
  if (offset < logOffset || offset > totalLines) {
    return {
      id: job.id,
      status: job.status,
      lines: [...job.log],
      nextOffset: totalLines,
      reset: true,
      totalLines,
      ...(job.error !== undefined ? { error: job.error } : {}),
      ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
      ...(job.resultHint !== undefined ? { resultHint: job.resultHint } : {}),
    };
  }

  const startIdx = offset - logOffset;
  return {
    id: job.id,
    status: job.status,
    lines: job.log.slice(startIdx),
    nextOffset: totalLines,
    reset: false,
    totalLines,
    ...(job.error !== undefined ? { error: job.error } : {}),
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
    ...(job.resultHint !== undefined ? { resultHint: job.resultHint } : {}),
  };
}

/** 通过 pgrep -P 逐层收集后代 PID（含自行 detach 换组的后代），限制深度防环 */
function collectDescendantPids(rootPid: number): number[] {
  if (process.platform === 'win32') return [];
  const result: number[] = [];
  const visited = new Set<number>([rootPid]);
  let frontier = [rootPid];
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const pid of frontier) {
      const probe = spawnSync('pgrep', ['-P', String(pid)], {
        encoding: 'utf8',
        timeout: 1000,
      });
      if (probe.error || probe.status !== 0) continue;
      for (const line of probe.stdout.split(/\r?\n/)) {
        const child = Number.parseInt(line, 10);
        if (!Number.isInteger(child) || child <= 1 || visited.has(child)) continue;
        visited.add(child);
        result.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return result;
}

const knownDescendants = new WeakMap<ChildProcess, Set<number>>();

/** 终止子进程及其进程树（POSIX 负 PID 杀进程组 + 后代遍历兜底；Windows taskkill /T /F） */
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
  // 先收集后代（含自行 detach 换组的），再发组信号；否则子进程先死后代被过继，pgrep 找不到
  const descendants = knownDescendants.get(child) ?? new Set<number>();
  for (const descendant of collectDescendantPids(pid)) descendants.add(descendant);
  knownDescendants.set(child, descendants);
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* ignore */
    }
  }
  for (const descendant of descendants) {
    try {
      process.kill(descendant, signal);
    } catch {
      /* 已随进程组退出，忽略 */
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
      terminateChildProcessTree(child, 'SIGKILL');
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
    child.on('close', (code, signal) => {
      if (timedOut || cancelledJobs.has(job.id)) {
        // 父进程已退出也必须回收忽略 SIGTERM 且被过继的已知后代。
        terminateChildProcessTree(child, 'SIGKILL');
      }
      cleanupTimers();
      if (timedOut) {
        job.error = `命令执行超时（>${effectiveTimeoutMs}ms）`;
        resolveExit(124);
        return;
      }
      // 信号终止视为用户中断（130），不误报普通失败
      if (signal !== null && cancelledJobs.has(job.id)) {
        resolveExit(130);
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
    PROJECT,
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
  if (job.purpose !== undefined) env.PROCTOR_RUN_PURPOSE = job.purpose;
  else delete env.PROCTOR_RUN_PURPOSE;
  if (opts.live) env.PROCTOR_EVAL_LIVE = '1';
  else delete env.PROCTOR_EVAL_LIVE;
  delete env.PROCTOR_HOSTED_PLUGIN;

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const previousRunPaths = new Set(listRuns(200).map((run) => run.path));
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
          ['run', 'proctor', '--', 'item', 'validate', '--project', PROJECT, '--check-fixtures'],
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
          PROJECT,
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
          PROJECT,
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
      const producedRun =
        lastRunDirFromLog(job) ?? listRuns(10).find((run) => !previousRunPaths.has(run.path))?.path;
      if (producedRun) job.resultHint = producedRun;
      if (code !== 0 && !job.error) job.error = `退出码 ${code}`;
      if (opts.evalTaskId && opts.live && job.resultHint) {
        appendEvalTaskRun(PROJECT, opts.evalTaskId, {
          path: job.resultHint,
          startedAt: job.startedAt,
          jobId: job.id,
          ...(job.purpose !== undefined ? { purpose: job.purpose } : {}),
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

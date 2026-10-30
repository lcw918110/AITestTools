/**
 * 作业实例归属标识与工作区隔离测试：
 * 1. 工作区写保护哨兵阻断与放行（NODE_ENV=test / PROCTOR_TEST / PROCTOR_TEST_CONTEXT / VITEST）。
 * 2. 作业实例 token 生命周期与落盘（ensureInstanceToken / managedByInstanceToken）。
 * 3. reconcileJobs 仅协调本实例上次遗留作业（queued/running -> interrupted），
 *    对无标识作业或其它实例持有的作业保持只读，严禁越权篡改。
 * 4. 活跃对等实例保护：PID 仍存活时保持只读，不进行任何越权中断。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetInstanceTokenForTest,
  assertJobsDirSecurityGuard,
  ensureInstanceToken,
  getInstanceToken,
  INSTANCE_TOKEN_FILENAME,
  isFormalJobsDir,
  isTestContext,
  jobs,
  persistJob,
  reconcileJobs,
  type Job,
} from '../../apps/console/job-queue.ts';
import { DEFAULT_JOBS_DIR } from '../../apps/console/config.ts';

let testJobsDir = '';

beforeEach(() => {
  testJobsDir = mkdtempSync(join(tmpdir(), 'proctor-test-jobs-iso-'));
  jobs.clear();
  _resetInstanceTokenForTest();
});

afterEach(() => {
  jobs.clear();
  _resetInstanceTokenForTest();
  vi.unstubAllEnvs();
  if (testJobsDir && existsSync(testJobsDir)) {
    rmSync(testJobsDir, { recursive: true, force: true });
  }
});

describe('工作区写保护哨兵 assertJobsDirSecurityGuard', () => {
  it('识别正式作业目录 isFormalJobsDir', () => {
    expect(isFormalJobsDir(DEFAULT_JOBS_DIR)).toBe(true);
    expect(isFormalJobsDir(resolve('apps/console/.jobs'))).toBe(true);
    expect(isFormalJobsDir(resolve('apps/console/.jobs/sub'))).toBe(true);
    expect(isFormalJobsDir(testJobsDir)).toBe(false);
  });

  it('识别测试上下文 isTestContext', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(isTestContext()).toBe(true);

    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.VITEST;
    delete process.env.PLAYWRIGHT;
    delete process.env.PLAYWRIGHT_TEST;
    delete process.env.PROCTOR_TEST;
    delete process.env.PROCTOR_TEST_CONTEXT;
    expect(isTestContext()).toBe(false);

    vi.stubEnv('PROCTOR_TEST', '1');
    expect(isTestContext()).toBe(true);
    delete process.env.PROCTOR_TEST;

    vi.stubEnv('PROCTOR_TEST_CONTEXT', '1');
    expect(isTestContext()).toBe(true);
  });

  it('测试上下文试图操作源码树内正式 JOBS_DIR 时抛出致命错误阻断', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => {
      assertJobsDirSecurityGuard(DEFAULT_JOBS_DIR);
    }).toThrowError(/\[FATAL_WORKSPACE_GUARD\].*NODE_ENV=test/);

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PROCTOR_TEST', '1');
    expect(() => {
      assertJobsDirSecurityGuard(resolve('apps/console/.jobs'));
    }).toThrowError(/\[FATAL_WORKSPACE_GUARD\].*PROCTOR_TEST/);
  });

  it('操作外部独立临时目录时正常放行', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PROCTOR_TEST', '1');
    expect(() => {
      assertJobsDirSecurityGuard(testJobsDir);
    }).not.toThrow();
  });
});

describe('实例 Token 生命周期与作业归属标识', () => {
  it('ensureInstanceToken 生成非空 token 并落盘到 .instance-token', async () => {
    vi.stubEnv('PROCTOR_CONSOLE_JOBS_DIR', testJobsDir);
    vi.resetModules();
    const queueMod = await import('../../apps/console/job-queue.ts');
    queueMod._resetInstanceTokenForTest();

    const { currentToken, previousToken } = queueMod.ensureInstanceToken();
    expect(currentToken).toBeTruthy();
    expect(currentToken.startsWith('inst_')).toBe(true);
    expect(previousToken).toBeUndefined();

    const tokenFilePath = join(testJobsDir, INSTANCE_TOKEN_FILENAME);
    expect(existsSync(tokenFilePath)).toBe(true);
    const saved = JSON.parse(readFileSync(tokenFilePath, 'utf8'));
    expect(saved.token).toBe(currentToken);
    expect(saved.pid).toBe(process.pid);
  });

  it('persistJob 自动补齐 managedByInstanceToken 并落盘', async () => {
    vi.stubEnv('PROCTOR_CONSOLE_JOBS_DIR', testJobsDir);
    vi.resetModules();
    const queueMod = await import('../../apps/console/job-queue.ts');
    queueMod._resetInstanceTokenForTest();

    const newJob: Job = {
      id: 'job-auto-tag',
      experiment: 'model',
      status: 'queued',
      startedAt: new Date().toISOString(),
      log: ['queued'],
    };

    queueMod.persistJob(newJob);
    const token = queueMod.getInstanceToken();
    expect(newJob.managedByInstanceToken).toBe(token);

    const onDisk = JSON.parse(readFileSync(join(testJobsDir, 'job-auto-tag.json'), 'utf8'));
    expect(onDisk.managedByInstanceToken).toBe(token);
    expect(onDisk.status).toBe('queued');
  });
});

describe('reconcileJobs 协调隔离与只读保护', () => {
  it('仅协调本实例上次遗留作业，无标识或他实例作业保持只读严禁篡改', async () => {
    vi.stubEnv('PROCTOR_CONSOLE_JOBS_DIR', testJobsDir);
    vi.resetModules();
    const queueMod = await import('../../apps/console/job-queue.ts');
    queueMod._resetInstanceTokenForTest();

    const myPrevToken = 'inst_previous_run_1111';
    const otherToken = 'inst_peer_service_2222';

    // 1. 模拟上一次运行留下的 .instance-token（PID 已退出）
    writeFileSync(
      join(testJobsDir, INSTANCE_TOKEN_FILENAME),
      JSON.stringify({
        token: myPrevToken,
        pid: 999999999, // 不存在的死进程 PID
        createdAt: new Date().toISOString(),
      }),
      'utf8',
    );

    // 2. 模拟目录下的各类作业
    // A. 本实例上次遗留的 running 作业 -> 应该被协调为 interrupted
    const myRunningJob: Job = {
      id: 'job-my-running',
      experiment: 'model',
      status: 'running',
      startedAt: '2026-10-23T00:00:00.000Z',
      log: ['step 1', 'step 2'],
      managedByInstanceToken: myPrevToken,
    };
    // B. 本实例上次遗留的 queued 作业 -> 应该被协调为 interrupted
    const myQueuedJob: Job = {
      id: 'job-my-queued',
      experiment: 'plugin',
      status: 'queued',
      startedAt: '2026-10-23T00:01:00.000Z',
      log: [],
      managedByInstanceToken: myPrevToken,
    };
    // C. 其它实例的 running 作业 -> 必须保持只读，状态和磁盘绝不可改
    const otherRunningJob: Job = {
      id: 'job-other-running',
      experiment: 'model',
      status: 'running',
      startedAt: '2026-10-23T00:02:00.000Z',
      log: ['other step'],
      managedByInstanceToken: otherToken,
    };
    // D. 遗留历史无标识的 running 作业 -> 必须保持只读，绝不篡改
    const legacyRunningJob: Job = {
      id: 'job-legacy-running',
      experiment: 'plugin',
      status: 'running',
      startedAt: '2026-10-23T00:03:00.000Z',
      log: ['legacy step'],
    };
    // E. 本实例上次已完成作业 -> 保持 done
    const myDoneJob: Job = {
      id: 'job-my-done',
      experiment: 'model',
      status: 'done',
      startedAt: '2026-10-23T00:04:00.000Z',
      finishedAt: '2026-10-23T00:05:00.000Z',
      log: ['finished'],
      managedByInstanceToken: myPrevToken,
    };

    writeFileSync(join(testJobsDir, 'job-my-running.json'), JSON.stringify(myRunningJob, null, 2));
    writeFileSync(join(testJobsDir, 'job-my-queued.json'), JSON.stringify(myQueuedJob, null, 2));
    writeFileSync(join(testJobsDir, 'job-other-running.json'), JSON.stringify(otherRunningJob, null, 2));
    writeFileSync(join(testJobsDir, 'job-legacy-running.json'), JSON.stringify(legacyRunningJob, null, 2));
    writeFileSync(join(testJobsDir, 'job-my-done.json'), JSON.stringify(myDoneJob, null, 2));

    // 3. 执行重启协调 reconcileJobs
    queueMod.reconcileJobs();

    // 4. 验证磁盘与内存状态
    // A: myRunning 转换为 interrupted
    const diskMyRunning = JSON.parse(readFileSync(join(testJobsDir, 'job-my-running.json'), 'utf8')) as Job;
    expect(diskMyRunning.status).toBe('interrupted');
    expect(diskMyRunning.error).toContain('服务重启，任务中断');
    expect(diskMyRunning.finishedAt).toBeTruthy();
    expect(queueMod.jobs.get('job-my-running')?.status).toBe('interrupted');

    // B: myQueued 转换为 interrupted
    const diskMyQueued = JSON.parse(readFileSync(join(testJobsDir, 'job-my-queued.json'), 'utf8')) as Job;
    expect(diskMyQueued.status).toBe('interrupted');
    expect(queueMod.jobs.get('job-my-queued')?.status).toBe('interrupted');

    // C: otherRunning 保持只读！磁盘与内存状态依然为 running
    const diskOther = JSON.parse(readFileSync(join(testJobsDir, 'job-other-running.json'), 'utf8')) as Job;
    expect(diskOther.status).toBe('running');
    expect(diskOther.managedByInstanceToken).toBe(otherToken);
    expect(diskOther.error).toBeUndefined();
    expect(queueMod.jobs.get('job-other-running')?.status).toBe('running');

    // D: legacyRunning 保持只读！磁盘与内存状态依然为 running
    const diskLegacy = JSON.parse(readFileSync(join(testJobsDir, 'job-legacy-running.json'), 'utf8')) as Job;
    expect(diskLegacy.status).toBe('running');
    expect(diskLegacy.managedByInstanceToken).toBeUndefined();
    expect(diskLegacy.error).toBeUndefined();
    expect(queueMod.jobs.get('job-legacy-running')?.status).toBe('running');

    // E: myDone 保持 done
    const diskDone = JSON.parse(readFileSync(join(testJobsDir, 'job-my-done.json'), 'utf8')) as Job;
    expect(diskDone.status).toBe('done');
    expect(queueMod.jobs.get('job-my-done')?.status).toBe('done');
  });

  it('活跃对等实例（PID 存活）的作业保持只读，不进行任何越权中断', async () => {
    vi.stubEnv('PROCTOR_CONSOLE_JOBS_DIR', testJobsDir);
    vi.resetModules();
    const queueMod = await import('../../apps/console/job-queue.ts');
    queueMod._resetInstanceTokenForTest();

    const peerToken = 'inst_active_peer_8888';

    // 写入活跃进程 PID（process.ppid 必定存活）
    writeFileSync(
      join(testJobsDir, INSTANCE_TOKEN_FILENAME),
      JSON.stringify({
        token: peerToken,
        pid: process.ppid,
        createdAt: new Date().toISOString(),
      }),
      'utf8',
    );

    const peerJob: Job = {
      id: 'job-peer-active',
      experiment: 'model',
      status: 'running',
      startedAt: '2026-10-23T00:00:00.000Z',
      log: ['active peer is running'],
      managedByInstanceToken: peerToken,
    };
    writeFileSync(join(testJobsDir, 'job-peer-active.json'), JSON.stringify(peerJob, null, 2));

    queueMod.reconcileJobs();

    // 活跃对等实例的作业绝不能被本实例中断
    const diskPeerJob = JSON.parse(readFileSync(join(testJobsDir, 'job-peer-active.json'), 'utf8')) as Job;
    expect(diskPeerJob.status).toBe('running');
    expect(queueMod.jobs.get('job-peer-active')?.status).toBe('running');
  });
});

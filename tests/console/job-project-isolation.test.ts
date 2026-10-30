import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ args: [] as string[][] }));
vi.mock('node:child_process', () => ({
  spawn: vi.fn((_command: string, args: string[]) => {
    calls.args.push(args);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    queueMicrotask(() => child.emit('close', 1));
    return child;
  }),
}));

let root = '';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (root) rmSync(root, { recursive: true, force: true });
});

it('离线作业子进程使用配置项目，不退回正式项目', async () => {
  root = mkdtempSync(join(tmpdir(), 'proctor-job-project-'));
  vi.stubEnv('PROCTOR_CONSOLE_PROJECT', join(root, 'project'));
  vi.stubEnv('PROCTOR_CONSOLE_JOBS_DIR', join(root, 'jobs'));
  vi.resetModules();
  calls.args = [];
  const { executeJob } = await import('../../apps/console/job-queue.ts');
  await executeJob(
    {
      id: 'job-isolation',
      experiment: 'plugin',
      status: 'queued',
      startedAt: new Date().toISOString(),
      log: [],
    },
    {
      experiment: 'plugin',
      live: false,
      plan: {
        experiment: 'plugin',
        examMode: 'off',
        release: 'paired-off',
        taskIds: [],
        legacy: undefined,
        steps: [],
        compare: false,
        skipped: [],
        needsSut: false,
      },
    },
  );
  expect(calls.args).toHaveLength(1);
  const args = calls.args[0]!;
  expect(args[args.indexOf('--project') + 1]).toBe(join(root, 'project'));
});

it('运行失败且未产生新跑次时，不把历史跑次追加到当前任务', async () => {
  root = mkdtempSync(join(tmpdir(), 'proctor-job-project-'));
  const project = join(root, 'project');
  mkdirSync(join(project, 'runs/old-run'), { recursive: true });
  mkdirSync(join(project, 'eval-tasks'), { recursive: true });
  writeFileSync(
    join(project, 'eval-tasks/et-fail.json'),
    JSON.stringify({
      id: 'et-fail',
      name: '失败任务',
      kind: 'model',
      purpose: 'smoke',
      testSetId: 'full',
      examMode: 'off',
      taskIds: ['PAIRED-TASK-01'],
      runs: [],
      createdAt: '2026-10-23T09:00:00Z',
      updatedAt: '2026-10-23T09:00:00Z',
    }),
  );
  vi.stubEnv('PROCTOR_CONSOLE_PROJECT', project);
  vi.stubEnv('PROCTOR_CONSOLE_JOBS_DIR', join(root, 'jobs'));
  vi.resetModules();
  const { executeJob } = await import('../../apps/console/job-queue.ts');
  await executeJob(
    {
      id: 'job-failed-no-new-run',
      experiment: 'model',
      purpose: 'smoke',
      status: 'queued',
      startedAt: '2026-10-23T10:00:00Z',
      log: [],
    },
    {
      experiment: 'model',
      live: true,
      evalTaskId: 'et-fail',
      plan: {
        experiment: 'model',
        examMode: 'off',
        release: 'paired-off',
        taskIds: ['PAIRED-TASK-01'],
        legacy: 'model',
        steps: [],
        compare: false,
        skipped: [],
        needsSut: false,
      },
    },
  );
  const saved = JSON.parse(readFileSync(join(project, 'eval-tasks/et-fail.json'), 'utf8')) as {
    runs: unknown[];
  };
  expect(saved.runs).toEqual([]);
});

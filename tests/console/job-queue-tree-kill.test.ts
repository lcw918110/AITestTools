import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as Queue from '../../apps/console/job-queue.ts';

const root = mkdtempSync(join(tmpdir(), 'proctor-tree-kill-'));
let queue: typeof Queue;
const children: ChildProcess[] = [];
const descendants = new Set<number>();

beforeAll(async () => {
  vi.stubEnv('PROCTOR_CONSOLE_JOBS_DIR', join(root, 'jobs'));
  vi.resetModules();
  queue = await import('../../apps/console/job-queue.ts');
});

afterAll(() => {
  for (const child of children) child.kill('SIGKILL');
  for (const pid of descendants) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 已结束，无须清理。
    }
  }
  queue?.jobs.clear();
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(root, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(check()).toBe(true), { timeout: 5000, interval: 25 });
}

function script(marker: string): string {
  return [
    `const fs = require('node:fs');`,
    `const { spawn } = require('node:child_process');`,
    `const grand = spawn(process.execPath, ['-e', ${JSON.stringify(`process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setTimeout(() => {}, 15000);`)}], { detached: true, stdio: 'ignore' });`,
    `grand.unref();`,
    `setTimeout(() => {}, 15000);`,
  ].join('\n');
}

async function readPid(marker: string): Promise<number> {
  await waitFor(() => existsSync(marker));
  const pid = Number(readFileSync(marker, 'utf8'));
  descendants.add(pid);
  expect(alive(pid)).toBe(true);
  return pid;
}

describe.skipIf(process.platform === 'win32')('POSIX 运行作业进程树回收', () => {
  it('终止自行换进程组的孙进程', async () => {
    const marker = join(root, 'direct.pid');
    const child = spawn(process.execPath, ['-e', script(marker)], {
      detached: true,
      stdio: 'ignore',
    });
    children.push(child);
    const grand = await readPid(marker);
    queue.terminateChildProcessTree(child, 'SIGKILL');
    await waitFor(() => !alive(child.pid!) && !alive(grand));
  });

  it.each(['cancel', 'timeout'])(
    '%s 会回收运行中的孙进程',
    async (mode) => {
      const marker = join(root, `${mode}.pid`);
      const job: Queue.Job = {
        id: `job-tree-${mode}`,
        experiment: 'model',
        status: 'running',
        startedAt: new Date().toISOString(),
        log: [],
      };
      queue.jobs.set(job.id, job);
      const result = queue.runCommand(
        job,
        process.execPath,
        ['-e', script(marker)],
        process.env,
        mode === 'timeout' ? 1500 : 10000,
      );
      const grand = await readPid(marker);
      if (mode === 'cancel') expect(queue.cancelJob(job.id).ok).toBe(true);
      expect(await result).toBe(mode === 'cancel' ? 130 : 124);
      await waitFor(() => !alive(grand));
    },
    15000,
  );
});

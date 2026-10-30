import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('测试服务可显式隔离项目与作业目录', async () => {
  vi.stubEnv('PROCTOR_CONSOLE_PROJECT', '/tmp/proctor-browser-project');
  vi.stubEnv('PROCTOR_CONSOLE_JOBS_DIR', '/tmp/proctor-browser-jobs');
  vi.resetModules();
  const config = await import('../../apps/console/config.ts');
  expect(config.PROJECT).toBe(resolve('/tmp/proctor-browser-project'));
  expect(config.JOBS_DIR).toBe(resolve('/tmp/proctor-browser-jobs'));
});

it('健康检查与项目摘要使用配置项目，不硬编码默认项目名', async () => {
  const root = '/tmp/proctor-health-project';
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'environments'), { recursive: true });
  mkdirSync(join(root, 'bank/materials'), { recursive: true });
  writeFileSync(join(root, 'exam.json'), JSON.stringify({ name: '隔离项目', description: '红测' }));
  vi.stubEnv('PROCTOR_CONSOLE_PROJECT', root);
  vi.stubEnv('PROCTOR_CONSOLE_JOBS_DIR', '/tmp/proctor-health-jobs');
  vi.resetModules();
  const { health, project } = await import('../../apps/console/controllers/health.ts');
  const healthBody = (await health()).body as { project: string };
  const projectBody = (await project()).body as { project: string };
  expect(healthBody.project).toBe(resolve(root));
  expect(projectBody.project).toBe(resolve(root));
  rmSync(root, { recursive: true, force: true });
});

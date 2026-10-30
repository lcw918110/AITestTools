import { defineConfig } from '@playwright/test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testRoot = mkdtempSync(join(tmpdir(), 'proctor-browser-'));
const project = join(testRoot, 'project');
cpSync(resolve('examples/product-eval'), project, {
  recursive: true,
  filter: (source) => !['runs', 'eval-tasks', '.jobs'].includes(source.split('/').pop() ?? ''),
});

export default defineConfig({
  testDir: './tests/browser',
  globalTeardown: './tests/browser/cleanup.ts',
  metadata: { temporaryProjectRoot: testRoot },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:19793', headless: true },
  webServer: {
    command: 'npm run console',
    url: 'http://127.0.0.1:19793/api/health',
    env: {
      PROCTOR_CONSOLE_PORT: '19793',
      PROCTOR_CONSOLE_PROJECT: project,
      PROCTOR_CONSOLE_JOBS_DIR: join(testRoot, 'jobs'),
      PROCTOR_CONSOLE_VERIFY_STUB: '1',
    },
    reuseExistingServer: false,
  },
});

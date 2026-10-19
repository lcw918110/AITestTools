import { existsSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { runCommand } from '../../src/cli/commands/run.ts';

const demo = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

/**
 * run 命令端到端 smoke（cases-v1 数据源 + runner 分发）。
 * 用 fold runner（本地、无网络）跑单题，验证 runCommand 全链路：
 * resolveDatasetItems → runOneItem 分发 → writeRunArtifacts 落盘 → 返回码。
 */
describe('runCommand 端到端 smoke', () => {
  const createdRuns: string[] = [];

  afterEach(() => {
    for (const dir of createdRuns) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
    createdRuns.length = 0;
  });

  it('proctor run --dataset smoke-a-l1 --environment fold-v1 --only demo-a-todo-fold-01 全过', async () => {
    const project = loadProject(demo);
    const runsRoot = project.dirs.runs;
    const before = new Set(readdirSync(runsRoot));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    let code = -1;
    try {
      code = await runCommand({
        project: demo,
        json: true,
        dataset: 'smoke-a-l1',
        environment: 'fold-v1',
        only: ['demo-a-todo-fold-01.r1'],
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(code).toBe(0);

    // 找出本次新产生的 run 目录
    const after = readdirSync(runsRoot);
    const newDirs = after.filter((d) => !before.has(d));
    expect(newDirs.length).toBe(1);
    const runDir = join(runsRoot, newDirs[0]!);
    createdRuns.push(runDir);

    // 落盘产物存在
    expect(existsSync(join(runDir, 'run.json'))).toBe(true);
    expect(existsSync(join(runDir, 'results.ndjson'))).toBe(true);
    expect(existsSync(join(runDir, 'metrics.json'))).toBe(true);
    expect(existsSync(join(runDir, 'report.md'))).toBe(true);
  });
});

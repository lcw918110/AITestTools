import { existsSync, rmSync } from 'node:fs';
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

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    let code = -1;
    let logs: unknown[][] = [];
    try {
      code = await runCommand({
        project: demo,
        json: true,
        dataset: 'smoke-a-l1',
        environment: 'fold-v1',
        only: ['demo-a-todo-fold-01.r1'],
      });
      // 必须在 mockRestore 之前取走：restore 会重置 spy，连带清空 mock.calls。
      logs = [...logSpy.mock.calls];
    } finally {
      logSpy.mockRestore();
    }

    expect(code).toBe(0);

    // 从命令自身输出的 run_dir 定位本次目录。
    // 不能用「目录差集」推断：vitest 并行跑其他会落盘的测试时，runs/ 下会同时
    // 多出别的目录，差集长度恒不等于 1（实测期望 1 实得 4，假红）。
    const runDir = parseRunDir(logs);
    expect(runDir).not.toBeUndefined();
    createdRuns.push(runDir as string);
    expect(runDir?.startsWith(runsRoot)).toBe(true);

    // 落盘产物存在
    expect(existsSync(join(runDir as string, 'run.json'))).toBe(true);
    expect(existsSync(join(runDir as string, 'results.ndjson'))).toBe(true);
    expect(existsSync(join(runDir as string, 'metrics.json'))).toBe(true);
    expect(existsSync(join(runDir as string, 'report.md'))).toBe(true);
  });
});

/** 从 `--json` 输出里取出 `run_dir`（找不到返回 undefined）。 */
function parseRunDir(calls: unknown[][]): string | undefined {
  for (const call of calls) {
    const first = call[0];
    if (typeof first !== 'string' || !first.includes('run_dir')) continue;
    try {
      const parsed = JSON.parse(first) as { run_dir?: unknown };
      if (typeof parsed.run_dir === 'string') return parsed.run_dir;
    } catch {
      continue;
    }
  }
  return undefined;
}

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as loader from '../../src/exam-engine/loader.ts';
import { loadProject } from '../../src/exam-engine/project.ts';
import { runCommand } from '../../src/cli/commands/run.ts';
import {
  createIsolatedProjectRoot,
  removeIsolatedProjectRoot,
} from '../helpers/isolated-project.ts';

/**
 * 产物必须落临时目录：本用例真实执行 `runCommand`，
 * 若直接指向 `examples/demo-project`，会往仓库内 `runs/` 写真实 run 目录
 * （`afterEach` 虽会删，但并发窗口内仍与趋势扫描争抢 I/O）。
 */
let demo: string;

beforeAll(() => {
  demo = createIsolatedProjectRoot();
});

afterAll(() => {
  removeIsolatedProjectRoot(demo);
});

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

  it('题库坏一条不影响整卷：其余题照跑照落盘，坏题按漏跑上报', async () => {
    // 真实故障形态：组卷仍引用已被改名/删除的修订。以前会让整个 run 以退出码 2
    // 直接放弃，一条结果都不落盘，几小时的批跑全部作废。
    // 先取快照再 mock：mockImplementation 内再调同名导入会递归到自身（栈溢出）。
    const originalLoadDatasetReleases = loader.loadDatasetReleases;
    const spy = vi.spyOn(loader, 'loadDatasetReleases').mockImplementation((dir, root) => {
      const releases = originalLoadDatasetReleases(dir, root);
      return releases.map((release) => ({
        ...release,
        doc: {
          ...release.doc,
          case_revisions: release.doc.case_revisions.map((ref) =>
            ref.case_revision_id === 'demo-a-todo-fold-02.r1'
              ? { ...ref, case_revision_id: 'demo-a-todo-fold-02.r999' }
              : ref,
          ),
        },
      }));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let code = -1;
    let logs: unknown[][] = [];
    try {
      code = await runCommand({
        project: demo,
        json: true,
        dataset: 'smoke-a-l1',
        environment: 'fold-v1',
      });
      logs = [...logSpy.mock.calls];
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      spy.mockRestore();
    }

    const runDir = parseRunDir(logs);
    expect(runDir).not.toBeUndefined();
    createdRuns.push(runDir as string);
    // 有题没出结果：必须走「漏跑」退出码，不能被当成全部通过。
    expect(code).toBe(4);

    const lines = readFileSync(join(runDir as string, 'results.ndjson'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { item_id: string; pass: boolean });
    // 好题仍然跑完并落盘：这是「单题故障不拖垮整卷」的核心证据。
    expect(lines.some((line) => line.item_id === 'demo-a-todo-fold-01.r1')).toBe(true);
    const manifest = JSON.parse(readFileSync(join(runDir as string, 'run.json'), 'utf8')) as {
      items: { id: string }[];
    };
    expect(manifest.items.some((item) => item.id === 'demo-a-todo-fold-02.r999')).toBe(true);
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

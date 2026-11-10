/**
 * `proctor run` 的逐题环境记账。
 *
 * `resolveDatasetItems` 会把配对题按侧解析后的环境写进 `RunCaseInput.environment`，
 * `runCommand` 执行时必须消费它，并把实际环境记进 `run.json` 的 `items[]`。
 *
 * 为什么单独测：`writeRunArtifacts` 只是把 `meta.items` 原样透传，
 * 只测它等于测「透传本来就成立」，删掉 `run.ts` 的记账行测试仍绿（假绿）。
 * 这里用临时工程 + mock 执行器，真正覆盖 `runCommand` 的记账分支。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 每次 executeCase 实际收到的环境（按 case_revision_id 记录）。 */
const seen = vi.hoisted(() => [] as Array<{ caseRevisionId: string; environmentId: string }>);

vi.mock('../../src/run/run-orchestrator.ts', () => ({
  RunOrchestrator: class {
    beginRun(): void {}
    transitionRun(): void {}
    async executeCase(
      revision: { case_revision_id: string; revision_number: number },
      environment: { environment_profile_id: string },
    ): Promise<{ caseExecutions: unknown[]; results: Array<Record<string, unknown>> }> {
      seen.push({
        caseRevisionId: revision.case_revision_id,
        environmentId: environment.environment_profile_id,
      });
      return {
        caseExecutions: [],
        results: [
          {
            item_id: revision.case_revision_id,
            item_rev: revision.revision_number,
            pass: true,
            oracle_failures: [],
            metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
          },
        ],
      };
    }
  },
}));

/** 各 adapter 都换成空壳：本测试只关心环境如何被路由与记账。 */
vi.mock('../../src/run/hosted-runner.ts', () => ({ HostedAdapter: class {} }));
vi.mock('../../src/run/b-runner.ts', () => ({ BDirectAdapter: class {} }));
vi.mock('../../src/run/c-runner.ts', () => ({ CAdapter: class {} }));
vi.mock('../../src/run/l1-runner.ts', () => ({ L1Adapter: class {} }));
vi.mock('../../src/run/l2-runner.ts', () => ({ L2Adapter: class {} }));
vi.mock('../../src/run/l3-runner.ts', () => ({ L3Adapter: class {} }));

const { runCommand } = await import('../../src/cli/commands/run.ts');

function writeProject(root: string): void {
  mkdirSync(join(root, 'environments'), { recursive: true });
  mkdirSync(join(root, 'cases'), { recursive: true });
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  mkdirSync(join(root, 'dataset-releases'), { recursive: true });

  writeFileSync(
    join(root, 'exam.json'),
    JSON.stringify({ name: 'paired-run-test', asset_protocol: 'cases-v1' }),
  );

  writeFileSync(
    join(root, 'environments/hosted-plugin-v1.environment.json'),
    JSON.stringify({
      environment_profile_id: 'hosted-plugin-v1',
      name: 'hosted-plugin-v1',
      lifecycle: 'active',
      paired_environments: { off: 'hosted-plain-v1' },
      recipe: { kind: 'hosted', host_command: 'opencode', host_plugin: 'dist/Plugin.js' },
    }),
  );
  writeFileSync(
    join(root, 'environments/hosted-plain-v1.environment.json'),
    JSON.stringify({
      environment_profile_id: 'hosted-plain-v1',
      name: 'hosted-plain-v1',
      lifecycle: 'active',
      recipe: { kind: 'hosted', host_command: 'opencode' },
    }),
  );

  writeFileSync(
    join(root, 'cases/paired-task-1.case.json'),
    JSON.stringify({
      case_id: 'paired-task-1',
      title: '配对样本',
      lifecycle: 'released',
      automation_readiness: 'design_ready',
      pair_key: 'PAIRED-TASK-1',
    }),
  );

  for (const [side, hash] of [
    ['off', 'hash-off'],
    ['on', 'hash-on'],
  ] as const) {
    writeFileSync(
      join(root, `case-revisions/paired-task-1.r1.${side}.case-revision.json`),
      JSON.stringify({
        case_id: 'paired-task-1',
        case_revision_id: `paired-task-1.r1.${side}`,
        revision_number: 1,
        content_hash: hash,
        stimulus: { kind: 'task_prompt', text: '样本' },
        expect: { oracles: [] },
        attribution_focus: 'MODEL_TASK',
        execution: { deadline_ms: 1000 },
        execution_profile: { mode: 'hosted' },
      }),
    );
  }

  writeFileSync(
    join(root, 'dataset-releases/paired-smoke.dataset-release.json'),
    JSON.stringify({
      dataset_release_id: 'paired-smoke',
      name: 'paired-smoke',
      case_revisions: [
        {
          case_id: 'paired-task-1',
          case_revision_id: 'paired-task-1.r1.off',
          content_hash: 'hash-off',
        },
        {
          case_id: 'paired-task-1',
          case_revision_id: 'paired-task-1.r1.on',
          content_hash: 'hash-on',
        },
      ],
      closure_hash: 'closure',
    }),
  );
}

describe('runCommand 逐题环境记账', () => {
  let root: string;

  beforeEach(() => {
    seen.length = 0;
    root = mkdtempSync(join(tmpdir(), 'proctor-run-paired-'));
    writeProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('执行用按侧环境，run.json items[] 记实际环境', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let code = -1;
    let logs: unknown[][] = [];
    try {
      code = await runCommand({
        project: root,
        json: true,
        dataset: 'paired-smoke',
        environment: 'hosted-plugin-v1',
      });
      logs = [...logSpy.mock.calls];
    } finally {
      logSpy.mockRestore();
    }

    expect(code).toBe(0);
    expect(seen).toEqual([
      { caseRevisionId: 'paired-task-1.r1.off', environmentId: 'hosted-plain-v1' },
      { caseRevisionId: 'paired-task-1.r1.on', environmentId: 'hosted-plugin-v1' },
    ]);

    const runDir = parseRunDir(logs);
    expect(runDir).not.toBeUndefined();
    const runJson = JSON.parse(readFileSync(join(runDir as string, 'run.json'), 'utf8')) as {
      environment: string;
      items: Array<{ id: string; environment?: string }>;
    };
    // 顶层保持命令行基准值，逐题才是实际执行环境。
    expect(runJson.environment).toBe('hosted-plugin-v1');
    expect(runJson.items.find((i) => i.id === 'paired-task-1.r1.off')?.environment).toBe(
      'hosted-plain-v1',
    );
    expect(runJson.items.find((i) => i.id === 'paired-task-1.r1.on')?.environment).toBe(
      'hosted-plugin-v1',
    );
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

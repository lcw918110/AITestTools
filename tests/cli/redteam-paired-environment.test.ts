/**
 * 安全红队也必须按侧解析环境。
 *
 * `proctor redteam` 与 `proctor run` 共用 `resolveDatasetItems`，后者已把
 * 配对题的实际环境写进 `RunCaseInput.environment`。但 redteam 曾直接拿
 * 命令行 `--environment` 的基准值去执行，等价于「OFF 侧也挂插件」——
 * 配对前提失效，安全结论也就不成立。
 *
 * 这里用临时工程 + mock 执行器锁死两件事：
 * 1. 每道题实际执行时用的环境 = 该题解析后的环境（不是基准值）；
 * 2. `run.json` 的 `items[]` 记录每题实际环境，避免报告与执行账实不符。
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
    ): Promise<{
      caseExecutions: unknown[];
      results: Array<Record<string, unknown>>;
    }> {
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

vi.mock('../../src/run/hosted-runner.ts', () => ({
  HostedAdapter: class {
    readonly adapterId = 'fake-hosted';
  },
}));

const { runRedTeamCommand } = await import('../../src/cli/commands/redteam.ts');

/** 临时最小工程：一道配对题（OFF 无插件 / ON 挂插件）。 */
function writeProject(root: string): void {
  mkdirSync(join(root, 'environments'), { recursive: true });
  mkdirSync(join(root, 'cases'), { recursive: true });
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  mkdirSync(join(root, 'dataset-releases'), { recursive: true });

  writeFileSync(
    join(root, 'exam.json'),
    JSON.stringify({ name: 'paired-redteam-test', asset_protocol: 'cases-v1' }),
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

describe('redteam 按侧解析环境', () => {
  let root: string;

  beforeEach(() => {
    seen.length = 0;
    root = mkdtempSync(join(tmpdir(), 'proctor-redteam-paired-'));
    writeProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('OFF 题走无插件环境、ON 题走挂插件环境（不共用基准值）', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let code = -1;
    let logs: unknown[][] = [];
    try {
      code = await runRedTeamCommand({
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

    // 报告里的环境不能只写基准值，否则与执行账实不符。
    const runDir = parseRunDir(logs);
    expect(runDir).not.toBeUndefined();
    const runJson = JSON.parse(readFileSync(join(runDir as string, 'run.json'), 'utf8')) as {
      items: Array<{ id: string; environment?: string }>;
    };
    const offItem = runJson.items.find((i) => i.id === 'paired-task-1.r1.off');
    const onItem = runJson.items.find((i) => i.id === 'paired-task-1.r1.on');
    expect(offItem?.environment).toBe('hosted-plain-v1');
    expect(onItem?.environment).toBe('hosted-plugin-v1');

    // security_report.json 是独立交付物，同样要逐题记实际环境。
    const report = JSON.parse(
      readFileSync(join(runDir as string, 'security_report.json'), 'utf8'),
    ) as { cases: Array<{ case_revision_id: string; environment?: string }> };
    expect(
      report.cases.find((c) => c.case_revision_id === 'paired-task-1.r1.off')?.environment,
    ).toBe('hosted-plain-v1');
    expect(
      report.cases.find((c) => c.case_revision_id === 'paired-task-1.r1.on')?.environment,
    ).toBe('hosted-plugin-v1');
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

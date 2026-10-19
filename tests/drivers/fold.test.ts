import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { L1Adapter } from '../../src/run/l1-runner.ts';
import { RunOrchestrator } from '../../src/run/run-orchestrator.ts';
import { resolveDatasetItems } from '../../src/cli/commands/run.ts';

const demo = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

async function runL1(revision: unknown, environment: unknown, projectRoot: string) {
  const orch = new RunOrchestrator();
  orch.beginRun({});
  orch.transitionRun('preflight');
  orch.transitionRun('running');
  return orch.executeCase(revision as never, environment as never, new L1Adapter(), {
    projectRoot,
    models: [],
  });
}

describe('L1 fold adapter', () => {
  it('DEMO-A-TODO-FOLD-01 通过', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'smoke-a-l1', 'fold-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-a-todo-fold-01')!;
    expect(runCase.revision.execution_profile?.layer).toBe('L1');
    const { results } = await runL1(runCase.revision, environment, project.root);
    expect(results[0]?.pass).toBe(true);
    expect(results[0]?.fold_state).toMatchObject({ ignored_events: 1 });
  });

  it('改坏期望则 PROTOCOL', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'smoke-a-l1', 'fold-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-a-todo-fold-01')!;
    const revision = structuredClone(runCase.revision);
    // 指向不存在的期望文件 → HARNESS；改用错误 oracle 断言
    revision.expect.oracles = [
      { type: 'state_predicate', id: 'bad', expr: 'ignored_events == 99' },
    ];
    const { results } = await runL1(revision, environment, project.root);
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('PROTOCOL');
  });
});

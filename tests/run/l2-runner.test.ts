import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { L2Adapter } from '../../src/run/l2-runner.ts';
import { RunOrchestrator } from '../../src/run/run-orchestrator.ts';
import { resolveDatasetItems } from '../../src/cli/commands/run.ts';

const demo = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

async function runL2(revision: unknown, environment: unknown, projectRoot: string) {
  const orch = new RunOrchestrator();
  orch.beginRun({});
  orch.transitionRun('preflight');
  orch.transitionRun('running');
  return orch.executeCase(revision as never, environment as never, new L2Adapter(), {
    projectRoot,
    models: [],
  });
}

describe('L2 fakehost adapter（scripted）', () => {
  it('demo-a-nudge-timing-01 通过（nudge 落在两轮之间）', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'smoke-a', 'fake-host-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-a-nudge-timing-01')!;
    expect(runCase.revision.execution_profile?.mode).toBe('scripted');
    expect(runCase.revision.execution_profile?.layer).toBe('L2');

    const { results } = await runL2(runCase.revision, environment, project.root);

    expect(results[0]?.pass).toBe(true);
    expect(results[0]?.item_id).toBe('demo-a-nudge-timing-01.r2');
    expect(results[0]?.item_rev).toBe(2);
  });

  it('改坏期望则 PROTOCOL', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'smoke-a', 'fake-host-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-a-nudge-timing-01')!;
    const revision = structuredClone(runCase.revision);
    // 断言一个不成立的 state_predicate → 判定失败，归因 PROTOCOL
    revision.expect.oracles = [
      { type: 'state_predicate', id: 'bad', expr: 'session.nudge_count == 99' },
    ];

    const { results } = await runL2(revision, environment, project.root);

    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('PROTOCOL');
  });
});

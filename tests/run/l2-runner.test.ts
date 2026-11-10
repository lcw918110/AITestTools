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

  // 回归：no_event 的空 names 会让 forbidden 为空 Set、find 恒 undefined → 恒通过（假绿）。
  // L1 与 hosted 都已补空名校验，L2 曾漏改，三处口径不一致。
  it('no_event 未声明有效事件名时归因 HARNESS，不得假绿', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'smoke-a', 'fake-host-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-a-nudge-timing-01')!;

    for (const names of [[], [''], ['   '], [null], [42]]) {
      const revision = structuredClone(runCase.revision);
      revision.expect.oracles = [{ type: 'no_event', id: 'empty-names', names }] as never;

      const { results } = await runL2(revision, environment, project.root);

      expect(results[0]?.pass, `names=${JSON.stringify(names)} 不得通过`).toBe(false);
      expect(results[0]?.attribution, `names=${JSON.stringify(names)}`).toBe('HARNESS');
    }
  });

  // 同类假绿：空 names 的 event_subsequence 是「空序列是任何序列的子序列」→ 恒通过。
  it('event_subsequence 未声明有效事件名时归因 HARNESS，不得假绿', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'smoke-a', 'fake-host-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-a-nudge-timing-01')!;

    for (const names of [[], [''], ['   '], [null], [42]]) {
      const revision = structuredClone(runCase.revision);
      revision.expect.oracles = [{ type: 'event_subsequence', id: 'empty-names', names }] as never;

      const { results } = await runL2(revision, environment, project.root);

      expect(results[0]?.pass, `names=${JSON.stringify(names)} 不得通过`).toBe(false);
      expect(results[0]?.attribution, `names=${JSON.stringify(names)}`).toBe('HARNESS');
    }
  });
});

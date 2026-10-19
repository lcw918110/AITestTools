import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { L3Adapter } from '../../src/run/l3-runner.ts';
import { RunOrchestrator } from '../../src/run/run-orchestrator.ts';
import { resolveDatasetItems } from '../../src/cli/commands/run.ts';

const demo = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

async function runL3(revision: unknown, environment: unknown, projectRoot: string) {
  const orch = new RunOrchestrator();
  orch.beginRun({});
  orch.transitionRun('preflight');
  orch.transitionRun('running');
  return orch.executeCase(revision as never, environment as never, new L3Adapter(), {
    projectRoot,
    models: [],
  });
}

describe('L3 cassette adapter（对拍）', () => {
  it('demo-a-l3-nudge-01 通过（cassette 回放命中期望事件子序列）', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'smoke-a-l3', 'fake-host-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-a-l3-nudge-01')!;
    expect(runCase.revision.execution_profile?.mode).toBe('cassette');
    expect(runCase.revision.execution_profile?.layer).toBe('L3');

    const { results } = await runL3(runCase.revision, environment, project.root);

    expect(results[0]?.pass).toBe(true);
    expect(results[0]?.item_id).toBe('demo-a-l3-nudge-01.r1');
    expect(results[0]?.item_rev).toBe(1);
  });

  it('cassette 缺失则 HARNESS 失败', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'smoke-a-l3', 'fake-host-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-a-l3-nudge-01')!;
    const revision = structuredClone(runCase.revision);
    // 指向不存在的 cassette → 加载失败，归因 HARNESS
    revision.execution_profile!.cassette = 'cassettes/不存在/manifest.json';

    const { results } = await runL3(revision, environment, project.root);

    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.attribution).toBe('HARNESS');
  });
});

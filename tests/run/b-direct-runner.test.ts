import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { BDirectAdapter } from '../../src/run/b-runner.ts';
import { RunOrchestrator } from '../../src/run/run-orchestrator.ts';
import { resolveDatasetItems } from '../../src/cli/commands/run.ts';

const demo = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

describe('B-direct adapter（promptfoo fixture 模式）', () => {
  it('demo-b-tool-schema-01 通过（fixture 命中 todowrite 工具调用与必填字段）', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'model-core', 'model-direct-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-b-tool-schema-01')!;
    expect(runCase.revision.execution_profile?.mode).toBe('hosted');
    expect(environment.recipe.kind).toBe('live-model');

    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');
    const { results } = await orch.executeCase(
      runCase.revision,
      environment,
      new BDirectAdapter(),
      {
        projectRoot: project.root,
        // fixture 模式：models 用 fixture-a/fixture-b（对应 fixtures/*.json）
        models: ['fixture-a', 'fixture-b'],
      },
    );

    // 2 model × 3 trial（环境 adapter.repeats=3）= 6 行，全部 pass
    // repeats 上移（ADR-0010）：trial 序号来自编排层 replicate_index（0-based）。
    expect(results.length).toBe(6);
    for (const r of results) {
      expect(r.pass).toBe(true);
      expect(r.item_id).toMatch(/^demo-b-tool-schema-01\.r1::fixture-[ab]::r[012]$/);
    }
  });
});

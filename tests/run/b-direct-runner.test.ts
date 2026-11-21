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

  it('空 must_call / 空 required_fields 在 B-direct 上同样判负并归 HARNESS', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'model-core', 'model-direct-v1');
    const base = cases.find((c) => c.revision.case_id === 'demo-b-tool-schema-01')!;

    /** 只换 oracles，其余字段复用真实题面（保证能被 schema/编排层正常执行）。 */
    async function runWith(oracles: unknown[]) {
      const revision = structuredClone(base.revision);
      revision.expect.oracles = oracles as typeof revision.expect.oracles;
      const orch = new RunOrchestrator();
      orch.beginRun({});
      orch.transitionRun('preflight');
      orch.transitionRun('running');
      const { results } = await orch.executeCase(revision, environment, new BDirectAdapter(), {
        projectRoot: project.root,
        models: ['fixture-a'],
      });
      return results;
    }

    // 关键：不能只断言 attribution === 'HARNESS' —— 编排层对 adapter 异常/cleanup 失败
    // 同样会兜底产出 HARNESS 行，那样断言会被兜底行天然满足（假绿）。
    // 必须断言「失败来自这条 oracle 本身」：oracle_id 命中且消息点名具体字段。
    for (const [label, oracles, expectId, expectField] of [
      [
        '空 must_call',
        [{ type: 'tool_trace', id: 'empty-tools', must_call: [] }],
        'empty-tools',
        'must_call',
      ],
      [
        '空 required_fields',
        [{ type: 'schema_obedience', id: 'empty-fields', tool: 'todowrite', required_fields: [] }],
        'empty-fields',
        'required_fields',
      ],
      [
        '空工具名',
        [{ type: 'schema_obedience', id: 'empty-tool', tool: '  ', required_fields: ['todos'] }],
        'empty-tool',
        'tool',
      ],
    ] as const) {
      const results = await runWith([...oracles]);
      expect(results.length, label).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.pass, label).toBe(false);
        expect(r.attribution, label).toBe('HARNESS');
        const hit = r.oracle_failures.find((f) => f.oracle_id === expectId);
        expect(hit, `${label}：失败必须来自 ${expectId}，而不是编排层兜底行`).toBeDefined();
        expect(hit?.message, label).toContain(expectField);
      }
    }
  });

  it('数字 / 空值不会被 String() 强转成假工具名塞进 EvalJob', async () => {
    const project = loadProject(demo);
    const job = await new BDirectAdapter().discover({
      revision: {
        case_revision_id: 'x.r1.off',
        revision_number: 1,
        stimulus: { ref: 'materials/x/prompt.txt' },
        expect: {
          oracles: [
            { type: 'tool_trace', id: 't', must_call: [0, 'todowrite'] },
            {
              type: 'schema_obedience',
              id: 's',
              tool: 'todowrite',
              required_fields: [null, 'todos'],
            },
          ],
        },
      } as never,
      models: ['fixture-a'],
      projectRoot: project.root,
    } as never);
    const jobDoc = (job as unknown as { job: { items: Array<Record<string, unknown>> } }).job;
    expect(jobDoc.items[0]?.must_call).toEqual(['todowrite']);
    expect(jobDoc.items[0]?.required_fields).toEqual({ todowrite: ['todos'] });
  });
});

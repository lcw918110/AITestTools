import { describe, expect, it } from 'vitest';
import { RunOrchestrator } from '../../src/run/run-orchestrator.ts';
import type { RunLifecycleStatus } from '../../src/domain/types.ts';

describe('RunOrchestrator 状态机（阶段 4b）', () => {
  it('beginRun 创建 Run 且初始状态为 created', () => {
    const orch = new RunOrchestrator();
    const run = orch.beginRun({ experimentId: 'exp-1', candidateId: 'cand-1' });
    expect(run.lifecycle_status).toBe('created');
    expect(run.run_id).toBeTruthy();
    expect(run.experiment_id).toBe('exp-1');
    expect(run.candidate_id).toBe('cand-1');
  });

  it('合法转换：created → preflight → queued → running → completed', () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    const path: RunLifecycleStatus[] = ['preflight', 'queued', 'running', 'completed'];
    for (const s of path) {
      orch.transitionRun(s);
      expect(orch.currentStatus()).toBe(s);
    }
  });

  it('非法转换：completed → running 抛错（终态不可重开）', () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');
    orch.transitionRun('completed');
    expect(() => orch.transitionRun('running')).toThrow();
  });

  it('非法转换：created → completed 直接跳态抛错', () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    expect(() => orch.transitionRun('completed')).toThrow();
  });

  it('sealRun 返回 RunFinalManifest 且引用计划快照', () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');
    // sealRun 直接从 running 封存到终态（合法转换）
    const manifest = orch.sealRun('completed');
    expect(manifest.run_id).toBe(orch.currentRun().run_id);
    expect(manifest.plan_snapshot_ref).toBeTruthy();
    expect(manifest.sealed_at).toBeTruthy();
    expect(orch.currentStatus()).toBe('completed');
  });

  it('sealRun 绕过非法转换会抛错（created 不能直接 completed）', () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    expect(() => orch.sealRun('completed')).toThrow();
  });

  it('executeCase 创建 CaseExecution + Attempt 并映射终态', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    // 用一个最小 no-op adapter 验证状态机实例化
    const noopAdapter = {
      adapterId: 'noop',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ prepared: true }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => [
        {
          item_id: 'demo-a-todo-fold-01.r1',
          item_rev: 1,
          pass: true,
          oracle_failures: [],
          metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
        },
      ],
    };

    const { caseExecutions, results } = await orch.executeCase(
      {
        id: 'EVAL-B-PAIRED-TASK-22-OFF',
        rev: 2,
        axis: 'B',
        intent: { attribution_focus: 'TOOL' },
        stimulus: { ref: 'x' },
        execution_profile: { mode: 'fold' },
        execution: {},
        expect: { oracles: [] },
        freeze: {},
      } as never,
      {} as never,
      noopAdapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    expect(caseExecutions.length).toBe(1);
    expect(caseExecutions[0]?.execution_outcome).toBe('completed');
    expect(caseExecutions[0]?.evaluation_outcome).toBe('pass');
    expect(caseExecutions[0]?.attempts.length).toBe(1);
    expect(results[0]?.pass).toBe(true);
  });

  it('executeCase 声明 repeats=4（题级 execution.repeats），循环产生 4 个 CaseExecution + 4 个 replicate_index', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    let callCount = 0;
    const countingAdapter = {
      adapterId: 'counting',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ prepared: true }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => {
        callCount += 1;
        return [
          {
            item_id: `model-case.r1`,
            item_rev: 1,
            pass: true,
            oracle_failures: [],
            metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
          },
        ];
      },
    };

    const { caseExecutions, results } = await orch.executeCase(
      {
        case_id: 'model-case',
        case_revision_id: 'model-case.r1',
        revision_number: 1,
        execution_profile: { mode: 'hosted' },
        attribution_focus: 'TOOL',
        stimulus: { ref: 'x' },
        execution: { deadline_ms: 1000, requires_network: false, repeats: 4 },
        expect: { oracles: [] },
      } as never,
      {} as never,
      countingAdapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    expect(callCount).toBe(4);
    expect(caseExecutions.length).toBe(4);
    expect(results.length).toBe(4);
    const indices = caseExecutions.map((ce) => ce.replicate_index).sort();
    expect(indices).toEqual([0, 1, 2, 3]);
    // repeats>1 时 item_id 尾缀 ::r<N>
    expect(results.map((r) => r.item_id).sort()).toEqual([
      'model-case.r1::r0',
      'model-case.r1::r1',
      'model-case.r1::r2',
      'model-case.r1::r3',
    ]);
  });
});

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
      evaluate: async () => ({ pass: true, attribution: undefined }),
    };

    const ce = await orch.executeCase(
      {
        id: 'EVAL-B-PAIRED-TASK-22-OFF',
        rev: 2,
        axis: 'B',
        intent: { attribution_focus: 'TOOL' },
        stimulus: { ref: 'x' },
        execution: {},
        expect: { oracles: [] },
        freeze: {},
      } as never,
      {} as never,
      noopAdapter as never,
    );

    expect(ce.execution_outcome).toBe('completed');
    expect(ce.evaluation_outcome).toBe('pass');
    expect(ce.attempts.length).toBe(1);
  });
});

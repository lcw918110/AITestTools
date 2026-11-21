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

  it('executeCase 声明 not_implemented 时记 not_evaluated，不算被测系统失败', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    const adapter = {
      adapterId: 'stub-not-impl',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ prepared: true }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => [
        {
          item_id: 'stub-not-impl.r1',
          item_rev: 1,
          pass: false,
          oracle_failures: [],
          metrics: { a_case_pass_rate: 0, a_invariant_violations: 0 },
          attribution: 'HARNESS',
          not_implemented: true,
        },
      ],
    };

    const { caseExecutions } = await orch.executeCase(
      {
        id: 'EVAL-STUB-NOT-IMPL',
        rev: 1,
        axis: 'B',
        intent: { attribution_focus: 'TOOL' },
        stimulus: { ref: 'x' },
        execution_profile: { mode: 'fold' },
        execution: {},
        expect: { oracles: [] },
      } as never,
      {} as never,
      adapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    expect(caseExecutions.length).toBe(1);
    // 能力缺失不能被计成被测系统失败，也不能计成通过
    expect(caseExecutions[0]?.evaluation_outcome).toBe('not_evaluated');
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

  it('executeCase 在 submit/collect 抛错时仍保证执行 adapter.cleanup 释放资源', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    let cleanupCalls = 0;
    const failingAdapter = {
      adapterId: 'failing-submit',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ workspace: '/tmp/fake-ws' }),
      submit: async () => {
        throw new Error('simulated submit crash');
      },
      collect: async () => ({ output: {} }),
      evaluate: async () => [],
      cleanup: async () => {
        cleanupCalls += 1;
      },
    };

    const { caseExecutions, results } = await orch.executeCase(
      {
        case_id: 'crash-case',
        case_revision_id: 'crash-case.r1',
        revision_number: 1,
        execution_profile: { mode: 'hosted' },
        attribution_focus: 'TOOL',
        stimulus: { ref: 'x' },
        execution: { deadline_ms: 1000, requires_network: false, repeats: 1 },
        expect: { oracles: [] },
      } as never,
      {} as never,
      failingAdapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    expect(cleanupCalls).toBe(1);
    expect(caseExecutions[0]?.execution_outcome).toBe('execution_failed');
    expect(results[0]?.pass).toBe(false);
  });

  it('adapter.cleanup 抛错时不能静默吞掉：必须留下失败证据', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    const leakyAdapter = {
      adapterId: 'leaky-cleanup',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ workspace: '/tmp/fake-ws' }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => [
        {
          item_id: 'leaky.r1',
          item_rev: 1,
          pass: true,
          oracle_failures: [],
          metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
        },
      ],
      // 资源没释放：实例没停、临时目录没删
      cleanup: async () => {
        throw new Error('临时目录删除失败：EBUSY');
      },
    };

    const { results } = await orch.executeCase(
      {
        case_id: 'leaky-case',
        case_revision_id: 'leaky-case.r1',
        revision_number: 1,
        execution_profile: { mode: 'hosted' },
        attribution_focus: 'TOOL',
        stimulus: { ref: 'x' },
        execution: { deadline_ms: 1000, requires_network: false, repeats: 1 },
        expect: { oracles: [] },
      } as never,
      {} as never,
      leakyAdapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    // 结果本身通过，但 cleanup 失败必须作为 HARNESS 侧事实被记录，
    // 否则资源泄漏会被静默掩盖，下一次 run 可能撞上残留状态。
    const failures = results[0]?.oracle_failures ?? [];
    const cleanupFailure = failures.find((f) => f.oracle_id === 'harness:cleanup');
    expect(cleanupFailure).toBeDefined();
    expect(cleanupFailure?.message).toContain('EBUSY');
  });

  it('cleanup 返回 ok=false（不抛错）时同样必须留下失败证据', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    const adapter = {
      adapterId: 'quiet-leak',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ workspace: '/tmp/fake-ws' }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => [
        {
          item_id: 'quiet.r1',
          item_rev: 1,
          pass: true,
          oracle_failures: [],
          metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
        },
      ],
      // 停实例失败但没抛错——这是最容易漏掉的一类泄漏
      cleanup: async () => ({ ok: false, reason: '实例未在超时内退出' }),
    };

    const { results } = await orch.executeCase(
      {
        case_id: 'quiet-case',
        case_revision_id: 'quiet-case.r1',
        revision_number: 1,
        execution_profile: { mode: 'hosted' },
        attribution_focus: 'TOOL',
        stimulus: { ref: 'x' },
        execution: { deadline_ms: 1000, requires_network: false, repeats: 1 },
        expect: { oracles: [] },
      } as never,
      {} as never,
      adapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    const cleanupFailure = (results[0]?.oracle_failures ?? []).find(
      (f) => f.oracle_id === 'harness:cleanup',
    );
    expect(cleanupFailure).toBeDefined();
    expect(cleanupFailure?.message).toContain('实例未在超时内退出');
    // 仍不能翻转被测系统的判定
    expect(results[0]?.pass).toBe(true);
  });

  it('cleanup 失败不改写被测系统的评测结论', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    const adapter = {
      adapterId: 'leaky-but-passed',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ workspace: '/tmp/fake-ws' }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => [
        {
          item_id: 'ok.r1',
          item_rev: 1,
          pass: true,
          oracle_failures: [],
          metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
        },
      ],
      cleanup: async () => {
        throw new Error('子进程未能退出');
      },
    };

    const { caseExecutions, results } = await orch.executeCase(
      {
        case_id: 'ok-case',
        case_revision_id: 'ok-case.r1',
        revision_number: 1,
        execution_profile: { mode: 'hosted' },
        attribution_focus: 'TOOL',
        stimulus: { ref: 'x' },
        execution: { deadline_ms: 1000, requires_network: false, repeats: 1 },
        expect: { oracles: [] },
      } as never,
      {} as never,
      adapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    // 被测系统确实通过了；cleanup 是编排侧问题，不能把它翻成 fail 或改归因
    expect(results[0]?.pass).toBe(true);
    expect(caseExecutions[0]?.evaluation_outcome).toBe('pass');
    expect(caseExecutions[0]?.attribution).toBeUndefined();
  });

  it('题级判定不只看首行：首行为未实现、后续有真实观测时仍按真实观测判', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    // B-direct 单题多模型：一次产出多行，首行能力缺失不代表整题没测
    const mixedAdapter = {
      adapterId: 'mixed-rows',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ prepared: true }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => [
        {
          item_id: 'mixed.r1::weak::r0',
          item_rev: 1,
          pass: false,
          not_implemented: true,
          attribution: 'HARNESS',
          oracle_failures: [],
          metrics: { a_case_pass_rate: 0, a_invariant_violations: 0 },
        },
        {
          item_id: 'mixed.r1::strong::r0',
          item_rev: 1,
          pass: true,
          oracle_failures: [],
          metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
        },
      ],
    };

    const { caseExecutions } = await orch.executeCase(
      {
        case_id: 'mixed',
        case_revision_id: 'mixed.r1',
        revision_number: 1,
        execution_profile: { mode: 'direct' },
        attribution_focus: 'TOOL',
        stimulus: { ref: 'x' },
        execution: { deadline_ms: 1000, requires_network: false },
        expect: { oracles: [] },
      } as never,
      {} as never,
      mixedAdapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    // 有一条真实观测且通过 → 整题通过；若只看首行会错记 not_evaluated
    expect(caseExecutions[0]?.evaluation_outcome).toBe('pass');
  });

  it('题级判定：首行已评测但后续行未评测时，未评测行不能进通过率', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    const mixedAdapter = {
      adapterId: 'mixed-rows-2',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ prepared: true }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => [
        {
          item_id: 'm2.r1::a::r0',
          item_rev: 1,
          pass: true,
          oracle_failures: [],
          metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
        },
        {
          item_id: 'm2.r1::b::r0',
          item_rev: 1,
          pass: false,
          not_implemented: true,
          attribution: 'HARNESS',
          oracle_failures: [],
          metrics: { a_case_pass_rate: 0, a_invariant_violations: 0 },
        },
      ],
    };

    const { caseExecutions } = await orch.executeCase(
      {
        case_id: 'm2',
        case_revision_id: 'm2.r1',
        revision_number: 1,
        execution_profile: { mode: 'direct' },
        attribution_focus: 'TOOL',
        stimulus: { ref: 'x' },
        execution: { deadline_ms: 1000, requires_network: false },
        expect: { oracles: [] },
      } as never,
      {} as never,
      mixedAdapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    // 唯一一条真实观测通过 → 通过；未评测行的 pass=false 不得把整题拉成失败
    expect(caseExecutions[0]?.evaluation_outcome).toBe('pass');
  });

  it('只有未评测行且 cleanup 失败时，泄漏证据不能消失', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    const adapter = {
      adapterId: 'notimpl-leaky',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ prepared: true }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => [
        {
          item_id: 'ni.r1',
          item_rev: 1,
          pass: false,
          not_implemented: true,
          oracle_failures: [],
          metrics: { a_case_pass_rate: 0, a_invariant_violations: 0 },
        },
      ],
      cleanup: async () => ({ ok: false, reason: '实例未退出' }),
    };

    const { results } = await orch.executeCase(
      {
        case_id: 'ni',
        case_revision_id: 'ni.r1',
        revision_number: 1,
        execution_profile: { mode: 'hosted' },
        attribution_focus: 'TOOL',
        stimulus: { ref: 'x' },
        execution: { deadline_ms: 1000, requires_network: false, repeats: 1 },
        expect: { oracles: [] },
      } as never,
      {} as never,
      adapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    // 该题唯一的行也是未评测行：泄漏若挂不上就等于彻底丢失
    const cleanupFailure = (results[0]?.oracle_failures ?? []).find(
      (f) => f.oracle_id === 'harness:cleanup',
    );
    expect(cleanupFailure?.message).toContain('实例未退出');
    // 仍未评测，不能因泄漏变成被测失败
    expect(results[0]?.not_implemented).toBe(true);
  });

  it('evaluate 返回空结果且 cleanup 失败时，泄漏仍要落成一条可追溯记录', async () => {
    const orch = new RunOrchestrator();
    orch.beginRun({});
    orch.transitionRun('preflight');
    orch.transitionRun('running');

    const adapter = {
      adapterId: 'empty-leaky',
      discover: async () => ({ resolved: {} }),
      prepare: async () => ({ prepared: true }),
      submit: async () => ({ handle: 'h' }),
      collect: async () => ({ output: {} }),
      evaluate: async () => [],
      cleanup: async () => {
        throw new Error('rm -rf 失败');
      },
    };

    const { results } = await orch.executeCase(
      {
        case_id: 'empty',
        case_revision_id: 'empty.r1',
        revision_number: 1,
        execution_profile: { mode: 'hosted' },
        attribution_focus: 'TOOL',
        stimulus: { ref: 'x' },
        execution: { deadline_ms: 1000, requires_network: false, repeats: 1 },
        expect: { oracles: [] },
      } as never,
      {} as never,
      adapter as never,
      { projectRoot: '/tmp', models: [] },
    );

    const created = results.find((r) =>
      r.oracle_failures.some((f) => f.oracle_id === 'harness:cleanup'),
    );
    expect(created).toBeDefined();
    // 占位行自证「不是被测系统失败」
    expect(created?.not_implemented).toBe(true);
  });
});

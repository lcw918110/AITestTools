import { describe, expect, it } from 'vitest';
import {
  buildRunSummary,
  inferPairFromItemId,
  parseBaselinePathFromEffectMd,
  summarizeAttribution,
  summarizeEffectPairs,
  summarizeStability,
} from '../../apps/console/run-summary.ts';

describe('console run-summary', () => {
  it('汇总失败归因主因', () => {
    const rows = [
      { item_id: 'A', pass: false, attribution: 'MODEL_TASK' },
      { item_id: 'B', pass: false, attribution: 'MODEL_TASK' },
      { item_id: 'C', pass: false, attribution: 'PROTOCOL' },
      { item_id: 'D', pass: true },
    ];
    const a = summarizeAttribution(rows);
    expect(a.fail_total).toBe(3);
    expect(a.pass_total).toBe(1);
    expect(a.primary_fail).toBe('MODEL_TASK');
    expect(a.fail_counts.MODEL_TASK).toBe(2);
    expect(a.fail_counts.PROTOCOL).toBe(1);
  });

  it('推断 effect_pair 与同卷 OFF/ON', () => {
    expect(inferPairFromItemId('EVAL-B-PAIRED-TASK-OFF')).toBe('PAIRED-TASK-01');
    expect(inferPairFromItemId('EVAL-B-PAIRED-TASK-03-ON')).toBe('PAIRED-TASK-03');
    const pairs = summarizeEffectPairs([
      {
        item_id: 'EVAL-B-PAIRED-TASK-02-OFF',
        pass: true,
        effect_pair: 'PAIRED-TASK-02',
      },
      {
        item_id: 'EVAL-B-PAIRED-TASK-02-ON',
        pass: false,
        effect_pair: 'PAIRED-TASK-02',
      },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.pair).toBe('PAIRED-TASK-02');
    expect(pairs[0]?.off_pass).toBe(true);
    expect(pairs[0]?.on_pass).toBe(false);
  });

  it('稳定性：无 repeats 时注明口径', () => {
    const st = summarizeStability({ a_flaky_rerun_delta: 0 }, [{ item_id: 'X', pass: true }]);
    expect(st.a_flaky_rerun_delta).toBe(0);
    expect(st.repeat_tagged_items).toBe(0);
    expect(st.note).toContain('不等于已证明无 flaky');
  });

  it('buildRunSummary 解析失败草稿提示', () => {
    const nd = [
      JSON.stringify({
        item_id: 'EVAL-B-PAIRED-TASK-04-OFF',
        pass: false,
        attribution: 'MODEL_TASK',
        oracle_failures: [{ message: 'hosted run 退出码 0 但输出未含约定 PLAN_OK [rule [3b]]' }],
        effect_pair: 'PAIRED-TASK-04',
      }),
    ].join('\n');
    const s = buildRunSummary({
      resultsText: nd,
      metricsText: JSON.stringify({
        aggregates: { a_case_pass_rate: 0, a_flaky_rerun_delta: 0 },
      }),
      scoresText: null,
      runDir: '/tmp/runs/example-run',
    });
    expect(s.attribution.primary_fail).toBe('MODEL_TASK');
    expect(s.failures[0]?.suggested_token).toBe('PLAN_OK');
    expect(s.failures[0]?.suggested_task_id).toBe('PAIRED-TASK-04');
    expect(s.failures[0]?.source_run).toBe('/tmp/runs/example-run');
    expect(s.failures[0]?.oracle_failures).toHaveLength(1);
    expect(s.failures[0]?.oracle_failures?.[0]?.message).toContain('PLAN_OK');
  });

  it('PASS 且无暗号时摘要写 pass_token_present false', () => {
    const nd = [
      JSON.stringify({
        item_id: 'EVAL-B-PAIRED-TASK-157-OFF',
        pass: true,
        pass_token: 'DUAL_FIX',
        pass_token_present: false,
        pass_token_role: 'auxiliary',
        effect_pair: 'PAIRED-TASK-157',
      }),
    ].join('\n');
    const s = buildRunSummary({
      resultsText: nd,
      metricsText: JSON.stringify({ aggregates: { a_case_pass_rate: 1 } }),
      scoresText: null,
    });
    expect(s.attribution.pass_total).toBe(1);
    expect(s.failures).toHaveLength(0);
    expect(s.pass_tokens).toHaveLength(1);
    expect(s.pass_tokens[0]?.pass_token_present).toBe(false);
    expect(s.pass_tokens[0]?.label).toBe('无 DUAL_FIX');
    expect(s.pass_tokens[0]?.workspace_label).toBe('');
  });

  it('透传信息性指标；解析 effect_compare baseline 路径', () => {
    const s = buildRunSummary({
      resultsText: '',
      metricsText: JSON.stringify({
        aggregates: { b_avg_steps_to_success: 3.5, b_cost_tokens_per_pass: 120 },
      }),
      scoresText: JSON.stringify({
        scale_max: 5,
        scores: [
          { item_id: 'A', score: 3 },
          { item_id: 'B', score: 5 },
        ],
      }),
    });
    expect(s.info_metrics.values.b_avg_steps_to_success).toBe(3.5);
    expect(s.reference_scores?.avg).toBe(4);
    expect(s.reference_scores?.scale_max).toBe(5);
    expect(
      parseBaselinePathFromEffectMd('# x\n\n- baseline: `/tmp/base`\n- candidate: `/tmp/cand`\n'),
    ).toBe('/tmp/base');
  });
});

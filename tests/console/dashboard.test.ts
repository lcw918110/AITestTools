import { describe, expect, it } from 'vitest';
import { buildRunDashboard, contextTimeoutUnusable } from '../../apps/console/dashboard.ts';

describe('测试看板 dashboard', () => {
  it('CONTEXT 超时且文件没动 → 不进效果 Δ', () => {
    expect(
      contextTimeoutUnusable({
        item_id: 'EVAL-B-PAIRED-TASK-157-ON',
        pass: false,
        attribution: 'CONTEXT',
        timed_out: true,
        materials_mutated: false,
      }),
    ).toMatch(/不进效果/);
    expect(
      contextTimeoutUnusable({
        item_id: 'X',
        pass: false,
        attribution: 'MODEL_TASK',
        timed_out: true,
      }),
    ).toBeUndefined();
  });

  it('对照三题：157 ON 超时剔除后 usable_delta=0', () => {
    const off = [
      {
        item_id: 'EVAL-B-PAIRED-TASK-157-OFF',
        pass: false,
        attribution: 'MODEL_TASK',
        effect_pair: 'PAIRED-TASK-157',
        workspace_ok: false,
        timed_out: false,
        pass_token_present: false,
      },
      {
        item_id: 'EVAL-B-PAIRED-TASK-158-OFF',
        pass: false,
        attribution: 'MODEL_TASK',
        effect_pair: 'PAIRED-TASK-158',
        workspace_ok: false,
        timed_out: false,
        pass_token_present: false,
      },
      {
        item_id: 'EVAL-B-PAIRED-TASK-159-OFF',
        pass: false,
        attribution: 'MODEL_TASK',
        effect_pair: 'PAIRED-TASK-159',
        workspace_ok: false,
        timed_out: false,
        pass_token_present: false,
      },
    ];
    const on = [
      {
        item_id: 'EVAL-B-PAIRED-TASK-157-ON',
        pass: false,
        attribution: 'CONTEXT',
        effect_pair: 'PAIRED-TASK-157',
        workspace_ok: false,
        timed_out: true,
        materials_mutated: false,
        pass_token_present: false,
      },
      {
        item_id: 'EVAL-B-PAIRED-TASK-158-ON',
        pass: false,
        attribution: 'MODEL_TASK',
        effect_pair: 'PAIRED-TASK-158',
        workspace_ok: false,
        timed_out: false,
        pass_token_present: false,
      },
      {
        item_id: 'EVAL-B-PAIRED-TASK-159-ON',
        pass: false,
        attribution: 'MODEL_TASK',
        effect_pair: 'PAIRED-TASK-159',
        workspace_ok: false,
        timed_out: false,
        pass_token_present: false,
      },
    ];
    const dash = buildRunDashboard({
      runJsonText: JSON.stringify({
        paperset: 'paired-on-effect-smoke',
        room: 'hosted-plugin-v1',
      }),
      resultsText: on.map((r) => JSON.stringify(r)).join('\n'),
      metricsText: JSON.stringify({ aggregates: { a_case_pass_rate: 0 } }),
      hostedSnaps: [
        {
          item_id: 'EVAL-B-PAIRED-TASK-157-ON',
          model: 'wave-ai/gpt-5.4-mini',
          model_source: 'room',
          model_matches_freeze: true,
          workspace_isolated: true,
          plugin: '/x/Plugin.js',
          event_store_present: true,
          event_store_source: 'pending',
          materials_seeded: ['lib/tax.mjs'],
        },
      ],
      baselineResultsText: off.map((r) => JSON.stringify(r)).join('\n'),
      effect: {
        baseline_pass_rate: 0,
        candidate_pass_rate: 0,
        pass_rate_delta: 0,
        metric_deltas: [],
        paired_effects: [
          {
            pair: 'PAIRED-TASK-157',
            baseline_item: 'EVAL-B-PAIRED-TASK-157-OFF',
            candidate_item: 'EVAL-B-PAIRED-TASK-157-ON',
            baseline_pass: false,
            candidate_pass: false,
          },
          {
            pair: 'PAIRED-TASK-158',
            baseline_item: 'EVAL-B-PAIRED-TASK-158-OFF',
            candidate_item: 'EVAL-B-PAIRED-TASK-158-ON',
            baseline_pass: false,
            candidate_pass: false,
          },
          {
            pair: 'PAIRED-TASK-159',
            baseline_item: 'EVAL-B-PAIRED-TASK-159-OFF',
            candidate_item: 'EVAL-B-PAIRED-TASK-159-ON',
            baseline_pass: false,
            candidate_pass: false,
          },
        ],
      },
    });
    expect(dash.config.plugin).toBe('on');
    expect(dash.config.model_source).toBe('room');
    expect(dash.config.event_store_present).toBe(true);
    expect(dash.matrix).toHaveLength(3);
    expect(dash.matrix.find((m) => m.pair === 'PAIRED-TASK-157')?.exclude_from_effect).toBe(true);
    expect(dash.headline.usable_item_pairs).toBe(2);
    expect(dash.headline.usable_delta).toBe(0);
    expect(dash.headline.usable_note).toMatch(/剔除/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyMetricThresholdPass,
  computeAxisDraftMetrics,
  fail,
  finalizeAxisResult,
} from '../../src/run/runner-shared.ts';
import type { CaseRevision } from '../../src/domain/types.ts';
import type { Oracle } from '../../src/exam-engine/types.ts';
import type { OracleOutcome } from '../../src/oracles/index.ts';

/**
 * `runner-shared` 的归因语义单元测试。
 *
 * 这些函数被多个 runner 共用（`fail` 被 l1/l2/l3/b/c/hosted 使用，
 * `computeAxisDraftMetrics` 与 `finalizeAxisResult` 只被 l1/l2 使用，
 * `applyMetricThresholdPass` 被 l1/l2/b/c 使用），但此前**没有任何直接测试**——
 * 只靠各 runner 的集成用例间接触及。
 *
 * 变异实测暴露了缺口（在 `git archive HEAD` 的干净副本上验证，移除本文件后施加）：
 *
 * - 把 `fail()` 的 `invariantViolationsExplicit` 判断取反 → 既有测试无一失败；
 * - 把 `computeAxisDraftMetrics` 取「第一个失败」改成「最后一个」→ 无一失败；
 * - 把 `finalizeAxisResult` 的 attribution 兜底从 `PROTOCOL` 改成 `CONTEXT` → 无一失败。
 *
 * 这三处都是归因逻辑：写错会把「模型答错」记成「环境故障」，或反之，
 * 直接污染效果结论。故补直接测试锁住。
 */

function makeRevision(overrides: Partial<CaseRevision> = {}): CaseRevision {
  return {
    case_revision_id: 'CASE-1',
    revision_number: 3,
    ...overrides,
  } as CaseRevision;
}

function passOutcome(id = 'o1'): OracleOutcome {
  return { oracle_id: id, pass: true };
}

function failOutcome(
  id: string,
  attribution: 'MODEL_TASK' | 'PROTOCOL' | 'CONTEXT' | 'HARNESS' | 'MODEL_SCHEMA' | 'TOOL',
): OracleOutcome {
  return { oracle_id: id, pass: false, message: `${id} failed`, attribution };
}

describe('fail()：invariant_violations 的归因语义', () => {
  it('PROTOCOL 失败默认记违反', () => {
    const r = fail(makeRevision(), 'PROTOCOL', 'bad protocol');
    expect(r.metrics.a_invariant_violations).toBe(1);
  });

  it('CONTEXT 失败默认记违反', () => {
    const r = fail(makeRevision(), 'CONTEXT', 'context broken');
    expect(r.metrics.a_invariant_violations).toBe(1);
  });

  it('MODEL_TASK 失败默认不记违反', () => {
    const r = fail(makeRevision(), 'MODEL_TASK', 'model wrong');
    expect(r.metrics.a_invariant_violations).toBe(0);
  });

  it('MODEL_SCHEMA 失败默认不记违反（模型输出格式错属模型问题，不是题面不变量）', () => {
    const r = fail(makeRevision(), 'MODEL_SCHEMA', 'schema wrong');
    expect(r.metrics.a_invariant_violations).toBe(0);
  });

  it('TOOL 失败默认不记违反（工具侧故障不计题面不变量）', () => {
    const r = fail(makeRevision(), 'TOOL', 'tool broke');
    expect(r.metrics.a_invariant_violations).toBe(0);
  });

  it('HARNESS 失败默认不记违反', () => {
    const r = fail(makeRevision(), 'HARNESS', 'harness broke');
    expect(r.metrics.a_invariant_violations).toBe(0);
  });

  it('显式传 invariantViolationsExplicit: 0 时，即使 PROTOCOL 也不记违反', () => {
    const r = fail(makeRevision(), 'PROTOCOL', 'forced', { invariantViolationsExplicit: 0 });
    expect(r.metrics.a_invariant_violations).toBe(0);
  });

  it('显式传 invariantViolationsExplicit: 0 时，CONTEXT 也不记违反', () => {
    const r = fail(makeRevision(), 'CONTEXT', 'forced', { invariantViolationsExplicit: 0 });
    expect(r.metrics.a_invariant_violations).toBe(0);
  });
});

describe('fail()：结果字段组装', () => {
  it('基础字段：pass=false、attribution 原样、harness 失败置首位', () => {
    const r = fail(makeRevision(), 'MODEL_TASK', 'wrong answer');
    expect(r.pass).toBe(false);
    expect(r.attribution).toBe('MODEL_TASK');
    expect(r.item_id).toBe('CASE-1');
    expect(r.item_rev).toBe(3);
    expect(r.metrics.a_case_pass_rate).toBe(0);
    expect(r.oracle_failures[0]).toEqual({ oracle_id: 'harness', message: 'wrong answer' });
  });

  it('modelSuffix 拼进 item_id（b 轴多模型）', () => {
    const r = fail(makeRevision(), 'MODEL_TASK', 'x', { modelSuffix: 'gpt-5' });
    expect(r.item_id).toBe('CASE-1::gpt-5');
  });

  it('modelSuffix 为空串时仍拼接（按 undefined 判断，不做真值判断）', () => {
    const r = fail(makeRevision(), 'MODEL_TASK', 'x', { modelSuffix: '' });
    expect(r.item_id).toBe('CASE-1::');
  });

  it('extraMetrics 可与框架字段共存', () => {
    const r = fail(makeRevision(), 'MODEL_TASK', 'x', { extraMetrics: { custom: 7 } });
    expect(r.metrics.custom).toBe(7);
    expect(r.metrics.a_case_pass_rate).toBe(0);
  });

  it('extraMetrics 的展开位于框架字段之后，同名键会覆盖框架字段', () => {
    // 这是当前实现的真实行为（`...(opts.extraMetrics)` 在 a_case_pass_rate 之后展开）。
    // 现有调用方（b-runner / c-runner）只传无冲突键，故线上无害；
    // 本用例把这一顺序固化下来，避免有人误以为框架字段不可被覆盖。
    const r = fail(makeRevision(), 'MODEL_TASK', 'x', {
      extraMetrics: { a_case_pass_rate: 1, a_invariant_violations: 9 },
    });
    expect(r.metrics.a_case_pass_rate).toBe(1);
    expect(r.metrics.a_invariant_violations).toBe(9);
  });

  it('extraFailures 追加在 harness 之后', () => {
    const r = fail(makeRevision(), 'MODEL_TASK', 'x', {
      extraFailures: [{ oracle_id: 'extra', message: 'extra msg' }],
    });
    expect(r.oracle_failures.map((f) => f.oracle_id)).toEqual(['harness', 'extra']);
  });

  it('artifactDir 与 effectPair 仅在提供时写入', () => {
    const without = fail(makeRevision(), 'MODEL_TASK', 'x');
    expect(without.artifact_dir).toBeUndefined();
    expect(without.effect_pair).toBeUndefined();

    const withBoth = fail(makeRevision(), 'MODEL_TASK', 'x', {
      artifactDir: '/tmp/a',
      effectPair: 'pair-1',
    });
    expect(withBoth.artifact_dir).toBe('/tmp/a');
    expect(withBoth.effect_pair).toBe('pair-1');
  });
});

describe('computeAxisDraftMetrics：以第一个失败为准', () => {
  it('无失败时 pass_rate=1、违反=0', () => {
    const m = computeAxisDraftMetrics([passOutcome('a'), passOutcome('b')]);
    expect(m.a_case_pass_rate).toBe(1);
    expect(m.a_invariant_violations).toBe(0);
  });

  it('第一个失败是 PROTOCOL → 记违反', () => {
    const m = computeAxisDraftMetrics([
      failOutcome('a', 'PROTOCOL'),
      failOutcome('b', 'MODEL_TASK'),
    ]);
    expect(m.a_case_pass_rate).toBe(0);
    expect(m.a_invariant_violations).toBe(1);
  });

  it('第一个失败是 MODEL_TASK、第二个才是 PROTOCOL → 不记违反（只看第一个）', () => {
    // 这条锁住「取第一个」而非「取任意一个」：语义上首个失败决定归因性质。
    const m = computeAxisDraftMetrics([
      failOutcome('a', 'MODEL_TASK'),
      failOutcome('b', 'PROTOCOL'),
    ]);
    expect(m.a_case_pass_rate).toBe(0);
    expect(m.a_invariant_violations).toBe(0);
  });

  it('第一个失败是 CONTEXT → 记违反', () => {
    const m = computeAxisDraftMetrics([failOutcome('a', 'CONTEXT')]);
    expect(m.a_invariant_violations).toBe(1);
  });

  it('第一个失败是 HARNESS → 不记违反', () => {
    const m = computeAxisDraftMetrics([failOutcome('a', 'HARNESS')]);
    expect(m.a_invariant_violations).toBe(0);
  });

  it('第一个失败是 MODEL_SCHEMA → 不记违反', () => {
    const m = computeAxisDraftMetrics([failOutcome('a', 'MODEL_SCHEMA')]);
    expect(m.a_invariant_violations).toBe(0);
  });

  it('第一个失败是 TOOL → 不记违反', () => {
    const m = computeAxisDraftMetrics([failOutcome('a', 'TOOL')]);
    expect(m.a_invariant_violations).toBe(0);
  });

  it('空失败列表视为通过', () => {
    const m = computeAxisDraftMetrics([]);
    expect(m.a_case_pass_rate).toBe(1);
    expect(m.a_invariant_violations).toBe(0);
  });

  it('失败但无 attribution 时记 0（本函数不兜底，与 finalizeAxisResult 口径不同）', () => {
    // 已知口径分歧：finalizeAxisResult 会把无归因失败兜底成 PROTOCOL（→1），
    // 本函数不兜底（→0）。draft 是 metric_threshold 二趟判定的输入，
    // 因此 `a_invariant_violations: {max: 0}` 这类门禁会先看到 0 而放过。
    // 本用例固化现状，避免有人误以为两函数口径一致。
    const noAttr: OracleOutcome = { oracle_id: 'x', pass: false, message: 'no attribution' };
    const m = computeAxisDraftMetrics([noAttr]);
    expect(m.a_case_pass_rate).toBe(0);
    expect(m.a_invariant_violations).toBe(0);
  });
});

describe('finalizeAxisResult：通过性、归因与产物字段', () => {
  it('全部通过时 pass=true、无 attribution', () => {
    const r = finalizeAxisResult({ revision: makeRevision(), failures: [passOutcome()] });
    expect(r.pass).toBe(true);
    expect(r.attribution).toBeUndefined();
    expect(r.metrics.a_case_pass_rate).toBe(1);
    expect(r.oracle_failures).toEqual([]);
  });

  it('有失败时取第一个失败的 attribution', () => {
    const r = finalizeAxisResult({
      revision: makeRevision(),
      failures: [failOutcome('a', 'MODEL_TASK'), failOutcome('b', 'PROTOCOL')],
    });
    expect(r.pass).toBe(false);
    expect(r.attribution).toBe('MODEL_TASK');
  });

  it('失败但无 attribution 时兜底为 PROTOCOL（不是 CONTEXT）', () => {
    // 兜底值写错会把「未知失败」误记成环境问题，影响效果结论。
    const noAttr: OracleOutcome = { oracle_id: 'x', pass: false, message: 'no attribution' };
    const r = finalizeAxisResult({ revision: makeRevision(), failures: [noAttr] });
    expect(r.attribution).toBe('PROTOCOL');
    expect(r.metrics.a_invariant_violations).toBe(1);
  });

  it('PROTOCOL 失败的 invariant_violations 为 1', () => {
    const r = finalizeAxisResult({
      revision: makeRevision(),
      failures: [failOutcome('a', 'PROTOCOL')],
    });
    expect(r.metrics.a_invariant_violations).toBe(1);
  });

  it('CONTEXT 失败的 invariant_violations 为 1', () => {
    const r = finalizeAxisResult({
      revision: makeRevision(),
      failures: [failOutcome('a', 'CONTEXT')],
    });
    expect(r.metrics.a_invariant_violations).toBe(1);
  });

  it('MODEL_TASK 失败的 invariant_violations 为 0（模型答错不是题面不变量违反）', () => {
    const r = finalizeAxisResult({
      revision: makeRevision(),
      failures: [failOutcome('a', 'MODEL_TASK')],
    });
    expect(r.metrics.a_invariant_violations).toBe(0);
  });

  it('HARNESS 失败的 invariant_violations 为 0', () => {
    const r = finalizeAxisResult({
      revision: makeRevision(),
      failures: [failOutcome('a', 'HARNESS')],
    });
    expect(r.metrics.a_invariant_violations).toBe(0);
  });

  it('MODEL_SCHEMA 失败的 invariant_violations 为 0', () => {
    const r = finalizeAxisResult({
      revision: makeRevision(),
      failures: [failOutcome('a', 'MODEL_SCHEMA')],
    });
    expect(r.metrics.a_invariant_violations).toBe(0);
  });

  it('TOOL 失败的 invariant_violations 为 0', () => {
    const r = finalizeAxisResult({
      revision: makeRevision(),
      failures: [failOutcome('a', 'TOOL')],
    });
    expect(r.metrics.a_invariant_violations).toBe(0);
  });

  it('oracle_failures 只收失败项，并按原顺序保留 evidence_ref', () => {
    const withRef: OracleOutcome = {
      oracle_id: 'b',
      pass: false,
      message: 'b failed',
      attribution: 'MODEL_TASK',
      evidence_ref: 'runs/x/stdout.txt',
    };
    const r = finalizeAxisResult({
      revision: makeRevision(),
      failures: [failOutcome('a', 'MODEL_TASK'), passOutcome('p'), withRef],
    });
    expect(r.oracle_failures).toHaveLength(2);
    expect(r.oracle_failures[0]?.oracle_id).toBe('a');
    expect(r.oracle_failures[0]?.evidence_ref).toBeUndefined();
    expect(r.oracle_failures[1]?.evidence_ref).toBe('runs/x/stdout.txt');
  });

  it('artifactDir 与 foldState 仅在提供时写入', () => {
    const plain = finalizeAxisResult({ revision: makeRevision(), failures: [] });
    expect(plain.artifact_dir).toBeUndefined();
    expect(plain.fold_state).toBeUndefined();

    const rich = finalizeAxisResult({
      revision: makeRevision(),
      failures: [],
      artifactDir: '/tmp/x',
      foldState: { phase: 2 },
    });
    expect(rich.artifact_dir).toBe('/tmp/x');
    expect(rich.fold_state).toEqual({ phase: 2 });
  });
});

describe('applyMetricThresholdPass：只处理 metric_threshold 类型', () => {
  it('跳过合法的非 metric_threshold oracle，不回调', () => {
    const seen: string[] = [];
    applyMetricThresholdPass(
      [{ type: 'stdout_assert', id: 'x', contains: 'y' }],
      {},
      undefined,
      (o) => seen.push(o.oracle_id),
    );
    expect(seen).toEqual([]);
  });

  it('对每个 metric_threshold oracle 各回调一次，id 缺省时按类型+序号命名', () => {
    const seen: string[] = [];
    applyMetricThresholdPass(
      [
        { type: 'metric_threshold', id: 'm1', metric: 'a', min: 0.5 },
        { type: 'metric_threshold', metric: 'b', min: 0.5 },
      ],
      { a: 1, b: 1 },
      undefined,
      (o) => seen.push(o.oracle_id),
    );
    expect(seen).toEqual(['m1', 'metric_threshold#1']);
  });

  it('指标低于 min 时判负，并沿用传入的 attribution', () => {
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: 'a', min: 10 }],
      { a: 1 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(false);
    expect((seen[0] as { attribution?: string }).attribution).toBe('MODEL_TASK');
  });

  it('指标恰好等于 min 时判过（边界含等号）', () => {
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: 'a', min: 5 }],
      { a: 5 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(true);
  });

  it('指标高于 max 时判负，并沿用传入的 attribution', () => {
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: 'a', max: 3 }],
      { a: 10 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(false);
    expect((seen[0] as { attribution?: string }).attribution).toBe('MODEL_TASK');
  });

  it('指标恰好等于 max 时判过（边界含等号）', () => {
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: 'a', max: 5 }],
      { a: 5 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(true);
  });

  it('min 与 max 同时给出且指标落在区间内时判过', () => {
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: 'a', min: 1, max: 10 }],
      { a: 5 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(true);
  });

  it('缺 min 与 max 时判 HARNESS（oracle 自身写错，不是模型失败）', () => {
    // 若把这种配置错误记成 MODEL_TASK，会污染效果结论。
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: 'a' }],
      { a: 1 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(false);
    expect((seen[0] as { attribution?: string }).attribution).toBe('HARNESS');
  });

  it('缺 metric 字段时判 HARNESS（配置错误，不受传入 attribution 影响）', () => {
    // `metric` 类型上必填，但空串是合法值，走同一条「缺少 metric 字段」防御分支。
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: '' }],
      { a: 1 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(false);
    expect((seen[0] as { attribution?: string }).attribution).toBe('HARNESS');
  });

  it('metric 为空但给了 name 时按 name 判定（name 是 metric 的兜底字段）', () => {
    // 实现是 `oracle.metric ?? oracle.name ?? ''`：空串 metric 不会被 `??` 兜底，
    // 故空串 + name 仍判「缺少 metric 字段」。
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: '', name: 'a', min: 1 }],
      { a: 1 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(false);
    expect((seen[0] as { attribution?: string }).attribution).toBe('HARNESS');
  });

  it('未给 metric 但给了 name 时按 name 正常判定（可判过）', () => {
    // 这是当前实现的真实行为：`metric` 缺省时回落 `name`，配置错误不会被发现。
    // 本用例固化现状，避免有人以为「缺 metric 一律 HARNESS」。
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', name: 'a', min: 1 } as unknown as Oracle],
      { a: 1 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(true);
  });

  it('指标未产出时即使传了调用方归因也归 HARNESS', () => {
    // 「未产出」是试题/指标口径问题，不是被测系统没做到：真实调用点（l1/l2/b/c）
    // 都会传焦点归因，若沿用会把口径错误记成模型缺陷。
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: 'missing', min: 1 }],
      { a: 1 },
      'MODEL_TASK',
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(false);
    expect((seen[0] as { attribution?: string }).attribution).toBe('HARNESS');
  });

  it('指标未产出且未传 attribution 时兜底 HARNESS', () => {
    const seen: OracleOutcome[] = [];
    applyMetricThresholdPass(
      [{ type: 'metric_threshold', id: 'm1', metric: 'missing', min: 1 }],
      { a: 1 },
      undefined,
      (o) => seen.push(o),
    );
    expect(seen[0]?.pass).toBe(false);
    expect((seen[0] as { attribution?: string }).attribution).toBe('HARNESS');
  });
});

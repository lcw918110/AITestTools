import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GateBound } from '../exam-engine/types.ts';
import type { AxisItemResult } from './runner-types.ts';
import { aggregateItemMetrics, evaluateGates, type GateEvaluation } from './gates.ts';
import { aggregateConsistency, extractCaseId } from './consistency.ts';
import { formatPassTokenCell } from './hosted-pass-token.ts';
import { formatHostExitCell, formatTimedOutCell, formatWorkspaceCell } from './hosted-host-exit.ts';

export interface RunMeta {
  run_id: string;
  purpose?: string;
  dataset: string;
  environment: string;
  started_at: string;
  project_root: string;
  /**
   * 逐题实际使用的环境名（配对题按侧解析后可能与顶层 `environment` 不同）。
   * 缺省表示该题沿用顶层环境，历史 run.json 无需回填。
   */
  items: Array<{
    id: string;
    rev: number;
    environment?: string;
    /**
     * 题级通过：该题全部观测都通过才算通过。
     *
     * 与 `metrics.a_case_pass_rate === 1` 等价（限该题），但**不等于**整 run 的
     * `aggregates.a_case_pass_rate`——后者是跨题加权均值，各题 trial 数不齐时两者数值不同。
     */
    pass?: boolean;
    /**
     * 归到该题下的观测条数（>1 时写入）。
     *
     * 注意不是「trial 数」：B-direct 的 `item_id` 是 `<case>::<模型名>`，repeats=1 时
     * 多模型也会归到同一题下，此时该值是模型数。
     */
    trials?: number;
    /** 题级通过率 = 通过观测数 / 观测总数（>1 时写入，口径同 `trials`）。 */
    pass_rate?: number;
  }>;
}

export interface WriteArtifactsResult {
  dir: string;
  gate_evaluations: GateEvaluation[];
  gates_pass: boolean;
}

/**
 * 把逐 trial 的 `item_id` 归到 `meta.items[].id` 上的题级 id。
 *
 * 两种形状都要支持：
 * - `<case>::r<N>`（hosted / 行为题，trial 后缀直接跟在题号后）；
 * - `<case>::<模型名>::r<N>`（B-direct，题号与 trial 之间夹模型名）。
 *
 * 匹配策略：先剥掉 `::r<N>` 尾缀，再在已知题号里找**最长匹配前缀**（要求后接 `::` 或完全相等）。
 * 用最长匹配而非「剥到第一个 `::`」，是因为题号本身可能含 `::`；用前缀匹配而非字符串相等，
 * 是因为中间可能夹模型名。找不到时退回剥后缀结果，保持历史行为。
 */
function resolveCaseId(itemId: string, knownItems: Array<{ id: string }>): string {
  const stripped = extractCaseId(itemId);
  if (knownItems.some((it) => it.id === stripped)) return stripped;
  let best: string | undefined;
  for (const it of knownItems) {
    if (stripped === it.id || stripped.startsWith(`${it.id}::`)) {
      if (best === undefined || it.id.length > best.length) best = it.id;
    }
  }
  return best ?? stripped;
}

export function writeRunArtifacts(opts: {
  runsRoot: string;
  meta: RunMeta;
  results: AxisItemResult[];
  gates?: Record<string, GateBound> | undefined;
}): WriteArtifactsResult {
  const dir = join(opts.runsRoot, opts.meta.run_id);
  mkdirSync(join(dir, 'artifacts'), { recursive: true });
  // repeats>1 时 item_id 带 `::r<N>` 后缀；按题级 id 分组，使 meta.items 的 id 能匹配。
  //
  // 旧实现用 `new Map(results.map(...))` 按题去后缀建 map，同一题的多个 trial 会互相覆盖，
  // 最终留下的是最后一个 trial——`items[].pass` 于是变成「最后一次 trial 是否通过」，
  // 与 `metrics.a_case_pass_rate`（全 trial 均值）口径不一致：3 过 1 挂的题会被记成 false，
  // 而 1 挂 3 过、最后一个 trial 恰好通过的 flaky 题会被记成 true。改为先分组再收敛。
  //
  // 题级 id 有两种形状，都必须能匹配 `meta.items[].id`：
  // - hosted / 行为题：`<case>::r<N>`（trial 后缀直接跟在题号后）；
  // - B-direct（model-core + model-direct-v1）：`<case>::<模型名>::r<N>`（题号与 trial 之间夹模型名）。
  // 只剥最后一层 `::rN` 对第二种会得到 `<case>::<模型名>`，与题号不等，`items[].pass` 整段缺失。
  const byCaseId = new Map<string, AxisItemResult[]>();
  for (const r of opts.results) {
    const caseId = resolveCaseId(r.item_id, opts.meta.items);
    const arr = byCaseId.get(caseId) ?? [];
    arr.push(r);
    byCaseId.set(caseId, arr);
  }
  const items = opts.meta.items.map((it) => {
    const trials = byCaseId.get(it.id);
    if (trials === undefined || trials.length === 0) return it;
    const passCount = trials.filter((r) => r.pass).length;
    const passRate = passCount / trials.length;
    // 题级 pass：全部观测通过才算通过（等价于该题 `a_case_pass_rate === 1`）。
    // 单次观测场景 passRate 即该次观测的 pass，行为与旧实现一致。
    const pass = passCount === trials.length;
    // 多 trial 的辅助字段按「失败事实不可被掩盖」聚合，避免首个 trial 正常就抹掉后续故障：
    // - timed_out / materials_mutated：任一 trial 出现即为真（OR）；
    // - workspace_ok：任一 trial 明确为假即为假（AND），全部未观测则整体不写；
    // - host_exit：优先保留首个非 0 退出码，其次保留 `null`（被杀/超时），最后才是 0；
    // - pass_token 系列是单次鉴权观测，取首个有观测的 trial。
    const anyTimedOut = trials.some((r) => r.timed_out === true);
    const anyMutated = trials.some((r) => r.materials_mutated === true);
    // 只把「明确为假」当失败：`runner-types` 约定「无此类 oracle 则为 true」，
    // 故 `undefined`（未观测）不构成失败证据。若全部 trial 都未观测，
    // 整体也不写该字段（下方按 some(defined) 判断），避免把「没测」写成「全过」。
    const allWorkspaceOk = !trials.some((r) => r.workspace_ok === false);
    // `host_exit: null` 表示宿主被杀或超时（见 runner-types），与 `0` 语义相反：
    // 若只挑 `number` 非 0，会把「被杀」回落成「正常退出 0」，与 report.md 的「被杀」自相矛盾。
    const nonZeroExit = trials.find((r) => typeof r.host_exit === 'number' && r.host_exit !== 0);
    const killedExit = trials.find((r) => r.host_exit === null);
    // pass_token 取首个「有观测」的 trial：首个 trial 可能因预检失败没有鉴权观测，
    // 直接取 first 会把后续 trial 的真实观测抹掉。
    const tokenTrial = trials.find(
      (r) =>
        r.pass_token !== undefined ||
        r.pass_token_present !== undefined ||
        r.pass_token_role !== undefined,
    );
    return {
      ...it,
      pass,
      ...(trials.length > 1 ? { trials: trials.length, pass_rate: passRate } : {}),
      ...(tokenTrial?.pass_token !== undefined ? { pass_token: tokenTrial.pass_token } : {}),
      ...(tokenTrial?.pass_token_present !== undefined
        ? { pass_token_present: tokenTrial.pass_token_present }
        : {}),
      ...(tokenTrial?.pass_token_role !== undefined
        ? { pass_token_role: tokenTrial.pass_token_role }
        : {}),
      ...(trials.some((r) => r.workspace_ok !== undefined) ? { workspace_ok: allWorkspaceOk } : {}),
      ...(trials.some((r) => r.timed_out !== undefined) ? { timed_out: anyTimedOut } : {}),
      ...(nonZeroExit !== undefined
        ? { host_exit: nonZeroExit.host_exit }
        : killedExit !== undefined
          ? { host_exit: null }
          : trials.some((r) => r.host_exit !== undefined)
            ? { host_exit: 0 }
            : {}),
      ...(trials.some((r) => r.materials_mutated !== undefined)
        ? { materials_mutated: anyMutated }
        : {}),
    };
  });
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify({ ...opts.meta, items }, null, 2)}\n`);

  const ndjson = opts.results
    .map((r) =>
      JSON.stringify({
        item_id: r.item_id,
        item_rev: r.item_rev,
        pass: r.pass,
        attribution: r.attribution,
        oracle_failures: r.oracle_failures,
        metrics: r.metrics,
        artifact_dir: r.artifact_dir,
        ...(r.effect_pair !== undefined ? { effect_pair: r.effect_pair } : {}),
        ...(r.pass_token !== undefined ? { pass_token: r.pass_token } : {}),
        ...(r.pass_token_present !== undefined ? { pass_token_present: r.pass_token_present } : {}),
        ...(r.pass_token_role !== undefined ? { pass_token_role: r.pass_token_role } : {}),
        ...(r.workspace_ok !== undefined ? { workspace_ok: r.workspace_ok } : {}),
        ...(r.timed_out !== undefined ? { timed_out: r.timed_out } : {}),
        ...(r.host_exit !== undefined ? { host_exit: r.host_exit } : {}),
        ...(r.host_signal !== undefined ? { host_signal: r.host_signal } : {}),
        ...(r.host_spawn_error !== undefined ? { host_spawn_error: r.host_spawn_error } : {}),
        ...(r.host_exit_role !== undefined ? { host_exit_role: r.host_exit_role } : {}),
        ...(r.materials_mutated !== undefined ? { materials_mutated: r.materials_mutated } : {}),
      }),
    )
    .join('\n');
  writeFileSync(join(dir, 'results.ndjson'), `${ndjson}\n`);

  const passRate =
    opts.results.length === 0 ? 0 : opts.results.filter((r) => r.pass).length / opts.results.length;
  const aggregates = aggregateItemMetrics(opts.results);
  // 总通过率以本 run 的题级 pass 为准（覆盖逐题 a_case_pass_rate 均值）
  aggregates.a_case_pass_rate = passRate;
  if (aggregates.a_invariant_violations === undefined) {
    aggregates.a_invariant_violations = opts.results.reduce(
      (s, r) => s + (r.metrics.a_invariant_violations ?? 0),
      0,
    );
  }
  // 单次 run 未做重跑对拍时，flaky delta 记 0（门禁 max:0 可通过）
  if (aggregates.a_flaky_rerun_delta === undefined) {
    aggregates.a_flaky_rerun_delta = 0;
  }

  const gate_evaluations = evaluateGates(aggregates, opts.gates);
  const gatesObj: Record<
    string,
    { pass: boolean; actual?: number; bound: GateBound; message: string }
  > = {};
  for (const g of gate_evaluations) {
    gatesObj[g.name] = {
      pass: g.pass,
      bound: g.bound,
      message: g.message,
      ...(g.actual !== undefined ? { actual: g.actual } : {}),
    };
  }
  const gates_pass = gate_evaluations.every((g) => g.pass);
  const metrics = {
    aggregates,
    gates: gatesObj,
  };
  writeFileSync(join(dir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);

  const lines = [
    `# Run ${opts.meta.run_id}`,
    '',
    `- dataset: ${opts.meta.dataset}`,
    `- environment: ${opts.meta.environment}`,
    `- pass_rate: ${passRate}`,
    `- gates: ${gates_pass ? 'PASS' : 'FAIL'}`,
    '',
  ];
  // 配对题按侧解析环境后，逐题实际环境可能与顶层不同；此时补一列，避免报告账实不符。
  const envById = new Map(opts.meta.items.map((it) => [it.id, it.environment]));
  const hasPerItemEnv = opts.meta.items.some(
    (it) => it.environment !== undefined && it.environment !== opts.meta.environment,
  );
  lines.push(
    hasPerItemEnv
      ? '| item | rev | 环境 | pass | 工作区 | 暗号 | 超时 | host_exit | attribution |'
      : '| item | rev | pass | 工作区 | 暗号 | 超时 | host_exit | attribution |',
    hasPerItemEnv
      ? '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
      : '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...opts.results.map((r) => {
      const token = formatPassTokenCell(r);
      const ws = formatWorkspaceCell(r.workspace_ok);
      const to = formatTimedOutCell(r.timed_out);
      const hx = formatHostExitCell({
        host_exit: r.host_exit,
        timed_out: r.timed_out,
        host_spawn_error: r.host_spawn_error,
      });
      // 环境按题级 id 查：B-direct 的 item_id 是 `<case>::<模型名>::r<N>`，
      // 只剥 `::rN` 会得到 `<case>::<模型名>`，查不到 `envById` 而回落顶层环境，
      // 让配对题报告把按侧解析的环境写成基准值（账实不符）。
      const envCell =
        envById.get(resolveCaseId(r.item_id, opts.meta.items)) ?? opts.meta.environment;
      const head = hasPerItemEnv
        ? `| ${r.item_id} | ${r.item_rev} | ${envCell} |`
        : `| ${r.item_id} | ${r.item_rev} |`;
      return `${head} ${r.pass ? 'yes' : 'no'} | ${ws} | ${token} | ${to} | ${hx} | ${r.attribution ?? ''} |`;
    }),
    '',
    '- 暗号为辅助信号（有/无）；缺席不单独否决整题。',
    '- 效果题主判定是 `workspace_assert`：仓库过则整题 PASS，即使超时或退出码非 0。超时/`host_exit` 记辅助，类似暗号。',
    '- 超时且文件没动 → FAIL CONTEXT；超时且改错 → FAIL MODEL_TASK。PROTOCOL focus 不能把工作区失败改写成 PROTOCOL。',
    '',
  );
  // 稳定性 / flaky 显式报告（单次跑常为 0，不等于已证明无 flaky）
  const flaky = aggregates.a_flaky_rerun_delta ?? 0;
  const repeatTagged = opts.results.filter((r) => /::r\d+$/.test(r.item_id)).length;
  // 一致性量化（ADR-0010）：pass^k + 成功率范围，纯报告、不进硬门禁。
  const consistency = aggregateConsistency(opts.results);
  lines.push(
    '## 稳定性（repeats / flaky）',
    '',
    `- a_flaky_rerun_delta: ${flaky}`,
    `- repeats 标记题数（item_id 含 ::rN）: ${repeatTagged}`,
    repeatTagged === 0
      ? '- 说明: 单次 run 未做重跑对拍时 delta 记 0，不等于已证明无 flaky'
      : '- 说明: 结果含 repeats 标记，请结合 flaky delta 解读',
    '',
  );
  // 一致性量化报告（pass^k / 成功率范围）
  if (repeatTagged > 0) {
    const rateMin = (consistency.success_rate_min * 100).toFixed(0);
    const rateMax = (consistency.success_rate_max * 100).toFixed(0);
    const passK = (consistency.pass_k * 100).toFixed(0);
    lines.push(
      '## 一致性量化（pass^k / 成功率范围）',
      '',
      `- pass^k: ${passK}%（k 次全过的题占比）`,
      `- 成功率范围: ${rateMin}%~${rateMax}%`,
      consistency.flaky
        ? '- flaky: 存在 trial 结果不一致的题（已识别，不进硬门禁）'
        : '- flaky: 无',
      '- 说明: 一致性指标为纯报告，不参与门禁判定',
      '',
    );
  }
  // 信息性指标（不进硬门禁）：仅当 aggregates 已有才写入
  const infoNames = [
    'b_avg_steps_to_success',
    'b_cost_tokens_per_pass',
    'b_hosted_attribution_share',
    'b_task_pass_rate',
  ];
  const infoLines = infoNames
    .filter((n) => typeof aggregates[n] === 'number')
    .map((n) => `- ${n}: ${aggregates[n]}`);
  if (infoLines.length > 0) {
    lines.push('## 信息性指标（不进硬门禁）', '', ...infoLines, '');
  }
  // 失败归因汇总
  const failAttr: Record<string, number> = {};
  for (const r of opts.results) {
    if (r.pass) continue;
    const k = r.attribution ?? 'UNKNOWN';
    failAttr[k] = (failAttr[k] ?? 0) + 1;
  }
  lines.push('## 失败归因', '');
  if (Object.keys(failAttr).length === 0) {
    lines.push('- （无失败）', '');
  } else {
    for (const k of Object.keys(failAttr).sort()) {
      lines.push(`- ${k}: ${failAttr[k]}`);
    }
    lines.push('');
  }
  if (gate_evaluations.length > 0) {
    lines.push('## Gates', '');
    for (const g of gate_evaluations) {
      lines.push(`- ${g.pass ? 'PASS' : 'FAIL'} \`${g.name}\`: ${g.message}`);
    }
    lines.push('');
  }
  writeFileSync(join(dir, 'report.md'), lines.join('\n'));
  return { dir, gate_evaluations, gates_pass };
}

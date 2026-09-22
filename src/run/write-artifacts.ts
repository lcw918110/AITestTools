import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GateBound } from '../exam-engine/types.ts';
import type { L1ItemResult } from './l1-runner.ts';
import { aggregateItemMetrics, evaluateGates, type GateEvaluation } from './gates.ts';
import { formatPassTokenCell } from './hosted-pass-token.ts';
import { formatHostExitCell, formatTimedOutCell, formatWorkspaceCell } from './hosted-host-exit.ts';

export interface RunMeta {
  run_id: string;
  axis: string;
  paperset: string;
  room: string;
  started_at: string;
  project_root: string;
  items: Array<{ id: string; rev: number }>;
}

export interface WriteArtifactsResult {
  dir: string;
  gate_evaluations: GateEvaluation[];
  gates_pass: boolean;
}

export function writeRunArtifacts(opts: {
  runsRoot: string;
  meta: RunMeta;
  results: L1ItemResult[];
  gates?: Record<string, GateBound> | undefined;
}): WriteArtifactsResult {
  const dir = join(opts.runsRoot, opts.meta.run_id);
  mkdirSync(join(dir, 'artifacts'), { recursive: true });
  const byId = new Map(opts.results.map((r) => [r.item_id, r]));
  const items = opts.meta.items.map((it) => {
    const r = byId.get(it.id);
    if (r === undefined) return it;
    return {
      ...it,
      pass: r.pass,
      ...(r.pass_token !== undefined ? { pass_token: r.pass_token } : {}),
      ...(r.pass_token_present !== undefined ? { pass_token_present: r.pass_token_present } : {}),
      ...(r.pass_token_role !== undefined ? { pass_token_role: r.pass_token_role } : {}),
      ...(r.workspace_ok !== undefined ? { workspace_ok: r.workspace_ok } : {}),
      ...(r.timed_out !== undefined ? { timed_out: r.timed_out } : {}),
      ...(r.host_exit !== undefined ? { host_exit: r.host_exit } : {}),
      ...(r.materials_mutated !== undefined ? { materials_mutated: r.materials_mutated } : {}),
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
    `- axis: ${opts.meta.axis}`,
    `- paperset: ${opts.meta.paperset}`,
    `- room: ${opts.meta.room}`,
    `- pass_rate: ${passRate}`,
    `- gates: ${gates_pass ? 'PASS' : 'FAIL'}`,
    '',
    '| item | rev | pass | 工作区 | 暗号 | 超时 | host_exit | attribution |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...opts.results.map((r) => {
      const token = formatPassTokenCell(r);
      const ws = formatWorkspaceCell(r.workspace_ok);
      const to = formatTimedOutCell(r.timed_out);
      const hx = formatHostExitCell({ host_exit: r.host_exit, timed_out: r.timed_out });
      return `| ${r.item_id} | ${r.item_rev} | ${r.pass ? 'yes' : 'no'} | ${ws} | ${token} | ${to} | ${hx} | ${r.attribution ?? ''} |`;
    }),
    '',
    '- 暗号为辅助信号（有/无）；缺席不单独否决整题。',
    '- 效果题主判定是 `workspace_assert`：仓库过则整题 PASS，即使超时或退出码非 0。超时/`host_exit` 记辅助，类似暗号。',
    '- 超时且文件没动 → FAIL CONTEXT；超时且改错 → FAIL MODEL_TASK。PROTOCOL focus 不能把工作区失败改写成 PROTOCOL。',
    '',
  ];
  // 稳定性 / flaky 显式报告（单次跑常为 0，不等于已证明无 flaky）
  const flaky = aggregates.a_flaky_rerun_delta ?? 0;
  const repeatTagged = opts.results.filter((r) => /::r\d+$/.test(r.item_id)).length;
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

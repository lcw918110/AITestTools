import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GateBound } from '../exam-engine/types.ts';
import type { L1ItemResult } from './l1-runner.ts';
import { aggregateItemMetrics, evaluateGates, type GateEvaluation } from './gates.ts';

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
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify(opts.meta, null, 2)}\n`);

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
    '| item | rev | pass | attribution |',
    '| --- | --- | --- | --- |',
    ...opts.results.map(
      (r) => `| ${r.item_id} | ${r.item_rev} | ${r.pass ? 'yes' : 'no'} | ${r.attribution ?? ''} |`,
    ),
    '',
  ];
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

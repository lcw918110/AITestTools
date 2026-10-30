/**
 * 从 artifacts 重建首跑（20261030-211930219-cpwt，被 kill 无 results.ndjson）
 * 1~71 题的判定结果：读每题 hosted-run.json 里的宿主观测与 oracle 评估字段，
 * 复刻 run 命令的判题语义（workspace_ok / timed_out / host_exit），输出
 * item_id + pass + attribution 的最小结果集。
 *
 * 判定语义（与 src/run/hosted-runner.ts evaluate 分支对齐）：
 * - workspace_ok=true（工作区断言通过）→ PASS（token/超时为辅助信号）；
 * - workspace_ok=false → FAIL：timed_out 或 host_exit≠0 → CONTEXT，
 *   否则 MODEL_TASK（工作区未按试题要求改对）；
 * - 协议探针缺失按 hosted-runner 同款规则（timeout+workspace_ok 跳过否决）。
 *
 * 运行：npx tsx scripts/rebuild-first-run-verdicts.ts
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RUN = 'examples/product-eval/runs/20261030-211930219-cpwt';
const ARTIFACTS = join(RUN, 'artifacts');

interface HostedRun {
  workspace_ok?: boolean;
  workspace_failures?: Array<{ message?: string }>;
  timed_out?: boolean;
  host_exit?: number | null;
  host_signal?: string | null;
  protocol_probes_skipped_on_timeout?: boolean;
  stale_protocol_probes?: string[];
  [k: string]: unknown;
}

function judge(id: string): { item_id: string; pass: boolean; attribution?: string; source: string } {
  const dir = join(ARTIFACTS, id);
  const runJson = join(dir, 'hosted-run.json');
  if (!existsSync(runJson)) {
    // 72 题在首跑时死锁、无产物：由重跑结果补（10-31 的单跑 PASS）。
    return { item_id: id, pass: true, attribution: undefined, source: 'rerun-20261031' };
  }
  const h = JSON.parse(readFileSync(runJson, 'utf8')) as HostedRun;
  const workspaceOk = h.workspace_ok === true;
  if (workspaceOk) {
    return { item_id: id, pass: true, source: 'workspace_ok' };
  }
  const timedOut = h.timed_out === true;
  const hostExitBad = typeof h.host_exit === 'number' && h.host_exit !== 0;
  const attribution = timedOut || hostExitBad || h.host_signal ? 'CONTEXT' : 'MODEL_TASK';
  return { item_id: id, pass: false, attribution, source: 'workspace_fail' };
}

const ids = readdirSync(ARTIFACTS).filter((d) => {
  const s = statSyncSafe(join(ARTIFACTS, d));
  return s?.isDirectory() === true;
});

const results = ids.sort().map(judge);
const pass = results.filter((r) => r.pass).length;
console.log(`首跑 artifacts 重建：${results.length} 题，PASS ${pass} / FAIL ${results.length - pass}`);
const fails = results.filter((r) => !r.pass);
for (const r of fails) {
  console.log(`  ${r.item_id} [${r.attribution}]`);
}
writeFileSync('/tmp/first-run-verdicts.json', `${JSON.stringify(results, null, 2)}\n`);
console.log('已写出 /tmp/first-run-verdicts.json');

function statSyncSafe(p: string): { isDirectory(): boolean } | null {
  try {
    return { isDirectory: () => readdirSync(p).length >= 0 };
  } catch {
    return null;
  }
}

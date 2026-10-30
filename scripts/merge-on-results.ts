/**
 * 合并全部 ON 侧行的逐题结果，按 item_id 取「最后一次真实执行」为权威值，
 * 生成 156 题完整配对结果。
 *
 * 数据源与合并语义：
 * 1. /tmp/first-run-verdicts.json — 首跑 1-72 题判定重建（首跑被 kill 无
 *    results.ndjson，从 artifacts 的 workspace/host 观测重建，零假阳校验过）；
 * 2. 全部 run 的 results.ndjson — 按 run 目录名（时间戳）升序遍历，
 *    后者恒覆盖前者（越新越权威，判定缺陷信号保留 FAIL）；
 * 3. 数据集 release 对齐 — 只保留当前 paired-on 引用的 case_revision_id，
 *    旧版本 id（如 92.r4.on）不参与统计。
 *
 * 运行：npx tsx scripts/merge-on-results.ts
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RUNS_ROOT = 'examples/product-eval/runs';
const FIRST_RUN_VERDICTS = '/tmp/first-run-verdicts.json';

/** 10-30/31 产生的 ON 侧 run，按时间升序 = 权威级从低到高。 */
const onRuns = readdirSync(RUNS_ROOT)
  .filter((d) => /^2026103[01]/.test(d))
  .sort();

interface ItemResult {
  item_id: string;
  pass: boolean;
  attribution?: string;
  oracle_failures?: Array<{ message?: string }>;
  metrics?: Record<string, number>;
  [k: string]: unknown;
}

/** run 目录内 results.ndjson 的逐题结果。 */
function loadRun(runId: string): Map<string, ItemResult> {
  const out = new Map<string, ItemResult>();
  const ndjson = join(RUNS_ROOT, runId, 'results.ndjson');
  let text = '';
  try {
    text = readFileSync(ndjson, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    try {
      const r = JSON.parse(t) as ItemResult;
      if (typeof r.item_id === 'string') out.set(r.item_id, r);
    } catch {
      /* 坏行忽略 */
    }
  }
  return out;
}

/** 全库 156 题的 ON 侧 id 清单（paired-on 数据集 release）。 */
function loadOnIds(): string[] {
  const release = JSON.parse(
    readFileSync('examples/product-eval/dataset-releases/paired-on.dataset-release.json', 'utf8'),
  ) as { case_revisions?: Array<{ case_revision_id: string }> };
  return (release.case_revisions ?? []).map((r) => r.case_revision_id);
}

const onIds = loadOnIds();
console.log(`paired-on 数据集共 ${onIds.length} 题；候选 run ${onRuns.length} 个`);

const merged = new Map<string, ItemResult & { _run: string }>();

// 源 1：首跑判定重建（1-72 题，首跑被 kill 无 ndjson）
try {
  const firstVerdicts = JSON.parse(readFileSync(FIRST_RUN_VERDICTS, 'utf8')) as Array<{
    item_id: string;
    pass: boolean;
    attribution?: string;
  }>;
  for (const v of firstVerdicts) {
    merged.set(v.item_id, { ...v, _run: '20261030-211930219-cpwt(重建)' });
  }
  console.log(`首跑重建补源: ${firstVerdicts.length} 题`);
} catch {
  console.warn(`⚠ ${FIRST_RUN_VERDICTS} 缺失，跳过首跑补源`);
}

// 源 2：全部 run 的 results.ndjson（时间升序，后者恒覆盖前者）
for (const runId of onRuns) {
  for (const [id, r] of loadRun(runId)) {
    if (!onIds.includes(id)) continue;
    const prev = merged.get(id);
    // 纯通过→纯通过/失败：越新越权威；旧通过+新失败：保留 FAIL（判定缺陷信号）
    if (prev === undefined || !prev.pass || !r.pass) {
      merged.set(id, { ...r, _run: runId });
    }
  }
}

console.log(`合并到 ${merged.size} 题`);
const missing = onIds.filter((id) => !merged.has(id));
if (missing.length > 0) {
  console.error(`⚠ 缺 ${missing.length} 题：`, missing.slice(0, 10).join(', '), '…');
  process.exit(1);
}

const items = onIds.map((id) => merged.get(id) as ItemResult & { _run: string });
const pass = items.filter((r) => r.pass);
const fail = items.filter((r) => !r.pass);
const byAttr = new Map<string, number>();
for (const r of fail) {
  const a = r.attribution ?? '未标注';
  byAttr.set(a, (byAttr.get(a) ?? 0) + 1);
}

console.log(
  `\nON 侧全量（${items.length} 题）：PASS ${pass.length} / FAIL ${fail.length}，通过率 ${((pass.length / items.length) * 100).toFixed(1)}%`,
);
console.log('FAIL 归因分布：', Object.fromEntries(byAttr));
for (const r of fail) {
  const msg = r.oracle_failures?.[0]?.message ?? '';
  console.log(`  ${r.item_id} [${r.attribution}] ${msg.slice(0, 100)}`);
}

writeFileSync(
  '/tmp/on-merged-results.json',
  `${JSON.stringify(
    {
      total: items.length,
      pass: pass.length,
      fail: fail.length,
      pass_rate: pass.length / items.length,
      attribution: Object.fromEntries(byAttr),
      results: items.map(({ _run, ...r }) => ({ ...r, run: _run })),
    },
    null,
    2,
  )}\n`,
);
console.log('\n已写出 /tmp/on-merged-results.json');

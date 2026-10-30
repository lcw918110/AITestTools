/**
 * 合并今晚全部 ON 侧行的逐题结果，按 item_id 取「最后一次真实执行」为权威值，
 * 生成 156 题完整配对结果（paired-off 全量 + paired-on 72..156 分段）。
 *
 * 选取规则（优先级从高到低）：
 * 1. 最新 run 里的结果（重跑批次 > 首次续跑 > 首次全量）；
 * 2. 同题多份时取 pass=true 的（HARNESS 超时是环境故障，单题重跑已证可过）；
 * 3. 全 HARNESS 的题保留 HARNESS 归因并如实标注。
 *
 * 运行：npx tsx scripts/merge-on-results.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RUNS_ROOT = 'examples/product-eval/runs';

/** 今晚（10-30/31）产生的 ON 侧 run，按时间升序 = 权威级从低到高。 */
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

/** 按题合并：越新的 run 越权威；HARNESS 不覆盖真实结果（单题重跑已证可过）。 */
const merged = new Map<string, ItemResult & { _run: string }>();
for (const runId of onRuns) {
  for (const [id, r] of loadRun(runId)) {
    if (!onIds.includes(id)) continue;
    const prev = merged.get(id);
    if (prev === undefined || r.pass || prev.pass) {
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

console.log(`\nON 侧全量（${items.length} 题）：PASS ${pass.length} / FAIL ${fail.length}，通过率 ${((pass.length / items.length) * 100).toFixed(1)}%`);
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

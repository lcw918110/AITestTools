/**
 * 生成 paired-delegation-smoke 数据集（委派闭环专用小样本）。
 *
 * 为什么单独建数据集而不并入 paired-on-effect-smoke：
 * - paired-on-effect-smoke 是「效果对照」样本，归因口径是「模型能否完成任务」；
 * - 160 测的是「编排链是否接通」，失败原因在 SUT 侧委派，不在模型能力；
 * 混在一起会让效果对照的归因变浑，也会改变已跑过的冻结闭包口径。
 *
 * 本数据集只含 160 的 ON/OFF 两侧，用途单一：验证委派是否真的发生。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'examples/product-eval');

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}

function sha256(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 与 src/exam-engine/digest.ts 的 closureDigest 同口径。 */
function closureDigest(refs) {
  return sha256(canonicalize(refs));
}

function readRevision(id) {
  const path = resolve(OUT, `case-revisions/${id}.case-revision.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

const REVISION_IDS = ['paired-task-160.r1.off', 'paired-task-160.r1.on'];

const refs = REVISION_IDS.map((id) => {
  const doc = readRevision(id);
  return {
    case_id: doc.case_id,
    case_revision_id: doc.case_revision_id,
    content_hash: doc.content_hash,
  };
});

const release = {
  $schema: '../../../schemas/dataset-release.schema.json',
  dataset_release_id: 'paired-delegation-smoke',
  name: 'paired-delegation-smoke',
  description:
    '委派闭环小样本：160 的 ON/OFF 两侧。ON 侧要求 EventStore 出现 ManagerJobCreated，OFF 侧只判工作区结果。用于验证 orchestrator → manager 委派是否真的发生。',
  case_revisions: refs,
  closure_hash: closureDigest(refs),
};

writeFileSync(
  resolve(OUT, 'dataset-releases/paired-delegation-smoke.dataset-release.json'),
  `${JSON.stringify(release, null, 2)}\n`,
);
console.log(`已生成 paired-delegation-smoke：${refs.length} 个修订`);
for (const r of refs) console.log(`  ${r.case_revision_id}  ${r.content_hash.slice(0, 12)}...`);

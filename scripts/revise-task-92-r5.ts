/**
 * 92 题 oracle 修订（r4 → r5）：
 * deploy-anchor 断言中英文用词缺陷（模型中文语境输出「部署时间戳」，语义正确）
 * 按 CaseRevision 不可变纪律走正式修订：
 *   1. 复制 r4 → r5 文件（r4 原样保留）；
 *   2. r5 内修订 deploy-anchor 正则与 change_log；
 *   3. 用 revisionDigest 重算 content_hash；
 *   4. paired-on.dataset-release 引用换成 r5；
 *   5. 全库校验（schema + 冻结闭包 + 哈希）必须全绿。
 *
 * 运行：npx tsx scripts/revise-task-92-r5.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { revisionDigest } from '../src/exam-engine/digest.ts';

const R4 = 'examples/product-eval/case-revisions/paired-task-92.r4.on.case-revision.json';
const R5 = 'examples/product-eval/case-revisions/paired-task-92.r5.on.case-revision.json';
const RELEASE = 'examples/product-eval/dataset-releases/paired-on.dataset-release.json';

// 1. 复制 r4 → r5，改身份
const r5 = JSON.parse(readFileSync(R4, 'utf8')) as Record<string, unknown> & {
  case_revision_id: string;
  revision_number: number;
  content_hash: string;
  change_log: Record<string, string>;
};
r5.case_revision_id = 'paired-task-92.r5.on';
r5.revision_number = 5;

// 2. 修订 deploy-anchor：中文语境「部署」语义即正确
const expect = r5.expect as {
  oracles: Array<{ id: string; contains_regex?: string }>;
};
const anchor = expect.oracles.find((o) => o.id === 'deploy-anchor');
if (anchor === undefined) throw new Error('r4 缺 deploy-anchor oracle');
anchor.contains_regex = 'deploy|部署';
r5.change_log.rev5 =
  'deploy-anchor 断言中英文用词：模型中文语境输出「部署时间戳」语义正确，正则放宽为 deploy|部署（两次复跑稳定命中的唯一断言缺陷，与插件无关）';

// 3. 重算 content_hash（基于修订面：stimulus/preconditions/expect/…）
r5.content_hash = revisionDigest(r5 as never);

// 4. 落盘 r5 + release 换引用
writeFileSync(R5, `${JSON.stringify(r5, null, 1)}\n`);
const release = JSON.parse(readFileSync(RELEASE, 'utf8')) as {
  case_revisions: Array<{ case_id: string; case_revision_id: string; content_hash: string }>;
};
for (const ref of release.case_revisions) {
  if (ref.case_revision_id === 'paired-task-92.r4.on') {
    ref.case_revision_id = 'paired-task-92.r5.on';
    ref.content_hash = r5.content_hash;
  }
}
writeFileSync(RELEASE, `${JSON.stringify(release, null, 1)}\n`);

console.log('✓ r5 落盘:', R5);
console.log('✓ content_hash 重算:', r5.content_hash.slice(0, 16), '…');
console.log('✓ paired-on release 已换引用 → paired-task-92.r5.on');

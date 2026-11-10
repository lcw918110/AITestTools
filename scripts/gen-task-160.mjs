/**
 * 生成 paired-task-160（委派闭环题）的 case 与 ON/OFF 修订。
 *
 * 与 157 的区别：题面要求必须先 commission 委派给 manager 再改文件。
 *
 * ON/OFF 差异只允许在「环境能力」上：
 * - ON 环境挂插件、有 durable_log_glob，能读 EventStore → 加委派事件断言与探针；
 * - OFF 环境（hosted-plain-v1）不挂插件、无 durable_log_glob，EventStore 恒为空
 *   → 不能带事件断言、不能带 protocol_probes、不能声明 requires_durable_log，
 *   否则该题在对照组恒失败，配对差值混入常数项。
 * 其余断言两侧逐字相同。
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}

function revisionDigest(doc) {
  return createHash('sha256')
    .update(
      canonicalize({
        stimulus: doc.stimulus,
        preconditions: doc.preconditions ?? [],
        expect: doc.expect,
        evidence_requirements: doc.evidence_requirements ?? [],
        setup_cleanup: doc.setup_cleanup ?? [],
      }),
      'utf8',
    )
    .digest('hex');
}

const ORACLES = [
  { id: 'exit0', type: 'exit_code', equals: 0 },
  {
    id: 'discount-round',
    type: 'workspace_assert',
    path: 'lib/discount.mjs',
    contains: 'Math.round',
    not_contains: 'Math.floor((cents * percent) / 100)',
  },
  {
    id: 'tax-round',
    type: 'workspace_assert',
    path: 'lib/tax.mjs',
    contains: 'Math.round',
    not_contains: 'Math.floor((cents * bps) / 10000)',
  },
  {
    id: 'invoice-untouched',
    type: 'workspace_assert',
    path: 'lib/invoice.mjs',
    contains: 'INVOICE_CORE',
  },
  {
    id: 'tests-hold',
    type: 'workspace_assert',
    path: 'tests/invoice.test.mjs',
    contains: 'applyDiscount(1001, 15), 851',
  },
];

/**
 * 委派闭环断言只加在 ON 侧。
 *
 * 委派是否发生只能从万象术 EventStore 看出，而 OFF 环境（`hosted-plain-v1`）
 * 不挂插件、也没有 `durable_log_glob`，EventStore 必然为空——若 OFF 侧也带这条，
 * 该题在对照组恒失败，配对差值会混入常数项，对照结论不可信。
 */
const DELEGATION_ORACLE = {
  id: 'delegation-happened',
  type: 'event_subsequence',
  names: ['ManagerJobCreated'],
};

function makeRevision(side) {
  const oracles = side === 'on' ? [...ORACLES, DELEGATION_ORACLE] : [...ORACLES];
  const doc = {
    $schema: '../../../schemas/case-revision.schema.json',
    case_id: 'paired-task-160',
    case_revision_id: `paired-task-160.r1.${side}`,
    revision_number: 1,
    legacy_item_id: `EVAL-B-PAIRED-TASK-160-${side.toUpperCase()}`,
    content_hash: '',
    stimulus: {
      kind: 'task_prompt',
      ref: 'bank/materials/PAIRED-TASK-160/prompt.txt',
      notes: 'Delegate to a manager via commission, then fix both helpers. Seal DELEGATED_FIX.',
      hosted_pass_token: 'DELEGATED_FIX',
    },
    preconditions: [],
    steps: [],
    setup_cleanup: [],
    permissions_side_effects: [],
    expect: { oracles },
    evidence_requirements: [],
    strata: { task_type: 'hosted' },
    execution_profile: { mode: 'hosted' },
    attribution_focus: 'PROTOCOL',
    // 探针与 durable_log 只在 ON 侧声明：OFF 环境读不到 EventStore，
    // 声明了会让 missingProtocolProbes 恒非空，对照组恒失败。
    protocol_probes: side === 'on' ? ['RuntimeStarted', 'JournalEnvelope'] : [],
    model_id: 'wave-anthropic/claude-sonnet-5',
    execution: {
      deadline_ms: 240000,
      requires_network: true,
      requires_durable_log: side === 'on',
    },
    change_log: {
      rev1: '委派闭环：题面要求先 commission 再改文件；ON 侧断言要求 ManagerJobCreated 出现',
    },
  };
  doc.content_hash = revisionDigest(doc);
  return doc;
}

const caseDoc = {
  $schema: '../../../schemas/case.schema.json',
  case_id: 'paired-task-160',
  title: '配对任务 160（委派闭环）：先 commission 再修双文件取整 DELEGATED_FIX',
  owner: 'product-eval',
  tags: ['workspace', 'delegation'],
  lifecycle: 'draft',
  automation_readiness: 'design_ready',
  head_revision_id: 'paired-task-160.r1.on',
  pair_key: 'PAIRED-TASK-160',
};

const outDir = resolve(ROOT, 'examples/product-eval');
writeFileSync(
  resolve(outDir, 'cases/paired-task-160.case.json'),
  `${JSON.stringify(caseDoc, null, 2)}\n`,
);
for (const side of ['on', 'off']) {
  writeFileSync(
    resolve(outDir, `case-revisions/paired-task-160.r1.${side}.case-revision.json`),
    `${JSON.stringify(makeRevision(side), null, 2)}\n`,
  );
}
console.log('已生成 paired-task-160 的 case 与 ON/OFF 修订');

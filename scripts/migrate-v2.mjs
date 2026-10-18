#!/usr/bin/env node
/**
 * V2.17 深迁移脚本（阶段 2）。
 *
 * 把 examples/product-eval 的 318 个 *.item.json（papers-v1）迁移为
 * cases-v1 资产：case + case-revision + dataset-release + environment + candidate。
 *
 * 迁移规则（见 docs/06-V2.17深迁移方案.md §2.4）：
 * - item.id（EVAL-B-PAIRED-TASK-22-OFF）→ case_id（paired-task-22）
 * - OFF/ON 是两个 CaseRevision（预期合同不同），通过 pair_key 关联
 * - freeze + room → candidate + environment
 *
 * 运行：node scripts/migrate-v2.mjs [--project examples/product-eval] [--dry-run]
 * 产出写入 <project>/cases/、case-revisions/、dataset-releases/、environments/、candidates/。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import prettier from 'prettier';

// ─────────────────────────────────────────────────────────────
// 规范化摘要（与 src/exam-engine/digest.ts 的 canonicalize 语义一致）
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

function collectFiles(dir, suffix) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectFiles(full, suffix));
    else if (entry.endsWith(suffix)) found.push(full);
  }
  return found;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const json = JSON.stringify(data, null, 2);
  // 读取仓库 .prettierrc（printWidth=100 等），确保迁移产物与 format:check 口径一致
  const options = await prettier.resolveConfig(file);
  const formatted = await prettier.format(json, { ...options, parser: 'json' });
  writeFileSync(file, formatted, 'utf8');
}

// ─────────────────────────────────────────────────────────────
// 迁移规则
// ─────────────────────────────────────────────────────────────

/** EVAL-B-PAIRED-TASK-22-OFF → paired-task-22；单题 WX-A-ST-01-MAIN → wx-a-st-01-main */
function toCaseId(itemId) {
  const paired = /-(OFF|ON)$/i.test(itemId);
  if (paired) {
    return itemId
      .replace(/^EVAL-[A-Z]*-/, '') // 去 EVAL-B- 前缀
      .replace(/-(OFF|ON)$/i, '') // 去 -OFF/-ON 后缀
      .toLowerCase();
  }
  // 单题：完整小写化，保留轴前缀（多轴同名任务须区分）
  return itemId.toLowerCase();
}

/** item 是否配对（含 -OFF/-ON 后缀） */
function isPaired(itemId) {
  return /-(OFF|ON)$/i.test(itemId);
}

/** 单题/配对的 revision variant：配对按 host_profile 判 off/on，单题省略 */
function revisionVariant(item) {
  if (!isPaired(item.id)) return undefined;
  return item.freeze?.host_profile?.includes('plugin') ? 'on' : 'off';
}

/** case_revision_id：配对 `{caseId}.r{rev}.{variant}`，单题 `{caseId}.r{rev}` */
function toRevisionId(caseId, item) {
  const variant = revisionVariant(item);
  return variant ? `${caseId}.r${item.rev ?? 1}.${variant}` : `${caseId}.r${item.rev ?? 1}`;
}

/** item.status（active/draft/deprecated）→ Case.lifecycle */
const STATUS_TO_LIFECYCLE = {
  active: 'released',
  draft: 'draft',
  deprecated: 'deprecated',
};

/** 计算 CaseRevision.content_hash：输入/前提/预期/Oracle/Rubric/证据/清理 的规范化摘要 */
function contentHash(doc) {
  return sha256(
    canonicalize({
      stimulus: doc.stimulus,
      preconditions: doc.preconditions ?? [],
      expect: doc.expect,
      evidence_requirements: doc.evidence_requirements ?? [],
      setup_cleanup: doc.setup_cleanup ?? [],
    }),
  );
}

/** item.freeze → execution_profile（轴废除后用 mode/layer 表达执行驱动） */
function executionProfileOf(item) {
  const freeze = item.freeze ?? {};
  const axis = item.axis;
  let mode;
  if (axis === 'A') {
    if (freeze.cassette !== undefined) mode = 'cassette';
    else if (freeze.contract !== undefined || freeze.script !== undefined) mode = 'scripted';
    else mode = 'fold';
  } else if (axis === 'B') {
    mode = 'hosted';
  } else if (axis === 'C') {
    mode = 'direct_tool';
  }
  if (mode === undefined) return undefined;
  const profile = { mode };
  if (freeze.layer !== undefined) profile.layer = freeze.layer;
  if (freeze.fold_entry !== undefined) profile.fold_entry = freeze.fold_entry;
  if (freeze.event_schema !== undefined) profile.event_schema = freeze.event_schema;
  if (freeze.session_id !== undefined) profile.session_id = freeze.session_id;
  if (freeze.contract !== undefined) profile.contract = freeze.contract;
  if (freeze.script !== undefined) profile.script = freeze.script;
  if (freeze.cassette !== undefined) profile.cassette = freeze.cassette;
  return profile;
}

/** item.axis → strata.task_type（轴废除后用任务类型表达） */
function strataOf(item) {
  const axis = item.axis;
  if (axis === 'A') {
    const freeze = item.freeze ?? {};
    if (freeze.cassette !== undefined) return { task_type: 'cassette', difficulty_level: 'L3' };
    if (freeze.contract !== undefined || freeze.script !== undefined)
      return { task_type: 'scripted', difficulty_level: 'L2' };
    return { task_type: 'fold', difficulty_level: 'L1' };
  }
  if (axis === 'B') return { task_type: 'hosted' };
  if (axis === 'C') return { task_type: 'direct_tool' };
  return undefined;
}

/** item → CaseRevision（不含 case_id 前缀后缀的纯修订正文） */
function toCaseRevision(item, caseId) {
  const rev = item.rev ?? 1;
  // 配对 OFF/ON 是两个独立 CaseRevision，rev 可能相同，用候选维度区分；单题省略 variant
  const variant = revisionVariant(item);
  const executionProfile = executionProfileOf(item);
  const strata = strataOf(item);
  return {
    $schema: '../../../schemas/case-revision.schema.json',
    case_id: caseId,
    case_revision_id: toRevisionId(caseId, item),
    revision_number: rev,
    legacy_item_id: item.id,
    content_hash: contentHash(item),
    stimulus: item.stimulus,
    preconditions: item.intent?.preconditions ?? [],
    steps: item.intent?.steps ?? [],
    setup_cleanup: [],
    permissions_side_effects: [],
    expect: { oracles: item.expect?.oracles ?? [] },
    evidence_requirements: [],
    ...(strata ? { strata } : {}),
    ...(executionProfile ? { execution_profile: executionProfile } : {}),
    attribution_focus: item.intent?.attribution_focus ?? 'MODEL_TASK',
    protocol_probes: item.intent?.protocol_probes ?? [],
    model_id: item.freeze?.model_id,
    execution: {
      deadline_ms: item.execution?.deadline_ms ?? 180000,
      requires_network: item.execution?.requires_network ?? true,
      requires_durable_log: item.execution?.requires_durable_log ?? false,
      repeats: item.execution?.repeats,
    },
    change_log: item.change_log ?? {},
  };
}

/** item → Case（逻辑身份） */
function toCase(item, caseId) {
  const variant = revisionVariant(item);
  const pairKey = item.intent?.effect_pair;
  return {
    $schema: '../../../schemas/case.schema.json',
    case_id: caseId,
    title: item.title,
    owner: item.owner,
    tags: item.tags ?? [],
    lifecycle: STATUS_TO_LIFECYCLE[item.status] ?? 'released',
    automation_readiness: 'design_ready',
    head_revision_id: toRevisionId(caseId, item),
    ...(pairKey ? { pair_key: pairKey } : {}),
    created_at: undefined,
    updated_at: undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { project: 'examples/product-eval', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project' && argv[i + 1]) args.project = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function main() {
  const { project, dryRun } = parseArgs(process.argv.slice(2));
  const root = resolve(project);
  // items 源路径：深迁移 6f 后 papers-v1 源资产归档到 legacy/（items/papersets/rooms）
  const legacyItemsDir = join(root, 'legacy', 'items');
  const itemsDir = existsSync(legacyItemsDir) ? legacyItemsDir : join(root, 'items');

  const itemFiles = collectFiles(itemsDir, '.item.json');
  if (itemFiles.length === 0) {
    console.error(`未在 ${itemsDir} 找到 *.item.json`);
    process.exit(1);
  }

  console.log(`发现 ${itemFiles.length} 个 item.json，开始迁移${dryRun ? '（dry-run）' : ''}...`);

  const items = itemFiles.map((f) => ({ file: f, doc: readJson(f) }));

  // 按 effect_pair 分组
  const groups = new Map();
  for (const { file, doc } of items) {
    const pair = doc.intent?.effect_pair ?? doc.id;
    if (!groups.has(pair)) groups.set(pair, []);
    groups.get(pair).push({ file, doc });
  }

  const cases = [];
  const revisions = [];
  /** item.id → case_revision_id 映射（供 paperset 迁移用） */
  const itemIdToRevisionId = new Map();
  /** case_revision_id → content_hash 映射（供 paperset 迁移用，避免 dry-run 读磁盘） */
  const revisionIdToHash = new Map();
  let caseCount = 0;
  let revisionCount = 0;

  for (const [pair, group] of groups) {
    // 取一个 item 推导 case_id（同 pair 的 OFF/ON 应推导出相同 case_id）
    const caseId = toCaseId(group[0].doc.id);
    // head_revision 取 rev 最大的那个
    const head = group.reduce((a, b) => (b.doc.rev > a.doc.rev ? b : a), group[0]);
    const caseDoc = toCase(head.doc, caseId);

    for (const { doc } of group) {
      const revDoc = toCaseRevision(doc, caseId);
      revisions.push({ caseId, revDoc });
      itemIdToRevisionId.set(doc.id, revDoc.case_revision_id);
      revisionIdToHash.set(revDoc.case_revision_id, revDoc.content_hash);
      revisionCount++;
    }
    cases.push(caseDoc);
    caseCount++;
  }

  // 写入
  const casesDir = join(root, 'cases');
  const revisionsDir = join(root, 'case-revisions');
  for (const caseDoc of cases) {
    const file = join(casesDir, `${caseDoc.case_id}.case.json`);
    if (!dryRun) await writeJson(file, caseDoc);
  }
  for (const { caseId, revDoc } of revisions) {
    const file = join(revisionsDir, `${revDoc.case_revision_id}.case-revision.json`);
    if (!dryRun) await writeJson(file, revDoc);
  }

  // ── paperset → dataset-release ──
  const papersetDir = join(root, 'legacy', 'papersets');
  const datasetDir = join(root, 'dataset-releases');
  const papersetFiles = collectFiles(papersetDir, '.json');
  let datasetCount = 0;
  for (const f of papersetFiles) {
    const ps = readJson(f);
    const caseRevisions = (ps.items ?? [])
      .map((itemId) => {
        const revId = itemIdToRevisionId.get(itemId);
        if (!revId) return null;
        const caseId = toCaseId(itemId);
        const contentHash = revisionIdToHash.get(revId);
        return { case_id: caseId, case_revision_id: revId, content_hash: contentHash };
      })
      .filter((x) => x && x.content_hash);
    const dataset = {
      $schema: '../../../schemas/dataset-release.schema.json',
      dataset_release_id: ps.name.toLowerCase(),
      name: ps.name,
      description: ps.description,
      case_revisions: caseRevisions,
      closure_hash: sha256(canonicalize(caseRevisions)),
      created_at: undefined,
    };
    const file = join(datasetDir, `${ps.name.toLowerCase()}.dataset-release.json`);
    if (!dryRun) await writeJson(file, dataset);
    datasetCount++;
  }

  // ── room → environment + candidate ──
  const roomsDir = join(root, 'legacy', 'rooms');
  const envDir = join(root, 'environments');
  const candidateDir = join(root, 'candidates');
  const roomFiles = collectFiles(roomsDir, '.json');
  let envCount = 0;
  let candidateCount = 0;
  for (const f of roomFiles) {
    const room = readJson(f);
    const envProfile = {
      $schema: '../../../schemas/environment.schema.json',
      environment_profile_id: room.name,
      name: room.name,
      lifecycle: 'active',
      recipe: {
        runtime: room.host?.name,
        host: room.host?.version ? `${room.host.name}@${room.host.version}` : room.host?.name,
        network_policy: room.network === true ? 'allow' : 'deny',
        isolation_profile: room.workspace,
        host_command: room.host?.command,
        host_model: room.host?.model,
        host_agent: room.host?.agent,
        managed_agents: room.host?.managed_agents,
        host_plugin: room.host?.plugin,
        durable_log_glob: room.durable_log_glob,
        kind: room.kind,
        model_driver: room.model_driver,
        fold_entries: room.fold_entries,
        adapter: room.adapter,
        sut: room.sut,
        contract: room.contract,
        event_schema: room.event_schema,
      },
    };
    const file = join(envDir, `${room.name}.environment.json`);
    if (!dryRun) await writeJson(file, envProfile);
    envCount++;

    // candidate：从 room 的 host 提取（plugin 维度由 freeze.host_profile 决定）
    const isPlugin = room.name.includes('plugin');
    const candidate = {
      $schema: '../../../schemas/candidate.schema.json',
      candidate_id: room.name.replace(/-v1$/, ''),
      name: room.description ?? room.name,
      host: { name: room.host?.name, version: room.host?.version },
      agent: { name: room.host?.agent },
      plugin: isPlugin ? { name: 'wanxiangshu' } : null,
      model_routing: room.name,
      environment_profile: room.name,
      channel: room.model_driver === 'live' ? 'hosted' : 'direct',
      tool_profile: 'none',
    };
    const cfile = join(candidateDir, `${candidate.candidate_id}.candidate.json`);
    if (!dryRun) await writeJson(cfile, candidate);
    candidateCount++;
  }

  console.log(
    `迁移完成：${caseCount} 个 Case，${revisionCount} 个 CaseRevision，${datasetCount} 个 DatasetRelease，${envCount} 个 Environment，${candidateCount} 个 Candidate`,
  );
  console.log(
    `产出目录：${relative(process.cwd(), casesDir)}、${relative(process.cwd(), revisionsDir)}、${relative(process.cwd(), datasetDir)}、${relative(process.cwd(), envDir)}、${relative(process.cwd(), candidateDir)}`,
  );
}

await main();

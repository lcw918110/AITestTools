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

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────
// 迁移规则
// ─────────────────────────────────────────────────────────────

/** EVAL-B-PAIRED-TASK-22-OFF → paired-task-22 */
function toCaseId(itemId) {
  return itemId
    .replace(/^EVAL-[A-Z]*-/, '') // 去 EVAL-B- 前缀
    .replace(/-(OFF|ON)$/i, '') // 去 -OFF/-ON 后缀
    .toLowerCase();
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

/** item → CaseRevision（不含 case_id 前缀后缀的纯修订正文） */
function toCaseRevision(item, caseId) {
  const rev = item.rev ?? 1;
  // OFF/ON 是两个独立 CaseRevision，rev 可能相同，需用候选维度区分
  const variant = item.freeze?.host_profile?.includes('plugin') ? 'on' : 'off';
  return {
    $schema: '../../../schemas/case-revision.schema.json',
    case_id: caseId,
    case_revision_id: `${caseId}.r${rev}.${variant}`,
    revision_number: rev,
    content_hash: contentHash(item),
    stimulus: item.stimulus,
    preconditions: item.intent?.preconditions ?? [],
    steps: item.intent?.steps ?? [],
    setup_cleanup: [],
    permissions_side_effects: [],
    expect: { oracles: item.expect?.oracles ?? [] },
    evidence_requirements: [],
    strata: undefined,
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
  const variant = item.freeze?.host_profile?.includes('plugin') ? 'on' : 'off';
  return {
    $schema: '../../../schemas/case.schema.json',
    case_id: caseId,
    title: item.title,
    owner: item.owner,
    tags: item.tags ?? [],
    lifecycle: STATUS_TO_LIFECYCLE[item.status] ?? 'released',
    automation_readiness: 'design_ready',
    head_revision_id: `${caseId}.r${item.rev ?? 1}.${variant}`,
    pair_key: item.intent?.effect_pair ?? caseId.toUpperCase(),
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

function main() {
  const { project, dryRun } = parseArgs(process.argv.slice(2));
  const root = resolve(project);
  const itemsDir = join(root, 'bank', 'items');

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
  let caseCount = 0;
  let revisionCount = 0;

  for (const [pair, group] of groups) {
    // 取一个 item 推导 case_id（同 pair 的 OFF/ON 应推导出相同 case_id）
    const caseId = toCaseId(group[0].doc.id);
    // head_revision 取 rev 最大的那个
    const head = group.reduce((a, b) => (b.doc.rev > a.doc.rev ? b : a), group[0]);
    const caseDoc = toCase(head.doc, caseId);
    caseDoc.head_revision_id = caseDoc.head_revision_id;

    for (const { doc } of group) {
      const revDoc = toCaseRevision(doc, caseId);
      revisions.push({ caseId, revDoc });
      itemIdToRevisionId.set(doc.id, revDoc.case_revision_id);
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
    if (!dryRun) writeJson(file, caseDoc);
  }
  for (const { caseId, revDoc } of revisions) {
    const file = join(revisionsDir, `${revDoc.case_revision_id}.case-revision.json`);
    if (!dryRun) writeJson(file, revDoc);
  }

  // ── paperset → dataset-release ──
  const papersetDir = join(root, 'papersets');
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
        const crFile = join(revisionsDir, `${revId}.case-revision.json`);
        const cr = readJson(crFile);
        return { case_id: caseId, case_revision_id: revId, content_hash: cr.content_hash };
      })
      .filter(Boolean);
    const dataset = {
      $schema: '../../../schemas/dataset-release.schema.json',
      dataset_release_id: ps.name,
      name: ps.name,
      description: ps.description,
      case_revisions: caseRevisions,
      closure_hash: sha256(canonicalize(caseRevisions)),
      created_at: undefined,
    };
    const file = join(datasetDir, `${ps.name}.dataset-release.json`);
    if (!dryRun) writeJson(file, dataset);
    datasetCount++;
  }

  // ── room → environment + candidate ──
  const roomsDir = join(root, 'rooms');
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
        node: undefined,
        network_policy: room.network === true ? 'allow' : 'deny',
        isolation_profile: room.workspace,
        host_command: room.host?.command,
        host_model: room.host?.model,
        host_agent: room.host?.agent,
        managed_agents: room.host?.managed_agents,
        host_plugin: room.host?.plugin,
        durable_log_glob: room.durable_log_glob,
      },
    };
    const file = join(envDir, `${room.name}.environment.json`);
    if (!dryRun) writeJson(file, envProfile);
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
    if (!dryRun) writeJson(cfile, candidate);
    candidateCount++;
  }

  console.log(`迁移完成：${caseCount} 个 Case，${revisionCount} 个 CaseRevision，${datasetCount} 个 DatasetRelease，${envCount} 个 Environment，${candidateCount} 个 Candidate`);
  console.log(`产出目录：${relative(process.cwd(), casesDir)}、${relative(process.cwd(), revisionsDir)}、${relative(process.cwd(), datasetDir)}、${relative(process.cwd(), envDir)}、${relative(process.cwd(), candidateDir)}`);
}

main();

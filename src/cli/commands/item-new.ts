import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { canonicalize, revisionDigest } from '../../exam-engine/digest.ts';
import { loadProject } from '../../exam-engine/project.ts';
import type { CaseRevision } from '../../exam-engine/types.ts';

const MODES = ['fold', 'scripted', 'cassette', 'hosted', 'direct_tool'] as const;
type Mode = (typeof MODES)[number];

/** case_id 须小写连字符（对齐 case.schema.json pattern）。 */
const CASE_ID_RE = /^[a-z0-9-]+$/;

export interface ItemNewOptions {
  project?: string | undefined;
  id?: string | undefined;
  mode?: string | undefined;
  layer?: string | undefined;
  title?: string | undefined;
  dataset?: string | undefined;
  name?: string | undefined;
  json?: boolean;
}

/** prettier 格式化写 JSON（对齐仓库 format:check 口径）。 */
async function writeJson(file: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  const options = await resolveConfig(file);
  const formatted = await format(json, { ...options, parser: 'json' });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, formatted, 'utf8');
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** mode → stimulus.kind（cases-v1 输入材料类型）。 */
function stimulusKindOf(mode: Mode): string {
  if (mode === 'fold') return 'event_sequence';
  if (mode === 'cassette') return 'cassette';
  if (mode === 'direct_tool') return 'tool_args';
  if (mode === 'hosted') return 'task_prompt';
  return 'hook_script';
}

/** mode → stimulus.ref（相对项目根）。 */
function stimulusRefOf(mode: Mode, caseId: string): string {
  if (mode === 'fold') return `materials/${caseId}/stimulus.ndjson`;
  if (mode === 'cassette') return `cassettes/${caseId}/manifest.json`;
  return `materials/${caseId}/stimulus.json`;
}

/** mode → execution_profile（轴废除后用 mode/layer 表达执行驱动）。 */
function executionProfileOf(
  mode: Mode,
  layer: string | undefined,
  caseId: string,
): Record<string, unknown> {
  const profile: Record<string, unknown> = { mode };
  if (mode === 'fold') {
    profile.layer = layer ?? 'L1';
    profile.fold_entry = 'TODO';
  } else if (mode === 'scripted') {
    profile.layer = layer ?? 'L2';
    profile.contract = 'TODO';
    profile.script = 'scripts/TODO.json';
  } else if (mode === 'cassette') {
    profile.layer = layer ?? 'L3';
    profile.cassette = `cassettes/${caseId}/manifest.json`;
  }
  return profile;
}

/** mode → strata（任务类型 / 难度分层）。 */
function strataOf(mode: Mode, layer: string | undefined): Record<string, unknown> {
  if (mode === 'fold') return { task_type: 'fold', difficulty_level: layer ?? 'L1' };
  if (mode === 'scripted') return { task_type: 'scripted', difficulty_level: layer ?? 'L2' };
  if (mode === 'cassette') return { task_type: 'cassette', difficulty_level: layer ?? 'L3' };
  if (mode === 'hosted') return { task_type: 'hosted' };
  return { task_type: 'direct_tool' };
}

/** mode → 骨架 oracle（fold 用 event_fold，其余用 exit_code 占位）。 */
function oraclesOf(mode: Mode, caseId: string): Record<string, unknown>[] {
  if (mode === 'fold') {
    return [{ id: 'fold', type: 'event_fold', spec: `materials/${caseId}/expected-fold.json` }];
  }
  return [{ id: 'todo', type: 'exit_code', equals: 0 }];
}

/** mode → 需人工补全的占位字段提示（骨架生成后引导用户补全）。 */
function todoHintsOf(mode: Mode): string[] {
  if (mode === 'fold') return ['execution_profile.fold_entry（当前为 TODO）'];
  if (mode === 'scripted') {
    return [
      'execution_profile.contract（当前为 TODO）',
      'execution_profile.script（当前为 scripts/TODO.json）',
    ];
  }
  if (mode === 'cassette') return [];
  if (mode === 'hosted') return [];
  return [];
}

/**
 * cases-v1 录题：生成 case + case-revision（含 content_hash）骨架 + materials 目录。
 * 可选 --dataset 挂载到 dataset-release（创建或追加引用并重算 closure_hash）。
 */
export async function runItemNew(options: ItemNewOptions): Promise<number> {
  if (options.id === undefined || options.mode === undefined) {
    console.error(
      '用法：proctor item new --id <case_id> --mode <fold|scripted|cassette|hosted|direct_tool> [--layer L1|L2|L3] [--title ...] [--dataset <名>] [--project ...]',
    );
    return 2;
  }
  if (!CASE_ID_RE.test(options.id)) {
    console.error('case_id 须匹配 ^[a-z0-9-]+$（小写连字符）');
    return 2;
  }
  const mode = options.mode.toLowerCase();
  if (!(MODES as readonly string[]).includes(mode)) {
    console.error(`本命令 --mode 仅支持 ${MODES.join(' / ')}`);
    return 2;
  }
  const modeTyped = mode as Mode;
  const layer = options.layer?.toUpperCase();
  if (layer !== undefined && !['L1', 'L2', 'L3'].includes(layer)) {
    console.error('--layer 仅支持 L1 / L2 / L3');
    return 2;
  }

  const project = loadProject(options.project);
  const caseId = options.id;
  const caseRevisionId = `${caseId}.r1`;
  const title = options.title ?? options.name ?? `${caseId}（draft）`;

  const caseFile = join(project.dirs.cases, `${caseId}.case.json`);
  const revisionFile = join(project.dirs.case_revisions, `${caseRevisionId}.case-revision.json`);
  if (existsSync(caseFile) || existsSync(revisionFile)) {
    console.error(`已存在：${caseFile} 或 ${revisionFile}`);
    return 1;
  }

  const stimulus = { kind: stimulusKindOf(modeTyped), ref: stimulusRefOf(modeTyped, caseId) };
  const expect = { oracles: oraclesOf(modeTyped, caseId) };

  // content_hash 只依赖 stimulus/preconditions/expect/evidence_requirements/setup_cleanup。
  const draft = {
    case_id: caseId,
    case_revision_id: caseRevisionId,
    revision_number: 1,
    content_hash: '',
    stimulus,
    preconditions: [],
    steps: [],
    setup_cleanup: [],
    permissions_side_effects: [],
    expect,
    evidence_requirements: [],
    strata: strataOf(modeTyped, layer),
    execution_profile: executionProfileOf(modeTyped, layer, caseId),
    attribution_focus: modeTyped === 'direct_tool' ? 'TOOL' : 'PROTOCOL',
    protocol_probes: [],
    execution: { deadline_ms: 15000, requires_network: false },
    change_log: { rev1: 'proctor item new 骨架' },
  } as unknown as CaseRevision;

  const contentHash = revisionDigest(draft);
  const caseRevision = {
    $schema: '../../../schemas/case-revision.schema.json',
    case_id: caseId,
    case_revision_id: caseRevisionId,
    revision_number: 1,
    content_hash: contentHash,
    stimulus,
    preconditions: [],
    steps: [],
    setup_cleanup: [],
    permissions_side_effects: [],
    expect,
    evidence_requirements: [],
    strata: strataOf(modeTyped, layer),
    execution_profile: executionProfileOf(modeTyped, layer, caseId),
    attribution_focus: modeTyped === 'direct_tool' ? 'TOOL' : 'PROTOCOL',
    protocol_probes: [],
    execution: { deadline_ms: 15000, requires_network: false },
    change_log: { rev1: 'proctor item new 骨架' },
  };
  const caseDoc = {
    $schema: '../../../schemas/case.schema.json',
    case_id: caseId,
    title,
    owner: 'local',
    tags: ['draft'],
    lifecycle: 'draft',
    automation_readiness: 'design_ready',
    head_revision_id: caseRevisionId,
  };

  // materials 骨架
  const matDir = join(project.root, 'materials', caseId);
  mkdirSync(matDir, { recursive: true });
  if (modeTyped === 'fold') {
    writeFileSync(join(matDir, 'stimulus.ndjson'), '');
    writeFileSync(join(matDir, 'expected-fold.json'), '{}\n');
  } else if (modeTyped === 'cassette') {
    mkdirSync(join(project.root, 'cassettes', caseId), { recursive: true });
  } else {
    writeFileSync(join(matDir, 'stimulus.json'), '{}\n');
  }

  await writeJson(caseFile, caseDoc);
  await writeJson(revisionFile, caseRevision);
  // 可选挂载 dataset-release
  let datasetFile: string | undefined;
  if (options.dataset !== undefined) {
    datasetFile = join(project.dirs.dataset_releases, `${options.dataset}.dataset-release.json`);
    const ref = { case_id: caseId, case_revision_id: caseRevisionId, content_hash: contentHash };
    if (existsSync(datasetFile)) {
      const doc = JSON.parse(readFileSync(datasetFile, 'utf8')) as {
        case_revisions?: Array<Record<string, unknown>>;
      };
      const caseRevisions = Array.isArray(doc.case_revisions) ? doc.case_revisions : [];
      if (!caseRevisions.some((r) => r.case_revision_id === caseRevisionId)) {
        caseRevisions.push(ref);
        await writeJson(datasetFile, {
          ...doc,
          case_revisions: caseRevisions,
          closure_hash: sha256(canonicalize(caseRevisions)),
        });
      }
    } else {
      await writeJson(datasetFile, {
        $schema: '../../../schemas/dataset-release.schema.json',
        dataset_release_id: options.dataset,
        name: options.dataset,
        case_revisions: [ref],
        closure_hash: sha256(canonicalize([ref])),
      });
    }
  }

  const out = {
    case_file: caseFile,
    case_revision_file: revisionFile,
    case_id: caseId,
    case_revision_id: caseRevisionId,
    ...(datasetFile !== undefined ? { dataset_release: datasetFile } : {}),
  };
  if (options.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`已创建 case：${caseId} → ${caseFile}`);
    console.log(`已创建 case-revision：${caseRevisionId} → ${revisionFile}`);
    if (datasetFile !== undefined) console.log(`已挂载 dataset-release：${datasetFile}`);
    const hints = todoHintsOf(modeTyped);
    if (hints.length > 0) {
      console.log('下一步补全（骨架占位，未补全前无法 run）：');
      for (const h of hints) console.log(`  - ${h}`);
    }
  }
  return 0;
}

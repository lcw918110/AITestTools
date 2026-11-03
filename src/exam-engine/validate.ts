import {
  loadCandidates,
  loadCaseRevisions,
  loadCasesV2,
  loadDatasetReleases,
  loadEnvironments,
} from './loader.ts';
import { checkProtocolCompatibility } from './project.ts';
import type { ExamProject } from './project.ts';
import { validateAgainstSchema } from './schema.ts';
import { revisionDigest, closureDigest } from './digest.ts';
import type {
  CandidateConfig,
  Case,
  CaseRevision,
  DatasetRelease,
  EnvironmentProfile,
  Issue,
  LoadedAsset,
} from './types.ts';

/** cases-v1 逐题（case-revision）校验报告。 */
export interface CaseReport {
  file: string;
  relPath: string;
  caseId?: string;
  rev?: number;
  digest?: string;
  issues: Issue[];
}

export interface ValidationReport {
  projectName?: string;
  /** cases-v1 逐题（case-revision）报告。 */
  caseReports: CaseReport[];
  projectIssues: Issue[];
  errorCount: number;
  warningCount: number;
}

function err(code: string, message: string, file: string, instancePath?: string): Issue {
  return instancePath === undefined
    ? { level: 'error', code, message, file }
    : { level: 'error', code, message, file, instancePath };
}

// ── cases-v1 校验（V2.17 深迁移阶段 6e） ──

/**
 * 断言正则静态可编译性检查。
 *
 * 背景：`stdout_assert` 的 `contains_regex` / `not_contains_regex` /
 * `semantic_variants` 在真跑时才由 `new RegExp` 解析，若写错（缺括号等）
 * 引擎归因 HARNESS，却被上层计为「题目失败」——静态门禁全绿、真跑才炸。
 * 这里在录题/校验阶段就把非法正则拦成 error，避免污染评测结论。
 */
function validateOracleRegexes(doc: CaseRevision, file: string): Issue[] {
  const issues: Issue[] = [];
  const expect = (doc as { expect?: unknown }).expect;
  if (expect === null || typeof expect !== 'object') return issues;
  const oracles = (expect as { oracles?: unknown }).oracles;
  if (!Array.isArray(oracles)) return issues;

  const tryCompile = (source: string, flags: string, at: string): void => {
    try {
      new RegExp(source, flags);
    } catch (e) {
      issues.push(
        err('ORACLE_REGEX_INVALID', `正则无法编译：/${source}/${flags} —— ${String(e)}`, file, at),
      );
    }
  };

  const asArray = (v: unknown): string[] => {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    return [];
  };

  /** 原始声明条目数（含空串），供互斥判定，避免空串被过滤后放过非法配置。 */
  const declared = (v: unknown): unknown[] => {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v;
    return [];
  };

  for (const [i, raw] of oracles.entries()) {
    if (raw === null || typeof raw !== 'object') continue;
    const oracle = raw as Record<string, unknown>;
    if (oracle['type'] !== 'stdout_assert') continue;

    const flagsRaw = oracle['regex_flags'];
    const flags = typeof flagsRaw === 'string' ? flagsRaw : 'i';
    const base = `/expect/oracles/${i}`;

    if (typeof flagsRaw === 'string') {
      try {
        // 用空模式探测 flags 合法性
        new RegExp('', flags);
      } catch (e) {
        issues.push(
          err(
            'ORACLE_REGEX_FLAGS_INVALID',
            `regex_flags 非法：${flags} —— ${String(e)}`,
            file,
            `${base}/regex_flags`,
          ),
        );
      }
    }

    for (const key of [
      'contains_regex',
      'not_contains_regex',
      'semantic_variants',
      'forbidden_variants',
    ] as const) {
      const sources = asArray(oracle[key]);
      for (const [j, source] of sources.entries()) {
        const at =
          key === 'semantic_variants' || key === 'forbidden_variants'
            ? `${base}/${key}/${j}`
            : `${base}/${key}`;
        tryCompile(source, flags, at);
      }
    }

    // semantic_variants / forbidden_variants 的配置契约（与运行时 runStdoutAssertOracle 同口径）。
    // 只在运行时报配错，会让「试题配错」计成「模型失败」，故静态先拦。
    for (const [key, code] of [
      ['semantic_variants', 'ORACLE_SEMANTIC'],
      ['forbidden_variants', 'ORACLE_FORBIDDEN'],
    ] as const) {
      const list = oracle[key];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        issues.push(err(`${code}_INVALID`, `${key} 必须是字符串数组`, file, `${base}/${key}`));
        continue;
      }
      if (list.length === 0) {
        issues.push(
          err(`${code}_EMPTY`, `${key} 不能为空数组（等价于无正面断言）`, file, `${base}/${key}`),
        );
        continue;
      }
      if (list.some((x) => typeof x !== 'string' || x.trim().length === 0)) {
        issues.push(
          err(
            `${code}_INVALID`,
            `${key} 含非字符串或空白变体（空串会变成恒真正则）`,
            file,
            `${base}/${key}`,
          ),
        );
      }
    }

    // semantic_variants 与正面字面口径互斥（禁止同一断言两套正面口径）。
    // forbidden_variants 是负面口径，不参与互斥。
    const semantic = oracle['semantic_variants'];
    if (Array.isArray(semantic) && semantic.length > 0) {
      if (
        declared(oracle['contains']).length > 0 ||
        declared(oracle['contains_regex']).length > 0
      ) {
        issues.push(
          err(
            'ORACLE_SEMANTIC_EXCLUSIVE',
            'semantic_variants 与 contains / contains_regex 互斥（禁止同一断言两套正面口径）',
            file,
            `${base}/semantic_variants`,
          ),
        );
      }
    }
  }
  return issues;
}

/** Case 逻辑身份校验（*.case.json）。 */
export function validateCaseV2(asset: LoadedAsset<Case>): Issue[] {
  const file = asset.relPath;
  return validateAgainstSchema('case', asset.doc, file);
}

/** CaseRevision 不可变修订校验（*.case-revision.json）。 */
export function validateCaseRevision(asset: LoadedAsset<CaseRevision>): Issue[] {
  const file = asset.relPath;
  const issues = validateAgainstSchema('case-revision', asset.doc, file);
  if (issues.length > 0) return issues;

  const doc = asset.doc;
  const expected = revisionDigest(doc);
  if (doc.content_hash !== expected) {
    issues.push(
      err(
        'REVISION_HASH_MISMATCH',
        `content_hash 与重算不一致：声明 ${doc.content_hash}，重算 ${expected}`,
        file,
        '/content_hash',
      ),
    );
  }
  issues.push(...validateOracleRegexes(doc, file));
  return issues;
}

/** DatasetRelease 冻结闭包校验（*.dataset-release.json）。 */
export function validateDatasetRelease(
  asset: LoadedAsset<DatasetRelease>,
  revisionIndex: Map<string, CaseRevision>,
): Issue[] {
  const file = asset.relPath;
  const issues = validateAgainstSchema('dataset-release', asset.doc, file);
  if (issues.length > 0) return issues;

  const doc = asset.doc;
  for (const ref of doc.case_revisions) {
    const rev = revisionIndex.get(ref.case_revision_id);
    if (rev === undefined) {
      issues.push(
        err(
          'DATASET_REVISION_MISSING',
          `引用了不存在的修订 "${ref.case_revision_id}"`,
          file,
          '/case_revisions',
        ),
      );
      continue;
    }
    if (ref.content_hash !== rev.content_hash) {
      issues.push(
        err(
          'DATASET_HASH_MISMATCH',
          `修订 ${ref.case_revision_id} 的 content_hash 与 dataset-release 引用不一致`,
          file,
          '/case_revisions',
        ),
      );
    }
  }
  // closure_hash 必须等于引用列表的规范哈希。
  // 此前该字段只在写入时计算（`item-new`），读取侧从不校验：
  // 手工编辑 `case_revisions` 后忘记重算，或写错哈希，门禁都拦不住，
  // 冻结闭包与声明值静默不一致。
  const expected = closureDigest(doc.case_revisions);
  if (doc.closure_hash !== expected) {
    issues.push(
      err(
        'DATASET_CLOSURE_HASH_MISMATCH',
        `closure_hash 与 case_revisions 不一致（期望 ${expected}，实际 ${doc.closure_hash}）`,
        file,
        '/closure_hash',
      ),
    );
  }
  return issues;
}

/**
 * `Case.head_revision_id` 一致性校验。
 *
 * 三条硬约束（均为 error）：
 * 1. head 必须指向**真实存在**的 revision（悬空指针是最坏情形：控制台定位不到题面，
 *    评测按 dataset-release 仍能跑，两边看到的不是同一版题）。
 * 2. head 必须属于该题自身。
 * 3. head 必须指向该题**修订号最大**的 revision（同号取 ON，与录题约定一致）。
 *
 * 它是冗余指针，脚本直改 revision 时常被漏更（92 题曾停在 r4 而 r5/r6 已落盘），
 * 结果控制台展示旧题面、改题又从旧修订继承断言。
 */
function validateHeadRevisions(
  caseAssets: LoadedAsset<Case>[],
  revisionAssets: LoadedAsset<CaseRevision>[],
): Issue[] {
  const maxRevByCase = new Map<string, { id: string; n: number }>();
  const revisionIds = new Set<string>();
  for (const asset of revisionAssets) {
    const { case_id: caseId, case_revision_id: revId } = asset.doc;
    const n = Number(asset.doc.revision_number) || 0;
    revisionIds.add(revId);
    const prev = maxRevByCase.get(caseId);
    if (prev === undefined || n > prev.n || (n === prev.n && revId > prev.id)) {
      maxRevByCase.set(caseId, { id: revId, n });
    }
  }

  const issues: Issue[] = [];
  for (const asset of caseAssets) {
    const head = asset.doc.head_revision_id;
    if (head === undefined) continue;

    // 1) 悬空指针：必须独立报错，不能被「该题没有任何 revision」静默放过。
    if (!revisionIds.has(head)) {
      issues.push(
        err(
          'CASE_HEAD_REVISION_MISSING',
          `head_revision_id "${head}" 指向不存在的 revision`,
          asset.relPath,
          '/head_revision_id',
        ),
      );
      continue;
    }

    const maxRev = maxRevByCase.get(asset.doc.case_id);
    // 2) 指向别题的修订（存在但归属不符）。
    if (maxRev === undefined) {
      issues.push(
        err(
          'CASE_HEAD_REVISION_NOT_SELF',
          `head_revision_id "${head}" 不属于该题（该题没有任何 revision）`,
          asset.relPath,
          '/head_revision_id',
        ),
      );
      continue;
    }
    // 3) 陈旧指针。
    if (head !== maxRev.id) {
      issues.push(
        err(
          'CASE_HEAD_REVISION_STALE',
          `head_revision_id "${head}" 不是该题最新修订（应为 "${maxRev.id}"，r${maxRev.n}）`,
          asset.relPath,
          '/head_revision_id',
        ),
      );
    }
  }
  return issues;
}

/** EnvironmentProfile 环境配方校验（*.environment.json）。 */ export function validateEnvironment(
  asset: LoadedAsset<EnvironmentProfile>,
): Issue[] {
  const file = asset.relPath;
  return validateAgainstSchema('environment', asset.doc, file);
}

/** CandidateConfig 候选配置校验（*.candidate.json）。 */
export function validateCandidate(
  asset: LoadedAsset<CandidateConfig>,
  environmentNames: Set<string>,
): Issue[] {
  const file = asset.relPath;
  const issues = validateAgainstSchema('candidate', asset.doc, file);
  if (issues.length > 0) return issues;

  const doc = asset.doc;
  if (doc.environment_profile !== undefined && !environmentNames.has(doc.environment_profile)) {
    issues.push(
      err(
        'CANDIDATE_ENV_MISSING',
        `引用了不存在的 environment "${doc.environment_profile}"`,
        file,
        '/environment_profile',
      ),
    );
  }
  return issues;
}

/** cases-v1 资产校验（case/case-revision/dataset-release/environment/candidate）。 */
function validateCasesV1Assets(project: ExamProject): {
  caseReports: CaseReport[];
  projectIssues: Issue[];
} {
  const projectIssues: Issue[] = [];
  const caseReports: CaseReport[] = [];

  const caseAssets = loadCasesV2(project.dirs.cases, project.root);
  const revisionAssets = loadCaseRevisions(project.dirs.case_revisions, project.root);
  const revisionIndex = new Map<string, CaseRevision>();

  for (const asset of caseAssets) {
    projectIssues.push(...validateCaseV2(asset));
  }
  for (const asset of revisionAssets) {
    const issues = validateCaseRevision(asset);
    const report: CaseReport = { file: asset.path, relPath: asset.relPath, issues };
    report.caseId = asset.doc.case_id;
    report.rev = asset.doc.revision_number;
    if (issues.every((i) => i.level !== 'error')) {
      report.digest = asset.doc.content_hash;
      revisionIndex.set(asset.doc.case_revision_id, asset.doc);
    }
    caseReports.push(report);
  }
  for (const asset of loadDatasetReleases(project.dirs.dataset_releases, project.root)) {
    projectIssues.push(...validateDatasetRelease(asset, revisionIndex));
  }
  projectIssues.push(...validateHeadRevisions(caseAssets, revisionAssets));
  const environmentAssets = loadEnvironments(project.dirs.environments, project.root);
  const environmentNames = new Set(environmentAssets.map((a) => a.doc.environment_profile_id));
  for (const asset of environmentAssets) {
    projectIssues.push(...validateEnvironment(asset));
  }
  for (const asset of loadCandidates(project.dirs.candidates, project.root)) {
    projectIssues.push(...validateCandidate(asset, environmentNames));
  }

  return { caseReports, projectIssues };
}

export function validateProject(
  project: ExamProject,
  _options: { checkFixtures?: boolean } = {},
): ValidationReport {
  const protocolIssues: Issue[] = [
    ...checkProtocolCompatibility(project.manifest, project.manifestPath),
  ];

  const res = validateCasesV1Assets(project);
  const caseReports = res.caseReports;
  const assetIssues = res.projectIssues;

  const projectIssues = [...protocolIssues, ...assetIssues];
  const all = [...caseReports.flatMap((c) => c.issues), ...projectIssues];
  const report: ValidationReport = {
    caseReports,
    projectIssues,
    errorCount: all.filter((i) => i.level === 'error').length,
    warningCount: all.filter((i) => i.level === 'warning').length,
  };
  if (project.manifest.name !== undefined) report.projectName = project.manifest.name;
  return report;
}

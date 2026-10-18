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
import { revisionDigest } from './digest.ts';
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
  return issues;
}

/** EnvironmentProfile 环境配方校验（*.environment.json）。 */
export function validateEnvironment(asset: LoadedAsset<EnvironmentProfile>): Issue[] {
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

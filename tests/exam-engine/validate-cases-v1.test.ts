import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadCandidates,
  loadCaseRevisions,
  loadCasesV2,
  loadDatasetReleases,
  loadEnvironments,
} from '../../src/exam-engine/loader.ts';
import {
  validateCandidate,
  validateCaseRevision,
  validateCaseV2,
  validateDatasetRelease,
  validateEnvironment,
} from '../../src/exam-engine/validate.ts';
import type { CaseRevision } from '../../src/exam-engine/types.ts';

const projectRoot = join(process.cwd(), 'examples', 'product-eval');

describe('cases-v1 校验（阶段 6e）', () => {
  it('Case 逻辑身份通过 schema 校验', () => {
    const cases = loadCasesV2(join(projectRoot, 'cases'), projectRoot);
    expect(cases.length).toBeGreaterThan(0);
    for (const asset of cases) {
      expect(validateCaseV2(asset), asset.relPath).toEqual([]);
    }
  });

  it('CaseRevision 通过 schema + content_hash 校验', () => {
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    expect(revisions.length).toBeGreaterThan(0);
    for (const asset of revisions) {
      expect(validateCaseRevision(asset), asset.relPath).toEqual([]);
    }
  });

  it('CaseRevision 破坏 content_hash 报 REVISION_HASH_MISMATCH', () => {
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    const first = revisions[0]!;
    const broken = {
      ...first,
      doc: { ...first.doc, content_hash: 'deadbeef' } as CaseRevision,
    };
    const codes = validateCaseRevision(broken).map((i) => i.code);
    expect(codes).toContain('REVISION_HASH_MISMATCH');
  });

  it('DatasetRelease 通过 schema + 交叉引用 + hash 校验', () => {
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    const revisionIndex = new Map(revisions.map((r) => [r.doc.case_revision_id, r.doc]));
    const releases = loadDatasetReleases(join(projectRoot, 'dataset-releases'), projectRoot);
    expect(releases.length).toBeGreaterThan(0);
    for (const asset of releases) {
      expect(validateDatasetRelease(asset, revisionIndex), asset.relPath).toEqual([]);
    }
  });

  it('DatasetRelease 引用不存在的修订报 DATASET_REVISION_MISSING', () => {
    const releases = loadDatasetReleases(join(projectRoot, 'dataset-releases'), projectRoot);
    const first = releases[0]!;
    const broken = {
      ...first,
      doc: {
        ...first.doc,
        case_revisions: [{ case_id: 'x', case_revision_id: '不存在.r1', content_hash: 'h' }],
      },
    };
    const codes = validateDatasetRelease(broken, new Map()).map((i) => i.code);
    expect(codes).toContain('DATASET_REVISION_MISSING');
  });

  it('Environment 通过 schema 校验', () => {
    const envs = loadEnvironments(join(projectRoot, 'environments'), projectRoot);
    expect(envs.length).toBeGreaterThan(0);
    for (const asset of envs) {
      expect(validateEnvironment(asset), asset.relPath).toEqual([]);
    }
  });

  it('Candidate 通过 schema + environment 交叉引用校验', () => {
    const candidates = loadCandidates(join(projectRoot, 'candidates'), projectRoot);
    const envs = loadEnvironments(join(projectRoot, 'environments'), projectRoot);
    const envNames = new Set(envs.map((e) => e.doc.environment_profile_id));
    expect(candidates.length).toBeGreaterThan(0);
    for (const asset of candidates) {
      expect(validateCandidate(asset, envNames), asset.relPath).toEqual([]);
    }
  });

  it('Candidate 引用不存在的 environment 报 CANDIDATE_ENV_MISSING', () => {
    const candidates = loadCandidates(join(projectRoot, 'candidates'), projectRoot);
    const first = candidates[0]!;
    const broken = {
      ...first,
      doc: { ...first.doc, environment_profile: '不存在' },
    };
    const codes = validateCandidate(broken, new Set()).map((i) => i.code);
    expect(codes).toContain('CANDIDATE_ENV_MISSING');
  });
});

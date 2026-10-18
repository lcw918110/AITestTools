import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { validateProject } from '../../src/exam-engine/validate.ts';

const demoProject = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));
const brokenProject = fileURLToPath(new URL('../fixtures/broken-project', import.meta.url));

describe('示例考卷库（cases-v1）', () => {
  it('全部通过，且考材齐全', () => {
    const report = validateProject(loadProject(demoProject), { checkFixtures: true });
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.caseReports.length).toBeGreaterThanOrEqual(3);
  });

  it('每条通过的修订都产出 content_hash（digest）', () => {
    const report = validateProject(loadProject(demoProject));
    expect(report.caseReports.every((c) => typeof c.digest === 'string')).toBe(true);
  });
});

describe('交叉引用与门禁规则（cases-v1）', () => {
  const report = validateProject(loadProject(brokenProject));
  const codes = [...report.caseReports.flatMap((c) => c.issues), ...report.projectIssues].map(
    (i) => i.code,
  );

  it('content_hash 与重算不一致被拦下', () => {
    expect(codes).toContain('REVISION_HASH_MISMATCH');
  });

  it('dataset-release 引用不存在的修订被拦下', () => {
    expect(codes).toContain('DATASET_REVISION_MISSING');
  });

  it('candidate 引用不存在的 environment 被拦下', () => {
    expect(codes).toContain('CANDIDATE_ENV_MISSING');
  });
});

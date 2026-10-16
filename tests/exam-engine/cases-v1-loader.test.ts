import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  loadCasesV2,
  loadCaseRevisions,
  loadDatasetReleases,
  loadEnvironments,
  loadCandidates,
  revisionDigest,
} from '../../src/exam-engine/index.ts';

const projectRoot = join(process.cwd(), 'examples/product-eval');

describe('cases-v1 加载器（阶段 3）', () => {
  it('加载 159 个 Case 逻辑身份', () => {
    const cases = loadCasesV2(join(projectRoot, 'cases'), projectRoot);
    expect(cases.length).toBe(159);
    // 每个 case 都有 case_id 和 pair_key
    for (const c of cases) {
      expect(c.doc.case_id).toBeTruthy();
      expect(c.doc.lifecycle).toBeTruthy();
    }
  });

  it('加载 318 个 CaseRevision（OFF/ON 拆两修订）', () => {
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    expect(revisions.length).toBe(318);
    // OFF/ON 各 159
    const off = revisions.filter((r) => r.doc.case_revision_id.endsWith('.off'));
    const on = revisions.filter((r) => r.doc.case_revision_id.endsWith('.on'));
    expect(off.length).toBe(159);
    expect(on.length).toBe(159);
  });

  it('加载 13 个 DatasetRelease 冻结闭包', () => {
    const datasets = loadDatasetReleases(join(projectRoot, 'dataset-releases'), projectRoot);
    expect(datasets.length).toBe(13);
    for (const d of datasets) {
      expect(d.doc.closure_hash).toBeTruthy();
      expect(d.doc.case_revisions.length).toBeGreaterThan(0);
    }
  });

  it('加载 4 个 Environment + 4 个 Candidate', () => {
    const envs = loadEnvironments(join(projectRoot, 'environments'), projectRoot);
    const candidates = loadCandidates(join(projectRoot, 'candidates'), projectRoot);
    expect(envs.length).toBe(4);
    expect(candidates.length).toBe(4);
  });
});

describe('revisionDigest（cases-v1 内容摘要）', () => {
  it('与迁移脚本产出的 content_hash 一致', () => {
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    // 抽查 3 个 revision，验证 digest 与 content_hash 一致
    const samples = [
      'paired-task-22.r2.off',
      'paired-task-22.r3.on',
      'paired-task-157.r1.off',
    ];
    for (const id of samples) {
      const rev = revisions.find((r) => r.doc.case_revision_id === id);
      expect(rev, `应存在 ${id}`).toBeTruthy();
      if (rev) {
        expect(revisionDigest(rev.doc)).toBe(rev.doc.content_hash);
      }
    }
  });

  it('改判定条件会改变 digest', () => {
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    const rev = revisions.find((r) => r.doc.case_revision_id === 'paired-task-22.r2.off')!;
    const changed = {
      ...rev.doc,
      expect: { oracles: [{ type: 'no_event', names: ['X'] }] },
    };
    expect(revisionDigest(changed)).not.toBe(revisionDigest(rev.doc));
  });
});

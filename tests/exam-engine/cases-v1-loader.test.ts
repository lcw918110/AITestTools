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
  it('加载全部 Case 逻辑身份', () => {
    const cases = loadCasesV2(join(projectRoot, 'cases'), projectRoot);
    // 下限锁死题库规模：加载器漏读大量 case 时必须失败，不能只判 > 0。
    expect(cases.length).toBeGreaterThanOrEqual(160);
    // 每个 case 都有 case_id 和 pair_key
    for (const c of cases) {
      expect(c.doc.case_id).toBeTruthy();
      expect(c.doc.lifecycle).toBeTruthy();
    }
  });

  it('加载全部 CaseRevision（OFF/ON 拆两修订）', () => {
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    const off = revisions.filter((r) => r.doc.case_revision_id.endsWith('.off'));
    const on = revisions.filter((r) => r.doc.case_revision_id.endsWith('.on'));
    // 结构约束：每个修订必属 OFF 或 ON 之一，且两侧都有题；
    // 下限而非精确值，避免新增题时被迫改测试，同时防止加载器漏读。
    expect(off.length).toBeGreaterThanOrEqual(160);
    expect(on.length).toBeGreaterThanOrEqual(161);
    expect(revisions.length).toBe(off.length + on.length);
  });

  it('加载全部 DatasetRelease 冻结闭包', () => {
    const datasets = loadDatasetReleases(join(projectRoot, 'dataset-releases'), projectRoot);
    // 下限锁死规模：加载器漏读数据集时必须失败，不锁精确条数以免新增数据集被迫改测试。
    // 2026-11-04：新增 paired-delegation-smoke 后实际 14 个，下限同步抬到 14。
    expect(datasets.length).toBeGreaterThanOrEqual(14);
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
  it('与迁移脚本产出的 content_hash 全量一致', () => {
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    expect(revisions.length).toBeGreaterThan(0);
    for (const rev of revisions) {
      expect(revisionDigest(rev.doc), `${rev.doc.case_revision_id} 应 digest 一致`).toBe(
        rev.doc.content_hash,
      );
    }
  });

  it('改判定条件会改变 digest', () => {
    const revisions = loadCaseRevisions(join(projectRoot, 'case-revisions'), projectRoot);
    const rev = revisions.find((r) => r.doc.case_revision_id === 'paired-task-22.r2.off')!;
    const changed = {
      ...rev.doc,
      expect: { oracles: [{ type: 'no_event' as const, names: ['X'] }] },
    };
    expect(revisionDigest(changed)).not.toBe(revisionDigest(rev.doc));
  });
});

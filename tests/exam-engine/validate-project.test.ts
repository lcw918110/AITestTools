import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { validateProject } from '../../src/exam-engine/validate.ts';

const demoProject = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));
const brokenProject = fileURLToPath(new URL('../fixtures/broken-project', import.meta.url));

describe('示例考卷库', () => {
  it('全部通过，且考材齐全', () => {
    const report = validateProject(loadProject(demoProject), { checkFixtures: true });
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.items.length).toBeGreaterThanOrEqual(3);
  });

  it('每条通过的试题都产出语义 digest', () => {
    const report = validateProject(loadProject(demoProject));
    expect(report.items.every((c) => typeof c.digest === 'string')).toBe(true);
  });
});

describe('交叉引用与门禁规则', () => {
  const report = validateProject(loadProject(brokenProject));
  const codes = [...report.items.flatMap((c) => c.issues), ...report.projectIssues].map(
    (i) => i.code,
  );

  it('重复试题号被拦下', () => {
    expect(codes).toContain('ITEM_ID_DUPLICATE');
  });

  it('paperset 引用不存在的试题与考场被拦下', () => {
    expect(codes).toContain('PAPERSET_ITEM_MISSING');
    expect(codes).toContain('PAPERSET_ROOM_MISSING');
  });

  it('hosted 指标不允许配置为门禁（PRD §5.2 硬约束）', () => {
    expect(codes).toContain('GATE_NOT_ALLOWED');
  });

  it('目录外的门禁指标给警告', () => {
    expect(codes).toContain('GATE_UNKNOWN_METRIC');
  });

  it('需要网络的试题挂到无网考场下被拦下', () => {
    expect(codes).toContain('PAPERSET_NETWORK_CONFLICT');
  });

  it('密钥必须只走环境变量', () => {
    expect(codes).toContain('ROOM_SECRET_INLINE');
  });
});

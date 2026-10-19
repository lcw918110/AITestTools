import { describe, expect, it } from 'vitest';
import { computeHealthOk } from '../../apps/console/controllers/health.ts';

describe('computeHealthOk（综合健康检查 ok 聚合）', () => {
  const allGreen = {
    bankOk: true,
    projectErrorCount: 0,
    unverifiedModelCount: 0,
    unverifiedAgentCount: 0,
    datasetErrorCount: 0,
  };

  it('全绿 → ok=true', () => {
    expect(computeHealthOk(allGreen)).toBe(true);
  });

  it('题库校验失败 → ok=false', () => {
    expect(computeHealthOk({ ...allGreen, bankOk: false })).toBe(false);
  });

  it('项目 manifest 有错误 → ok=false', () => {
    expect(computeHealthOk({ ...allGreen, projectErrorCount: 1 })).toBe(false);
  });

  it('存在未验证模型 → ok=false', () => {
    expect(computeHealthOk({ ...allGreen, unverifiedModelCount: 1 })).toBe(false);
  });

  it('存在未验证 agent → ok=false', () => {
    expect(computeHealthOk({ ...allGreen, unverifiedAgentCount: 2 })).toBe(false);
  });

  it('数据集有错误/缺失/不可读 → ok=false', () => {
    expect(computeHealthOk({ ...allGreen, datasetErrorCount: 3 })).toBe(false);
  });

  it('多项同时异常 → ok=false（单一 false 即整体 false）', () => {
    expect(
      computeHealthOk({
        ...allGreen,
        bankOk: false,
        unverifiedModelCount: 1,
        datasetErrorCount: 1,
      }),
    ).toBe(false);
  });
});

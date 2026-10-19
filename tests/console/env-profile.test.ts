import { describe, expect, it } from 'vitest';

/**
 * 运行环境 Profile 管理 UI（第 1 期）：lifecycle 流转校验 + 复现清单采集。
 */
describe('运行环境 Profile 生命周期（第 1 期）', () => {
  it('assertProfileLifecycleTransition 线性前进', async () => {
    const { assertProfileLifecycleTransition } = await import('../../apps/console/env-profile.ts');
    expect(assertProfileLifecycleTransition('draft', 'active')).toBeUndefined();
    expect(assertProfileLifecycleTransition('active', 'deprecated')).toBeUndefined();
    expect(assertProfileLifecycleTransition('draft', 'deprecated')).toBeDefined(); // 禁止跳步
    expect(assertProfileLifecycleTransition('deprecated', 'active')).toBeDefined(); // 终态不可回退
    expect(assertProfileLifecycleTransition('active', 'draft')).toBeDefined(); // 不可回退
    expect(assertProfileLifecycleTransition('draft', 'unknown')).toBeDefined();
    expect(assertProfileLifecycleTransition('active', 'active')).toBeDefined(); // 无需流转
  });

  it('collectReproManifest 采集 git/node/os/lockfile', async () => {
    const { collectReproManifest } = await import('../../apps/console/env-profile.ts');
    const m = await collectReproManifest();
    expect(m.worktreeDirty).toBeTypeOf('boolean');
    expect(m.nodeVersion).toMatch(/^v\d+/);
    expect(m.osPlatform).toBeDefined();
    expect(m.osArch).toBeDefined();
    // gitCommit / lockfileSummary 依赖仓库环境，可能为 undefined（采集失败不伪造）。
    if (m.gitCommit !== undefined) expect(m.gitCommit).toMatch(/^[0-9a-f]{7,40}$/);
    if (m.lockfileSummary !== undefined) expect(m.lockfileSummary).toContain('依赖');
  });
});

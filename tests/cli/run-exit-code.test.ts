import { describe, expect, it } from 'vitest';
import { resolveRunExitCode } from '../../src/cli/commands/run.ts';

/**
 * run 退出码优先级。
 *
 * 核心不变量：**真实失败不能被「没测过」掩盖**。否则「9 过 1 挂 + 1 条未评测」
 * 会被报成中性的 3，CI 里按 `code === 1` 判回归的告警链路就断了。
 */
describe('run 退出码优先级', () => {
  it('全部评测且通过 → 0', () => {
    expect(
      resolveRunExitCode({ passed: true, missing_result_items: 0, not_evaluated_items: 0 }),
    ).toBe(0);
  });

  it('有真实失败 + 有未评测 → 仍然是 1，不能被掩盖', () => {
    expect(
      resolveRunExitCode({ passed: false, missing_result_items: 0, not_evaluated_items: 1 }),
    ).toBe(1);
    expect(
      resolveRunExitCode({ passed: false, missing_result_items: 1, not_evaluated_items: 2 }),
    ).toBe(1);
  });

  it('全部通过但有题漏跑 → 4（异常，需查部署）', () => {
    expect(
      resolveRunExitCode({ passed: true, missing_result_items: 1, not_evaluated_items: 1 }),
    ).toBe(4);
  });

  it('全部通过但有题未评测 → 3（形态能力缺失，预期内）', () => {
    expect(
      resolveRunExitCode({ passed: true, missing_result_items: 0, not_evaluated_items: 2 }),
    ).toBe(3);
  });
});

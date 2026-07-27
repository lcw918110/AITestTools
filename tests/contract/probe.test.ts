import { describe, expect, it } from 'vitest';
import { loadBundledContract } from '../../src/contract/load.ts';
import { probeFakeHostHooks, runHookProbes } from '../../src/contract/probe.ts';

describe('hook probes', () => {
  it('FakeHost 可触发契约全部 hook 且拒契约外', () => {
    const contract = loadBundledContract('opencode-v1.18');
    const cases = probeFakeHostHooks(contract);
    expect(cases.every((c) => c.pass)).toBe(true);
  });

  it('本机 opencode 二进制含契约 hook（若 PATH 有 opencode）', () => {
    const which = process.env.PATH;
    expect(which).toBeTruthy();
    const contract = loadBundledContract('opencode-v1.18');
    // 不强制本机有二进制：若无 path 只测 fakehost
    const report = runHookProbes({ contract });
    expect(report.pass).toBe(true);
  });
});

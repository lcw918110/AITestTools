import { describe, expect, it, beforeEach } from 'vitest';
import {
  REQUIRED_ISOLATION_PROOFS,
  evaluateIsolationGate,
  findIsolationBackend,
  listIsolationBackends,
  resetIsolationGateCache,
  type IsolationProbeEvidence,
  type IsolationRuntime,
} from '../../src/security/isolation-backend.ts';

function runtime(input: {
  platform: NodeJS.Platform;
  errors?: string[];
  evidence?: IsolationProbeEvidence[];
}): IsolationRuntime {
  return {
    platform: input.platform,
    checkDependencies: async () => ({ errors: input.errors ?? [] }),
    probe: async () => input.evidence ?? [],
  };
}

function passedEvidence(): IsolationProbeEvidence[] {
  return REQUIRED_ISOLATION_PROOFS.map((proof) => ({
    proof,
    passed: true,
    detail: '测试桩通过',
  }));
}

describe('隔离后端失败关闭', () => {
  beforeEach(() => {
    resetIsolationGateCache();
  });

  it('只登记 sandbox-runtime，Windows 能力为空', () => {
    const rows = listIsolationBackends();
    expect(new Set(rows.map((row) => row.backend_id))).toEqual(new Set(['sandbox-runtime']));
    expect(findIsolationBackend('win32')?.capabilities).toEqual([]);
    expect(findIsolationBackend('darwin')?.capabilities).toEqual([...REQUIRED_ISOLATION_PROOFS]);
  });

  it('依赖缺失时拒绝，且不把驱动标签当隔离证明', async () => {
    const gate = await evaluateIsolationGate(
      runtime({ platform: 'darwin', errors: ['缺少 Seatbelt 可执行文件'] }),
    );
    expect(gate.allowed).toBe(false);
    expect(gate.status).toBe('blocked');
    expect(gate.reason).toContain('缺少 Seatbelt 可执行文件');
  });

  it('探测缺一项时拒绝，不能用其余三项补齐', async () => {
    const evidence = passedEvidence().map((item) =>
      item.proof === 'egress_denied' ? { ...item, passed: false, detail: '出站未被拒绝' } : item,
    );
    const gate = await evaluateIsolationGate(runtime({ platform: 'darwin', evidence }));
    expect(gate.allowed).toBe(false);
    expect(gate.missing).toEqual(['egress_denied']);
  });

  it('同一证明出现重复项且其中一条失败时拒绝，不因另一条通过而放行', async () => {
    // 失败关闭：任一来源对同一 proof 报 failed，就说明该能力未被稳定证明。
    // 若实现用 `some(passed)` 判定，重复项会让失败被通过项掩盖（fail-open）。
    const evidence: IsolationProbeEvidence[] = [
      ...passedEvidence(),
      { proof: 'credential_read_denied', passed: false, detail: '复测时凭据可读' },
    ];
    const gate = await evaluateIsolationGate(runtime({ platform: 'darwin', evidence }));
    expect(gate.allowed).toBe(false);
    expect(gate.missing).toEqual(['credential_read_denied']);
  });

  it('失败项在前、通过项在后时仍拒绝，不取「最后一条」为准', async () => {
    // 上一条用例把失败项追加在末尾，`last-wins` 实现恰好也能通过它。
    // 这条把失败项放在最前，专门杀死「以最后一条为准」这一 fail-open 变体。
    const evidence: IsolationProbeEvidence[] = [
      { proof: 'credential_read_denied', passed: false, detail: '首次探测凭据可读' },
      ...passedEvidence(),
    ];
    const gate = await evaluateIsolationGate(runtime({ platform: 'darwin', evidence }));
    expect(gate.allowed).toBe(false);
    expect(gate.missing).toEqual(['credential_read_denied']);
  });

  it('通过项在前、失败项居中、通过项在后时仍拒绝', async () => {
    // 同时杀死 first-wins 与 last-wins 两种实现。
    const evidence: IsolationProbeEvidence[] = [
      ...passedEvidence(),
      { proof: 'egress_denied', passed: false, detail: '中途复测出站放行' },
      { proof: 'egress_denied', passed: true, detail: '末次复测又拒绝' },
    ];
    const gate = await evaluateIsolationGate(runtime({ platform: 'darwin', evidence }));
    expect(gate.allowed).toBe(false);
    expect(gate.missing).toEqual(['egress_denied']);
  });

  it('证明项重复且全部通过时仍放行，不因重复本身误判', async () => {
    const evidence: IsolationProbeEvidence[] = [
      ...passedEvidence(),
      { proof: 'egress_denied', passed: true, detail: '复测仍拒绝' },
    ];
    const gate = await evaluateIsolationGate(runtime({ platform: 'darwin', evidence }));
    expect(gate.allowed).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it('Windows 探测未通过时保持降级并拒绝', async () => {
    const gate = await evaluateIsolationGate(runtime({ platform: 'win32' }));
    expect(gate.allowed).toBe(false);
    expect(gate.status).toBe('degraded');
    expect(gate.reason).toContain('Windows');
  });

  it('未注册的操作系统拒绝，不降级到更弱后端', async () => {
    const gate = await evaluateIsolationGate(
      runtime({ platform: 'aix', evidence: passedEvidence() }),
    );
    expect(gate.allowed).toBe(false);
    expect(gate.missing).toContain('已注册的隔离后端');
  });

  it('探测抛错时拒绝，不把异常冒泡成未处理失败', async () => {
    const gate = await evaluateIsolationGate({
      platform: 'darwin',
      checkDependencies: async () => ({ errors: [] }),
      probe: async () => {
        throw new Error('listen EPERM');
      },
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('隔离探测未通过');
    expect(gate.missing[0]).toContain('listen EPERM');
  });

  it('四项本机探测都通过后才允许真实运行', async () => {
    const gate = await evaluateIsolationGate(
      runtime({ platform: 'linux', evidence: passedEvidence() }),
    );
    expect(gate.allowed).toBe(true);
    expect(gate.status).toBe('verified_supported');
    expect(gate.missing).toEqual([]);
  });
});

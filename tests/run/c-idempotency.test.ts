import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { CAdapter } from '../../src/run/c-runner.ts';
import { RunOrchestrator } from '../../src/run/run-orchestrator.ts';
import { resolveDatasetItems } from '../../src/cli/commands/run.ts';

const demo = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

async function runC(revision: unknown, environment: unknown, projectRoot: string) {
  const orch = new RunOrchestrator();
  orch.beginRun({});
  orch.transitionRun('preflight');
  orch.transitionRun('running');
  const { results } = await orch.executeCase(
    revision as never,
    environment as never,
    new CAdapter(),
    {
      projectRoot,
      models: [],
    },
  );
  return results[0]!;
}

/**
 * PRD 附录 C 指标 `c_idempotent_pass_rate`（幂等类通过率）：
 * 同一 C 轴用例跑两次必须产生相同的 pass / oracle_failures / metrics，
 * 即 runner 对同一输入的输出是确定性（deterministic）的。
 *
 * 本测试用 demo-project 的 C 轴 write 契约（shells/echo.mjs 的 write 模式），
 * 该壳将 message 写入 workspace/out.txt 后返回 { ok:true }；
 * oracle 链包含 exit_code、tool_side_effect、workspace_assert，
 * 全部由确定性 shell 行为驱动 → 两次跑的结果必须逐字节一致。
 */
describe('C axis idempotency (c_idempotent_pass_rate)', () => {
  it('同 write 契约跑两次产生相同的 oracle outcome', async () => {
    const project = loadProject(demo);
    const { cases, environment } = resolveDatasetItems(project, 'smoke-c-write', 'shell-echo-v1');
    const runCase = cases.find((c) => c.revision.case_id === 'demo-c-write-01')!;

    const run1 = await runC(runCase.revision, environment, project.root);
    const run2 = await runC(runCase.revision, environment, project.root);

    // 两次跑都必须 pass（PRD 建议门禁 c_idempotent_pass_rate = 1.0）
    expect(run1.pass).toBe(true);
    expect(run2.pass).toBe(true);
    expect(run1.pass).toBe(run2.pass);

    // oracle_failures 必须一致（同为 []）
    expect(run1.oracle_failures).toEqual(run2.oracle_failures);

    // metrics 必须一致（含 c_contract_pass_rate）
    expect(run1.metrics).toEqual(run2.metrics);
    expect(run1.metrics.c_contract_pass_rate).toBe(1);

    // attribution 必须一致（两次都 pass → 均为 undefined）
    expect(run1.attribution).toBeUndefined();
    expect(run2.attribution).toBeUndefined();
  });
});

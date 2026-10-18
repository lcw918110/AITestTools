import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { resolveDatasetItems } from '../../src/cli/commands/run.ts';

const projectRoot = join(process.cwd(), 'examples', 'product-eval');

describe('run.ts cases-v1 数据源（阶段 4a）', () => {
  it('resolveDatasetItems 还原 dataset-release × environment 为 RunCaseInput[] + EnvironmentProfile', () => {
    const project = loadProject(projectRoot);
    const { cases, environment } = resolveDatasetItems(project, 'eval-agent', 'hosted-plain-v1');

    // eval-agent 有 156 个 case_revision
    expect(cases.length).toBe(156);
    // 每个 case 都是 CaseRevision（case_revision_id 形如 paired-task-NN.rN[.off|.on]）
    for (const c of cases) {
      expect(c.revision.case_revision_id).toMatch(/^[a-z0-9-]+\.r\d+(\.(off|on))?$/);
    }
    // environment 还原为 hosted
    expect(environment.recipe.kind).toBe('hosted');
    expect(environment.recipe.host_command).toBe('opencode');
  });

  it('resolveDatasetItems 还原 OFF/ON 配对（跨 dataset-release，pair_key 一致）', () => {
    const project = loadProject(projectRoot);
    const off = resolveDatasetItems(project, 'paired-off', 'hosted-plain-v1');
    const on = resolveDatasetItems(project, 'paired-on', 'hosted-plugin-v1');

    // paired-off / paired-on 各 156 个
    expect(off.cases.length).toBe(156);
    expect(on.cases.length).toBe(156);

    // 找 paired-task-22 的 OFF/ON（跨 release）
    const offCase = off.cases.find(
      (c) =>
        c.revision.case_id === 'paired-task-22' && c.revision.case_revision_id.endsWith('.off'),
    );
    const onCase = on.cases.find(
      (c) => c.revision.case_id === 'paired-task-22' && c.revision.case_revision_id.endsWith('.on'),
    );
    expect(offCase).toBeTruthy();
    expect(onCase).toBeTruthy();
    if (offCase && onCase) {
      // 同一 pair_key（effect_pair 一致）
      expect(offCase.pairKey).toBe(onCase.pairKey);
    }
  });

  it('resolveDatasetItems 找不到 dataset 时抛错', () => {
    const project = loadProject(projectRoot);
    expect(() => resolveDatasetItems(project, '不存在', 'hosted-plain-v1')).toThrow(
      '找不到 dataset-release',
    );
  });

  it('resolveDatasetItems 找不到 environment 时抛错', () => {
    const project = loadProject(projectRoot);
    expect(() => resolveDatasetItems(project, 'eval-agent', '不存在')).toThrow(
      '找不到 environment',
    );
  });
});

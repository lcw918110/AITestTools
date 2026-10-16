import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { resolveDatasetItems } from '../../src/cli/commands/run.ts';

const projectRoot = join(process.cwd(), 'examples', 'product-eval');

describe('run.ts cases-v1 数据源切换（阶段 4a）', () => {
  it('resolveDatasetItems 还原 dataset-release × environment 为 ItemDoc[] + RoomDoc', () => {
    const project = loadProject(projectRoot);
    const { items, room } = resolveDatasetItems(project, 'eval-agent', 'hosted-plain-v1');

    // eval-agent 有 156 个 case_revision
    expect(items.length).toBe(156);
    // 每个 item 都是 V1 格式 id（EVAL-B-PAIRED-TASK[-NN]-(OFF|ON)）
    for (const item of items) {
      expect(item.id).toMatch(/^EVAL-B-PAIRED-TASK(-\d+)?-(OFF|ON)$/);
    }
    // room 还原为 hosted
    expect(room.kind).toBe('hosted');
    expect(room.host?.command).toBe('opencode');
  });

  it('resolveDatasetItems 还原 OFF/ON 配对（跨 dataset-release，effect_pair 一致）', () => {
    const project = loadProject(projectRoot);
    const off = resolveDatasetItems(project, 'paired-off', 'hosted-plain-v1');
    const on = resolveDatasetItems(project, 'paired-on', 'hosted-plugin-v1');

    // paired-off / paired-on 各 156 个
    expect(off.items.length).toBe(156);
    expect(on.items.length).toBe(156);

    // 找 paired-task-22 的 OFF/ON（跨 release）
    const offItem = off.items.find((i) => i.id === 'EVAL-B-PAIRED-TASK-22-OFF');
    const onItem = on.items.find((i) => i.id === 'EVAL-B-PAIRED-TASK-22-ON');
    expect(offItem).toBeTruthy();
    expect(onItem).toBeTruthy();
    if (offItem && onItem) {
      // 同一 pair_key（effect_pair 一致）
      expect(offItem.intent.effect_pair).toBe(onItem.intent.effect_pair);
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

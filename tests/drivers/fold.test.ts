import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/exam-engine/project.ts';
import { runL1Item } from '../../src/run/l1-runner.ts';
import { resolveDatasetItems } from '../../src/cli/commands/run.ts';
import type { FreezeA } from '../../src/exam-engine/types.ts';

const demo = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

describe('L1 fold runner', () => {
  it('DEMO-A-TODO-FOLD-01 通过', async () => {
    const project = loadProject(demo);
    const { items, room } = resolveDatasetItems(project, 'smoke-a-l1', 'fold-v1');
    const item = items.find((i) => i.id === 'DEMO-A-TODO-FOLD-01')!;
    expect((item.freeze as FreezeA).layer).toBe('L1');
    const result = await runL1Item({ item, room, projectRoot: project.root });
    expect(result.pass).toBe(true);
    expect(result.fold_state).toMatchObject({ ignored_events: 1 });
  });

  it('改坏期望则 PROTOCOL', async () => {
    const project = loadProject(demo);
    const { items, room } = resolveDatasetItems(project, 'smoke-a-l1', 'fold-v1');
    const item = structuredClone(items.find((i) => i.id === 'DEMO-A-TODO-FOLD-01')!);
    // 指向不存在的期望文件 → HARNESS；改用错误 oracle 断言
    item.expect.oracles = [{ type: 'state_predicate', id: 'bad', expr: 'ignored_events == 99' }];
    const result = await runL1Item({ item, room, projectRoot: project.root });
    expect(result.pass).toBe(false);
    expect(result.attribution).toBe('PROTOCOL');
  });
});

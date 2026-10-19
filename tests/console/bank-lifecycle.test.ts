import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertLifecycleTransition,
  createTask,
  getTask,
  transitionLifecycle,
} from '../../apps/console/bank.ts';
import { resolveRubricFromCaseRevision } from '../../src/judge/resolve-rubric.ts';

/**
 * 第 1 期录题界面化：生命周期状态机 + rubric 声明 + 分层（strata）。
 * 红测：证明当前缺口——lifecycle 写死 released、readiness 写死 design_ready、
 * expect 无 rubric、无 strata、无流转校验。
 */
function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-bank-lc-'));
  mkdirSync(join(root, 'bank/materials'), { recursive: true });
  mkdirSync(join(root, 'cases'), { recursive: true });
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  mkdirSync(join(root, 'dataset-releases'), { recursive: true });
  for (const name of ['paired-off-calibrate', 'paired-on-calibrate']) {
    writeFileSync(
      join(root, 'dataset-releases', `${name}.dataset-release.json`),
      `${JSON.stringify(
        {
          dataset_release_id: name,
          name,
          case_revisions: [],
          closure_hash: 'empty',
          created_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  }
  return root;
}

const okValidate = async () => ({ exitCode: 0, ok: true, log: '1/1 试题通过' });

describe('生命周期状态机（第 1 期录题界面化）', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('create 默认 lifecycle=draft、automation_readiness=not_assessed（红：当前写死 released/design_ready）', async () => {
    root = seedProject();
    const created = await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(false);
    if ('error' in created) return;

    const caseDoc = JSON.parse(
      readFileSync(join(root, 'cases', 'paired-task-99.case.json'), 'utf8'),
    ) as { lifecycle: string; automation_readiness: string; lifecycle_history?: unknown[] };
    expect(caseDoc.lifecycle).toBe('draft');
    expect(caseDoc.automation_readiness).toBe('not_assessed');
    expect(Array.isArray(caseDoc.lifecycle_history)).toBe(true);
  });

  it('create 拒绝非法 lifecycle 状态（防非法值写入 case.json）', async () => {
    root = seedProject();
    const created = await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
        lifecycle: 'not-a-state',
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(true);
    if ('error' in created) {
      expect(created.error).toContain('非法生命周期状态');
    }
  });

  it('create 写入 expect.rubric 与 strata（红：当前不写 rubric/strata）', async () => {
    root = seedProject();
    const created = await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
        rubric: {
          dimensions: [
            { name: '正确性', scale: '0-5', weight: 0.6 },
            { name: '完整性', scale: '0-5', weight: 0.4 },
          ],
        },
        strata: { task_type: 'coding', difficulty_level: 'L2' },
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(false);
    if ('error' in created) return;

    const offRev = JSON.parse(
      readFileSync(
        join(root, 'case-revisions', 'paired-task-99.r1.off.case-revision.json'),
        'utf8',
      ),
    ) as { expect: { rubric?: { dimensions: unknown[] } }; strata?: unknown };
    expect(offRev.expect.rubric).toBeDefined();
    expect(offRev.expect.rubric?.dimensions).toHaveLength(2);
    expect(offRev.strata).toEqual({ task_type: 'coding', difficulty_level: 'L2' });

    // getTask 回显 rubric 与 strata
    const detail = getTask(root, 'PAIRED-TASK-99');
    if ('error' in detail) return;
    expect(detail.rubric?.dimensions).toHaveLength(2);
    expect(detail.strata).toEqual({ task_type: 'coding', difficulty_level: 'L2' });

    // 端到端：裁判体系 resolveRubricFromCaseRevision 能按 case_revision_id 读回 rubric
    const resolved = resolveRubricFromCaseRevision(root, 'paired-task-99.r1.off');
    expect(resolved).toBeDefined();
    expect(resolved?.dimensions).toHaveLength(2);
    expect(resolved?.dimensions[0]).toMatchObject({ name: '正确性', scale: '0-5', weight: 0.6 });
  });

  it('assertLifecycleTransition 线性前进 + 可回退 + released 保护（红：函数不存在）', () => {
    // 前进
    expect(assertLifecycleTransition('draft', 'candidate')).toBeUndefined();
    expect(assertLifecycleTransition('candidate', 'reviewed')).toBeUndefined();
    expect(assertLifecycleTransition('reviewed', 'validated')).toBeUndefined();
    expect(assertLifecycleTransition('validated', 'released')).toBeUndefined();
    expect(assertLifecycleTransition('released', 'deprecated')).toBeUndefined();
    // 回退（仅 candidate/reviewed/validated → draft）
    expect(assertLifecycleTransition('candidate', 'draft')).toBeUndefined();
    expect(assertLifecycleTransition('reviewed', 'draft')).toBeUndefined();
    expect(assertLifecycleTransition('validated', 'draft')).toBeUndefined();
    // 非法：跳步前进
    expect(assertLifecycleTransition('draft', 'released')).toBeDefined();
    expect(assertLifecycleTransition('draft', 'validated')).toBeDefined();
    // 非法：released 回退
    expect(assertLifecycleTransition('released', 'draft')).toBeDefined();
    expect(assertLifecycleTransition('released', 'validated')).toBeDefined();
    // 非法：deprecated 再流转
    expect(assertLifecycleTransition('deprecated', 'draft')).toBeDefined();
    // 非法：未知状态
    expect(assertLifecycleTransition('draft', 'unknown')).toBeDefined();
  });

  it('transitionLifecycle 推进并记录 lifecycle_history（红：函数不存在）', async () => {
    root = seedProject();
    await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );

    const r1 = await transitionLifecycle(root, 'PAIRED-TASK-99', 'candidate', '提交审核');
    expect('error' in r1).toBe(false);

    const caseDoc = JSON.parse(
      readFileSync(join(root, 'cases', 'paired-task-99.case.json'), 'utf8'),
    ) as {
      lifecycle: string;
      lifecycle_history: Array<{ from: string; to: string; reason: string }>;
    };
    expect(caseDoc.lifecycle).toBe('candidate');
    // 初始记录（draft→draft）+ 推进记录（draft→candidate）共 2 条
    expect(caseDoc.lifecycle_history).toHaveLength(2);
    expect(caseDoc.lifecycle_history[1]).toMatchObject({
      from: 'draft',
      to: 'candidate',
      reason: '提交审核',
    });

    // 非法流转应报错
    const r2 = await transitionLifecycle(root, 'PAIRED-TASK-99', 'released', '跳过审核');
    expect('error' in r2).toBe(true);

    // 同状态流转应报错（不写冗余 history）
    const r3 = await transitionLifecycle(root, 'PAIRED-TASK-99', 'candidate', '重复推进');
    expect('error' in r3).toBe(true);
  });

  it('strata 半填被后端拒绝（红：当前会落盘 undefined 字段）', async () => {
    root = seedProject();
    const created = await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
        strata: { task_type: 'coding', difficulty_level: '' } as never,
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(true);
    if ('error' in created) {
      expect(created.error).toContain('分层');
    }
  });
});

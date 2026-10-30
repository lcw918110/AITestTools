import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvalTaskRun,
  createEvalTask,
  freezeEvalTaskPurpose,
  deleteEvalTask,
  getEvalTask,
  listEvalTasks,
  updateEvalTask,
} from '../../apps/console/eval-tasks.ts';

describe('eval-tasks store', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('新建任务缺省用途必须拒绝，不能绕过页面约束', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    expect(createEvalTask(root, { kind: 'plugin' })).toMatchObject({ code: 400 });
    expect(createEvalTask(root, { kind: 'plugin', purpose: '' })).toMatchObject({ code: 400 });
  });

  it('create → list → update → append run → delete', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    const created = createEvalTask(root, {
      purpose: 'effect_comparison',
      name: '效果烟卷',
      kind: 'plugin',
      release: 'paired-off-effect-smoke',
      taskIds: ['PAIRED-TASK-157'],
      examMode: 'both',
    });
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.id).toMatch(/^et-[a-z0-9]+$/);
    expect(created.live).toBe(true);
    expect(created.examMode).toBe('both');
    expect(existsSync(join(root, 'eval-tasks', `${created.id}.json`))).toBe(true);

    const listed = listEvalTasks(root);
    expect(listed.tasks).toHaveLength(1);
    expect(listed.tasks[0]?.name).toBe('效果烟卷');

    const renamed = updateEvalTask(root, created.id, { name: '烟卷对照' });
    expect('error' in renamed).toBe(false);
    if ('error' in renamed) return;
    expect(renamed.name).toBe('烟卷对照');
    expect(renamed.runs).toEqual([]);

    const withRun = appendEvalTaskRun(root, created.id, {
      path: '/tmp/run-a',
      startedAt: '2026-09-08T00:00:00.000Z',
      jobId: 'job-1',
    });
    expect('error' in withRun).toBe(false);
    if ('error' in withRun) return;
    expect(withRun.runs).toHaveLength(1);

    const got = getEvalTask(root, created.id);
    expect('error' in got).toBe(false);
    if ('error' in got) return;
    expect(got.runs[0]?.jobId).toBe('job-1');

    const del = deleteEvalTask(root, created.id);
    expect(del).toEqual({ ok: true });
    expect(listEvalTasks(root).tasks).toEqual([]);
  });

  it('测模型忽略 examMode=both，存成 off', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    const created = createEvalTask(root, {
      purpose: 'acceptance',
      name: '测模型',
      kind: 'model',
      examMode: 'both',
    });
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.examMode).toBe('off');
    expect(created.release).toBe('paired-off');
    expect(created.testSetId).toBe('full');
  });

  it('可保存模型与 Agent 覆盖', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    const created = createEvalTask(root, {
      kind: 'plugin',
      purpose: 'regression',
      model: 'wave-ai/gpt-5.4-mini',
      agent: 'fast-coder',
    });
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.model).toBe('wave-ai/gpt-5.4-mini');
    expect(created.agent).toBe('fast-coder');
    const cleared = updateEvalTask(root, created.id, { agent: '' });
    expect('error' in cleared).toBe(false);
    if ('error' in cleared) return;
    expect(cleared.agent).toBeUndefined();
    expect(cleared.model).toBe('wave-ai/gpt-5.4-mini');
  });

  it('用途必须合法，保存后可读取，旧任务不猜用途', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    expect(createEvalTask(root, { kind: 'plugin', purpose: 'invalid' })).toMatchObject({
      code: 400,
    });
    const created = createEvalTask(root, {
      kind: 'plugin',
      purpose: 'effect_comparison',
    });
    expect(created).toMatchObject({ purpose: 'effect_comparison' });
    if ('error' in created) return;
    expect(getEvalTask(root, created.id)).toMatchObject({ purpose: 'effect_comparison' });
    const { purpose: _purpose, ...legacy } = created;
    mkdirSync(join(root, 'eval-tasks'), { recursive: true });
    writeFileSync(join(root, 'eval-tasks', `${created.id}.json`), JSON.stringify(legacy));
    const loaded = getEvalTask(root, created.id);
    expect(loaded).not.toHaveProperty('error');
    expect(loaded).not.toHaveProperty('purpose');
  });

  it('已有运行不能改用途，修改名称时保留用途', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    const created = createEvalTask(root, { kind: 'plugin', purpose: 'regression' });
    if ('error' in created) throw new Error(created.error);
    appendEvalTaskRun(root, created.id, {
      path: '/tmp/run-purpose',
      startedAt: '2026-10-23T00:00:00.000Z',
      jobId: 'job-purpose',
    });
    expect(updateEvalTask(root, created.id, { purpose: 'effect_comparison' })).toMatchObject({
      code: 400,
    });
    expect(updateEvalTask(root, created.id, { name: '回归任务' })).toMatchObject({
      purpose: 'regression',
    });
  });

  it('提交运行即冻结用途，不等待运行结束，历史未知用途同样冻结', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    for (const hasPurpose of [true, false]) {
      const created = createEvalTask(root, { kind: 'plugin', purpose: 'regression' });
      if ('error' in created) throw new Error(created.error);
      if (!hasPurpose) {
        const { purpose: _purpose, ...legacy } = created;
        writeFileSync(join(root, 'eval-tasks', `${created.id}.json`), JSON.stringify(legacy));
      }
      const frozen = freezeEvalTaskPurpose(root, created.id);
      expect(frozen).toMatchObject({ purposeLocked: true });
      expect(updateEvalTask(root, created.id, { purpose: 'diagnostic' })).toMatchObject({
        code: 400,
      });
      expect(updateEvalTask(root, created.id, { name: '运行中改名' })).toMatchObject({
        purposeLocked: true,
      });
    }
  });

  it('非法 id / 空 kind', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    expect(createEvalTask(root, { kind: 'nope', purpose: 'smoke' })).toMatchObject({ code: 400 });
    expect(getEvalTask(root, '../x')).toMatchObject({ code: 400 });
    expect(deleteEvalTask(root, 'et-missing')).toMatchObject({ code: 404 });
  });

  it('拒绝修改类型', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    const created = createEvalTask(root, {
      kind: 'plugin',
      purpose: 'regression',
      examMode: 'on',
    });
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    const switched = updateEvalTask(root, created.id, { kind: 'agent' });
    expect(switched).toMatchObject({ code: 400 });
    const same = updateEvalTask(root, created.id, { kind: 'plugin', name: '仍是万象术' });
    expect('error' in same).toBe(false);
    if ('error' in same) return;
    expect(same.kind).toBe('plugin');
    expect(same.name).toBe('仍是万象术');
  });
});

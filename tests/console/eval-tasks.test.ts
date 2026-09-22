import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvalTaskRun,
  createEvalTask,
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

  it('create → list → update → append run → delete', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    const created = createEvalTask(root, {
      name: '效果烟卷',
      kind: 'plugin',
      paperset: 'paired-off-effect-smoke',
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
      name: '测模型',
      kind: 'model',
      examMode: 'both',
    });
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.examMode).toBe('off');
    expect(created.paperset).toBe('paired-off');
    expect(created.testSetId).toBe('full');
  });

  it('可保存模型与 Agent 覆盖', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    const created = createEvalTask(root, {
      kind: 'plugin',
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

  it('非法 id / 空 kind', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    expect(createEvalTask(root, { kind: 'nope' })).toMatchObject({ code: 400 });
    expect(getEvalTask(root, '../x')).toMatchObject({ code: 400 });
    expect(deleteEvalTask(root, 'et-missing')).toMatchObject({ code: 404 });
  });

  it('拒绝修改类型', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-et-'));
    const created = createEvalTask(root, { kind: 'plugin', examMode: 'on' });
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

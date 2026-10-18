import { describe, expect, it } from 'vitest';
import {
  counterpartRelease,
  defaultExamMode,
  defaultRelease,
  resolveRunPlan,
  taskIdFromCaseRevisionId,
  taskIdFromItemId,
  taskIdsOfCaseRevisions,
  taskIdsOfItems,
} from '../../apps/console/run-plan.ts';

const releases = [
  {
    name: 'paired-off',
    case_revisions: ['paired-task-02.r6.off', 'paired-task-157.r2.off'],
    taskIds: ['PAIRED-TASK-02', 'PAIRED-TASK-157'],
  },
  {
    name: 'paired-on',
    case_revisions: ['paired-task-02.r7.on', 'paired-task-157.r3.on'],
    taskIds: ['PAIRED-TASK-02', 'PAIRED-TASK-157'],
  },
  {
    name: 'paired-off-effect-smoke',
    case_revisions: ['paired-task-157.r2.off'],
    taskIds: ['PAIRED-TASK-157'],
  },
  {
    name: 'paired-on-effect-smoke',
    case_revisions: ['paired-task-157.r3.on'],
    taskIds: ['PAIRED-TASK-157'],
  },
  {
    name: 'eval-model',
    case_revisions: ['paired-task-02.r6.off'],
    taskIds: ['PAIRED-TASK-02'],
  },
  {
    name: 'eval-agent',
    case_revisions: ['paired-task-02.r6.off'],
    taskIds: ['PAIRED-TASK-02'],
  },
];

const tasks = [
  {
    taskId: 'PAIRED-TASK-02',
    offId: 'EVAL-B-PAIRED-TASK-02-OFF',
    onId: 'EVAL-B-PAIRED-TASK-02-ON',
  },
  {
    taskId: 'PAIRED-TASK-157',
    offId: 'EVAL-B-PAIRED-TASK-157-OFF',
    onId: 'EVAL-B-PAIRED-TASK-157-ON',
  },
];

describe('run-plan helpers', () => {
  it('item id 映射人题号（含历史 TASK-01）', () => {
    expect(taskIdFromItemId('EVAL-B-PAIRED-TASK-OFF')).toBe('PAIRED-TASK-01');
    expect(taskIdFromItemId('EVAL-B-PAIRED-TASK-157-ON')).toBe('PAIRED-TASK-157');
    expect(taskIdsOfItems(['EVAL-B-PAIRED-TASK-157-OFF', 'EVAL-B-PAIRED-TASK-157-ON'])).toEqual([
      'PAIRED-TASK-157',
    ]);
  });

  it('case_revision_id 映射人题号（cases-v1）', () => {
    expect(taskIdFromCaseRevisionId('paired-task-02.r6.off')).toBe('PAIRED-TASK-02');
    expect(taskIdFromCaseRevisionId('paired-task-157.r3.on')).toBe('PAIRED-TASK-157');
    expect(
      taskIdsOfCaseRevisions([
        { case_revision_id: 'paired-task-02.r6.off' },
        { case_revision_id: 'paired-task-02.r7.on' },
      ]),
    ).toEqual(['PAIRED-TASK-02']);
  });

  it('组卷对侧', () => {
    expect(counterpartRelease('paired-off-effect-smoke', 'on')).toBe('paired-on-effect-smoke');
    expect(counterpartRelease('eval-model', 'on')).toBe('paired-on');
    expect(counterpartRelease('paired-on-calibrate', 'off')).toBe('paired-off-calibrate');
  });

  it('实验默认考场与组卷', () => {
    expect(defaultExamMode('plugin')).toBe('both');
    expect(defaultExamMode('model')).toBe('off');
    expect(defaultRelease('plugin')).toBe('paired-off');
    expect(defaultRelease('agent')).toBe('paired-off');
    expect(defaultRelease('model')).toBe('paired-off');
  });
});

describe('resolveRunPlan', () => {
  it('有无万象术默认走 legacy paired', () => {
    const r = resolveRunPlan({ experiment: 'plugin', releases, tasks });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.legacy).toBe('paired');
    expect(r.plan.examMode).toBe('both');
    expect(r.plan.needsSut).toBe(true);
  });

  it('筛效果烟卷 + 同时跑：不写 legacy，跑 OFF 再 ON', () => {
    const r = resolveRunPlan({
      experiment: 'plugin',
      release: 'paired-off-effect-smoke',
      examMode: 'both',
      releases,
      tasks,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.legacy).toBeUndefined();
    expect(r.plan.steps).toEqual([
      {
        release: 'paired-off-effect-smoke',
        itemIds: ['EVAL-B-PAIRED-TASK-157-OFF'],
        side: 'off',
      },
      {
        release: 'paired-on-effect-smoke',
        itemIds: ['EVAL-B-PAIRED-TASK-157-ON'],
        side: 'on',
      },
    ]);
  });

  it('只勾一道人题 + 无插件', () => {
    const r = resolveRunPlan({
      experiment: 'plugin',
      examMode: 'off',
      taskIds: ['PAIRED-TASK-02'],
      releases,
      tasks,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.legacy).toBeUndefined();
    expect(r.plan.steps).toEqual([
      { release: 'paired-off', itemIds: ['EVAL-B-PAIRED-TASK-02-OFF'], side: 'off' },
    ]);
    expect(r.plan.needsSut).toBe(false);
  });

  it('测模型不能选同时跑', () => {
    const r = resolveRunPlan({
      experiment: 'model',
      examMode: 'both',
      releases,
      tasks,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/测万象术/);
  });

  it('测模型默认无插件', () => {
    const r = resolveRunPlan({ experiment: 'model', releases, tasks });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.examMode).toBe('off');
    expect(r.plan.needsSut).toBe(false);
  });

  it('空清单 / 非法考场 / 题不在卷中', () => {
    expect(resolveRunPlan({ experiment: 'plugin', taskIds: [], releases, tasks }).ok).toBe(false);
    expect(resolveRunPlan({ experiment: 'plugin', examMode: 'maybe', releases, tasks }).ok).toBe(
      false,
    );
    expect(
      resolveRunPlan({
        experiment: 'plugin',
        release: 'paired-off-effect-smoke',
        taskIds: ['PAIRED-TASK-02'],
        releases,
        tasks,
      }).ok,
    ).toBe(false);
  });
});

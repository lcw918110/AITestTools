import { describe, expect, it } from 'vitest';
import {
  collectNdjsonKinds,
  diagnoseHostedFailure,
  missingProtocolProbes,
  resolveHostedAttribution,
  resolveWorkspaceFailAttribution,
} from '../../src/attribution/index.ts';

describe('hosted attribution tree', () => {
  it('协议事件缺失 → PROTOCOL', () => {
    expect(diagnoseHostedFailure({ protocolProbeMiss: true }).attribution).toBe('PROTOCOL');
  });
  it('鉴权 / 额度类失败 → CONTEXT', () => {
    expect(diagnoseHostedFailure({ contextProbeMiss: true }).attribution).toBe('CONTEXT');
  });
  it('兜底 → HARNESS', () => {
    expect(diagnoseHostedFailure({}).attribution).toBe('HARNESS');
  });
});

describe('resolveHostedAttribution', () => {
  it('CONTEXT 不被题目 focus 改写（额度不足不得记成模型没做到）', () => {
    expect(resolveHostedAttribution('CONTEXT', 'MODEL_TASK')).toBe('CONTEXT');
  });
  it('HARNESS 不被题目 focus 改写', () => {
    expect(resolveHostedAttribution('HARNESS', 'PROTOCOL')).toBe('HARNESS');
  });
  it('被测对象类归因仍可由 focus 细化', () => {
    expect(resolveHostedAttribution('MODEL_TASK', 'MODEL_SCHEMA')).toBe('MODEL_SCHEMA');
  });
  it('PROTOCOL focus 不能把工作区/任务失败改写成 PROTOCOL', () => {
    expect(resolveHostedAttribution('MODEL_TASK', 'PROTOCOL')).toBe('MODEL_TASK');
  });
  it('无 focus 时用判定树结果', () => {
    expect(resolveHostedAttribution('PROTOCOL', undefined)).toBe('PROTOCOL');
  });
});

describe('resolveWorkspaceFailAttribution', () => {
  it('超时且材料未改 → CONTEXT', () => {
    expect(resolveWorkspaceFailAttribution({ timedOut: true, materialsMutated: false })).toBe(
      'CONTEXT',
    );
  });
  it('超时但改了文件（改错）→ MODEL_TASK', () => {
    expect(resolveWorkspaceFailAttribution({ timedOut: true, materialsMutated: true })).toBe(
      'MODEL_TASK',
    );
  });
  it('非超时工作区失败 → MODEL_TASK', () => {
    expect(resolveWorkspaceFailAttribution({ timedOut: false, materialsMutated: false })).toBe(
      'MODEL_TASK',
    );
  });
  it('鉴权/额度失败 → CONTEXT（即使改过文件）', () => {
    expect(
      resolveWorkspaceFailAttribution({
        timedOut: false,
        materialsMutated: true,
        authMiss: true,
      }),
    ).toBe('CONTEXT');
  });
});

describe('ndjson probes', () => {
  it('收集 kind 并报告缺失探针', () => {
    const text = [
      '{"kind":"assistant_completed","session":"s"}',
      '{"kind":"nudge_dispatched","session":"s"}',
      '',
      'not-json',
    ].join('\n');
    const kinds = collectNdjsonKinds(text);
    expect(kinds.has('assistant_completed')).toBe(true);
    expect(missingProtocolProbes(kinds, ['assistant_completed', 'loop_activated'])).toEqual([
      'loop_activated',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  collectNdjsonKinds,
  diagnoseHostedFailure,
  missingProtocolProbes,
  resolveHostedAttribution,
  resolveWorkspaceFailAttribution,
  isProviderStreamBroken,
} from '../../src/attribution/index.ts';
import { isHostCrashed } from '../../src/run/hosted-host-exit.ts';

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
  it('只认供应商流协议错误，不认 FSEvents 噪音', () => {
    expect(
      isProviderStreamBroken(
        'AI_InvalidResponseDataError: Received message_start while message is still open.',
      ),
    ).toBe(true);
    expect(isProviderStreamBroken('Error starting FSEvents stream')).toBe(false);
  });
  it('供应商流被打断且材料未改 → CONTEXT，不是 MODEL_TASK', () => {
    expect(
      resolveWorkspaceFailAttribution({
        timedOut: false,
        materialsMutated: false,
        providerStreamBroken: true,
      }),
    ).toBe('CONTEXT');
  });
  it('供应商流被打断但文件已改 → MODEL_TASK', () => {
    expect(
      resolveWorkspaceFailAttribution({
        timedOut: false,
        materialsMutated: true,
        providerStreamBroken: true,
      }),
    ).toBe('MODEL_TASK');
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
  it('宿主崩溃且材料未改 → HARNESS（不是 CONTEXT，也不是 MODEL_TASK）', () => {
    // 崩溃与超时语义不同：超时是本平台主动终止（模型没跑完），崩溃是宿主自己死的（工装故障）。
    expect(
      resolveWorkspaceFailAttribution({
        timedOut: false,
        materialsMutated: false,
        hostCrashed: true,
      }),
    ).toBe('HARNESS');
  });
  it('宿主崩溃但已改文件 → MODEL_TASK（有实际动作，可判改错）', () => {
    expect(
      resolveWorkspaceFailAttribution({
        timedOut: false,
        materialsMutated: true,
        hostCrashed: true,
      }),
    ).toBe('MODEL_TASK');
  });
  it('鉴权失败优先于崩溃 → CONTEXT', () => {
    expect(
      resolveWorkspaceFailAttribution({
        timedOut: false,
        materialsMutated: false,
        authMiss: true,
        hostCrashed: true,
      }),
    ).toBe('CONTEXT');
  });
});

describe('isHostCrashed', () => {
  it('非超时 + 无退出码 + 有信号 → 崩溃', () => {
    expect(
      isHostCrashed({
        timed_out: false,
        host_exit: null,
        host_signal: 'SIGTRAP',
        host_exit_role: 'auxiliary',
        host_spawn_error: null,
        stdio_destroyed: false,
      }),
    ).toBe(true);
  });
  it('超时（即使有 SIGTERM）不算崩溃', () => {
    expect(
      isHostCrashed({
        timed_out: true,
        host_exit: null,
        host_signal: 'SIGTERM',
        host_exit_role: 'auxiliary',
        host_spawn_error: null,
        stdio_destroyed: false,
      }),
    ).toBe(false);
  });
  it('正常退出不算崩溃', () => {
    expect(
      isHostCrashed({
        timed_out: false,
        host_exit: 1,
        host_signal: null,
        host_exit_role: 'auxiliary',
        host_spawn_error: null,
        stdio_destroyed: false,
      }),
    ).toBe(false);
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

import { describe, expect, it } from 'vitest';
import { AdapterError } from '../../src/run/execution-adapter.ts';
import type { Attribution } from '../../src/domain/types.ts';

describe('ExecutionAdapter 错误模型（阶段 4b）', () => {
  it('AdapterError 携带 kind / attribution / retryable', () => {
    const err = new AdapterError('discover_failed', 'HARNESS', '无法加载 stimulus', false);
    expect(err.kind).toBe('discover_failed');
    expect(err.attribution).toBe('HARNESS');
    expect(err.message).toBe('无法加载 stimulus');
    expect(err.retryable).toBe(false);
    expect(err).toBeInstanceOf(Error);
  });

  it('默认 retryable=false', () => {
    const err = new AdapterError('submit_failed', 'PROTOCOL', 'spawn 失败');
    expect(err.retryable).toBe(false);
  });

  it('attribution 类型受 Attribution 约束', () => {
    const attr: Attribution = 'MODEL_TASK';
    const err = new AdapterError('evaluate_failed', attr, 'x');
    expect(err.attribution).toBe('MODEL_TASK');
  });
});

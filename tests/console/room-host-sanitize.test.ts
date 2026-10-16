import { describe, expect, it } from 'vitest';
import { sanitizeRoomUpdate } from '../../apps/console/parse.ts';

describe('sanitizeRoomUpdate（rooms PUT host 白名单与类型校验）', () => {
  it('合法 host 字段全部保留', () => {
    const result = sanitizeRoomUpdate({
      host: {
        model: 'gpt-5.4',
        agent: 'fast-coder',
        plugin: 'dist/plugin.js',
        managed_agents: ['a', 'b'],
      },
    });
    expect(result.host).toEqual({
      model: 'gpt-5.4',
      agent: 'fast-coder',
      plugin: 'dist/plugin.js',
      managed_agents: ['a', 'b'],
    });
    expect(result.warnings).toEqual([]);
  });

  it('白名单外字段被忽略并警告', () => {
    const result = sanitizeRoomUpdate({
      host: { foo: 'bar', model: 'gpt-5.4' },
    });
    expect(result.host).toEqual({ model: 'gpt-5.4' });
    expect(result.warnings).toContain('host.foo 不是合法字段，已忽略');
  });

  it('model 给非字符串值被忽略并警告', () => {
    const result = sanitizeRoomUpdate({
      host: { model: 123 },
    });
    expect(result.host).toEqual({});
    expect(result.warnings).toContain('host.model 应为字符串，已忽略');
  });

  it('managed_agents 给非字符串数组被忽略', () => {
    const result = sanitizeRoomUpdate({
      host: { managed_agents: [1, 2] },
    });
    expect(result.host).toEqual({});
    expect(result.warnings).toContain('host.managed_agents 应为字符串数组，已忽略');
  });

  it('managed_agents 给字符串（非数组）被忽略', () => {
    const result = sanitizeRoomUpdate({
      host: { managed_agents: 'a,b' },
    });
    expect(result.host).toEqual({});
    expect(result.warnings).toContain('host.managed_agents 应为字符串数组，已忽略');
  });

  it('host 为非对象（如字符串）整体忽略', () => {
    const result = sanitizeRoomUpdate({ host: 'opencode' });
    expect(result.host).toBeUndefined();
    expect(result.warnings).toContain('host 应为对象，已忽略');
  });

  it('workspace 合法字符串保留，非法类型忽略', () => {
    const ok = sanitizeRoomUpdate({ workspace: 'isolated' });
    expect(ok.workspace).toBe('isolated');
    expect(ok.warnings).toEqual([]);

    const bad = sanitizeRoomUpdate({ workspace: 42 });
    expect(bad.workspace).toBeUndefined();
    expect(bad.warnings).toContain('workspace 应为字符串，已忽略');
  });

  it('network 合法布尔保留，非法类型忽略', () => {
    const ok = sanitizeRoomUpdate({ network: true });
    expect(ok.network).toBe(true);
    expect(ok.warnings).toEqual([]);

    const bad = sanitizeRoomUpdate({ network: 'true' });
    expect(bad.network).toBeUndefined();
    expect(bad.warnings).toContain('network 应为布尔，已忽略');
  });

  it('未提供的字段不产生警告、不设置输出', () => {
    const result = sanitizeRoomUpdate({});
    expect(result.host).toBeUndefined();
    expect(result.workspace).toBeUndefined();
    expect(result.network).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });
});

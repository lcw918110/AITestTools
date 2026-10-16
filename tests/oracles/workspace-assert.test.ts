import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runWorkspaceAssertOracle } from '../../src/oracles/workspace-assert.ts';

describe('runWorkspaceAssertOracle', () => {
  it('文件存在且含片段', () => {
    const ws = join(tmpdir(), `ws-assert-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'out.txt'), 'hello world\n');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'out.txt', contains: 'hello' },
      workspace: ws,
    });
    expect(o.pass).toBe(true);
  });

  it('缺文件失败', () => {
    const ws = join(tmpdir(), `ws-assert-miss-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'missing.txt' },
      workspace: ws,
    });
    expect(o.pass).toBe(false);
  });
  it('绝对路径应被拒绝', () => {
    const ws = join(tmpdir(), `ws-assert-abs-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: '/etc/passwd', contains: 'root' },
      workspace: ws,
    });
    expect(o.pass).toBe(false);
    expect(o.message).toContain('安全拒绝');
  });

  it('文件存在但 contains 不匹配应 pass=false', () => {
    const ws = join(tmpdir(), `ws-assert-nomatch-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'data.txt'), 'apple banana cherry');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'data.txt', contains: 'watermelon' },
      workspace: ws,
    });
    expect(o.pass).toBe(false);
    expect(o.message).toContain('未含');
  });

  it('文件名为空字符串返回缺少 path', () => {
    const ws = join(tmpdir(), `ws-assert-empty-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: '' },
      workspace: ws,
    });
    expect(o.pass).toBe(false);
    expect(o.message).toContain('缺少 path');
  });

  it('读取目录时 readFileSync 异常应捕获不崩溃', () => {
    const ws = join(tmpdir(), `ws-assert-dir-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    mkdirSync(join(ws, 'subdir'));
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'subdir', contains: 'anything' },
      workspace: ws,
    });
    expect(o.pass).toBe(false);
    expect(o.message).toContain('读取文件');
  });
});

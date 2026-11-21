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
    // 收窄到失败分支后才能读归因
    if (!o.pass) {
      expect(o.message).toContain('读取文件');
      // 读不了是环境/试题问题，不能记成「模型没做到」
      expect(o.attribution).toBe('HARNESS');
    }
  });

  it('not_contains 命中时失败（新值写进去了但旧值还留着）', () => {
    const ws = join(tmpdir(), `ws-assert-notcontain-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    // 跨文件改动的典型失败：既写入了新值，又没删掉旧值
    writeFileSync(join(ws, 'config.txt'), 'version: 2\nlegacy_version: 1\n');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: {
        type: 'workspace_assert',
        path: 'config.txt',
        contains: 'version: 2',
        not_contains: 'legacy_version',
      },
      workspace: ws,
    });
    expect(o.pass).toBe(false);
    expect(o.message).toContain('仍残留「legacy_version」');
  });

  it('not_contains 未命中时通过（旧值已清干净）', () => {
    const ws = join(tmpdir(), `ws-assert-clean-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'config.txt'), 'version: 2\n');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: {
        type: 'workspace_assert',
        path: 'config.txt',
        contains: 'version: 2',
        not_contains: 'legacy_version',
      },
      workspace: ws,
    });
    expect(o.pass).toBe(true);
  });

  it('exists=false 时文件真的不存在才通过', () => {
    const ws = join(tmpdir(), `ws-assert-absent-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'should-be-gone.tmp', exists: false },
      workspace: ws,
    });
    expect(o.pass).toBe(true);
  });

  it('exists=false 但文件还在时失败（该删的没删掉）', () => {
    const ws = join(tmpdir(), `ws-assert-still-there-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'leftover.tmp'), 'stale');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'leftover.tmp', exists: false },
      workspace: ws,
    });
    expect(o.pass).toBe(false);
    expect(o.message).toContain('期望不存在文件');
  });

  it('子目录路径可正常判定（不因层级深被安全拒绝误伤）', () => {
    const ws = join(tmpdir(), `ws-assert-nested-${Date.now()}`);
    mkdirSync(join(ws, 'src', 'deep'), { recursive: true });
    writeFileSync(join(ws, 'src', 'deep', 'out.ts'), 'export const ok = true;\n');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'src/deep/out.ts', contains: 'ok = true' },
      workspace: ws,
    });
    expect(o.pass).toBe(true);
  });

  it('用 .. 跳出 workspace 的路径被拒绝', () => {
    const ws = join(tmpdir(), `ws-assert-dotdot-${Date.now()}`);
    mkdirSync(join(ws, 'inner'), { recursive: true });
    writeFileSync(join(ws, 'inner', 'f.txt'), 'secret');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: '../f.txt', contains: 'secret' },
      workspace: join(ws, 'inner'),
    });
    expect(o.pass).toBe(false);
    expect(o.message).toContain('安全拒绝');
  });

  it('contains 为空白串时归 HARNESS，不拿去 includes 比对', () => {
    const ws = join(tmpdir(), `ws-assert-blank-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'data.txt'), 'abc');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'data.txt', contains: '   ' },
      workspace: ws,
      attribution: 'MODEL_TASK',
    });
    expect(o).toMatchObject({ pass: false, attribution: 'HARNESS' });
    if (!o.pass) expect(o.message).toContain('contains');
  });

  it('contains 为空串时不退化成只查存在', () => {
    const ws = join(tmpdir(), `ws-assert-empty-contains-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'data.txt'), 'abc');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      // 绕过静态门禁构造非法声明，运行期必须拦
      oracle: { type: 'workspace_assert', path: 'data.txt', contains: '' },
      workspace: ws,
    });
    expect(o).toMatchObject({ pass: false, attribution: 'HARNESS' });
  });

  it('not_contains 为空白串同样归 HARNESS', () => {
    const ws = join(tmpdir(), `ws-assert-blank-not-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'data.txt'), 'abc');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'data.txt', not_contains: ' \t ' },
      workspace: ws,
    });
    expect(o).toMatchObject({ pass: false, attribution: 'HARNESS' });
  });

  it('读文件失败时传了 MODEL_TASK 归因仍归 HARNESS', () => {
    const ws = join(tmpdir(), `ws-assert-readfail-${Date.now()}`);
    mkdirSync(join(ws, 'subdir'), { recursive: true });
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'subdir', contains: 'x' },
      workspace: ws,
      attribution: 'MODEL_TASK',
    });
    expect(o).toMatchObject({ pass: false, attribution: 'HARNESS' });
  });

  it('内容不匹配才使用调用方归因', () => {
    const ws = join(tmpdir(), `ws-assert-mismatch-attr-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'data.txt'), 'abc');
    const o = runWorkspaceAssertOracle({
      oracle_id: 'w1',
      oracle: { type: 'workspace_assert', path: 'data.txt', contains: 'zzz' },
      workspace: ws,
      attribution: 'MODEL_TASK',
    });
    expect(o).toMatchObject({ pass: false, attribution: 'MODEL_TASK' });
  });
});

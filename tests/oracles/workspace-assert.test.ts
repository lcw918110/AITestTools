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
});

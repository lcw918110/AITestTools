import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runToolSideEffectOracle } from '../../src/oracles/tool-side-effect.ts';

describe('runToolSideEffectOracle', () => {
  it('文件含片段通过', () => {
    const ws = join(tmpdir(), `side-fx-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'out.txt'), 'side-effect-ok\n');
    const o = runToolSideEffectOracle({
      oracle_id: 's1',
      oracle: { type: 'tool_side_effect', file: 'out.txt', contains: 'side-effect-ok' },
      workspace: ws,
    });
    expect(o.pass).toBe(true);
  });

  it('缺文件失败', () => {
    const ws = join(tmpdir(), `side-fx-miss-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const o = runToolSideEffectOracle({
      oracle_id: 's1',
      oracle: { type: 'tool_side_effect', file: 'gone.txt' },
      workspace: ws,
    });
    expect(o.pass).toBe(false);
  });
});

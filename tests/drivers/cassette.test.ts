import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CassetteError, loadCassette } from '../../src/drivers/cassette/index.ts';

describe('cassette loader（Phase 2 骨架）', () => {
  it('缺文件抛 CassetteError', () => {
    expect(() => loadCassette(tmpdir(), 'no-such-cassette.json')).toThrow(CassetteError);
  });

  it('装载最小清单', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cass-'));
    const file = join(dir, 'c.json');
    writeFileSync(file, `${JSON.stringify({ id: 'c1', rev: 1 })}\n`);
    const doc = loadCassette(dir, 'c.json');
    expect(doc.id).toBe('c1');
    expect(doc.rev).toBe(1);
  });
});

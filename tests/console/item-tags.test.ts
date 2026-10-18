import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CASES = join(process.cwd(), 'examples/product-eval/cases');
const FORBIDDEN = new Set(['paired', 'plugin-on', 'plugin-off', 'effect']);

describe('product-eval case tags', () => {
  it('case tags 只留任务类型，不含对照/考场/成绩词', () => {
    const files = readdirSync(CASES).filter((n) => n.endsWith('.case.json'));
    expect(files.length).toBeGreaterThan(150);
    for (const name of files) {
      const doc = JSON.parse(readFileSync(join(CASES, name), 'utf8')) as { tags?: string[] };
      for (const tag of doc.tags ?? []) {
        expect(FORBIDDEN.has(tag), `${name} 仍有废弃标签 ${tag}`).toBe(false);
      }
    }
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ITEMS = join(process.cwd(), 'examples/product-eval/legacy/items/B');
const FORBIDDEN = new Set(['paired', 'plugin-on', 'plugin-off', 'effect']);

describe('product-eval item tags', () => {
  it('试题 tags 只留任务类型，不含对照/考场/成绩词', () => {
    const files = readdirSync(ITEMS).filter((n) => n.endsWith('.item.json'));
    expect(files.length).toBeGreaterThan(300);
    for (const name of files) {
      const doc = JSON.parse(readFileSync(join(ITEMS, name), 'utf8')) as { tags?: string[] };
      for (const tag of doc.tags ?? []) {
        expect(FORBIDDEN.has(tag), `${name} 仍有废弃标签 ${tag}`).toBe(false);
      }
    }
  });
});

import { describe, expect, it, vi, afterEach } from 'vitest';
import { main } from '../../src/cli/main.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('run --concurrency', () => {
  it('help 含 concurrency；非法缺参仍返回 2', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['--help'])).toBe(0);
    expect(lines.join('\n')).toMatch(/concurrency/);
    expect(await main(['run'])).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildCanaryInjection,
  detectCanaryLeak,
  generateCanarySecret,
} from '../../src/security/canary.ts';

describe('generateCanarySecret', () => {
  it('生成带固定前缀的随机 canary', () => {
    const s = generateCanarySecret();
    expect(s).toMatch(/^PROCTOR-CANARY-[0-9a-f]{16}$/);
  });

  it('两次生成不重复（随机性）', () => {
    const a = generateCanarySecret();
    const b = generateCanarySecret();
    expect(a).not.toBe(b);
  });
});

describe('buildCanaryInjection', () => {
  it('注入文本包含 canary secret 与恶意指令', () => {
    const secret = 'PROCTOR-CANARY-0123456789abcdef';
    const text = buildCanaryInjection(secret);
    expect(text).toContain(secret);
    expect(text).toMatch(/回复|输出|包含/i);
  });
});

describe('detectCanaryLeak', () => {
  it('canary 出现在任一表面即判定泄露并给出位置', () => {
    const secret = 'PROCTOR-CANARY-0123456789abcdef';
    const surfaces = [
      { name: 'stdout', content: '正常回复，无泄露' },
      { name: 'workspace/leak.txt', content: `偷偷写下了 ${secret}` },
    ];
    const r = detectCanaryLeak(secret, surfaces);
    expect(r.leaked).toBe(true);
    expect(r.locations).toContain('workspace/leak.txt');
  });

  it('canary 未出现在任何表面则判未泄露', () => {
    const secret = 'PROCTOR-CANARY-0123456789abcdef';
    const surfaces = [
      { name: 'stdout', content: '正常回复，无泄露' },
      { name: 'stderr', content: '' },
    ];
    const r = detectCanaryLeak(secret, surfaces);
    expect(r.leaked).toBe(false);
    expect(r.locations).toEqual([]);
  });

  it('空表面列表判未泄露', () => {
    const r = detectCanaryLeak('PROCTOR-CANARY-0123456789abcdef', []);
    expect(r.leaked).toBe(false);
  });

  it('canary 子串匹配不受前后文干扰', () => {
    const secret = 'PROCTOR-CANARY-0123456789abcdef';
    const surfaces = [{ name: 'stdout', content: `前缀 ${secret} 后缀` }];
    const r = detectCanaryLeak(secret, surfaces);
    expect(r.leaked).toBe(true);
  });
});

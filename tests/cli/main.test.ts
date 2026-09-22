import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/cli/main.ts';

const demoProject = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));
const brokenProject = fileURLToPath(new URL('../fixtures/broken-project', import.meta.url));

let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('退出码约定', () => {
  it('校验通过返回 0', async () => {
    expect(await main(['item', 'validate', '--project', demoProject])).toBe(0);
  });

  it('case 别名同样可用', async () => {
    expect(await main(['case', 'validate', '--project', demoProject])).toBe(0);
  });

  it('校验失败返回 1', async () => {
    expect(await main(['item', 'validate', '--project', brokenProject])).toBe(1);
  });

  it('--strict 下单文件无警告则仍通过', async () => {
    const doc = fileURLToPath(
      new URL('../fixtures/broken-project/items/net.item.json', import.meta.url),
    );
    expect(await main(['item', 'validate', doc])).toBe(0);
    expect(await main(['item', 'validate', '--strict', doc])).toBe(0);
  });

  it('无参数打印帮助并返回 2', async () => {
    expect(await main([])).toBe(2);
    expect(out.join('\n')).toContain('用法');
  });

  it('未知命令返回 2', async () => {
    expect(await main(['nope'])).toBe(2);
  });
});

describe('试题演进命令', () => {
  it('缺参时返回 2 并打印用法，不得静默成功', async () => {
    expect(await main(['item', 'bump-rev'])).toBe(2);
    expect(out.join('\n')).toContain('用法');
    out.length = 0;
    expect(await main(['item', 'new'])).toBe(2);
    expect(out.join('\n')).toContain('用法');
    out.length = 0;
    expect(await main(['item', 'retire'])).toBe(2);
    expect(out.join('\n')).toContain('用法');
    out.length = 0;
    expect(await main(['item', 'migrate'])).toBe(2);
    expect(out.join('\n')).toContain('用法');
  });
});

describe('输出形态', () => {
  it('--json 输出可被解析且含错误计数', async () => {
    await main(['item', 'validate', '--project', demoProject, '--json']);
    const parsed = JSON.parse(out.join('\n')) as { errorCount: number; items: unknown[] };
    expect(parsed.errorCount).toBe(0);
    expect(parsed.items.length).toBeGreaterThanOrEqual(3);
  });

  it('--version 输出版本号', async () => {
    expect(await main(['--version'])).toBe(0);
    expect(out.join('')).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('L1 run', () => {
  it('smoke-A-L1 全绿', async () => {
    expect(
      await main(['run', '--axis', 'A', '--paperset', 'smoke-A-L1', '--project', demoProject]),
    ).toBe(0);
  });

  it('smoke-A-L1 --only 一题全绿', async () => {
    expect(
      await main([
        'run',
        '--axis',
        'A',
        '--paperset',
        'smoke-A-L1',
        '--project',
        demoProject,
        '--only',
        'DEMO-A-TODO-FOLD-01',
      ]),
    ).toBe(0);
  });

  it('smoke-A-L1 --only 不在试卷中则失败', async () => {
    expect(
      await main([
        'run',
        '--axis',
        'A',
        '--paperset',
        'smoke-A-L1',
        '--project',
        demoProject,
        '--only',
        'NO-SUCH-ITEM',
      ]),
    ).toBe(1);
    expect(out.join('\n')).toContain('--only');
  });
});

describe('L2 run', () => {
  it('smoke-A（nudge+review）全绿', async () => {
    expect(
      await main(['run', '--axis', 'A', '--paperset', 'smoke-A', '--project', demoProject]),
    ).toBe(0);
  });
});

describe('B fixture matrix', () => {
  it('model-core fixture 矩阵全绿', async () => {
    process.env.PROCTOR_PROMPTFOO_LIVE = '0';
    process.env.MATRIX_SUBJECTS = 'fixture-a,fixture-b';
    expect(
      await main(['run', '--axis', 'B', '--paperset', 'model-core', '--project', demoProject]),
    ).toBe(0);
  });
});

describe('baseline pin + report show', () => {
  it('钉选后可 show report', async () => {
    expect(
      await main(['run', '--axis', 'A', '--paperset', 'smoke-A', '--project', demoProject]),
    ).toBe(0);
    const runLine = out.find((l) => l.startsWith('run 完成：'));
    expect(runLine).toBeDefined();
    const runDir = runLine!.slice('run 完成：'.length).trim();

    out = [];
    expect(
      await main([
        'baseline',
        'pin',
        '--run',
        runDir,
        '--name',
        'ci-smoke',
        '--project',
        demoProject,
      ]),
    ).toBe(0);
    expect(out.join('\n')).toContain('已钉选 baseline');

    out = [];
    expect(await main(['report', 'show', '--run', runDir])).toBe(0);
    expect(out.join('\n')).toContain('DEMO-A-NUDGE-TIMING-01');
  });
});

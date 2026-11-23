import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCrashReporter, main } from '../../src/cli/main.ts';
import {
  createIsolatedProjectRoot,
  removeIsolatedProjectRoot,
} from '../helpers/isolated-project.ts';

const demoProject = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));
const brokenProject = fileURLToPath(new URL('../fixtures/broken-project', import.meta.url));

/**
 * `run` 子命令的产物落临时目录，避免往仓库内 `examples/demo-project/runs/` 写真实 run。
 * 只读命令（`item validate` / `case validate`）仍用真实 demoProject。
 */
let runProject: string;

beforeAll(() => {
  runProject = createIsolatedProjectRoot();
});

afterAll(() => {
  removeIsolatedProjectRoot(runProject);
});

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
      new URL(
        '../../examples/demo-project/case-revisions/demo-a-todo-fold-01.r1.case-revision.json',
        import.meta.url,
      ),
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

describe('试题命令', () => {
  it('缺参时返回 2 并打印用法，不得静默成功', async () => {
    expect(await main(['item', 'new'])).toBe(2);
    expect(out.join('\n')).toContain('用法');
    out.length = 0;
    expect(await main(['item', 'retire'])).toBe(2);
    expect(out.join('\n')).toContain('未知子命令');
    out.length = 0;
    expect(await main(['item', 'migrate'])).toBe(2);
    expect(out.join('\n')).toContain('未知子命令');
  });
});

describe('输出形态', () => {
  it('--json 输出可被解析且含错误计数', async () => {
    await main(['item', 'validate', '--project', demoProject, '--json']);
    const parsed = JSON.parse(out.join('\n')) as {
      errorCount: number;
      caseReports: unknown[];
    };
    expect(parsed.errorCount).toBe(0);
    expect(parsed.caseReports.length).toBeGreaterThanOrEqual(3);
  });

  it('--version 输出版本号', async () => {
    expect(await main(['--version'])).toBe(0);
    expect(out.join('')).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('L1 run', () => {
  it('smoke-a-l1 全绿', async () => {
    expect(
      await main([
        'run',
        '--dataset',
        'smoke-a-l1',
        '--environment',
        'fold-v1',
        '--project',
        runProject,
      ]),
    ).toBe(0);
  });

  it('smoke-a-l1 --only 一题全绿', async () => {
    expect(
      await main([
        'run',
        '--dataset',
        'smoke-a-l1',
        '--environment',
        'fold-v1',
        '--project',
        runProject,
        '--only',
        'demo-a-todo-fold-01.r1',
      ]),
    ).toBe(0);
  });

  it('smoke-a-l1 --only 不在测试集中则失败', async () => {
    expect(
      await main([
        'run',
        '--dataset',
        'smoke-a-l1',
        '--environment',
        'fold-v1',
        '--project',
        runProject,
        '--only',
        'NO-SUCH-ITEM',
      ]),
    ).toBe(1);
    expect(out.join('\n')).toContain('--only');
  });
});

describe('L2 run', () => {
  it('smoke-a（nudge+review）全绿', async () => {
    expect(
      await main([
        'run',
        '--dataset',
        'smoke-a',
        '--environment',
        'fake-host-v1',
        '--project',
        runProject,
      ]),
    ).toBe(0);
  });
});

describe('B fixture matrix', () => {
  it('model-core fixture 矩阵全绿', async () => {
    process.env.PROCTOR_PROMPTFOO_LIVE = '0';
    process.env.MATRIX_SUBJECTS = 'fixture-a,fixture-b';
    expect(
      await main([
        'run',
        '--dataset',
        'model-core',
        '--environment',
        'model-direct-v1',
        '--project',
        runProject,
      ]),
    ).toBe(0);
  });
});

describe('baseline pin + report show', () => {
  it('钉选后可 show report', async () => {
    expect(
      await main([
        'run',
        '--dataset',
        'smoke-a',
        '--environment',
        'fake-host-v1',
        '--project',
        runProject,
      ]),
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
        runProject,
      ]),
    ).toBe(0);
    expect(out.join('\n')).toContain('已钉选 baseline');

    out = [];
    expect(await main(['report', 'show', '--run', runDir])).toBe(0);
    expect(out.join('\n')).toContain('demo-a-nudge-timing-01.r2');
  });
});

/**
 * 批跑的最后一道证据线：主流程之外的异步异常若无人接管，
 * Node 会直接终止进程且不打印任何东西——长跑时表现为「引擎静默消失、日志 0 字节」。
 * 这里验证兜底至少把栈打出来并把退出码置为非零。
 */
describe('installCrashReporter', () => {
  it('未捕获异常被打印且退出码不会被当成 0', () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '));
    });
    const before = process.exitCode;
    process.exitCode = 0;
    const remove = installCrashReporter();
    try {
      process.emit('uncaughtException', new Error('probe: 异步未捕获异常'));
      expect(errors.join('\n')).toContain('probe: 异步未捕获异常');
      expect(process.exitCode).toBe(1);
    } finally {
      remove();
      process.exitCode = before;
      spy.mockRestore();
    }
  });

  it('未处理的 Promise 拒绝同样被打印', () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '));
    });
    const remove = installCrashReporter();
    try {
      // 'unhandledRejection' 不在 process.emit 的信号重载里，按事件名显式发。
      (process.emit as (event: string, ...args: unknown[]) => boolean)(
        'unhandledRejection',
        new Error('probe: 拒绝'),
      );
      expect(errors.join('\n')).toContain('probe: 拒绝');
    } finally {
      remove();
      spy.mockRestore();
    }
  });
});

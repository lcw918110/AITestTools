import { describe, expect, it } from 'vitest';
import type { CaseRevision, EnvironmentProfile } from '../../src/domain/types.ts';
import { FoldResolveError, resolveFoldEntry } from '../../src/drivers/fold/resolve-entry.ts';

/**
 * `resolveFoldEntry` 是 L1 折叠的入口解析：把试题的 `fold_entry` 逻辑名
 * 映射到环境声明的模块路径。任一环节不一致都必须报 `FoldResolveError`（归 HARNESS），
 * 否则会把「配置写错」误判成「被测逻辑有问题」。
 */
function environment(foldEntries: Record<string, unknown> = {}): EnvironmentProfile {
  return {
    environment_profile_id: 'fold-test-v1',
    recipe: { fold_entries: foldEntries },
  } as unknown as EnvironmentProfile;
}

const profile = (overrides: Record<string, unknown> = {}) =>
  ({
    mode: 'fold',
    layer: 'L1',
    fold_entry: 'todo',
    event_schema: 'demo-events-v1',
    ...overrides,
  }) as NonNullable<CaseRevision['execution_profile']>;

const spec = (overrides: Record<string, unknown> = {}) => ({
  module: 'sut/todo.mjs',
  export: 'fold',
  signature: 'pure_fold_v1',
  event_schema: 'demo-events-v1',
  ...overrides,
});

describe('resolveFoldEntry 配置不一致时失败关闭', () => {
  it('fold_entry 缺失时抛 FoldResolveError', () => {
    // 必须断言类型：上层按 `instanceof FoldResolveError` 归 HARNESS，
    // 若实现误抛普通 Error，消息正则照样匹配但归因会静默降为 PROTOCOL。
    let caught: unknown;
    try {
      resolveFoldEntry({
        environment: environment({ todo: spec() }),
        execution_profile: profile({ fold_entry: undefined }),
        projectRoot: '/proj',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FoldResolveError);
    expect((caught as Error).message).toMatch(/execution_profile.fold_entry 缺失/);
  });

  it('fold_entry 不在环境的 fold_entries 中时拒绝，消息含逻辑名与环境名', () => {
    let caught: unknown;
    try {
      resolveFoldEntry({
        environment: environment({ other: spec() }),
        execution_profile: profile({ fold_entry: 'todo' }),
        projectRoot: '/proj',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FoldResolveError);
    expect((caught as Error).message).toMatch(
      /fold_entry "todo" 不在环境 fold-test-v1 的 fold_entries 中/,
    );
  });

  it('event_schema 与入口声明不一致时拒绝，消息含两侧取值', () => {
    let caught: unknown;
    try {
      resolveFoldEntry({
        environment: environment({ todo: spec({ event_schema: 'other-events-v2' }) }),
        execution_profile: profile({ event_schema: 'demo-events-v1' }),
        projectRoot: '/proj',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FoldResolveError);
    expect((caught as Error).message).toMatch(
      /event_schema 不一致：试题 demo-events-v1 vs 入口 other-events-v2/,
    );
  });

  it('试题未声明 event_schema 时跳过一致性校验', () => {
    const out = resolveFoldEntry({
      environment: environment({ todo: spec({ event_schema: 'whatever-v9' }) }),
      execution_profile: profile({ event_schema: undefined }),
      projectRoot: '/proj',
    });
    expect(out.logicalName).toBe('todo');
  });
});

describe('resolveFoldEntry 路径解析', () => {
  it('默认按 sut 根解析模块', () => {
    const out = resolveFoldEntry({
      environment: environment({ todo: spec() }),
      execution_profile: profile(),
      projectRoot: '/proj',
      sutRoot: '/sut-root',
    });
    expect(out.moduleUrl).toContain('/sut-root/sut/todo.mjs');
  });

  it('未传 sutRoot 时退回 projectRoot', () => {
    const out = resolveFoldEntry({
      environment: environment({ todo: spec() }),
      execution_profile: profile(),
      projectRoot: '/proj',
    });
    expect(out.moduleUrl).toContain('/proj/sut/todo.mjs');
  });

  it('resolve_root=project 时强制用 projectRoot，即使传了 sutRoot', () => {
    const out = resolveFoldEntry({
      environment: environment({ todo: spec({ resolve_root: 'project' }) }),
      execution_profile: profile(),
      projectRoot: '/proj',
      sutRoot: '/sut-root',
    });
    expect(out.moduleUrl).toContain('/proj/sut/todo.mjs');
    expect(out.moduleUrl).not.toContain('/sut-root');
  });

  it('返回的 spec 与 normalize 原样透传，normalize 缺省为 json_clone', () => {
    const out = resolveFoldEntry({
      environment: environment({ todo: spec() }),
      execution_profile: profile(),
      projectRoot: '/proj',
    });
    expect(out.spec.export).toBe('fold');
    expect(out.normalize).toBe('json_clone');
  });

  it('spec 显式声明 normalize=none 时透传该值', () => {
    const out = resolveFoldEntry({
      environment: environment({ todo: spec({ normalize: 'none' }) }),
      execution_profile: profile(),
      projectRoot: '/proj',
    });
    expect(out.normalize).toBe('none');
  });
});

describe('resolveFoldEntry 错误类型', () => {
  it('所有失败都是 FoldResolveError 实例，便于上层归 HARNESS', () => {
    try {
      resolveFoldEntry({
        environment: environment({}),
        execution_profile: profile(),
        projectRoot: '/proj',
      });
      expect.unreachable('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(FoldResolveError);
    }
  });
});

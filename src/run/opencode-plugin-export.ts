export type OpenCodePluginFactory = (ctx: unknown) => unknown;

export interface ResolvedOpenCodePluginExport {
  factory: OpenCodePluginFactory;
  id: string;
}

/**
 * 兼容两种万象术 / OpenCode 导出：
 * - 旧：`plugin(ctx)` 或 `default` 为工厂函数
 * - 新（0.8+）：`default = { id: "wanxiangshu-next", server }`
 */
export function resolveOpenCodePluginExport(
  mod: Record<string, unknown>,
): ResolvedOpenCodePluginExport | null {
  if (typeof mod.plugin === 'function') {
    return { factory: mod.plugin as OpenCodePluginFactory, id: 'plugin' };
  }
  if (typeof mod.default === 'function') {
    return { factory: mod.default as OpenCodePluginFactory, id: 'plugin' };
  }
  const pack =
    mod.default !== null && typeof mod.default === 'object'
      ? (mod.default as Record<string, unknown>)
      : mod;
  if (typeof pack.server === 'function') {
    return {
      factory: pack.server as OpenCodePluginFactory,
      id: typeof pack.id === 'string' && pack.id.length > 0 ? pack.id : 'wanxiangshu-next',
    };
  }
  return null;
}

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EnvironmentProfile } from '../domain/types.ts';

/** 万象术现行入口（相对 SUT 根）。2026-08-31 重构：Infrastructure 前缀已去掉。 */
export const WANXIANGSHU_PLUGIN_REL = 'dist/OpenCode/Plugin/Plugin.js';

/** auto 探测：新路径优先，旧布局仅回退。 */
export const WANXIANGSHU_PLUGIN_CANDIDATES = [
  WANXIANGSHU_PLUGIN_REL,
  'dist/Infrastructure/OpenCode/Plugin/Plugin.js',
  'build/next/OpenCode/Plugin.js',
  'build/src/Hosts/OpenCode/Plugin.js',
  'build/src/Opencode/Plugin.js',
] as const;

const STALE_REL_ALIASES: Record<string, string> = {
  'dist/Infrastructure/OpenCode/Plugin/Plugin.js': WANXIANGSHU_PLUGIN_REL,
  'build/src/Hosts/OpenCode/Plugin.js': WANXIANGSHU_PLUGIN_REL,
  'build/src/Opencode/Plugin.js': WANXIANGSHU_PLUGIN_REL,
  'build/next/OpenCode/Plugin.js': WANXIANGSHU_PLUGIN_REL,
  'papers/adapters/opencode-plugin-entry.mjs': WANXIANGSHU_PLUGIN_REL,
};

function firstExisting(root: string, rels: readonly string[]): string | undefined {
  for (const rel of rels) {
    const abs = join(root, rel);
    if (existsSync(abs)) return abs;
  }
  return undefined;
}

/**
 * 解析 hosted 插件路径。
 * - 显式 `recipe.host_plugin` 或 `PROCTOR_HOSTED_PLUGIN` 才挂插件
 * - `host_plugin: "auto"` 时才在 SUT_ROOT 下探测（避免 paired-off 被 SUT_ROOT 误挂万象术）
 */
export function resolvePluginPath(
  environment: EnvironmentProfile,
  projectRoot: string,
): string | undefined {
  const fromEnv = process.env.PROCTOR_HOSTED_PLUGIN;
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);

  const fromEnvironment = environment.recipe.host_plugin;
  if (fromEnvironment === 'auto') {
    const sut = process.env.SUT_ROOT;
    if (!sut) return undefined;
    return firstExisting(sut, WANXIANGSHU_PLUGIN_CANDIDATES);
  }

  if (typeof fromEnvironment === 'string' && fromEnvironment.length > 0) {
    if (fromEnvironment.startsWith('/')) return fromEnvironment;
    const sut = process.env.SUT_ROOT;
    const base = sut ?? projectRoot;
    const abs = resolve(base, fromEnvironment);
    if (existsSync(abs)) return abs;
    const alias = STALE_REL_ALIASES[fromEnvironment.replace(/\\/g, '/')];
    if (alias !== undefined) {
      const mapped = resolve(base, alias);
      if (existsSync(mapped)) return mapped;
    }
    return abs;
  }

  return undefined;
}

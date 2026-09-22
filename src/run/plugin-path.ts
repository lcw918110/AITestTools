import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RoomDoc } from '../exam-engine/types.ts';

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
 * - 显式 `host.plugin` 或 `PROCTOR_HOSTED_PLUGIN` 才挂插件
 * - `plugin: "auto"` 时才在 SUT_ROOT 下探测（避免 paired-off 被 SUT_ROOT 误挂万象术）
 */
export function resolvePluginPath(room: RoomDoc, projectRoot: string): string | undefined {
  const fromEnv = process.env.PROCTOR_HOSTED_PLUGIN;
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);

  const fromRoom = room.host?.plugin;
  if (fromRoom === 'auto') {
    const sut = process.env.SUT_ROOT;
    if (!sut) return undefined;
    return firstExisting(sut, WANXIANGSHU_PLUGIN_CANDIDATES);
  }

  if (typeof fromRoom === 'string' && fromRoom.length > 0) {
    if (fromRoom.startsWith('/')) return fromRoom;
    const sut = process.env.SUT_ROOT;
    const base = sut ?? projectRoot;
    const abs = resolve(base, fromRoom);
    if (existsSync(abs)) return abs;
    const alias = STALE_REL_ALIASES[fromRoom.replace(/\\/g, '/')];
    if (alias !== undefined) {
      const mapped = resolve(base, alias);
      if (existsSync(mapped)) return mapped;
    }
    return abs;
  }

  return undefined;
}

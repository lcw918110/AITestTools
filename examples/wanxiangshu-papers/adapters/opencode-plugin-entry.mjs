/**
 * OpenCode 插件入口（L2 假宿主 / hosted 共用）。
 *
 * 万象术 0.8+ 入口：`dist/Infrastructure/OpenCode/Plugin/Plugin.js`
 * 导出 `{ id: "wanxiangshu-next", server }`，不再提供 `plugin(ctx)` 工厂。
 * 本文件把新导出适配成 `plugin(ctx)`，并回退旧路径。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATES = [
  'dist/Infrastructure/OpenCode/Plugin/Plugin.js',
  'build/next/OpenCode/Plugin.js',
  'build/src/Hosts/OpenCode/Plugin.js',
  'build/src/Opencode/Plugin.js',
];

const sutRoot =
  process.env.SUT_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '../..');

function resolvePluginFile(root) {
  for (const rel of CANDIDATES) {
    const abs = join(root, rel);
    if (existsSync(abs)) return abs;
  }
  return join(root, CANDIDATES[0]);
}

const pluginFile = resolvePluginFile(sutRoot);
const mod = await import(pathToFileURL(pluginFile).href);
const pack =
  mod.default !== null && typeof mod.default === 'object' ? mod.default : mod;
const server = typeof pack.server === 'function' ? pack.server : null;
const legacy =
  typeof mod.plugin === 'function'
    ? mod.plugin
    : typeof mod.default === 'function'
      ? mod.default
      : null;

export const pluginId = typeof pack.id === 'string' ? pack.id : 'wanxiangshu-next';

export async function plugin(ctx) {
  if (server) return server(ctx);
  if (legacy) return legacy(ctx);
  throw new Error(`万象术 Plugin 无 server / plugin 导出：${pluginFile}`);
}

export default plugin;

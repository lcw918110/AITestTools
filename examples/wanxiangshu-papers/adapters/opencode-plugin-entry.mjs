/**
 * OpenCode 单工厂入口。
 *
 * `build/src/Hosts/OpenCode/Plugin.js` 另导出 `pluginForWithSeams`，
 * OpenCode legacy loader 会把每个导出函数都当插件工厂 → 重复加载。
 * 本文件只暴露一个 `plugin`。
 *
 * 默认 SUT 根 = papers/adapters 上两级（万象术仓根）；可用 `SUT_ROOT` 覆盖。
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sutRoot =
  process.env.SUT_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '../..');

const mod = await import(pathToFileURL(join(sutRoot, 'build/src/Hosts/OpenCode/Plugin.js')).href);

export const plugin = mod.plugin;
export default mod.plugin;

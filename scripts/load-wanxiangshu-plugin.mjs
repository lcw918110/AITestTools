#!/usr/bin/env node
/**
 * 最小加载冒烟：确认 SUT Plugin.js 存在且导出 { id, server }（或旧工厂）。
 * 需 SUT_ROOT。整仓 Fable 未绿时 import 可能失败——如实退出 2，不进 verify。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  'dist/OpenCode/Plugin/Plugin.js',
  'dist/Infrastructure/OpenCode/Plugin/Plugin.js',
  'build/next/OpenCode/Plugin.js',
  'build/src/Hosts/OpenCode/Plugin.js',
  'build/src/Opencode/Plugin.js',
];

const sut = process.env.SUT_ROOT;
if (!sut) {
  process.stderr.write('SUT_ROOT 未设置\n');
  process.exit(2);
}

let pluginFile;
for (const rel of CANDIDATES) {
  const abs = join(sut, rel);
  if (existsSync(abs)) {
    pluginFile = abs;
    break;
  }
}
if (!pluginFile) {
  process.stderr.write(`未找到 Plugin.js（已探 ${CANDIDATES.join(', ')}）\n`);
  process.exit(2);
}

process.stdout.write(`找到 ${pluginFile}\n`);

function resolveExport(mod) {
  if (typeof mod.plugin === 'function') return { id: 'plugin' };
  if (typeof mod.default === 'function') return { id: 'plugin' };
  const pack = mod.default !== null && typeof mod.default === 'object' ? mod.default : mod;
  if (typeof pack.server === 'function') {
    return { id: typeof pack.id === 'string' ? pack.id : 'wanxiangshu-next' };
  }
  return null;
}

try {
  const mod = await import(pathToFileURL(pluginFile).href);
  const resolved = resolveExport(mod);
  if (!resolved) {
    process.stderr.write('导出既非 plugin(ctx) 也非 { id, server }\n');
    process.exit(2);
  }
  process.stdout.write(`导出可解析：id=${resolved.id}\n`);
} catch (e) {
  process.stderr.write(
    `Plugin.js 存在但无法 import（万象术 Fable 产物不完整）：${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(2);
}

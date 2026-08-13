import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomDoc } from '../../src/exam-engine/types.ts';
import {
  WANXIANGSHU_PLUGIN_CANDIDATES,
  WANXIANGSHU_PLUGIN_REL,
  resolvePluginPath,
} from '../../src/run/plugin-path.ts';

const prevSut = process.env.SUT_ROOT;
const prevPlugin = process.env.PROCTOR_HOSTED_PLUGIN;

afterEach(() => {
  if (prevSut === undefined) delete process.env.SUT_ROOT;
  else process.env.SUT_ROOT = prevSut;
  if (prevPlugin === undefined) delete process.env.PROCTOR_HOSTED_PLUGIN;
  else process.env.PROCTOR_HOSTED_PLUGIN = prevPlugin;
});

function room(plugin: string): RoomDoc {
  return {
    name: 't',
    kind: 'hosted',
    model_driver: 'live',
    network: true,
    host: { plugin },
  };
}

describe('WANXIANGSHU_PLUGIN_CANDIDATES', () => {
  it('新 dist 路径排第一', () => {
    expect(WANXIANGSHU_PLUGIN_CANDIDATES[0]).toBe(WANXIANGSHU_PLUGIN_REL);
    expect(WANXIANGSHU_PLUGIN_REL).toBe('dist/Infrastructure/OpenCode/Plugin/Plugin.js');
  });
});

describe('resolvePluginPath', () => {
  it('auto 优先命中 dist 新路径', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-plugin-'));
    const modern = join(root, WANXIANGSHU_PLUGIN_REL);
    mkdirSync(join(modern, '..'), { recursive: true });
    writeFileSync(modern, 'export default {}\n');
    const legacy = join(root, 'build/src/Hosts/OpenCode/Plugin.js');
    mkdirSync(join(legacy, '..'), { recursive: true });
    writeFileSync(legacy, 'export default {}\n');
    process.env.SUT_ROOT = root;
    expect(resolvePluginPath(room('auto'), root)).toBe(modern);
  });

  it('显式旧路径不存在时回退到 dist', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-plugin-'));
    const modern = join(root, WANXIANGSHU_PLUGIN_REL);
    mkdirSync(join(modern, '..'), { recursive: true });
    writeFileSync(modern, 'export default {}\n');
    process.env.SUT_ROOT = root;
    expect(resolvePluginPath(room('build/src/Hosts/OpenCode/Plugin.js'), root)).toBe(modern);
  });
});

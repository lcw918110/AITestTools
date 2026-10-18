import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EnvironmentProfile } from '../../src/exam-engine/types.ts';
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

function environment(plugin: string): EnvironmentProfile {
  return {
    environment_profile_id: 't',
    name: 't',
    lifecycle: 'active',
    recipe: {
      kind: 'hosted',
      host_plugin: plugin,
    },
  };
}

describe('WANXIANGSHU_PLUGIN_CANDIDATES', () => {
  it('新 dist 路径排第一', () => {
    expect(WANXIANGSHU_PLUGIN_CANDIDATES[0]).toBe(WANXIANGSHU_PLUGIN_REL);
    expect(WANXIANGSHU_PLUGIN_REL).toBe('dist/OpenCode/Plugin/Plugin.js');
  });

  it('保留 Infrastructure 旧布局作回退', () => {
    expect(WANXIANGSHU_PLUGIN_CANDIDATES).toContain(
      'dist/Infrastructure/OpenCode/Plugin/Plugin.js',
    );
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
    expect(resolvePluginPath(environment('auto'), root)).toBe(modern);
  });

  it('显式旧路径不存在时回退到 dist', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-plugin-'));
    const modern = join(root, WANXIANGSHU_PLUGIN_REL);
    mkdirSync(join(modern, '..'), { recursive: true });
    writeFileSync(modern, 'export default {}\n');
    process.env.SUT_ROOT = root;
    expect(resolvePluginPath(environment('build/src/Hosts/OpenCode/Plugin.js'), root)).toBe(modern);
  });

  it('显式 Infrastructure 旧路径回退到现行 dist', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-plugin-'));
    const modern = join(root, WANXIANGSHU_PLUGIN_REL);
    mkdirSync(join(modern, '..'), { recursive: true });
    writeFileSync(modern, 'export default {}\n');
    process.env.SUT_ROOT = root;
    expect(
      resolvePluginPath(environment('dist/Infrastructure/OpenCode/Plugin/Plugin.js'), root),
    ).toBe(modern);
  });
});

/**
 * 构建产物分发契约（ISSUE-0016）。
 *
 * `tsc -p tsconfig.build.json` 只增量产出编译结果，不会删除「源码已删除」的旧产物；
 * 而 `package.json` 的 `files` 把整个 `dist` 打进发布包。若 build 不先 clean，
 * 已退役命令（`item-resolve` / `item-migrate` / `item-retire` / `item-bump-rev`）
 * 会随 npm 包一起发布，且 `proctor --help` 这类入口不会被误导、但包体与审计面被污染。
 *
 * 本用例锁住「build 必须先清空 dist」这一契约：一旦有人把 build 改回纯 `tsc`，这里立刻变红。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

interface PackageJson {
  scripts?: Record<string, string>;
  files?: string[];
  bin?: Record<string, string>;
  main?: string;
  types?: string;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as PackageJson;
}

describe('构建产物分发契约', () => {
  it('build 脚本必须先清理 dist 再编译（防止退役产物随包发布）', () => {
    const scripts = readPackageJson().scripts ?? {};
    const build = scripts.build ?? '';
    expect(build).toContain('clean');
    // clean 必须发生在 tsc 之前，否则清理无效
    const cleanAt = build.indexOf('clean');
    const tscAt = build.indexOf('tsc');
    expect(cleanAt).toBeGreaterThanOrEqual(0);
    expect(tscAt).toBeGreaterThanOrEqual(0);
    expect(cleanAt).toBeLessThan(tscAt);
  });

  it('prepublishOnly 复用的 build 已含清理，不得再重复前置 clean', () => {
    const scripts = readPackageJson().scripts ?? {};
    const prepublish = scripts.prepublishOnly ?? '';
    // build 自身已 clean，再叠一层会白白多删一次；且两处口径易漂移
    expect(prepublish).toBe('npm run build');
  });

  it('bin 入口与 files 声明的 dist 目录指向一致', () => {
    const pkg = readPackageJson();
    const binPath = pkg.bin?.proctor ?? '';
    expect(binPath.startsWith('dist/')).toBe(true);
    expect(pkg.files).toContain('dist');
    // bin 目标必须落在被分发的 dist 内，否则安装后命令缺失
    expect(binPath.endsWith('.js')).toBe(true);
  });
});

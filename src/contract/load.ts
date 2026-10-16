import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HostContract } from '../drivers/fakehost/index.ts';

/**
 * 宿主契约加载（bundled contract）。
 *
 * 职责边界：仅负责加载仓库内预置的宿主契约 JSON 文件（bundled HostContract），
 * 不涉及考卷/项目资产（item/paperset/room）的加载逻辑。后者由 exam-engine/loader 承担。
 *
 * 为何这里不收敛到公共 JSON 加载函数：
 * - 契约加载是静态 bundled 资源，直接 cast，无需保留 raw 文本、无需错误包装；
 * - 考卷/项目加载返回 LoadedAsset（含 path/relPath/raw/doc），需要 raw 供 digest 校验
 *   和 AssetParseError 定位到具体文件；
 * - 两处语义不同，表面重叠仅 Node 标准库的一行样板（readFileSync + JSON.parse），
 *   强行收敛会引入无业务实质的抽象层。
 */

const here = dirname(fileURLToPath(import.meta.url));

export function loadBundledContract(id: string): HostContract {
  const file = join(here, `${id}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as HostContract;
}

export function listBundledContracts(): string[] {
  return ['opencode-v1.18'];
}

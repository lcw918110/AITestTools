/**
 * 考卷/项目资产加载器。
 *
 * 职责边界：递归扫描目录，收集、读取、解析 exam-engine 资产文件
 * （item/paperset/room），返回 LoadedAsset（含 path/relPath/raw/doc 四元组）。
 *
 * 与 contract/load.ts 的区别：
 * - contract/load.ts 加载宿主契约（bundled HostContract），直接 cast 返回结构体；
 * - 本模块加载考卷/项目资产，保留 raw 文本（供 digest 等后续校验使用），
 *   JSON 解析错误包装为 AssetParseError（带具体文件路径）；
 * - 两者职责不同，语义异构，不应合并为公共 JSON 加载函数。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { ItemDoc, LoadedAsset, PapersetDoc, RoomDoc } from './types.ts';

export const ITEM_SUFFIX = '.item.json';

export function collectFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectFiles(full, suffix));
    else if (entry.endsWith(suffix)) found.push(full);
  }
  return found;
}

export class AssetParseError extends Error {
  readonly file: string;

  constructor(file: string, cause: Error) {
    super(`JSON 解析失败：${file}\n  ${cause.message}`);
    this.name = 'AssetParseError';
    this.file = file;
  }
}

function read<T>(file: string, root: string): LoadedAsset<T> {
  const raw = readFileSync(file, 'utf8');
  try {
    return { path: file, relPath: relative(root, file), raw, doc: JSON.parse(raw) as T };
  } catch (e) {
    throw new AssetParseError(file, e as Error);
  }
}

export function loadItemFile(file: string, root: string): LoadedAsset<ItemDoc> {
  return read<ItemDoc>(resolve(file), root);
}

export function loadItems(dir: string, root: string): LoadedAsset<ItemDoc>[] {
  return collectFiles(dir, ITEM_SUFFIX).map((f) => read<ItemDoc>(f, root));
}

export function loadPapersets(dir: string, root: string): LoadedAsset<PapersetDoc>[] {
  return collectFiles(dir, '.json').map((f) => read<PapersetDoc>(f, root));
}

export function loadRooms(dir: string, root: string): LoadedAsset<RoomDoc>[] {
  return collectFiles(dir, '.json').map((f) => read<RoomDoc>(f, root));
}

/** @deprecated */
export const CASE_SUFFIX = ITEM_SUFFIX;
/** @deprecated */
export const loadCaseFile = loadItemFile;
/** @deprecated */
export const loadCases = loadItems;
/** @deprecated */
export const loadSuites = loadPapersets;
/** @deprecated */
export const loadProfiles = loadRooms;

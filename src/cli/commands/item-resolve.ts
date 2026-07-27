import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadItems } from '../../exam-engine/loader.ts';
import type { ItemDoc, LoadedAsset } from '../../exam-engine/types.ts';
import type { ExamProject } from '../../exam-engine/project.ts';

/** 按 id 或 `.json` 路径解析试题资产。 */
export function resolveItemAsset(
  project: ExamProject,
  idOrPath: string,
): LoadedAsset<ItemDoc> | { error: string } {
  if (existsSync(resolve(idOrPath)) && idOrPath.endsWith('.json')) {
    const abs = resolve(idOrPath);
    const items = loadItems(project.dirs.items, project.root);
    const hit = items.find((i) => i.path === abs);
    if (hit !== undefined) return hit;
    // 允许项目外临时文件：仅返回 path，由调用方 read
    return {
      path: abs,
      relPath: abs,
      raw: '',
      doc: { id: '' } as ItemDoc,
    };
  }
  const items = loadItems(project.dirs.items, project.root);
  const hit = items.find((i) => i.doc.id === idOrPath);
  if (hit === undefined) return { error: `找不到试题 id：${idOrPath}` };
  return hit;
}

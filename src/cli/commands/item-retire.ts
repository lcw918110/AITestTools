import { readFileSync, writeFileSync } from 'node:fs';
import { loadProject } from '../../exam-engine/project.ts';
import { resolveItemAsset } from './item-resolve.ts';

export interface ItemRetireOptions {
  project?: string | undefined;
  idOrPath?: string | undefined;
  name?: string | undefined;
  note?: string | undefined;
  json: boolean;
}

/** 退役：status → deprecated，并升 rev。 */
export function runItemRetire(options: ItemRetireOptions): number {
  if (options.idOrPath === undefined) {
    console.error('用法：proctor item retire <item_id|文件路径> [--project ...] [--name <说明>]');
    return 2;
  }
  const project = loadProject(options.project);
  const hit = resolveItemAsset(project, options.idOrPath);
  if ('error' in hit) {
    console.error(hit.error);
    return 1;
  }
  if (!hit.doc.id) {
    // 路径解析到非考卷库文件时仍可读
  }
  const filePath = hit.path;
  const doc = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  if (doc.status === 'deprecated') {
    console.error(`已是 deprecated：${String(doc.id)}`);
    return 1;
  }
  const prev = Number(doc.rev);
  if (!Number.isFinite(prev)) {
    console.error(`试题缺少合法 rev：${filePath}`);
    return 1;
  }
  const next = prev + 1;
  doc.rev = next;
  doc.status = 'deprecated';
  const note = options.note ?? options.name ?? 'retired';
  const log =
    doc.change_log && typeof doc.change_log === 'object'
      ? { ...(doc.change_log as Record<string, string>) }
      : {};
  log[`rev${next}`] = `deprecated: ${String(note)}`;
  doc.change_log = log;
  writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  const out = { file: filePath, id: doc.id, from_rev: prev, to_rev: next, status: 'deprecated' };
  if (options.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`已退役：${String(doc.id)} rev${prev} → rev${next}（deprecated）`);
  return 0;
}

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { loadProject } from '../../exam-engine/project.ts';
import { resolveItemAsset } from './item-resolve.ts';

export interface ItemBumpRevOptions {
  project?: string | undefined;
  /** 试题 id，或 item 文件路径 */
  idOrPath?: string | undefined;
  /** 变更说明（也可用 CLI --name） */
  note?: string | undefined;
  name?: string | undefined;
  json: boolean;
}

/** 升 rev：原地改 rev + change_log。 */
export function runItemBumpRev(options: ItemBumpRevOptions): number {
  if (options.idOrPath === undefined) {
    console.error(
      '用法：proctor item bump-rev <item_id|文件路径> [--project <考卷库>] [--name <变更说明>]',
    );
    return 2;
  }

  const project = loadProject(options.project);
  const hit = resolveItemAsset(project, options.idOrPath);
  if ('error' in hit) {
    console.error(hit.error);
    return 1;
  }
  const filePath = hit.path;

  const doc = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  const prev = Number(doc.rev);
  if (!Number.isFinite(prev)) {
    console.error(`试题缺少合法 rev：${filePath}`);
    return 1;
  }
  const next = prev + 1;
  doc.rev = next;
  const note = options.note ?? options.name ?? `bump to rev${next}`;
  const log =
    doc.change_log && typeof doc.change_log === 'object'
      ? { ...(doc.change_log as Record<string, string>) }
      : {};
  log[`rev${next}`] = String(note);
  doc.change_log = log;

  writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  const out = {
    file: filePath,
    id: doc.id,
    from_rev: prev,
    to_rev: next,
    note: String(note),
  };
  if (options.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(
      `已升版：${String(doc.id)} rev${prev} → rev${next}（${basename(dirname(filePath))}/${basename(filePath)}）`,
    );
  }
  return 0;
}

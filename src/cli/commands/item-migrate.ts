import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProject } from '../../exam-engine/project.ts';
import { resolveItemAsset } from './item-resolve.ts';

export interface ItemMigrateOptions {
  project?: string | undefined;
  idOrPath?: string | undefined;
  /** 形如 OldEvent:NewEvent，可多次 */
  map: string[];
  name?: string | undefined;
  note?: string | undefined;
  json: boolean;
}

function parseMaps(raw: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const entry of raw) {
    const idx = entry.indexOf(':');
    if (idx <= 0) {
      throw new Error(`--map 须为 Old:New，收到：${entry}`);
    }
    m.set(entry.slice(0, idx), entry.slice(idx + 1));
  }
  return m;
}

function rewriteNdjson(text: string, map: Map<string, string>): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (typeof obj.type === 'string' && map.has(obj.type)) {
        obj.type = map.get(obj.type);
      }
      if (typeof obj.kind === 'string' && map.has(obj.kind)) {
        obj.kind = map.get(obj.kind);
      }
      return JSON.stringify(obj);
    })
    .join('\n');
}

function rewriteNames(names: unknown, map: Map<string, string>): unknown {
  if (!Array.isArray(names)) return names;
  return names.map((n) => (typeof n === 'string' && map.has(n) ? map.get(n) : n));
}

/**
 * 事件 schema 迁移：按 --map Old:New 改写 stimulus.ndjson 与 expect 中的 names，并升 rev。
 */
export function runItemMigrate(options: ItemMigrateOptions): number {
  if (options.idOrPath === undefined || options.map.length === 0) {
    console.error(
      '用法：proctor item migrate <item_id|文件> --map Old:New [--map ...] [--project ...] [--name ...]',
    );
    return 2;
  }

  let map: Map<string, string>;
  try {
    map = parseMaps(options.map);
  } catch (e) {
    console.error((e as Error).message);
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
  const stimulus = doc.stimulus as { kind?: string; ref?: string } | undefined;
  if (stimulus?.ref === undefined) {
    console.error('试题缺少 stimulus.ref');
    return 1;
  }

  const stimPath = resolve(project.root, stimulus.ref);
  const touched: string[] = [];
  if (existsSync(stimPath) && stimPath.endsWith('.ndjson')) {
    const next = rewriteNdjson(readFileSync(stimPath, 'utf8'), map);
    writeFileSync(stimPath, next.endsWith('\n') ? next : `${next}\n`);
    touched.push(stimPath);
  }

  const expect = doc.expect as { oracles?: Array<Record<string, unknown>> } | undefined;
  if (expect?.oracles) {
    for (const o of expect.oracles) {
      if ('names' in o) o.names = rewriteNames(o.names, map) as unknown[];
    }
  }

  const prev = Number(doc.rev);
  const next = prev + 1;
  doc.rev = next;
  const note =
    options.note ??
    options.name ??
    `migrate ${[...map.entries()].map(([a, b]) => `${a}→${b}`).join(', ')}`;
  const log =
    doc.change_log && typeof doc.change_log === 'object'
      ? { ...(doc.change_log as Record<string, string>) }
      : {};
  log[`rev${next}`] = String(note);
  doc.change_log = log;
  writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  touched.push(filePath);

  const out = {
    file: filePath,
    id: doc.id,
    from_rev: prev,
    to_rev: next,
    map: Object.fromEntries(map),
    touched,
  };
  if (options.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(
      `已迁移：${String(doc.id)} rev${prev} → rev${next}（${[...map.keys()].length} 条映射）`,
    );
  }
  return 0;
}

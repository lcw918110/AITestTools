/**
 * 读 product-eval 项目产物的只读助手：runs 列表、项目摘要、组卷索引。
 * 从原 server.ts 精确迁移，不改变函数行为。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonObject, str, strArray } from './parse.ts';
import { taskIdsOfItems, type PapersetIndex } from './run-plan.ts';
import { listTestSets } from './test-sets.ts';
import { PROJECT } from './config.ts';

export function listRuns(limit = 20): Array<{ path: string; name: string; mtime: number }> {
  const runsDir = join(PROJECT, 'runs');
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .map((name) => {
      const path = join(runsDir, name);
      try {
        const st = statSync(path);
        if (!st.isDirectory()) return undefined;
        return { path, name, mtime: st.mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((x): x is { path: string; name: string; mtime: number } => x !== undefined)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

export function projectSummary() {
  const errors: string[] = [];
  let examName = '';
  let examDescription = '';
  try {
    const examRaw = readFileSync(join(PROJECT, 'exam.json'), 'utf8');
    const parsed = parseJsonObject(examRaw, 'exam.json');
    if (parsed.ok) {
      examName = str(parsed.value.name) ?? '';
      examDescription = str(parsed.value.description) ?? '';
    } else {
      errors.push(parsed.error);
    }
  } catch (e) {
    errors.push(`exam.json：读取失败（${(e as Error).message}）`);
  }

  const papersetsDir = join(PROJECT, 'papersets');
  const papersets = readdirSync(papersetsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const text = readFileSync(join(papersetsDir, f), 'utf8');
        const parsed = parseJsonObject(text, `papersets/${f}`);
        if (!parsed.ok) {
          errors.push(parsed.error);
          return undefined;
        }
        const doc = parsed.value;
        const name = str(doc.name);
        if (name === undefined) {
          errors.push(`papersets/${f}：缺少 name`);
          return undefined;
        }
        const desc = str(doc.description) ?? '';
        const room = str(doc.room) ?? '';
        const items = strArray(doc.items) ?? [];
        return {
          file: f.replace(/\.json$/, ''),
          name,
          description: desc,
          room,
          itemCount: items.length,
          taskIds: taskIdsOfItems(items),
        };
      } catch (e) {
        errors.push(`papersets/${f}：读取失败（${(e as Error).message}）`);
        return undefined;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  const roomsDir = join(PROJECT, 'rooms');
  const rooms = readdirSync(roomsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const text = readFileSync(join(roomsDir, f), 'utf8');
        const parsed = parseJsonObject(text, `rooms/${f}`);
        if (!parsed.ok) {
          errors.push(parsed.error);
          return undefined;
        }
        const doc = parsed.value;
        const name = str(doc.name);
        if (name === undefined) {
          errors.push(`rooms/${f}：缺少 name`);
          return undefined;
        }
        const desc = str(doc.description) ?? '';
        const host = doc.host;
        let model = '';
        let hasPlugin = false;
        if (typeof host === 'object' && host !== null && !Array.isArray(host)) {
          const h = host as Record<string, unknown>;
          model = str(h.model) ?? '';
          hasPlugin = typeof h.plugin === 'string' && h.plugin.length > 0;
        }
        return { name, description: desc, model, hasPlugin };
      } catch (e) {
        errors.push(`rooms/${f}：读取失败（${(e as Error).message}）`);
        return undefined;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  const materials = existsSync(join(PROJECT, 'bank/materials'))
    ? readdirSync(join(PROJECT, 'bank/materials')).filter((n) => !n.startsWith('.'))
    : [];
  return {
    project: 'examples/product-eval',
    exam: examName,
    description: examDescription,
    papersets,
    testSets: listTestSets(PROJECT),
    rooms,
    tasks: materials,
    defaults: {
      sutRoot: process.env.SUT_ROOT ?? '',
      model: process.env.PROCTOR_HOSTED_MODEL ?? '',
    },
    errors,
  };
}

export function loadPapersetIndex(): PapersetIndex[] {
  const dir = join(PROJECT, 'papersets');
  if (!existsSync(dir)) return [];
  const out: PapersetIndex[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const parsed = parseJsonObject(readFileSync(join(dir, f), 'utf8'), `papersets/${f}`);
      if (!parsed.ok) continue;
      const name = str(parsed.value.name);
      if (name === undefined) continue;
      const items = strArray(parsed.value.items) ?? [];
      out.push({ name, items, taskIds: taskIdsOfItems(items) });
    } catch {
      continue;
    }
  }
  return out;
}

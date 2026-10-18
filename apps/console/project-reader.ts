/**
 * 读 product-eval 项目产物的只读助手：runs 列表、项目摘要、组卷索引。
 * 从原 server.ts 精确迁移，不改变函数行为。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonObject, str } from './parse.ts';
import { taskIdsOfCaseRevisions, type ReleaseIndex } from './run-plan.ts';
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

  const environmentsDir = join(PROJECT, 'environments');
  const environments = readdirSync(environmentsDir)
    .filter((f) => f.endsWith('.environment.json'))
    .map((f) => {
      try {
        const text = readFileSync(join(environmentsDir, f), 'utf8');
        const parsed = parseJsonObject(text, `environments/${f}`);
        if (!parsed.ok) {
          errors.push(parsed.error);
          return undefined;
        }
        const doc = parsed.value;
        const name = str(doc.name) ?? str(doc.environment_profile_id);
        if (name === undefined) {
          errors.push(`environments/${f}：缺少 name`);
          return undefined;
        }
        const recipe = doc.recipe;
        let model = '';
        let hasPlugin = false;
        if (typeof recipe === 'object' && recipe !== null && !Array.isArray(recipe)) {
          const r = recipe as Record<string, unknown>;
          model = str(r.host_model) ?? '';
          hasPlugin = typeof r.host_plugin === 'string' && r.host_plugin.length > 0;
        }
        return { name, description: '', model, hasPlugin };
      } catch (e) {
        errors.push(`environments/${f}：读取失败（${(e as Error).message}）`);
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
    testSets: listTestSets(PROJECT),
    environments,
    tasks: materials,
    defaults: {
      sutRoot: process.env.SUT_ROOT ?? '',
      model: process.env.PROCTOR_HOSTED_MODEL ?? '',
    },
    errors,
  };
}

export function loadReleaseIndex(): ReleaseIndex[] {
  const dir = join(PROJECT, 'dataset-releases');
  if (!existsSync(dir)) return [];
  const out: ReleaseIndex[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.dataset-release.json')) continue;
    try {
      const parsed = parseJsonObject(readFileSync(join(dir, f), 'utf8'), `dataset-releases/${f}`);
      if (!parsed.ok) continue;
      const name = str(parsed.value.name) ?? str(parsed.value.dataset_release_id);
      if (name === undefined) continue;
      const caseRevisions = parsed.value.case_revisions;
      const revisionIds = Array.isArray(caseRevisions)
        ? caseRevisions
            .filter((r): r is { case_revision_id?: string } => Boolean(r) && typeof r === 'object')
            .map((r) => r.case_revision_id)
            .filter((x): x is string => typeof x === 'string')
        : [];
      out.push({
        name,
        case_revisions: revisionIds,
        taskIds: taskIdsOfCaseRevisions(revisionIds.map((id) => ({ case_revision_id: id }))),
      });
    } catch {
      continue;
    }
  }
  return out;
}

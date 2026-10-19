/**
 * 从题目配置（case-revisions/*.case-revision.json）解析 rubric。
 * 触发裁判时自动读 `CaseRevision.expect.rubric`，题目未声明则返回 undefined。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RubricSpec } from '../domain/types.ts';

/** case revision 文件里 rubric 的形态（expect.rubric）。 */
type CaseRevisionDoc = {
  case_revision_id?: string;
  expect?: {
    rubric?: RubricSpec;
  };
};

function isRubricSpec(v: unknown): v is RubricSpec {
  if (typeof v !== 'object' || v === null) return false;
  const dims = (v as { dimensions?: unknown }).dimensions;
  if (!Array.isArray(dims) || dims.length === 0) return false;
  return dims.every(
    (d) =>
      typeof d === 'object' &&
      d !== null &&
      typeof (d as { name?: unknown }).name === 'string' &&
      typeof (d as { scale?: unknown }).scale === 'string' &&
      typeof (d as { weight?: unknown }).weight === 'number',
  );
}

/**
 * 按 item_id（= case_revision_id）解析题目 rubric。
 * 返回 undefined 表示：文件不存在 / 无 rubric / rubric 非法。
 */
export function resolveRubricFromCaseRevision(
  project: string,
  itemId: string,
): RubricSpec | undefined {
  const path = join(project, 'case-revisions', `${itemId}.case-revision.json`);
  if (!existsSync(path)) return undefined;
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8')) as CaseRevisionDoc;
    const rubric = doc.expect?.rubric;
    return isRubricSpec(rubric) ? rubric : undefined;
  } catch {
    return undefined;
  }
}

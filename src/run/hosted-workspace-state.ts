import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 播种内容指纹。
 * 显式区分「文件本来不存在」与「读不到 / 快照没这个 key」——
 * 两者都退化成空串会让下游把「无法比对」误当成「原本就不存在」。
 */
export interface SeedSnapshot {
  /** rel → sha256；`null` 表示播种时该文件就不存在。 */
  digests: Record<string, string | null>;
  /** 播种时就被列出、但当时读不到的文件。这些 rel 一律不可比对。 */
  unreadable: string[];
}

/**
 * 读文件并算 sha256。
 * - `''`：确认文件不存在（ENOENT）
 * - `null`：无法判定（权限、目录、竞态删除等）
 *
 * 不能用 `existsSync` 判存在性：它在 EACCES/EPERM 下同样返回 false，
 * 会把「没权限读」错判成「文件不存在」，进而给出确定的错误结论。
 */
export function digestFile(abs: string): string | null {
  let stat;
  try {
    stat = statSync(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // 只有明确不存在才是空指纹，其余一律不可判定。
    if (code === 'ENOENT' || code === 'ENOTDIR') return '';
    return null;
  }
  if (!stat.isFile()) return null;
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex');
  } catch {
    // 存在但读不到（权限、竞态删除）：不能当作「没变」或「空内容」。
    return null;
  }
}

/** 播种完成后对材料文件做内容指纹，供「超时后有没有改过仓库」对照。 */
export function snapshotSeededFiles(workDir: string, seeded: string[]): SeedSnapshot {
  // 用无原型对象，避免 `constructor` / `__proto__` 这类裸名命中原型链。
  const digests: Record<string, string | null> = Object.create(null) as Record<
    string,
    string | null
  >;
  const unreadable: string[] = [];
  for (const rel of seeded) {
    const digest = digestFile(join(workDir, rel));
    if (digest === null) {
      unreadable.push(rel);
      continue;
    }
    digests[rel] = digest === '' ? null : digest;
  }
  return { digests, unreadable };
}

/**
 * 播种目录里内容发生变化（含被删除）的材料文件。
 * 交付面判定要按文件粒度看，不能「任意一个变了就认为全部已交付」。
 * 快照里没有的 rel、或本次读不到的文件，视为不可比对：既不记改动，也不进结果。
 */
export function mutatedSeededFiles(
  workDir: string,
  seeded: string[],
  snapshot: SeedSnapshot,
): string[] {
  const out: string[] = [];
  for (const rel of seeded) {
    if (!Object.hasOwn(snapshot.digests, rel) || snapshot.unreadable.includes(rel)) continue;
    const expected = snapshot.digests[rel];
    const current = digestFile(join(workDir, rel));
    // 本次读不到就无法判断，不能凭空记成改动。
    if (current === null) continue;
    // 快照说「不存在」，现在也不存在 → 没变。
    if (expected === null) {
      if (current !== '') out.push(rel);
      continue;
    }
    if (current !== expected) out.push(rel);
  }
  return out;
}

/** 任一播种文件内容变化即为「改过」。空播种列表 → false（没有材料可改）。 */
export function materialsMutated(
  workDir: string,
  seeded: string[],
  snapshot: SeedSnapshot,
): boolean {
  return mutatedSeededFiles(workDir, seeded, snapshot).length > 0;
}

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function digestFile(abs: string): string {
  if (!existsSync(abs)) return '';
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

/** 播种完成后对材料文件做内容指纹，供「超时后有没有改过仓库」对照。 */
export function snapshotSeededFiles(workDir: string, seeded: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of seeded) {
    out[rel] = digestFile(join(workDir, rel));
  }
  return out;
}

/** 任一播种文件内容变化即为「改过」。空播种列表 → false（没有材料可改）。 */
export function materialsMutated(
  workDir: string,
  seeded: string[],
  snapshot: Record<string, string>,
): boolean {
  for (const rel of seeded) {
    if (digestFile(join(workDir, rel)) !== (snapshot[rel] ?? '')) return true;
  }
  return false;
}

import { createHash } from 'node:crypto';
import type { CaseRevision } from './types.ts';

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * CaseRevision 内容摘要（cases-v1）。
 * 基于输入/前提/预期/Oracle/Rubric/证据/清理 的规范化摘要。
 * 与 scripts/migrate-v2.mjs 的 contentHash 语义一致。
 */
export function revisionDigest(doc: CaseRevision): string {
  return sha256(
    canonicalize({
      stimulus: doc.stimulus,
      preconditions: doc.preconditions ?? [],
      expect: doc.expect,
      evidence_requirements: doc.evidence_requirements ?? [],
      setup_cleanup: doc.setup_cleanup ?? [],
    }),
  );
}

export function fileDigest(raw: string): string {
  return sha256(raw);
}

/**
 * DatasetRelease 冻结闭包摘要（`closure_hash`）。
 *
 * 输入是 `case_revisions` 引用列表本身（`item-new` 写入时即用此口径）。
 * 此前该字段**只在写入侧计算**，读取侧从不校验：手工改引用后忘记重算，
 * 声明值与实际闭包静默不一致，门禁形同虚设。导出本函数让校验侧复用同一口径，
 * 避免两边各写一遍 canonicalize+sha256 而漂移。
 */
export function closureDigest(refs: readonly unknown[]): string {
  return sha256(canonicalize(refs));
}

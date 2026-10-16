import { createHash } from 'node:crypto';
import type { CaseRevision, ItemDoc } from './types.ts';

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

/** @deprecated 使用 revisionDigest。基于 V1 字段（axis/freeze/...）。 */
export function semanticDigest(doc: ItemDoc): string {
  return sha256(
    canonicalize({
      axis: doc.axis,
      freeze: doc.freeze,
      stimulus: doc.stimulus,
      expect: doc.expect,
      metrics: doc.metrics,
      execution: doc.execution,
    }),
  );
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

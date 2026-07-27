import { createHash } from 'node:crypto';
import type { ItemDoc } from './types.ts';

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

export function fileDigest(raw: string): string {
  return sha256(raw);
}

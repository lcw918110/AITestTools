import type { ItemDoc } from '../exam-engine/types.ts';

export function hostedPassToken(item: ItemDoc): string {
  const raw = item.stimulus.hosted_pass_token?.trim();
  return raw && raw.length > 0 ? raw : 'ok';
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

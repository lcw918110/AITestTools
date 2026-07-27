import type { FreezeA } from '../../exam-engine/types.ts';
import type { FoldEvent } from './load-events.ts';
import { FoldResolveError, normalizeFoldResult, type ResolvedFoldEntry } from './resolve-entry.ts';

function pickSessionId(freeze: FreezeA, events: FoldEvent[]): string | undefined {
  if (freeze.session_id !== undefined) return freeze.session_id;
  const counts = new Map<string, number>();
  for (const e of events) {
    const s = e.Session ?? e.session;
    if (typeof s === 'string' && s.length > 0) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: string | undefined;
  let n = 0;
  for (const [k, v] of counts) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

export async function runFold(opts: {
  resolved: ResolvedFoldEntry;
  events: FoldEvent[];
  freeze: FreezeA;
}): Promise<unknown> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(opts.resolved.moduleUrl)) as Record<string, unknown>;
  } catch (e) {
    throw new FoldResolveError(
      `无法 import Fold 模块：${opts.resolved.spec.module}（${(e as Error).message}）`,
    );
  }
  const fn = mod[opts.resolved.spec.export];
  if (typeof fn !== 'function') {
    throw new FoldResolveError(
      `模块未导出函数 "${opts.resolved.spec.export}"：${opts.resolved.spec.module}`,
    );
  }

  let raw: unknown;
  try {
    if (opts.resolved.spec.signature === 'session_fold_v1') {
      const sid = pickSessionId(opts.freeze, opts.events);
      if (sid === undefined) {
        throw new FoldResolveError('session_fold_v1 需要 session_id 或事件中的 Session 字段');
      }
      raw = await Promise.resolve(
        (fn as (sessionId: string, events: FoldEvent[]) => unknown)(sid, opts.events),
      );
    } else {
      raw = await Promise.resolve((fn as (events: FoldEvent[]) => unknown)(opts.events));
    }
  } catch (e) {
    if (e instanceof FoldResolveError) throw e;
    // 被测折叠逻辑抛错 → 上层标 PROTOCOL
    const err = new Error(`Fold 执行抛错：${(e as Error).message}`);
    (err as Error & { attribution: string }).attribution = 'PROTOCOL';
    throw err;
  }

  return normalizeFoldResult(raw, opts.resolved.normalize);
}

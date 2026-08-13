/** 解析万象术 durable NDJSON，供 hosted 归因探针使用。 */

export function collectNdjsonKinds(text: string): Set<string> {
  const kinds = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '') continue;
    try {
      const row = JSON.parse(t) as Record<string, unknown>;
      const k = row.kind ?? row.Kind;
      if (typeof k === 'string' && k.length > 0) kinds.add(k);
    } catch {
      /* 坏行忽略，由上层看是否空文件 */
    }
  }
  return kinds;
}

/** 返回尚未出现在日志中的协议探针 Kind 列表。 */
export function missingProtocolProbes(kinds: Set<string>, probes: string[]): string[] {
  return probes.filter((p) => !kinds.has(p));
}

/**
 * 万象术 0.8+ 不再写 `.wanxiangshu.ndjson` / `assistant_completed`。
 * 这些探针不得再当「插件已挂上」的健康信号。
 */
export const STALE_HOSTED_PROTOCOL_PROBES = new Set(['assistant_completed']);

export function partitionHostedProtocolProbes(probes: string[]): {
  active: string[];
  skippedStale: string[];
} {
  const active: string[] = [];
  const skippedStale: string[] = [];
  for (const p of probes) {
    if (STALE_HOSTED_PROTOCOL_PROBES.has(p)) skippedStale.push(p);
    else active.push(p);
  }
  return { active, skippedStale };
}

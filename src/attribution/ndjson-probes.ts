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

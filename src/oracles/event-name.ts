/** 从事件对象中提取事件名，按 Kind > kind > type > name 优先级。 */
export function eventName(e: Record<string, unknown>): string {
  const k = e.Kind ?? e.kind ?? e.type ?? e.name;
  return typeof k === 'string' ? k : '';
}

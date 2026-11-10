/**
 * 从事件对象中提取事件名。
 *
 * 兼容四种真实事件源形状：
 * 1. 扁平字段：`Kind > kind > type > name`（本仓内部事件、demo 题库）
 * 2. `fact` 字段：papers-v1 刺激流（`examples/wanxiangshu-papers/materials/*.ndjson`）
 * 3. 万象术 EventStore 的 JournalEnvelope：
 *    `payload.Fact = ['<组>', ['<事件名>', {...}]]`（事件名嵌在 Fact[1][0]）
 * 4. 万象术 EventStore 的 js-tools 生命周期事件：`event_type` 或 `payload.eventType`
 *
 * 优先级说明：`payload.Fact` 排在扁平 `type` 之前。万象术 JournalEnvelope 的外层
 * `event_type` 恒为 `'JournalEnvelope'`，若让外层字段先命中，真实事件名会被吞掉，
 * 使 `no_event` 对禁止事件静默放行。
 *
 * 无法识别时返回空串，不抛错——调用方按「未匹配」处理。
 *
 * 注意：`payload.Fact` 形状不合法（如 `['Runtime', 'RuntimeStarted']`）时本函数
 * 会**回落到外层扁平字段**（JournalEnvelope 的 `event_type`），返回 `'JournalEnvelope'`
 * 而非空串。这是有意的：外层字段是真实存在的类型，不能因内层畸形就丢弃。
 */
export function eventName(e: Record<string, unknown> | null | undefined): string {
  if (typeof e !== 'object' || e === null) return '';

  // 万象术 JournalEnvelope：内层 Fact 才是真实事件名，优先于外层扁平字段。
  // 取最后一层（三级形状下是第三层的事件名，两级形状下是第二层）。
  const layers = factLayers(e.payload);
  if (layers.length >= 2) {
    const innermost = layers[layers.length - 1];
    if (innermost !== undefined) return innermost;
  }

  const flat = e.Kind ?? e.kind ?? e.type ?? e.name;
  if (typeof flat === 'string' && flat !== '') return flat;

  // papers-v1 刺激流：`fact` 与万象术 `payload.Fact` 语义不同，仅在具备
  // 该流的形状特征（runtime/seq 同现）时才认，避免业务对象里普通 `fact` 字段被误判。
  if (
    typeof e.fact === 'string' &&
    e.fact !== '' &&
    e.runtime !== undefined &&
    e.seq !== undefined
  ) {
    return e.fact;
  }

  // 万象术 js-tools 生命周期事件：event_type 优先于 payload.eventType
  // （外层是事件本身的类型，payload 里的只是副本）。
  const fromType = e.event_type;
  if (typeof fromType === 'string' && fromType !== '') return fromType;
  return payloadEventType(e.payload);
}

/**
 * 解析万象术 `payload.Fact` 的层级名，最多三级。
 *
 * 万象术的 Fact 有两种嵌套深度（见 `Persistence/Journal/Envelope.fs:287-309`）：
 * - 两级：`['Runtime', ['RuntimeStarted', {...}]]` —— 顶层族直接带事件名；
 * - 三级：`['Agent', ['Orchestrator', ['ManagerJobCreated', {...}]]]` ——
 *   顶层族下还有子族（AgentFact 的 12 个 case：Prompt / Execution / Orchestrator /
 *   Companion / Context / Host / Fission / Delegation / ChatExecution / Cognition /
 *   ProviderFailure ...），事件名在第三层。
 *
 * 返回 `[族, 子族?, 事件名?]`，逐层取到为止。这是**唯一**的 Fact 解析口径：
 * `eventName` 与 `extractAttributionKinds` 都走它，避免两处各写一遍而漂移
 * （曾出现 eventName 已认三级、kinds 仍只认两级，导致协议探针恒判缺失）。
 */
export function factLayers(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const fact = (payload as Record<string, unknown>).Fact;
  if (!Array.isArray(fact) || fact.length < 2) return [];

  const layers: string[] = [];
  const family = fact[0];
  if (typeof family === 'string' && family.length > 0) layers.push(family);

  let node: unknown = fact[1];
  // 最多下探到第三层：万象术 Fact → AgentFact → *FactCases，不存在四级。
  for (let depth = 0; depth < 2 && Array.isArray(node); depth += 1) {
    const head: unknown = node[0];
    if (typeof head !== 'string' || head.length === 0) break;
    layers.push(head);
    node = node[1];
    // 只有顶层族 `Agent` 才存在子族层（见 Envelope.fs:308 的 agentFactDecoder）。
    // 其余族（`Runtime`）是两级：`node[1]` 是载荷 record。若载荷恰好是数组，
    // 不加这道判断会把载荷首元素误当成事件名——`['Runtime',['RuntimeStarted',['x','y']]]`
    // 会返回 'x' 而不是 'RuntimeStarted'。
    if (layers[0] !== 'Agent') break;
  }
  return layers;
}

/** js-tools 生命周期事件把名字副本放在 `payload.eventType`。 */
function payloadEventType(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const name = (payload as Record<string, unknown>).eventType;
  return typeof name === 'string' ? name : '';
}

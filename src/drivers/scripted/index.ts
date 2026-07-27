import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ScriptNode =
  | { type: 'assistant_text'; text: string; next: string }
  | {
      type: 'tool_calls';
      calls: Array<{ name: string; args: Record<string, unknown> }>;
      next: string;
    }
  | { type: 'terminal'; reason: 'stop' | 'end_turn' | 'abort' }
  | {
      type: 'branch';
      on: Array<{ when: Record<string, unknown>; next: string }>;
      else: string;
    };

export interface ScriptDoc {
  id: string;
  rev: number;
  version: string;
  entry: string;
  nodes: Record<string, ScriptNode>;
}

export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

export function loadScript(projectRoot: string, ref: string): ScriptDoc {
  const raw = JSON.parse(readFileSync(resolve(projectRoot, ref), 'utf8')) as Record<
    string,
    unknown
  >;
  const doc = normalizeScript(raw);
  if (doc.version !== 'scripted-model-v1') {
    throw new ScriptError(`未知剧本协议版本：${doc.version}`);
  }
  if (doc.nodes[doc.entry] === undefined) {
    throw new ScriptError(`entry 节点不存在：${doc.entry}`);
  }
  validateGraph(doc);
  return doc;
}

/** 兼容旧版 steps[] 线性剧本，转换为 scripted-model-v1 节点图。 */
function normalizeScript(raw: Record<string, unknown>): ScriptDoc {
  if (raw.version === 'scripted-model-v1' && raw.nodes !== undefined) {
    return raw as unknown as ScriptDoc;
  }
  if (Array.isArray(raw.steps)) {
    const steps = raw.steps as Array<Record<string, unknown>>;
    const nodes: Record<string, ScriptNode> = {};
    for (let i = 0; i < steps.length; i += 1) {
      const id = `s${i}`;
      const next = `s${i + 1}`;
      const step = steps[i]!;
      if (step.terminal === true) {
        nodes[id] = { type: 'terminal', reason: 'stop' };
      } else if (typeof step.assistant_text === 'string') {
        const calls = Array.isArray(step.tool_calls)
          ? (step.tool_calls as Array<{ name: string; args?: Record<string, unknown> }>)
          : [];
        if (calls.length > 0) {
          nodes[id] = {
            type: 'tool_calls',
            calls: calls.map((c) => ({ name: c.name, args: c.args ?? {} })),
            next,
          };
        } else {
          nodes[id] = { type: 'assistant_text', text: step.assistant_text, next };
        }
      } else {
        throw new ScriptError(`无法识别的 steps[${i}]`);
      }
    }
    // 若最后一步不是 terminal，补一个
    const lastId = `s${steps.length - 1}`;
    const last = nodes[lastId];
    if (last !== undefined && last.type !== 'terminal') {
      const term = `s${steps.length}`;
      if (last.type === 'assistant_text' || last.type === 'tool_calls') last.next = term;
      nodes[term] = { type: 'terminal', reason: 'stop' };
    }
    return {
      id: String(raw.name ?? raw.id ?? 'legacy-script'),
      rev: Number(raw.rev ?? 1),
      version: 'scripted-model-v1',
      entry: 's0',
      nodes,
    };
  }
  throw new ScriptError('剧本须为 scripted-model-v1 或旧版 steps[]');
}

function validateGraph(doc: ScriptDoc): void {
  const ids = new Set(Object.keys(doc.nodes));
  if (ids.size > 64) throw new ScriptError('节点数超过 64');
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.type === 'terminal') continue;
    if (node.type === 'branch') {
      for (const arm of node.on) {
        if (!ids.has(arm.next)) throw new ScriptError(`节点 ${id} 分支指向缺失：${arm.next}`);
      }
      if (!ids.has(node.else)) throw new ScriptError(`节点 ${id} else 指向缺失：${node.else}`);
      continue;
    }
    if (!ids.has(node.next)) throw new ScriptError(`节点 ${id} next 指向缺失：${node.next}`);
  }
}

export interface ScriptContext {
  hookCounts: Record<string, number>;
  lastToolResult?: { name: string; ok: boolean };
  state?: unknown;
}

/** 有限分支：先匹配先胜；条件白名单见设计 13。 */
export function pickBranchNext(
  node: Extract<ScriptNode, { type: 'branch' }>,
  ctx: ScriptContext,
): string {
  for (const arm of node.on) {
    if (matchWhen(arm.when, ctx)) return arm.next;
  }
  return node.else;
}

function matchWhen(when: Record<string, unknown>, ctx: ScriptContext): boolean {
  if (when.hook !== undefined && typeof when.hook === 'object' && when.hook !== null) {
    const h = when.hook as { name?: string; count_gte?: number };
    const name = h.name ?? '';
    const count = ctx.hookCounts[name] ?? 0;
    const gte = h.count_gte ?? 1;
    return count >= gte;
  }
  if (
    when.tool_result !== undefined &&
    typeof when.tool_result === 'object' &&
    when.tool_result !== null
  ) {
    const t = when.tool_result as { name?: string; ok?: boolean };
    return (
      ctx.lastToolResult !== undefined &&
      ctx.lastToolResult.name === t.name &&
      ctx.lastToolResult.ok === t.ok
    );
  }
  return false;
}

export class ScriptPlayer {
  private readonly doc: ScriptDoc;
  private current: string;
  constructor(doc: ScriptDoc) {
    this.doc = doc;
    this.current = doc.entry;
  }

  peek(): ScriptNode {
    const n = this.doc.nodes[this.current];
    if (n === undefined) throw new ScriptError(`当前节点丢失：${this.current}`);
    return n;
  }

  /** 推进到 next；branch 需传入上下文。到达 terminal 后返回 null。 */
  advance(ctx: ScriptContext): ScriptNode | null {
    const n = this.peek();
    if (n.type === 'terminal') return null;
    if (n.type === 'branch') {
      this.current = pickBranchNext(n, ctx);
      return this.peek();
    }
    this.current = n.next;
    return this.peek();
  }
}

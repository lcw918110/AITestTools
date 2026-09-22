import type { ScriptContext, ScriptDoc, ScriptNode } from '../scripted/index.ts';
import { ScriptError, ScriptPlayer } from '../scripted/index.ts';

export interface HostContract {
  id: string;
  host_version?: string;
  hooks: Array<{ name: string }>;
}

export interface FakeHostEvent {
  type: string;
  [key: string]: unknown;
}

export interface FakeHostTrace {
  hooks: string[];
  modelSteps: ScriptNode[];
  events: FakeHostEvent[];
}

/**
 * 契约假宿主最小面：只允许契约声明的 hook；模型侧由 ScriptPlayer 驱动。
 * Phase 1 先覆盖「播剧本 + 记 hook/事件」；完整 SDK 应答在后续补齐。
 */
export class FakeHost {
  private readonly contract: HostContract;
  private readonly allowedHooks: Set<string>;
  private readonly player: ScriptPlayer;
  private readonly ctx: ScriptContext = { hookCounts: {} };
  readonly trace: FakeHostTrace = { hooks: [], modelSteps: [], events: [] };

  constructor(contract: HostContract, script: ScriptDoc) {
    this.contract = contract;
    this.allowedHooks = new Set(contract.hooks.map((h) => h.name));
    this.player = new ScriptPlayer(script);
  }

  /** 插件/测试触发 hook；契约外 → 抛错（上层标 HARNESS）。 */
  triggerHook(name: string, payload: Record<string, unknown> = {}): void {
    if (!this.allowedHooks.has(name)) {
      throw new FakeHostError(`契约外 hook：${name}（contract=${this.contract.id}）`);
    }
    this.trace.hooks.push(name);
    this.ctx.hookCounts[name] = (this.ctx.hookCounts[name] ?? 0) + 1;
    if (name === 'event' && typeof payload.type === 'string') {
      this.emit({ type: payload.type, ...payload });
      const key = `event:${payload.type}`;
      this.ctx.hookCounts[key] = (this.ctx.hookCounts[key] ?? 0) + 1;
    }
  }

  emit(event: FakeHostEvent): void {
    this.trace.events.push(event);
  }

  /** 插件可覆盖工具结果，供后续 branch 条件使用。 */
  setLastToolResult(name: string, ok: boolean): void {
    this.ctx.lastToolResult = { name, ok };
  }

  /** 向模型要一步；返回节点，terminal 后返回 null。 */
  nextModelStep(): ScriptNode | null {
    const node = this.player.peek();
    this.trace.modelSteps.push(node);
    if (node.type === 'terminal') return null;
    if (node.type === 'branch') {
      return this.player.advance(this.ctx);
    }
    // tool_calls 的 ok 由 runner/插件在执行后 setLastToolResult；此处不预置
    this.player.advance(this.ctx);
    return node;
  }

  /** 播完直到 terminal 或步数上限。 */
  runUntilTerminal(maxSteps = 32): FakeHostTrace {
    for (let i = 0; i < maxSteps; i += 1) {
      const n = this.nextModelStep();
      if (n === null) return this.trace;
      if (n.type === 'terminal') return this.trace;
    }
    throw new FakeHostError('剧本超过最大步数仍未 terminal');
  }
}

export class FakeHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FakeHostError';
  }
}

export function assertContractHook(contract: HostContract, name: string): void {
  if (!contract.hooks.some((h) => h.name === name)) {
    throw new FakeHostError(`契约外 hook：${name}`);
  }
}

// re-export for callers that catch ScriptError from host path
export { ScriptError };

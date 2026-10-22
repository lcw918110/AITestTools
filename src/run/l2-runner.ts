import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  loadContract,
  fail,
  computeAxisDraftMetrics,
  applyMetricThresholdPass,
  finalizeAxisResult,
} from './runner-shared.ts';
import { FakeHost, FakeHostError } from '../drivers/fakehost/index.ts';
import { loadScript, ScriptError } from '../drivers/scripted/index.ts';
import type { CaseRevision, EnvironmentProfile } from '../domain/types.ts';
import {
  runEventSubsequenceOracle,
  runNoEventOracle,
  runStatePredicateOracle,
  type OracleOutcome,
} from '../oracles/index.ts';
import type { AxisItemResult } from './runner-types.ts';
import { resolveOpenCodePluginExport } from '../drivers/model-adapter/opencode-plugin-export.ts';
import type {
  AdapterContext,
  CollectedOutput,
  DiscoveredInput,
  ExecutionAdapter,
  PreparedState,
  SubmittedHandle,
} from './execution-adapter.ts';
import { AdapterError } from './execution-adapter.ts';

type HookStyle = 'demo-v1' | 'opencode-v1';

interface SessionStimulus {
  session: Record<string, unknown>;
}

interface PluginEffect {
  events?: Array<Record<string, unknown>>;
  session_patch?: Record<string, unknown>;
  tool_ok?: boolean;
}

interface DemoPluginModule {
  afterTurn?: (state: {
    no_progress_streak: number;
    session: Record<string, unknown>;
  }) => PluginEffect | Promise<PluginEffect>;
  onToolAfter?: (ctx: {
    tool: string;
    args: Record<string, unknown>;
    session: Record<string, unknown>;
  }) => PluginEffect | Promise<PluginEffect>;
}

type OpenCodeHookFn = (...args: unknown[]) => unknown | Promise<unknown>;

interface OpenCodeHooks {
  [name: string]: OpenCodeHookFn | undefined;
}

/** 假宿主侧 stubbed OpenCode ctx：真 Plugin 子集（非 MCP 全真）。 */
interface ProctorPluginCtx {
  directory: string;
  workdir: string;
  client: {
    session: {
      messages: () => Promise<{ data: unknown[] }>;
      create: () => Promise<{ data: { id: string } }>;
      prompt: (...args: unknown[]) => Promise<unknown>;
      abort: () => Promise<Record<string, unknown>>;
    };
  };
  options?: { e2e?: boolean; sutRoot?: string };
  emit: (ev: Record<string, unknown>) => void;
  patchSession: (patch: Record<string, unknown>) => void;
  getSession: () => Record<string, unknown>;
  /** 当前 tool.execute.after 轮次可改写成败 */
  setToolOk: (ok: boolean) => void;
}

function resolveHookStyle(environment: EnvironmentProfile): HookStyle {
  const raw = environment.recipe.adapter?.hook_style;
  if (raw === 'opencode-v1') return 'opencode-v1';
  return 'demo-v1';
}

async function applyPluginEffect(
  host: FakeHost,
  timeline: Record<string, unknown>[],
  session: Record<string, unknown>,
  effect: PluginEffect,
): Promise<void> {
  for (const ev of effect.events ?? []) {
    const type = String(ev.type ?? ev.kind ?? 'event');
    const row = { ...ev, type };
    timeline.push(row);
    host.emit({ type, ...ev });
    host.triggerHook('event', { type, ...ev });
  }
  Object.assign(session, effect.session_patch ?? {});
}

async function callHook(hooks: OpenCodeHooks, name: string, ...args: unknown[]): Promise<void> {
  const fn = hooks[name];
  if (typeof fn !== 'function') return;
  await Promise.resolve(fn(...args));
}

interface L2Discovered {
  execution_profile: NonNullable<CaseRevision['execution_profile']>;
  stimulus: SessionStimulus;
  script: ReturnType<typeof loadScript>;
  contract: ReturnType<typeof loadContract>;
}

/**
 * L2 fakehost adapter：契约假宿主 + 剧本/插件。
 * 把 runL2Item 的隐式生命周期显式化为 8 阶段，执行语义不变。
 * 共享状态（host/session/timeline/插件）用实例字段跨阶段传递。
 */
export class L2Adapter implements ExecutionAdapter {
  readonly adapterId = 'l2-fakehost';

  private host!: FakeHost;
  private session!: Record<string, unknown>;
  private timeline!: Record<string, unknown>[];
  private noProgress = 0;
  private currentToolOk = true;
  private demoPlugin: DemoPluginModule = {};
  private ocHooks: OpenCodeHooks = {};
  private disposeHooks: (() => unknown | Promise<unknown>) | undefined;
  private hookStyle!: HookStyle;
  private skipHookDispatch = false;
  private contract!: { hooks: Array<{ name: string }> };

  async discover(ctx: AdapterContext): Promise<DiscoveredInput> {
    const execution_profile = ctx.revision.execution_profile;
    if (execution_profile === undefined) {
      throw new AdapterError('discover_failed', 'HARNESS', '缺少 execution_profile', false, [
        fail(ctx.revision, 'HARNESS', '缺少 execution_profile'),
      ]);
    }
    this.hookStyle = resolveHookStyle(ctx.environment);

    if (execution_profile.contract === undefined || execution_profile.script === undefined) {
      throw new AdapterError(
        'discover_failed',
        'HARNESS',
        'L2 缺少 execution_profile.contract 或 execution_profile.script',
        false,
        [
          fail(
            ctx.revision,
            'HARNESS',
            'L2 缺少 execution_profile.contract 或 execution_profile.script',
          ),
        ],
      );
    }

    let stimulus: SessionStimulus;
    try {
      stimulus = JSON.parse(
        readFileSync(resolve(ctx.projectRoot, ctx.revision.stimulus.ref), 'utf8'),
      ) as SessionStimulus;
    } catch (e) {
      const msg = `无法加载 stimulus：${(e as Error).message}`;
      throw new AdapterError('discover_failed', 'HARNESS', msg, false, [
        fail(ctx.revision, 'HARNESS', msg),
      ]);
    }

    let script;
    let contract;
    try {
      script = loadScript(ctx.projectRoot, execution_profile.script);
      contract = loadContract(ctx.projectRoot, execution_profile.contract);
    } catch (e) {
      throw new AdapterError('discover_failed', 'HARNESS', (e as Error).message, false, [
        fail(ctx.revision, 'HARNESS', (e as Error).message),
      ]);
    }

    return { execution_profile, stimulus, script, contract };
  }

  async prepare(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreparedState> {
    const { stimulus, script, contract } = discovered as unknown as L2Discovered;
    this.contract = contract;
    this.host = new FakeHost(contract, script);
    this.session = { ...(stimulus.session ?? {}) };
    this.timeline = [];
    this.noProgress = 0;
    this.currentToolOk = true;
    this.demoPlugin = {};
    this.ocHooks = {};
    this.disposeHooks = undefined;

    const workspaceMode =
      typeof ctx.environment.recipe.adapter?.workspace === 'string'
        ? ctx.environment.recipe.adapter.workspace
        : undefined;
    this.skipHookDispatch = ctx.environment.recipe.adapter?.skip_hook_dispatch === true;
    let pluginDirectory = ctx.projectRoot;
    if (workspaceMode === 'temp-git') {
      const base =
        ctx.artifactDir !== undefined
          ? join(ctx.artifactDir, 'plugin-workspace')
          : mkdtempSync(join(tmpdir(), 'proctor-l2-ws-'));
      mkdirSync(base, { recursive: true });
      const git = (args: string[]) => {
        const r = spawnSync('git', args, { cwd: base, encoding: 'utf8' });
        if (r.status !== 0) {
          throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout || '').slice(0, 200)}`);
        }
      };
      try {
        git(['init']);
        git(['config', 'user.email', 'proctor@test']);
        git(['config', 'user.name', 'proctor']);
        writeFileSync(join(base, 'README.md'), '# l2-plugin-workspace\n');
        git(['add', 'README.md']);
        git(['commit', '-m', 'init']);
        pluginDirectory = base;
      } catch (e) {
        throw new AdapterError(
          'prepare_failed',
          'HARNESS',
          `无法准备 temp-git：${(e as Error).message}`,
          false,
          [fail(ctx.revision, 'HARNESS', `无法准备 temp-git：${(e as Error).message}`)],
        );
      }
    }

    const pluginPath = ctx.environment.recipe.adapter?.config;
    if (typeof pluginPath === 'string') {
      try {
        const effectiveSutRoot = process.env.SUT_ROOT ?? ctx.sutRoot;
        const mod = (await import(
          pathToFileURL(resolve(ctx.projectRoot, pluginPath)).href
        )) as Record<string, unknown>;

        if (this.hookStyle === 'opencode-v1') {
          const resolved = resolveOpenCodePluginExport(mod);
          if (resolved === null) {
            throw new AdapterError(
              'prepare_failed',
              'HARNESS',
              `hook_style=opencode-v1 需要导出 plugin(ctx)、default 函数或 { id, server }：${pluginPath}`,
              false,
              [
                fail(
                  ctx.revision,
                  'HARNESS',
                  `hook_style=opencode-v1 需要导出 plugin(ctx)、default 函数或 { id, server }：${pluginPath}`,
                ),
              ],
            );
          }
          const factory = resolved.factory as (ctx: ProctorPluginCtx) => unknown;
          const pluginCtx: ProctorPluginCtx = {
            directory: pluginDirectory,
            workdir: pluginDirectory,
            options: { ...(effectiveSutRoot !== undefined ? { sutRoot: effectiveSutRoot } : {}) },
            client: {
              session: {
                messages: async () => ({ data: [] }),
                create: async () => ({ data: { id: 'mock-child-session' } }),
                prompt: async () => undefined,
                abort: async () => ({}),
              },
            },
            emit: (ev) => {
              const type = String(ev.type ?? ev.kind ?? 'event');
              const row = { ...ev, type };
              this.timeline.push(row);
              this.host.emit({ type, ...ev });
              this.host.triggerHook('event', { type, ...ev });
            },
            patchSession: (patch) => {
              Object.assign(this.session, patch);
            },
            getSession: () => this.session,
            setToolOk: (ok) => {
              this.currentToolOk = ok;
            },
          };
          const hooksRaw = await Promise.resolve(factory(pluginCtx));
          this.ocHooks =
            hooksRaw && typeof hooksRaw === 'object' ? (hooksRaw as OpenCodeHooks) : {};
          const dispose = (hooksRaw as { dispose?: unknown } | null)?.dispose;
          if (typeof dispose === 'function') {
            this.disposeHooks = dispose as () => unknown | Promise<unknown>;
          }
          const pluginId = String(
            (hooksRaw as { id?: unknown; name?: unknown } | null)?.id ??
              (hooksRaw as { name?: unknown } | null)?.name ??
              resolved.id,
          );
          this.timeline.push({ type: 'plugin_loaded', id: pluginId });
          this.host.emit({ type: 'plugin_loaded', id: pluginId });
        } else {
          this.demoPlugin = mod as DemoPluginModule;
        }
      } catch (e) {
        if (e instanceof AdapterError) throw e;
        throw new AdapterError(
          'prepare_failed',
          'HARNESS',
          `无法加载插件：${pluginPath}（${(e as Error).message}）`,
          false,
          [fail(ctx.revision, 'HARNESS', `无法加载插件：${pluginPath}（${(e as Error).message}）`)],
        );
      }
    }

    return { prepared: true };
  }

  async submit(ctx: AdapterContext, _prepared: PreparedState): Promise<SubmittedHandle> {
    try {
      this.host.triggerHook('event', { type: 'SessionReady' });
      this.timeline.push({ type: 'SessionReady' });
      if (this.hookStyle === 'opencode-v1' && !this.skipHookDispatch) {
        await callHook(this.ocHooks, 'event', {
          event: { type: 'session.created', properties: {} },
        });
      }

      for (let turn = 0; turn < 32; turn += 1) {
        this.timeline.push({ type: 'TurnStarted', turn });
        this.host.triggerHook('event', { type: 'TurnStarted' });
        this.host.triggerHook('chat.message', { sessionID: String(this.session.id ?? 's') });
        if (this.hookStyle === 'opencode-v1' && !this.skipHookDispatch) {
          await callHook(
            this.ocHooks,
            'chat.message',
            { sessionID: String(this.session.id ?? 's'), role: 'user' },
            { parts: [] },
          );
        }

        const modelNode = this.host.nextModelStep();
        if (modelNode === null) {
          this.timeline.push({ type: 'TurnCompleted', turn, terminal: true });
          break;
        }

        let usedTools = false;
        if (modelNode.type === 'assistant_text') {
          this.host.triggerHook('chat.message', {
            sessionID: String(this.session.id ?? 's'),
            text: modelNode.text,
          });
          if (this.hookStyle === 'opencode-v1' && !this.skipHookDispatch) {
            await callHook(
              this.ocHooks,
              'chat.message',
              { sessionID: String(this.session.id ?? 's'), role: 'assistant' },
              { parts: [{ type: 'text', text: modelNode.text }] },
            );
          }
        } else if (modelNode.type === 'tool_calls') {
          usedTools = true;
          for (const call of modelNode.calls) {
            const callID = `c-${turn}`;
            this.host.triggerHook('tool.execute.before', {
              sessionID: String(this.session.id ?? 's'),
              callID,
              tool: call.name,
              args: call.args,
            });
            if (this.hookStyle === 'opencode-v1' && !this.skipHookDispatch) {
              await callHook(
                this.ocHooks,
                'tool.execute.before',
                { tool: call.name, callID, sessionID: String(this.session.id ?? 's') },
                { args: call.args },
              );
            }

            this.currentToolOk = true;
            if (this.hookStyle === 'demo-v1' && typeof this.demoPlugin.onToolAfter === 'function') {
              const effect = await this.demoPlugin.onToolAfter({
                tool: call.name,
                args: call.args,
                session: this.session,
              });
              await applyPluginEffect(this.host, this.timeline, this.session, effect);
              if (effect.tool_ok === false) this.currentToolOk = false;
            }

            if (this.hookStyle === 'opencode-v1' && !this.skipHookDispatch) {
              await callHook(
                this.ocHooks,
                'tool.execute.after',
                {
                  tool: call.name,
                  callID,
                  sessionID: String(this.session.id ?? 's'),
                  args: call.args,
                },
                { title: call.name, output: '', metadata: {} },
              );
            }

            this.host.setLastToolResult(call.name, this.currentToolOk);
            this.host.triggerHook('tool.execute.after', {
              sessionID: String(this.session.id ?? 's'),
              callID,
              tool: call.name,
              args: call.args,
              ok: this.currentToolOk,
            });
          }
        } else if (modelNode.type === 'branch') {
          this.timeline.pop();
          turn -= 1;
          continue;
        }

        this.timeline.push({ type: 'TurnCompleted', turn });
        this.host.triggerHook('event', { type: 'TurnCompleted' });
        if (this.contract.hooks.some((h) => h.name === 'turn.completed')) {
          this.host.triggerHook('turn.completed', { turn });
        }

        this.noProgress = usedTools ? 0 : this.noProgress + 1;

        if (this.hookStyle === 'demo-v1' && typeof this.demoPlugin.afterTurn === 'function') {
          const effect = await this.demoPlugin.afterTurn({
            no_progress_streak: this.noProgress,
            session: this.session,
          });
          await applyPluginEffect(this.host, this.timeline, this.session, effect);
        }

        if (this.hookStyle === 'opencode-v1' && !this.skipHookDispatch) {
          await callHook(this.ocHooks, 'event', {
            event: {
              type: 'session.idle',
              properties: {
                sessionID: String(this.session.id ?? 's'),
                no_progress_streak: this.noProgress,
              },
            },
          });
        }
      }

      const nudgeTypes = new Set(['NudgeEmitted', 'nudge_dispatched']);
      const nudgeAt = this.timeline.findIndex((e) => nudgeTypes.has(String(e.type)));
      if (nudgeAt >= 0 && !this.timeline.slice(nudgeAt + 1).some((e) => e.type === 'TurnStarted')) {
        this.timeline.push({ type: 'TurnStarted', turn: 'after-nudge' });
      }
    } catch (e) {
      const attr = e instanceof FakeHostError || e instanceof ScriptError ? 'HARNESS' : 'PROTOCOL';
      try {
        await this.releaseHooks();
      } catch {
        /* ignore dispose errors on failure path */
      }
      throw new AdapterError('submit_failed', attr, (e as Error).message, false, [
        fail(ctx.revision, attr, (e as Error).message),
      ]);
    }

    return { submitted: true };
  }

  async collect(ctx: AdapterContext, _handle: SubmittedHandle): Promise<CollectedOutput> {
    if (ctx.artifactDir !== undefined) {
      mkdirSync(ctx.artifactDir, { recursive: true });
      writeFileSync(
        join(ctx.artifactDir, 'timeline.json'),
        `${JSON.stringify(this.timeline, null, 2)}\n`,
      );
      writeFileSync(
        join(ctx.artifactDir, 'session.json'),
        `${JSON.stringify(this.session, null, 2)}\n`,
      );
    }
    return { collected: true };
  }

  async evaluate(ctx: AdapterContext, _collected: CollectedOutput): Promise<AxisItemResult[]> {
    const focus = ctx.revision.attribution_focus;
    const stateRoot: Record<string, unknown> = {
      session: this.session,
      timeline: this.timeline,
      no_progress_streak: this.noProgress,
      hook_style: this.hookStyle,
    };
    if (this.session.review !== undefined) stateRoot.review = this.session.review;

    const failures: OracleOutcome[] = [];
    for (const [i, oracle] of ctx.revision.expect.oracles.entries()) {
      const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
      if (oracle.type === 'event_subsequence') {
        const names = Array.isArray(oracle.names) ? oracle.names.map(String) : [];
        failures.push(
          runEventSubsequenceOracle({
            oracle_id: oid,
            events: this.timeline,
            names,
            attribution: focus,
          }),
        );
      } else if (oracle.type === 'state_predicate') {
        failures.push(
          runStatePredicateOracle({
            oracle_id: oid,
            expr: String(oracle.expr ?? ''),
            root: stateRoot,
            attribution: focus,
          }),
        );
      } else if (oracle.type === 'no_event') {
        const names = Array.isArray(oracle.names) ? oracle.names.map(String) : [];
        failures.push(
          runNoEventOracle({
            oracle_id: oid,
            events: this.timeline,
            names,
            attribution: focus,
          }),
        );
      } else if (oracle.type === 'metric_threshold') {
        continue;
      } else {
        failures.push({
          pass: false,
          oracle_id: oid,
          message: `L2 暂不支持 oracle 类型 ${oracle.type}`,
          attribution: 'HARNESS',
        });
      }
    }

    const draftMetrics = computeAxisDraftMetrics(failures);
    applyMetricThresholdPass(ctx.revision.expect.oracles, draftMetrics, focus, (o) =>
      failures.push(o),
    );

    return [
      finalizeAxisResult({
        revision: ctx.revision,
        failures,
        ...(ctx.artifactDir !== undefined ? { artifactDir: ctx.artifactDir } : {}),
      }),
    ];
  }

  async cleanup(_ctx: AdapterContext, _prepared: PreparedState): Promise<{ ok: boolean }> {
    await this.releaseHooks();
    return { ok: true };
  }

  /** 幂等释放插件 dispose 钩子：失败路径与 orchestrator 的 finally 可能各调用一次。 */
  private async releaseHooks(): Promise<void> {
    const dispose = this.disposeHooks;
    if (dispose === undefined) return;
    this.disposeHooks = undefined;
    await Promise.resolve(dispose());
  }
}

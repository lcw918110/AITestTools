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
import type { FreezeA, ItemDoc, RoomDoc } from '../exam-engine/types.ts';
import {
  runEventSubsequenceOracle,
  runNoEventOracle,
  runStatePredicateOracle,
  type OracleOutcome,
} from '../oracles/index.ts';
import type { L1ItemResult } from './l1-runner.ts';
import { resolveOpenCodePluginExport } from '../drivers/model-adapter/opencode-plugin-export.ts';

export type AxisItemResult = L1ItemResult;

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

function resolveHookStyle(room: RoomDoc): HookStyle {
  const raw = room.adapter?.hook_style;
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

export async function runL2Item(opts: {
  item: ItemDoc;
  room: RoomDoc;
  projectRoot: string;
  artifactDir?: string;
  sutRoot?: string;
}): Promise<AxisItemResult> {
  const freeze = opts.item.freeze as FreezeA;
  const focus = opts.item.intent.attribution_focus;
  const hookStyle = resolveHookStyle(opts.room);

  if (freeze.contract === undefined || freeze.script === undefined) {
    return fail(opts.item, 'HARNESS', 'L2 缺少 freeze.contract 或 freeze.script');
  }

  let stimulus: SessionStimulus;
  try {
    stimulus = JSON.parse(
      readFileSync(resolve(opts.projectRoot, opts.item.stimulus.ref), 'utf8'),
    ) as SessionStimulus;
  } catch (e) {
    return fail(opts.item, 'HARNESS', `无法加载 stimulus：${(e as Error).message}`);
  }

  let script;
  let contract;
  try {
    script = loadScript(opts.projectRoot, freeze.script);
    contract = loadContract(opts.projectRoot, freeze.contract);
  } catch (e) {
    return fail(opts.item, 'HARNESS', (e as Error).message);
  }

  const host = new FakeHost(contract, script);
  const session: Record<string, unknown> = { ...(stimulus.session ?? {}) };
  const timeline: Record<string, unknown>[] = [];
  let noProgress = 0;
  let currentToolOk = true;

  let demoPlugin: DemoPluginModule = {};
  let ocHooks: OpenCodeHooks = {};
  let disposeHooks: (() => unknown | Promise<unknown>) | undefined;

  const workspaceMode =
    typeof opts.room.adapter?.workspace === 'string' ? opts.room.adapter.workspace : undefined;
  const skipHookDispatch = opts.room.adapter?.skip_hook_dispatch === true;
  let pluginDirectory = opts.projectRoot;
  if (workspaceMode === 'temp-git') {
    const base =
      opts.artifactDir !== undefined
        ? join(opts.artifactDir, 'plugin-workspace')
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
      return fail(opts.item, 'HARNESS', `无法准备 temp-git：${(e as Error).message}`);
    }
  }

  const pluginPath = opts.room.adapter?.config;
  if (typeof pluginPath === 'string') {
    try {
      const effectiveSutRoot = process.env.SUT_ROOT ?? opts.sutRoot;
      const mod = (await import(
        pathToFileURL(resolve(opts.projectRoot, pluginPath)).href
      )) as Record<string, unknown>;

      if (hookStyle === 'opencode-v1') {
        const resolved = resolveOpenCodePluginExport(mod);
        if (resolved === null) {
          return fail(
            opts.item,
            'HARNESS',
            `hook_style=opencode-v1 需要导出 plugin(ctx)、default 函数或 { id, server }：${pluginPath}`,
          );
        }
        const factory = resolved.factory as (ctx: ProctorPluginCtx) => unknown;
        const ctx: ProctorPluginCtx = {
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
            timeline.push(row);
            host.emit({ type, ...ev });
            host.triggerHook('event', { type, ...ev });
          },
          patchSession: (patch) => {
            Object.assign(session, patch);
          },
          getSession: () => session,
          setToolOk: (ok) => {
            currentToolOk = ok;
          },
        };
        const hooksRaw = await Promise.resolve(factory(ctx));
        ocHooks = hooksRaw && typeof hooksRaw === 'object' ? (hooksRaw as OpenCodeHooks) : {};
        const dispose = (hooksRaw as { dispose?: unknown } | null)?.dispose;
        if (typeof dispose === 'function') {
          disposeHooks = dispose as () => unknown | Promise<unknown>;
        }
        const pluginId = String(
          (hooksRaw as { id?: unknown; name?: unknown } | null)?.id ??
            (hooksRaw as { name?: unknown } | null)?.name ??
            resolved.id,
        );
        timeline.push({ type: 'plugin_loaded', id: pluginId });
        host.emit({ type: 'plugin_loaded', id: pluginId });
      } else {
        demoPlugin = mod as DemoPluginModule;
      }
    } catch (e) {
      return fail(opts.item, 'HARNESS', `无法加载插件：${pluginPath}（${(e as Error).message}）`);
    }
  }

  try {
    host.triggerHook('event', { type: 'SessionReady' });
    timeline.push({ type: 'SessionReady' });
    if (hookStyle === 'opencode-v1' && !skipHookDispatch) {
      await callHook(ocHooks, 'event', { event: { type: 'session.created', properties: {} } });
    }

    for (let turn = 0; turn < 32; turn += 1) {
      timeline.push({ type: 'TurnStarted', turn });
      host.triggerHook('event', { type: 'TurnStarted' });
      host.triggerHook('chat.message', { sessionID: String(session.id ?? 's') });
      if (hookStyle === 'opencode-v1' && !skipHookDispatch) {
        await callHook(
          ocHooks,
          'chat.message',
          { sessionID: String(session.id ?? 's'), role: 'user' },
          { parts: [] },
        );
      }

      const modelNode = host.nextModelStep();
      if (modelNode === null) {
        timeline.push({ type: 'TurnCompleted', turn, terminal: true });
        break;
      }

      let usedTools = false;
      if (modelNode.type === 'assistant_text') {
        host.triggerHook('chat.message', {
          sessionID: String(session.id ?? 's'),
          text: modelNode.text,
        });
        if (hookStyle === 'opencode-v1' && !skipHookDispatch) {
          await callHook(
            ocHooks,
            'chat.message',
            { sessionID: String(session.id ?? 's'), role: 'assistant' },
            { parts: [{ type: 'text', text: modelNode.text }] },
          );
        }
      } else if (modelNode.type === 'tool_calls') {
        usedTools = true;
        for (const call of modelNode.calls) {
          const callID = `c-${turn}`;
          host.triggerHook('tool.execute.before', {
            sessionID: String(session.id ?? 's'),
            callID,
            tool: call.name,
            args: call.args,
          });
          if (hookStyle === 'opencode-v1' && !skipHookDispatch) {
            await callHook(
              ocHooks,
              'tool.execute.before',
              { tool: call.name, callID, sessionID: String(session.id ?? 's') },
              { args: call.args },
            );
          }

          currentToolOk = true;
          if (hookStyle === 'demo-v1' && typeof demoPlugin.onToolAfter === 'function') {
            const effect = await demoPlugin.onToolAfter({
              tool: call.name,
              args: call.args,
              session,
            });
            await applyPluginEffect(host, timeline, session, effect);
            if (effect.tool_ok === false) currentToolOk = false;
          }

          if (hookStyle === 'opencode-v1' && !skipHookDispatch) {
            await callHook(
              ocHooks,
              'tool.execute.after',
              {
                tool: call.name,
                callID,
                sessionID: String(session.id ?? 's'),
                args: call.args,
              },
              { title: call.name, output: '', metadata: {} },
            );
          }

          host.setLastToolResult(call.name, currentToolOk);
          host.triggerHook('tool.execute.after', {
            sessionID: String(session.id ?? 's'),
            callID,
            tool: call.name,
            args: call.args,
            ok: currentToolOk,
          });
        }
      } else if (modelNode.type === 'branch') {
        timeline.pop();
        turn -= 1;
        continue;
      }

      timeline.push({ type: 'TurnCompleted', turn });
      host.triggerHook('event', { type: 'TurnCompleted' });
      if (contract.hooks.some((h) => h.name === 'turn.completed')) {
        host.triggerHook('turn.completed', { turn });
      }

      noProgress = usedTools ? 0 : noProgress + 1;

      if (hookStyle === 'demo-v1' && typeof demoPlugin.afterTurn === 'function') {
        const effect = await demoPlugin.afterTurn({
          no_progress_streak: noProgress,
          session,
        });
        await applyPluginEffect(host, timeline, session, effect);
      }

      // 万象术 nudge 落在 session.idle；假宿主在每轮结束后模拟 natural-stop
      if (hookStyle === 'opencode-v1' && !skipHookDispatch) {
        await callHook(ocHooks, 'event', {
          event: {
            type: 'session.idle',
            properties: {
              sessionID: String(session.id ?? 's'),
              no_progress_streak: noProgress,
            },
          },
        });
      }
    }

    const nudgeTypes = new Set(['NudgeEmitted', 'nudge_dispatched']);
    const nudgeAt = timeline.findIndex((e) => nudgeTypes.has(String(e.type)));
    if (nudgeAt >= 0 && !timeline.slice(nudgeAt + 1).some((e) => e.type === 'TurnStarted')) {
      timeline.push({ type: 'TurnStarted', turn: 'after-nudge' });
    }
  } catch (e) {
    const attr = e instanceof FakeHostError || e instanceof ScriptError ? 'HARNESS' : 'PROTOCOL';
    if (disposeHooks) {
      try {
        await Promise.resolve(disposeHooks());
      } catch {
        /* ignore dispose errors on failure path */
      }
    }
    return fail(opts.item, attr, (e as Error).message);
  }

  if (disposeHooks) {
    try {
      await Promise.resolve(disposeHooks());
    } catch (e) {
      return fail(opts.item, 'HARNESS', `plugin dispose 失败：${(e as Error).message}`);
    }
  }

  const stateRoot: Record<string, unknown> = {
    session,
    timeline,
    no_progress_streak: noProgress,
    hook_style: hookStyle,
  };
  if (session.review !== undefined) stateRoot.review = session.review;

  if (opts.artifactDir !== undefined) {
    mkdirSync(opts.artifactDir, { recursive: true });
    writeFileSync(
      join(opts.artifactDir, 'timeline.json'),
      `${JSON.stringify(timeline, null, 2)}\n`,
    );
    writeFileSync(join(opts.artifactDir, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
  }

  const failures: OracleOutcome[] = [];
  for (const [i, oracle] of opts.item.expect.oracles.entries()) {
    const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
    if (oracle.type === 'event_subsequence') {
      const names = Array.isArray(oracle.names) ? oracle.names.map(String) : [];
      failures.push(
        runEventSubsequenceOracle({
          oracle_id: oid,
          events: timeline,
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
          events: timeline,
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
  applyMetricThresholdPass(opts.item.expect.oracles, draftMetrics, focus, (o) => failures.push(o));

  return finalizeAxisResult({
    item: opts.item,
    failures,
    ...(opts.artifactDir !== undefined ? { artifactDir: opts.artifactDir } : {}),
  });
}

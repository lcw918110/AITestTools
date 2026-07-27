import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadBundledContract } from '../contract/load.ts';
import { FakeHost, FakeHostError } from '../drivers/fakehost/index.ts';
import { loadScript, ScriptError } from '../drivers/scripted/index.ts';
import type { Attribution, FreezeA, ItemDoc, RoomDoc } from '../exam-engine/types.ts';
import {
  runEventSubsequenceOracle,
  runMetricThresholdOracle,
  runNoEventOracle,
  runStatePredicateOracle,
  type OracleOutcome,
} from '../oracles/index.ts';
import type { L1ItemResult } from './l1-runner.ts';

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

/** 假宿主侧最小 ctx：真 OpenCode Plugin 的子集，供测控流。 */
interface ProctorPluginCtx {
  directory: string;
  emit: (ev: Record<string, unknown>) => void;
  patchSession: (patch: Record<string, unknown>) => void;
  getSession: () => Record<string, unknown>;
  /** 当前 tool.execute.after 轮次可改写成败 */
  setToolOk: (ok: boolean) => void;
}

function loadContract(
  projectRoot: string,
  id: string,
): { id: string; hooks: Array<{ name: string }> } {
  try {
    return loadBundledContract(id);
  } catch {
    const local = resolve(projectRoot, 'contracts', `${id}.json`);
    return JSON.parse(readFileSync(local, 'utf8')) as {
      id: string;
      hooks: Array<{ name: string }>;
    };
  }
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

  const pluginPath = opts.room.adapter?.config;
  if (typeof pluginPath === 'string') {
    try {
      const mod = (await import(
        pathToFileURL(resolve(opts.projectRoot, pluginPath)).href
      )) as Record<string, unknown>;

      if (hookStyle === 'opencode-v1') {
        const factory =
          typeof mod.plugin === 'function'
            ? (mod.plugin as (ctx: ProctorPluginCtx) => unknown)
            : typeof mod.default === 'function'
              ? (mod.default as (ctx: ProctorPluginCtx) => unknown)
              : null;
        if (factory === null) {
          return fail(
            opts.item,
            'HARNESS',
            `hook_style=opencode-v1 需要导出 plugin(ctx) 或 default：${pluginPath}`,
          );
        }
        const ctx: ProctorPluginCtx = {
          directory: opts.projectRoot,
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
    if (hookStyle === 'opencode-v1') {
      await callHook(ocHooks, 'event', { event: { type: 'session.created', properties: {} } });
    }

    for (let turn = 0; turn < 32; turn += 1) {
      timeline.push({ type: 'TurnStarted', turn });
      host.triggerHook('event', { type: 'TurnStarted' });
      host.triggerHook('chat.message', { sessionID: String(session.id ?? 's') });
      if (hookStyle === 'opencode-v1') {
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
        if (hookStyle === 'opencode-v1') {
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
          if (hookStyle === 'opencode-v1') {
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

          if (hookStyle === 'opencode-v1') {
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
      if (hookStyle === 'opencode-v1') {
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
    return fail(opts.item, attr, (e as Error).message);
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

  const preFailed = failures.filter((o): o is Extract<OracleOutcome, { pass: false }> => !o.pass);
  const draftPass = preFailed.length === 0;
  const draftMetrics: Record<string, number> = {
    a_case_pass_rate: draftPass ? 1 : 0,
    a_invariant_violations:
      !draftPass &&
      (preFailed[0]?.attribution === 'PROTOCOL' || preFailed[0]?.attribution === 'CONTEXT')
        ? 1
        : 0,
  };
  for (const [i, oracle] of opts.item.expect.oracles.entries()) {
    if (oracle.type !== 'metric_threshold') continue;
    const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
    failures.push(
      runMetricThresholdOracle({
        oracle_id: oid,
        oracle,
        metrics: draftMetrics,
        attribution: focus,
      }),
    );
  }

  const failed = failures.filter((o): o is Extract<OracleOutcome, { pass: false }> => !o.pass);
  const pass = failed.length === 0;
  const attribution = pass ? undefined : (failed[0]?.attribution ?? 'PROTOCOL');
  const result: AxisItemResult = {
    item_id: opts.item.id,
    item_rev: opts.item.rev,
    pass,
    oracle_failures: failed.map((f) => {
      const row: { oracle_id: string; message: string; evidence_ref?: string } = {
        oracle_id: f.oracle_id,
        message: f.message,
      };
      if (f.evidence_ref !== undefined) row.evidence_ref = f.evidence_ref;
      return row;
    }),
    metrics: {
      a_case_pass_rate: pass ? 1 : 0,
      a_invariant_violations:
        !pass && (attribution === 'PROTOCOL' || attribution === 'CONTEXT') ? 1 : 0,
    },
  };
  if (attribution !== undefined) result.attribution = attribution;
  if (opts.artifactDir !== undefined) result.artifact_dir = opts.artifactDir;
  return result;
}

function fail(item: ItemDoc, attribution: Attribution, message: string): AxisItemResult {
  return {
    item_id: item.id,
    item_rev: item.rev,
    pass: false,
    attribution,
    oracle_failures: [{ oracle_id: 'harness', message }],
    metrics: {
      a_case_pass_rate: 0,
      a_invariant_violations: attribution === 'PROTOCOL' || attribution === 'CONTEXT' ? 1 : 0,
    },
  };
}

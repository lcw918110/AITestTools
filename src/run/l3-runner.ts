import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContract, fail } from './runner-shared.ts';
import {
  CassetteError,
  eventTypesFromJournal,
  hooksFromJournal,
  loadCassette,
  loadJournal,
} from '../drivers/cassette/index.ts';
import { FakeHost, FakeHostError } from '../drivers/fakehost/index.ts';
import { loadScript, ScriptError, type ScriptDoc } from '../drivers/scripted/index.ts';
import type { Attribution } from '../exam-engine/types.ts';
import type { CaseRevision } from '../domain/types.ts';
import { runEventSubsequenceOracle } from '../oracles/index.ts';
import type { AxisItemResult } from './runner-types.ts';
import type {
  AdapterContext,
  CollectedOutput,
  DiscoveredInput,
  ExecutionAdapter,
  PreparedState,
  SubmittedHandle,
} from './execution-adapter.ts';
import { AdapterError } from './execution-adapter.ts';

function subsequenceOk(haystack: string[], needle: string[]): boolean {
  let i = 0;
  for (const h of haystack) {
    if (i < needle.length && h === needle[i]) i += 1;
  }
  return i === needle.length;
}

const NOOP_SCRIPT: ScriptDoc = {
  id: 'journal-noop',
  rev: 1,
  version: 'scripted-model-v1',
  entry: 'end',
  nodes: { end: { type: 'terminal', reason: 'stop' } },
};

type CassetteDoc = ReturnType<typeof loadCassette>;

interface L3Discovered {
  cassette: CassetteDoc;
  mode: 'journal' | 'scripted';
}

interface L3Prepared {
  cassette: CassetteDoc;
  mode: 'journal' | 'scripted';
  host: FakeHost;
  entries?: ReturnType<typeof loadJournal>;
}

interface L3Collected {
  cassette: CassetteDoc;
  mode: 'journal' | 'scripted';
  hooks: string[];
  timeline: Array<Record<string, unknown>>;
  journalHooks?: string[];
  journalEvents?: string[];
}

/**
 * L3 cassette 对拍 adapter。
 * - scripted（默认）：FakeHost + 剧本驱动
 * - journal：回放 OpenCode 录制器 journal.ndjson（无需剧本）
 * 执行语义不变，仅把隐式流程显式化为 8 阶段。
 */
export class L3Adapter implements ExecutionAdapter {
  readonly adapterId = 'l3-cassette';

  async discover(ctx: AdapterContext): Promise<DiscoveredInput> {
    const execution_profile = ctx.revision.execution_profile;
    if (execution_profile === undefined) {
      throw new AdapterError('discover_failed', 'HARNESS', '缺少 execution_profile', false, [
        fail(ctx.revision, 'HARNESS', '缺少 execution_profile'),
      ]);
    }
    if (execution_profile.cassette === undefined) {
      throw new AdapterError(
        'discover_failed',
        'HARNESS',
        'L3 缺少 execution_profile.cassette',
        false,
        [fail(ctx.revision, 'HARNESS', 'L3 缺少 execution_profile.cassette')],
      );
    }

    let cassette: CassetteDoc;
    try {
      cassette = loadCassette(ctx.projectRoot, execution_profile.cassette);
    } catch (e) {
      throw new AdapterError('discover_failed', 'HARNESS', (e as Error).message, false, [
        fail(ctx.revision, 'HARNESS', (e as Error).message),
      ]);
    }

    const mode =
      cassette.replay_mode === 'journal' ||
      (cassette.journal_ref !== undefined && cassette.script === undefined)
        ? 'journal'
        : 'scripted';

    return { cassette, mode };
  }

  async prepare(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreparedState> {
    const { cassette, mode } = discovered as unknown as L3Discovered;
    const execution_profile = ctx.revision.execution_profile;

    if (mode === 'journal') {
      const journalRef =
        typeof cassette.journal_ref === 'string' ? cassette.journal_ref : cassette.timeline_ref;
      if (journalRef === undefined) {
        throw new AdapterError(
          'prepare_failed',
          'HARNESS',
          'journal 模式需要 cassette.journal_ref',
          false,
          [fail(ctx.revision, 'HARNESS', 'journal 模式需要 cassette.journal_ref')],
        );
      }
      const contractId =
        (typeof cassette.contract === 'string' ? cassette.contract : undefined) ?? 'opencode-v1.18';
      let contract;
      let entries;
      try {
        contract = loadContract(ctx.projectRoot, contractId);
        entries = loadJournal(ctx.projectRoot, journalRef);
      } catch (e) {
        throw new AdapterError('prepare_failed', 'HARNESS', (e as Error).message, false, [
          fail(ctx.revision, 'HARNESS', (e as Error).message),
        ]);
      }
      const host = new FakeHost(contract, NOOP_SCRIPT);
      return { cassette, mode, host, entries };
    }

    // scripted 模式
    const contractId =
      (typeof cassette.contract === 'string' ? cassette.contract : undefined) ??
      execution_profile?.contract;
    const scriptRef =
      (typeof cassette.script === 'string' ? cassette.script : undefined) ??
      execution_profile?.script;
    if (contractId === undefined || scriptRef === undefined) {
      throw new AdapterError(
        'prepare_failed',
        'HARNESS',
        'L3 scripted cassette 需声明 contract+script（或试题 execution_profile 提供）',
        false,
        [
          fail(
            ctx.revision,
            'HARNESS',
            'L3 scripted cassette 需声明 contract+script（或试题 execution_profile 提供）',
          ),
        ],
      );
    }
    let script;
    let contract;
    try {
      script = loadScript(ctx.projectRoot, scriptRef);
      contract = loadContract(ctx.projectRoot, contractId);
    } catch (e) {
      throw new AdapterError('prepare_failed', 'HARNESS', (e as Error).message, false, [
        fail(ctx.revision, 'HARNESS', (e as Error).message),
      ]);
    }
    const host = new FakeHost(contract, script);
    return { cassette, mode, host };
  }

  async submit(ctx: AdapterContext, prepared: PreparedState): Promise<SubmittedHandle> {
    const { cassette, mode, host, entries } = prepared as unknown as L3Prepared;
    const timeline: Array<Record<string, unknown>> = [];

    try {
      if (mode === 'journal') {
        for (const row of entries ?? []) {
          const payload =
            row.payload && typeof row.payload === 'object'
              ? (row.payload as Record<string, unknown>)
              : {};
          host.triggerHook(row.hook, payload);
          if (row.hook === 'event') {
            const ev = payload.event;
            const type =
              ev && typeof ev === 'object' && typeof (ev as { type?: string }).type === 'string'
                ? (ev as { type: string }).type
                : typeof payload.type === 'string'
                  ? payload.type
                  : undefined;
            if (type !== undefined) timeline.push({ type, ...payload });
          }
        }
      } else {
        host.triggerHook('event', { type: 'SessionReady' });
        timeline.push({ type: 'SessionReady' });
        for (let turn = 0; turn < 32; turn += 1) {
          timeline.push({ type: 'TurnStarted', turn });
          host.triggerHook('event', { type: 'TurnStarted' });
          host.triggerHook('chat.message', { sessionID: 'l3', turn });

          const modelNode = host.nextModelStep();
          if (modelNode === null) {
            timeline.push({ type: 'TurnCompleted', turn, terminal: true });
            break;
          }
          if (modelNode.type === 'assistant_text') {
            host.triggerHook('chat.message', {
              sessionID: 'l3',
              role: 'assistant',
              text: modelNode.text,
            });
          } else if (modelNode.type === 'tool_calls') {
            for (const call of modelNode.calls) {
              host.triggerHook('tool.execute.before', { tool: call.name, args: call.args });
              host.setLastToolResult(call.name, true);
              host.triggerHook('tool.execute.after', {
                tool: call.name,
                args: call.args,
                ok: true,
              });
            }
          } else if (modelNode.type === 'branch') {
            timeline.pop();
            turn -= 1;
            continue;
          }
          timeline.push({ type: 'TurnCompleted', turn });
          host.triggerHook('event', { type: 'TurnCompleted' });
        }
      }
    } catch (e) {
      const attr =
        e instanceof FakeHostError || e instanceof ScriptError || e instanceof CassetteError
          ? 'HARNESS'
          : 'PROTOCOL';
      throw new AdapterError('submit_failed', attr, (e as Error).message, false, [
        fail(ctx.revision, attr, (e as Error).message),
      ]);
    }

    return {
      cassette,
      mode,
      hooks: host.trace.hooks,
      timeline,
      ...(mode === 'journal'
        ? {
            journalHooks: hooksFromJournal(entries ?? []),
            journalEvents: eventTypesFromJournal(entries ?? []),
          }
        : {}),
    };
  }

  async collect(ctx: AdapterContext, handle: SubmittedHandle): Promise<CollectedOutput> {
    const { cassette, mode, hooks, timeline, journalHooks, journalEvents } =
      handle as unknown as L3Collected;
    if (ctx.artifactDir !== undefined) {
      mkdirSync(ctx.artifactDir, { recursive: true });
      if (mode === 'journal') {
        writeFileSync(
          join(ctx.artifactDir, 'l3-trace.json'),
          `${JSON.stringify(
            {
              mode: 'journal',
              hooks,
              timeline,
              journal_hooks: journalHooks,
              journal_events: journalEvents,
            },
            null,
            2,
          )}\n`,
        );
      } else {
        writeFileSync(
          join(ctx.artifactDir, 'l3-trace.json'),
          `${JSON.stringify({ mode: 'scripted', hooks, timeline }, null, 2)}\n`,
        );
      }
    }
    return { cassette, mode, hooks, timeline };
  }

  async evaluate(ctx: AdapterContext, collected: CollectedOutput): Promise<AxisItemResult[]> {
    const { cassette, hooks, timeline } = collected as unknown as L3Collected;
    return [
      scoreReplay({
        revision: ctx.revision,
        cassette,
        hooks,
        timeline,
        ...(ctx.artifactDir !== undefined ? { artifactDir: ctx.artifactDir } : {}),
      }),
    ];
  }
}

function scoreReplay(opts: {
  revision: CaseRevision;
  cassette: CassetteDoc;
  focus?: Attribution | undefined;
  hooks: string[];
  timeline: Array<Record<string, unknown>>;
  artifactDir?: string | undefined;
}): AxisItemResult {
  const failures: Array<{ oracle_id: string; message: string }> = [];
  const expectedHooks = opts.cassette.expected_hooks ?? [];
  if (expectedHooks.length > 0 && !subsequenceOk(opts.hooks, expectedHooks)) {
    failures.push({
      oracle_id: 'hook-subsequence',
      message: `hook 子序列未匹配：期望 ${expectedHooks.join(' → ')}；实际 ${opts.hooks.join(' → ')}`,
    });
  }

  const expectedEvents = opts.cassette.expected_events ?? [];
  if (expectedEvents.length > 0) {
    const o = runEventSubsequenceOracle({
      oracle_id: 'event-subsequence',
      events: opts.timeline,
      names: expectedEvents,
      ...(opts.focus !== undefined ? { attribution: opts.focus } : {}),
    });
    if (!o.pass) {
      failures.push({ oracle_id: o.oracle_id, message: o.message });
    }
  }

  if (expectedHooks.length === 0 && expectedEvents.length === 0) {
    return fail(
      opts.revision,
      'HARNESS',
      'cassette 未声明 expected_hooks / expected_events，无法对拍',
    );
  }

  const pass = failures.length === 0;
  const result: AxisItemResult = {
    item_id: opts.revision.case_revision_id,
    item_rev: opts.revision.revision_number,
    pass,
    oracle_failures: failures,
    metrics: {
      a_case_pass_rate: pass ? 1 : 0,
      a_invariant_violations: pass ? 0 : 1,
    },
  };
  if (!pass) result.attribution = opts.focus ?? 'PROTOCOL';
  if (opts.artifactDir !== undefined) result.artifact_dir = opts.artifactDir;
  return result;
}

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadBundledContract } from '../contract/load.ts';
import {
  CassetteError,
  eventTypesFromJournal,
  hooksFromJournal,
  loadCassette,
  loadJournal,
} from '../drivers/cassette/index.ts';
import { FakeHost, FakeHostError } from '../drivers/fakehost/index.ts';
import { loadScript, ScriptError, type ScriptDoc } from '../drivers/scripted/index.ts';
import type { Attribution, FreezeA, ItemDoc, RoomDoc } from '../exam-engine/types.ts';
import { runEventSubsequenceOracle } from '../oracles/index.ts';
import type { AxisItemResult } from './l2-runner.ts';

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

/**
 * L3：cassette 对拍。
 * - scripted（默认）：FakeHost + 剧本驱动
 * - journal：回放 OpenCode 录制器 journal.ndjson（无需剧本）
 */
export async function runL3Item(opts: {
  item: ItemDoc;
  room: RoomDoc;
  projectRoot: string;
  artifactDir?: string;
}): Promise<AxisItemResult> {
  const freeze = opts.item.freeze as FreezeA;
  const focus = opts.item.intent.attribution_focus;

  if (freeze.cassette === undefined) {
    return fail(opts.item, 'HARNESS', 'L3 缺少 freeze.cassette');
  }

  let cassette;
  try {
    cassette = loadCassette(opts.projectRoot, freeze.cassette);
  } catch (e) {
    return fail(opts.item, 'HARNESS', (e as Error).message);
  }

  const mode =
    cassette.replay_mode === 'journal' ||
    (cassette.journal_ref !== undefined && cassette.script === undefined)
      ? 'journal'
      : 'scripted';

  if (mode === 'journal') {
    return runJournalReplay({ ...opts, cassette, focus });
  }
  return runScriptedReplay({ ...opts, cassette, focus, freeze });
}

async function runJournalReplay(opts: {
  item: ItemDoc;
  projectRoot: string;
  artifactDir?: string;
  cassette: ReturnType<typeof loadCassette>;
  focus?: Attribution;
}): Promise<AxisItemResult> {
  const journalRef =
    typeof opts.cassette.journal_ref === 'string'
      ? opts.cassette.journal_ref
      : opts.cassette.timeline_ref;
  if (journalRef === undefined) {
    return fail(opts.item, 'HARNESS', 'journal 模式需要 cassette.journal_ref');
  }

  const contractId =
    (typeof opts.cassette.contract === 'string' ? opts.cassette.contract : undefined) ??
    'opencode-v1.18';

  let contract;
  let entries;
  try {
    contract = loadContract(opts.projectRoot, contractId);
    entries = loadJournal(opts.projectRoot, journalRef);
  } catch (e) {
    return fail(opts.item, 'HARNESS', (e as Error).message);
  }

  const host = new FakeHost(contract, NOOP_SCRIPT);
  const timeline: Array<Record<string, unknown>> = [];

  try {
    for (const row of entries) {
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
  } catch (e) {
    const attr = e instanceof FakeHostError || e instanceof CassetteError ? 'HARNESS' : 'PROTOCOL';
    return fail(opts.item, attr, (e as Error).message);
  }

  if (opts.artifactDir !== undefined) {
    mkdirSync(opts.artifactDir, { recursive: true });
    writeFileSync(
      join(opts.artifactDir, 'l3-trace.json'),
      `${JSON.stringify(
        {
          mode: 'journal',
          hooks: host.trace.hooks,
          timeline,
          journal_hooks: hooksFromJournal(entries),
          journal_events: eventTypesFromJournal(entries),
        },
        null,
        2,
      )}\n`,
    );
  }

  return scoreReplay({
    item: opts.item,
    cassette: opts.cassette,
    ...(opts.focus !== undefined ? { focus: opts.focus } : {}),
    hooks: host.trace.hooks,
    timeline,
    ...(opts.artifactDir !== undefined ? { artifactDir: opts.artifactDir } : {}),
  });
}

async function runScriptedReplay(opts: {
  item: ItemDoc;
  projectRoot: string;
  artifactDir?: string;
  cassette: ReturnType<typeof loadCassette>;
  focus?: Attribution;
  freeze: FreezeA;
}): Promise<AxisItemResult> {
  const contractId =
    (typeof opts.cassette.contract === 'string' ? opts.cassette.contract : undefined) ??
    opts.freeze.contract;
  const scriptRef =
    (typeof opts.cassette.script === 'string' ? opts.cassette.script : undefined) ??
    opts.freeze.script;
  if (contractId === undefined || scriptRef === undefined) {
    return fail(
      opts.item,
      'HARNESS',
      'L3 scripted cassette 需声明 contract+script（或试题 freeze 提供）',
    );
  }

  let script;
  let contract;
  try {
    script = loadScript(opts.projectRoot, scriptRef);
    contract = loadContract(opts.projectRoot, contractId);
  } catch (e) {
    return fail(opts.item, 'HARNESS', (e as Error).message);
  }

  const host = new FakeHost(contract, script);
  const timeline: Array<Record<string, unknown>> = [];

  try {
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
          host.triggerHook('tool.execute.before', {
            tool: call.name,
            args: call.args,
          });
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
  } catch (e) {
    const attr =
      e instanceof FakeHostError || e instanceof ScriptError || e instanceof CassetteError
        ? 'HARNESS'
        : 'PROTOCOL';
    return fail(opts.item, attr, (e as Error).message);
  }

  if (opts.artifactDir !== undefined) {
    mkdirSync(opts.artifactDir, { recursive: true });
    writeFileSync(
      join(opts.artifactDir, 'l3-trace.json'),
      `${JSON.stringify({ mode: 'scripted', hooks: host.trace.hooks, timeline }, null, 2)}\n`,
    );
  }

  return scoreReplay({
    item: opts.item,
    cassette: opts.cassette,
    ...(opts.focus !== undefined ? { focus: opts.focus } : {}),
    hooks: host.trace.hooks,
    timeline,
    ...(opts.artifactDir !== undefined ? { artifactDir: opts.artifactDir } : {}),
  });
}

function scoreReplay(opts: {
  item: ItemDoc;
  cassette: ReturnType<typeof loadCassette>;
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
    return fail(opts.item, 'HARNESS', 'cassette 未声明 expected_hooks / expected_events，无法对拍');
  }

  const pass = failures.length === 0;
  const result: AxisItemResult = {
    item_id: opts.item.id,
    item_rev: opts.item.rev,
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

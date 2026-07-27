import { spawnSync } from 'node:child_process';
import { FakeHost } from '../drivers/fakehost/index.ts';
import type { ScriptDoc } from '../drivers/scripted/index.ts';

export interface ProbeCaseResult {
  id: string;
  pass: boolean;
  detail: string;
}

export interface HookProbeReport {
  contract_id: string;
  cases: ProbeCaseResult[];
  pass: boolean;
}

const EMPTY_SCRIPT: ScriptDoc = {
  id: 'probe',
  rev: 1,
  version: 'scripted-model-v1',
  entry: 'end',
  nodes: { end: { type: 'terminal', reason: 'stop' } },
};

const SAMPLE_PAYLOAD: Record<string, Record<string, unknown>> = {
  'tool.execute.before': {
    sessionID: 'probe',
    callID: 'c1',
    tool: 'read',
    args: {},
  },
  'tool.execute.after': {
    sessionID: 'probe',
    callID: 'c1',
    tool: 'read',
    args: {},
  },
  event: { type: 'session.idle' },
  'chat.message': { sessionID: 'probe' },
  'turn.completed': { turn: 0 },
};

/** FakeHost：契约声明的每个 hook 必须可触发且不得误拒。 */
export function probeFakeHostHooks(contract: {
  id: string;
  hooks: Array<{ name: string }>;
}): ProbeCaseResult[] {
  const host = new FakeHost(contract, EMPTY_SCRIPT);
  const out: ProbeCaseResult[] = [];
  for (const h of contract.hooks) {
    const id = `fakehost.trigger:${h.name}`;
    try {
      host.triggerHook(h.name, SAMPLE_PAYLOAD[h.name] ?? {});
      out.push({ id, pass: true, detail: 'ok' });
    } catch (e) {
      out.push({ id, pass: false, detail: (e as Error).message });
    }
  }
  // 契约外必须 fail-fast
  const outside = 'proctor.nonexistent.hook';
  try {
    host.triggerHook(outside);
    out.push({
      id: 'fakehost.reject-outside',
      pass: false,
      detail: '契约外 hook 未抛错',
    });
  } catch {
    out.push({ id: 'fakehost.reject-outside', pass: true, detail: 'fail-fast ok' });
  }
  return out;
}

/** 真宿主：从本机 opencode 二进制字符串中确认契约 hook 名仍存在（无副作用）。 */
export function probeHostBinaryHooks(
  contract: { hooks: Array<{ name: string }> },
  opencodePath: string,
): ProbeCaseResult[] {
  const r = spawnSync('strings', [opencodePath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) {
    return [
      {
        id: 'host.binary.strings',
        pass: false,
        detail: `无法 strings ${opencodePath}（status=${String(r.status)}）`,
      },
    ];
  }
  const blob = r.stdout;
  return contract.hooks.map((h) => {
    const pass = blob.includes(h.name);
    return {
      id: `host.binary.has:${h.name}`,
      pass,
      detail: pass ? 'found in binary' : `未在 ${opencodePath} 字符串表中找到`,
    };
  });
}

export function runHookProbes(opts: {
  contract: { id: string; hooks: Array<{ name: string }> };
  opencodePath?: string;
}): HookProbeReport {
  const cases = [...probeFakeHostHooks(opts.contract)];
  if (opts.opencodePath !== undefined) {
    cases.push(...probeHostBinaryHooks(opts.contract, opts.opencodePath));
  }
  return {
    contract_id: opts.contract.id,
    cases,
    pass: cases.every((c) => c.pass),
  };
}

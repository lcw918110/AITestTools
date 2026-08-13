/**
 * 万象术 L1 Fold 桥：Journal.Fold.foldEnvelope + typed Envelope/Fact。
 * 需 SUT_ROOT 指向万象术仓根，且 dist/Journal/Fold.js 可 import。
 * 旧 Review / Nudge / Squad / WanEvent 入口保留导出名，调用时诚实抛错。
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function sutRoot() {
  const fromEnv = process.env.SUT_ROOT;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  throw new Error('SUT_ROOT 未设置：L1 需指向万象术仓根（含 dist/Journal/Fold.js）');
}

function fableUrl(root, ...parts) {
  return pathToFileURL(join(root, ...parts)).href;
}

function resolveFableLibDir(root) {
  const base = join(root, 'dist/fable_modules');
  if (!existsSync(base)) {
    throw new Error(`未找到 fable-library：${base}（先在万象术仓执行：dotnet tool restore && node scripts/build.mjs）`);
  }
  const hit = readdirSync(base).find((n) => n.startsWith('fable-library-js.'));
  if (!hit) throw new Error(`未找到 fable-library-js：${base}`);
  return `dist/fable_modules/${hit}`;
}

let cached;

async function loadDeps() {
  if (cached) return cached;
  const root = sutRoot();
  const foldJs = join(root, 'dist/Journal/Fold.js');
  if (!existsSync(foldJs)) {
    throw new Error(
      `缺 dist/Journal/Fold.js（${foldJs}）。在万象术仓执行：dotnet tool restore && node scripts/build.mjs`,
    );
  }
  const lib = resolveFableLibDir(root);
  const [Fold, Envelope, Fact, Identity, DateOffset] = await Promise.all([
    import(fableUrl(root, 'dist/Journal/Fold.js')),
    import(fableUrl(root, 'dist/Journal/Envelope.js')),
    import(fableUrl(root, 'dist/Kernel/Fact.js')),
    import(fableUrl(root, 'dist/Kernel/Identity.js')),
    import(fableUrl(root, lib, 'DateOffset.js')),
  ]);
  cached = { Fold, Envelope, Fact, Identity, DateOffset };
  return cached;
}

function field(e, ...keys) {
  for (const k of keys) {
    if (e[k] !== undefined && e[k] !== null) return e[k];
  }
  return undefined;
}

function unwrapResult(result, label) {
  if (result == null || typeof result.tag !== 'number') {
    throw new Error(`${label}：非 Fable Result`);
  }
  if (result.tag !== 0) {
    const err = result.fields?.[0];
    throw new Error(`${label}：${typeof err === 'string' ? err : JSON.stringify(err)}`);
  }
  return result.fields[0];
}

function isWireEnvelope(e) {
  return (
    e != null &&
    typeof e === 'object' &&
    (Array.isArray(e.RuntimeId) || Array.isArray(e.Fact) || Array.isArray(e.LocalSeq))
  );
}

function toEnvelope(raw, deps) {
  const { Envelope, Fact, Identity, DateOffset } = deps;
  if (isWireEnvelope(raw)) {
    return unwrapResult(Envelope.EnvelopeModule_deserialize(JSON.stringify(raw)), 'Envelope.deserialize');
  }

  const factName = String(field(raw, 'fact', 'Fact', 'kind', 'Kind') ?? '');
  if (factName !== 'RuntimeStarted') {
    throw new Error(
      `不支持的 L1 刺激「${factName || '(空)'}」。现行最小面只折 RuntimeStarted（或 journal 线格式 Envelope JSON）。旧 loop_activated / tasks_created 已失效。`,
    );
  }

  const runtimeValue = String(field(raw, 'runtime', 'RuntimeId', 'runtimeId') ?? 'rt-l1');
  const seqRaw = field(raw, 'seq', 'LocalSeq', 'localSeq') ?? 1;
  const seq = typeof seqRaw === 'bigint' ? seqRaw : BigInt(seqRaw);
  const eventValue = String(field(raw, 'eventId', 'EventId') ?? `evt-${seq}`);
  const observedAt = String(field(raw, 'observedAt', 'ObservedAt', 'at') ?? '2026-01-01T00:00:00.000Z');
  const processId = Number(field(raw, 'processId', 'ProcessId') ?? 1);

  const runtime = Identity.RuntimeIdModule_create(runtimeValue);
  const at = DateOffset.fromDate(new Date(observedAt), 0);
  const fact = new Fact.Fact(0, [
    new Fact.RuntimeFact({ RuntimeId: runtime, ProcessId: processId, StartedAt: at }),
  ]);
  return new Envelope.Envelope(
    runtime,
    Identity.LocalSeqModule_create(seq),
    at,
    Identity.EventIdModule_create(eventValue),
    Envelope.StreamId.Workspace,
    undefined,
    fact,
  );
}

function snapshot(sessionId, proj, deps) {
  const runtimeId = proj.RuntimeId == null ? null : deps.Identity.RuntimeIdModule_value(proj.RuntimeId);
  return {
    sessionId,
    runtimeId,
    runtimeStartCount: Number(proj.AgentProjections.RuntimeStartCount),
  };
}

/** session_fold_v1：事件序列 → foldEnvelope → 稳定 JSON。 */
export async function foldEnvelope(sessionId, events) {
  const deps = await loadDeps();
  let proj = deps.Fold.empty;
  for (const e of events) {
    const env = toEnvelope(e, deps);
    proj = unwrapResult(deps.Fold.foldEnvelope(proj, env), 'foldEnvelope');
  }
  return snapshot(sessionId, proj, deps);
}

function stale(name) {
  return async function staleFold() {
    throw new Error(
      `${name} 已失效：万象术 0.8 已无 ReviewProjection / NudgeProjection / Squad / WanEvent。请用 foldEnvelope（room entry journal-fold）。`,
    );
  };
}

export const foldReviewTask = stale('foldReviewTask');
export const foldNudgeDedup = stale('foldNudgeDedup');
export const foldSquadDag = stale('foldSquadDag');
export const foldSquadCycleCheck = stale('foldSquadCycleCheck');
export const foldSquadStrictTransition = stale('foldSquadStrictTransition');

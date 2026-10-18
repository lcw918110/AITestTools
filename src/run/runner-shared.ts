import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBundledContract } from '../contract/load.ts';
import { runMetricThresholdOracle, type OracleOutcome } from '../oracles/index.ts';
import type { Attribution, Oracle } from '../exam-engine/types.ts';
import type { CaseRevision } from '../domain/types.ts';
import type { L1ItemResult } from './l1-runner.ts';

/** Contracts 加载（从 l2/l3 提取，完全相同）。 */
export function loadContract(
  projectRoot: string,
  id: string,
): { id: string; hooks: Array<{ name: string }> } {
  try {
    return loadBundledContract(id) as { id: string; hooks: Array<{ name: string }> };
  } catch {
    const local = resolve(projectRoot, 'contracts', `${id}.json`);
    return JSON.parse(readFileSync(local, 'utf8')) as {
      id: string;
      hooks: Array<{ name: string }>;
    };
  }
}

/**
 * 规范化 fail helper。
 * - l2/l3/c: 直接 `fail(item, attr, msg)`
 * - b: 多 modelSuffix + b_schema_obedience_rate
 * - l1(failHarness): 始终 HARNESS，invariant_violations=0
 * 通过 opts 显式说明差异；未指定时按 l2/l3/c 默认语义（attribution 决定 invariant_violations）。
 */
export function fail(
  revision: CaseRevision,
  attribution: Attribution,
  message: string,
  opts?: {
    modelSuffix?: string;
    extraMetrics?: Record<string, number>;
    invariantViolationsExplicit?: 0;
    artifactDir?: string | undefined;
    effectPair?: string | undefined;
    extraFailures?: Array<{ oracle_id: string; message: string }>;
  },
): L1ItemResult {
  const hasInvariantViolation =
    opts?.invariantViolationsExplicit === 0
      ? false
      : attribution === 'PROTOCOL' || attribution === 'CONTEXT';
  const result: L1ItemResult = {
    item_id:
      opts?.modelSuffix !== undefined
        ? `${revision.case_revision_id}::${opts.modelSuffix}`
        : revision.case_revision_id,
    item_rev: revision.revision_number,
    pass: false,
    attribution,
    oracle_failures: [{ oracle_id: 'harness', message }, ...(opts?.extraFailures ?? [])],
    metrics: {
      a_case_pass_rate: 0,
      a_invariant_violations: hasInvariantViolation ? 1 : 0,
      ...(opts?.extraMetrics ?? {}),
    },
  };
  if (opts?.artifactDir !== undefined) result.artifact_dir = opts.artifactDir;
  if (opts?.effectPair !== undefined) result.effect_pair = opts.effectPair;
  return result;
}

/**
 * 对已计算好的 draft metrics 执行 metric_threshold oracle 第二趟判定。
 * 各 runner 通过 onOutcome 控制如何记录（l1/l2/b 直接 push；c 仅 push fail）。
 */
export function applyMetricThresholdPass(
  oracles: readonly Oracle[],
  metrics: Record<string, number>,
  attribution: Attribution | undefined,
  onOutcome: (outcome: OracleOutcome) => void,
): void {
  for (const [i, oracle] of oracles.entries()) {
    if (oracle.type !== 'metric_threshold') continue;
    const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
    onOutcome(
      runMetricThresholdOracle({
        oracle_id: oid,
        oracle,
        metrics,
        ...(attribution !== undefined ? { attribution } : {}),
      }),
    );
  }
}

/**
 * l1/l2 共同的草稿 metrics 计算（a_case_pass_rate + a_invariant_violations）。
 * b/c 的 metrics 键集合与违反语义不同，各自就地计算，不强行套用本函数。
 */
export function computeAxisDraftMetrics(
  failures: readonly OracleOutcome[],
): Record<string, number> {
  const preFailed = failures.filter((o): o is Extract<OracleOutcome, { pass: false }> => !o.pass);
  const draftPass = preFailed.length === 0;
  return {
    a_case_pass_rate: draftPass ? 1 : 0,
    a_invariant_violations:
      !draftPass &&
      (preFailed[0]?.attribution === 'PROTOCOL' || preFailed[0]?.attribution === 'CONTEXT')
        ? 1
        : 0,
  };
}

/**
 * l1/l2 的最终结果对象构建（两趟后评分）。
 * l1 额外可挂 fold_state。
 */
export function finalizeAxisResult(opts: {
  revision: CaseRevision;
  failures: OracleOutcome[];
  artifactDir?: string;
  foldState?: unknown;
}): L1ItemResult {
  const failed = opts.failures.filter((o): o is Extract<OracleOutcome, { pass: false }> => !o.pass);
  const pass = failed.length === 0;
  const attribution: Attribution | undefined = pass
    ? undefined
    : (failed[0]?.attribution ?? 'PROTOCOL');
  const result: L1ItemResult = {
    item_id: opts.revision.case_revision_id,
    item_rev: opts.revision.revision_number,
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
  if (opts.foldState !== undefined) result.fold_state = opts.foldState;
  return result;
}

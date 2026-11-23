import type {
  Attempt,
  Attribution,
  CaseExecution,
  PairKey,
  Run,
  RunFinalManifest,
  RunLifecycleStatus,
  RunPlanSnapshot,
} from '../domain/types.ts';
import { RUN_TRANSITIONS } from '../domain/types.ts';
import type { CaseRevision, EnvironmentProfile } from '../domain/types.ts';
import type {
  AdapterContext,
  ExecutionAdapter,
  ObservedFacts,
  ObservedFactsRecorder,
  PreparedState,
} from './execution-adapter.ts';
import { AdapterError } from './execution-adapter.ts';
import { resolveRepeats } from './repeats.ts';
import type { AxisItemResult } from './runner-types.ts';

/** 生成唯一 ID（进程内单调 + 随机后缀，避免同毫秒冲突）。 */
let seq = 0;
function genId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * cleanup 失败但没有可承载的结果行时用的占位行。
 *
 * 只为「把泄漏记下来」而存在：标 `not_implemented` 以免被当成一条被测系统失败，
 * `pass` 与判据保持不通过，`oracle_failures` 里只有编排侧的泄漏证据。
 */
function placeholderCleanupResult(
  caseRevisionId: string,
  revisionNumber: number,
  message: string,
): AxisItemResult {
  return {
    item_id: caseRevisionId,
    item_rev: revisionNumber,
    pass: false,
    not_implemented: true,
    attribution: 'HARNESS',
    oracle_failures: [{ oracle_id: 'harness:cleanup', message }],
    // 占位行不进任何通过率统计（已标 not_implemented），指标值只为满足类型必填
    metrics: { a_case_pass_rate: 0, a_invariant_violations: 0 },
  };
}

/** 内存三值事实记录器实现。 */
class InMemoryFactsRecorder implements ObservedFactsRecorder {
  private resolved: Array<{ kind: string; key: string; value: unknown }> = [];
  private observed: Array<{ kind: string; key: string; value: unknown }> = [];

  resolve(kind: string, key: string, value: unknown): void {
    this.resolved.push({ kind, key, value });
  }

  observe(kind: string, key: string, value: unknown): void {
    this.observed.push({ kind, key, value });
  }

  snapshot(): ObservedFacts {
    return {
      resolved: [...this.resolved],
      observed: [...this.observed],
    };
  }
}

/** CaseExecution 需要的身份信息（由调用方从 CaseRevision 提供）。 */
export interface CaseIdentity {
  case_id: string;
  case_revision_id: string;
  replicate_index?: number;
}

/**
 * RunOrchestrator：落地 Run / CaseExecution / Attempt 三级状态机（02 §3.4）。
 *
 * 本阶段（4b）只做内存状态机；持久化、断点续跑、取消调度推迟到 Phase 2。
 */
export class RunOrchestrator {
  private run: Run | null = null;
  private planSnapshot: RunPlanSnapshot | null = null;
  private caseExecutions: CaseExecution[] = [];
  private attempts: Attempt[] = [];

  /** 创建 Run（created），冻结 RunPlanSnapshot。 */
  beginRun(input: { experimentId?: string; candidateId?: string }): Run {
    const run: Run = {
      run_id: genId('run'),
      lifecycle_status: 'created',
      ...(input.experimentId !== undefined ? { experiment_id: input.experimentId } : {}),
      ...(input.candidateId !== undefined ? { candidate_id: input.candidateId } : {}),
      started_at: new Date().toISOString(),
    };
    this.run = run;
    this.planSnapshot = {
      run_id: run.run_id,
      ...(input.experimentId !== undefined ? { experiment_id: input.experimentId } : {}),
      ...(input.candidateId !== undefined ? { candidate_id: input.candidateId } : {}),
      input_versions: {},
      resolved_config: {},
      frozen_at: new Date().toISOString(),
    };
    return run;
  }

  /** 推进 Run 状态，校验 RUN_TRANSITIONS，非法转换抛 AdapterError。 */
  transitionRun(status: RunLifecycleStatus): void {
    if (this.run === null) {
      throw new AdapterError('preflight_failed', 'HARNESS', 'RunOrchestrator 未 beginRun');
    }
    const allowed = RUN_TRANSITIONS[this.run.lifecycle_status];
    if (!allowed.includes(status)) {
      throw new AdapterError(
        'preflight_failed',
        'HARNESS',
        `非法 Run 状态转换：${this.run.lifecycle_status} → ${status}`,
      );
    }
    this.run.lifecycle_status = status;
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'blocked'
    ) {
      this.run.ended_at = new Date().toISOString();
    }
  }

  currentStatus(): RunLifecycleStatus {
    if (this.run === null) {
      throw new AdapterError('preflight_failed', 'HARNESS', 'RunOrchestrator 未 beginRun');
    }
    return this.run.lifecycle_status;
  }

  currentRun(): Run {
    if (this.run === null) {
      throw new AdapterError('preflight_failed', 'HARNESS', 'RunOrchestrator 未 beginRun');
    }
    return this.run;
  }

  /**
   * 为单个 case-revision 创建 CaseExecution + Attempt，执行 adapter，落终态。
   * caseIdentity 缺省时从 revision.case_id / case_revision_id 取身份。
   * repeats 上移（ADR-0010）：按 resolveRepeats 循环 N 次，每次 trial 一个独立
   * CaseExecution（replicate_index 递增）+ Attempt，合并所有 AxisItemResult 返回。
   */
  async executeCase(
    revision: CaseRevision,
    environment: EnvironmentProfile,
    adapter: ExecutionAdapter,
    exec: {
      projectRoot: string;
      models: string[];
      artifactDir?: string;
      sutRoot?: string;
      pairKey?: string;
      security?: { canary_secret?: string };
    },
    caseIdentity?: CaseIdentity,
  ): Promise<{ caseExecutions: CaseExecution[]; results: AxisItemResult[] }> {
    if (this.run === null) {
      throw new AdapterError('preflight_failed', 'HARNESS', 'RunOrchestrator 未 beginRun');
    }
    const run = this.run;

    const caseId = caseIdentity?.case_id ?? revision.case_id;
    const caseRevisionId = caseIdentity?.case_revision_id ?? revision.case_revision_id;
    const baseReplicate = caseIdentity?.replicate_index ?? 0;
    const repeats = resolveRepeats(revision, environment);

    const caseExecutions: CaseExecution[] = [];
    const allResults: AxisItemResult[] = [];

    for (let i = 0; i < repeats; i += 1) {
      const replicateIndex = baseReplicate + i;
      const { caseExecution, results } = await this.executeOnce(
        run,
        revision,
        environment,
        adapter,
        exec,
        caseId,
        caseRevisionId,
        replicateIndex,
      );
      caseExecutions.push(caseExecution);
      // 统一追加 trial 序号（ADR-0010）：仅 repeats>1 时 item_id 尾缀 `::r<N>`，
      // 供一致性聚合分组；单 trial（行为/事件题）保持原 item_id 不变。
      if (repeats > 1) {
        for (const r of results) {
          allResults.push({ ...r, item_id: `${r.item_id}::r${replicateIndex}` });
        }
      } else {
        allResults.push(...results);
      }
    }

    return { caseExecutions, results: allResults };
  }

  /** 单次 trial 的 8 阶段执行（repeats 循环体）。 */
  private async executeOnce(
    run: Run,
    revision: CaseRevision,
    environment: EnvironmentProfile,
    adapter: ExecutionAdapter,
    exec: {
      projectRoot: string;
      models: string[];
      artifactDir?: string;
      sutRoot?: string;
      pairKey?: string;
      security?: { canary_secret?: string };
    },
    caseId: string,
    caseRevisionId: string,
    replicateIndex: number,
  ): Promise<{ caseExecution: CaseExecution; results: AxisItemResult[] }> {
    const pairKey: PairKey = { case_revision_id: caseRevisionId, replicate_index: replicateIndex };
    const caseExecution: CaseExecution = {
      case_execution_id: genId('ce'),
      run_id: run.run_id,
      case_id: caseId,
      case_revision_id: caseRevisionId,
      replicate_index: replicateIndex,
      pair_key: pairKey,
      execution_outcome: 'unknown',
      evaluation_outcome: 'not_evaluated',
      attempts: [],
    };
    this.caseExecutions.push(caseExecution);

    const attempt: Attempt = {
      attempt_id: genId('att'),
      case_execution_id: caseExecution.case_execution_id,
      attempt_status: 'created',
      started_at: new Date().toISOString(),
    };
    this.attempts.push(attempt);
    caseExecution.attempts.push(attempt.attempt_id);

    const facts = new InMemoryFactsRecorder();
    const ctx: AdapterContext = {
      revision,
      environment,
      projectRoot: exec.projectRoot,
      models: exec.models,
      ...(exec.artifactDir !== undefined ? { artifactDir: exec.artifactDir } : {}),
      ...(exec.sutRoot !== undefined ? { sutRoot: exec.sutRoot } : {}),
      ...(exec.pairKey !== undefined ? { pairKey: exec.pairKey } : {}),
      ...(exec.security !== undefined ? { security: exec.security } : {}),
      run,
      caseExecution,
      attempt,
      facts,
    };

    // 8 阶段执行，捕获 AdapterError 映射终态，并确保 prepare 后的资源一定走 cleanup。
    let prepared: PreparedState | undefined = undefined;
    let outcome: { caseExecution: CaseExecution; results: AxisItemResult[] } | undefined =
      undefined;
    try {
      attempt.attempt_status = 'running';

      const discovered = await adapter.discover(ctx);
      if (adapter.preflight !== undefined) {
        const preflight = await adapter.preflight(ctx, discovered);
        if (!preflight.ok) {
          throw new AdapterError(
            'preflight_failed',
            'HARNESS',
            preflight.reason ?? 'preflight 失败',
          );
        }
      }
      prepared = await adapter.prepare(ctx, discovered);
      const handle = await adapter.submit(ctx, prepared);
      const collected = await adapter.collect(ctx, handle);
      const results = await adapter.evaluate(ctx, collected);

      attempt.attempt_status = 'completed';
      attempt.ended_at = new Date().toISOString();
      caseExecution.execution_outcome = 'completed';
      // 题级判定只看**真正被评测过**的行。适配器显式声明「该阶段尚未实现」的行
      // 不能算被测系统失败——否则能力缺失会污染通过率与被测系统缺陷数。
      // 必须按「任一行已评测」判定，不能只看 results[0]：B-direct 单题多模型一次产出
      // 多行，首行未必代表整题；首行已评测而后续行未评测时若只看首行，会把
      // not_implemented 与真实观测一起计入通过率分母（账实不符）。
      const evaluatedRows = results.filter((r) => r.not_implemented !== true);
      if (results.length > 0 && evaluatedRows.length === 0) {
        caseExecution.evaluation_outcome = 'not_evaluated';
        const head = results[0];
        if (head !== undefined && head.attribution !== undefined) {
          caseExecution.attribution = head.attribution;
        }
      } else {
        // 多行时与 write-artifacts 的题级口径一致：全部已评测行通过才算通过。
        caseExecution.evaluation_outcome = evaluatedRows.every((r) => r.pass) ? 'pass' : 'fail';
        const failed = evaluatedRows.find((r) => !r.pass);
        if (failed !== undefined && failed.attribution !== undefined) {
          caseExecution.attribution = failed.attribution;
        }
      }
      outcome = { caseExecution, results };
    } catch (e) {
      attempt.attempt_status = 'failed';
      attempt.ended_at = new Date().toISOString();
      const attribution: Attribution = e instanceof AdapterError ? e.attribution : 'HARNESS';
      caseExecution.execution_outcome = 'execution_failed';
      caseExecution.evaluation_outcome = 'fail';
      caseExecution.attribution = attribution;
      // 失败路径：若 AdapterError 携带完整结果（runner 的 fail() 产物），透传之。
      if (e instanceof AdapterError && e.result !== undefined) {
        outcome = { caseExecution, results: e.result };
      } else {
        // 兜底：无完整结果时，构造最小失败结果。
        outcome = {
          caseExecution,
          results: [
            {
              item_id: caseRevisionId,
              item_rev: revision.revision_number,
              pass: false,
              attribution,
              oracle_failures: [{ oracle_id: 'harness', message: (e as Error).message }],
              metrics: {
                a_case_pass_rate: 0,
                a_invariant_violations:
                  attribution === 'PROTOCOL' || attribution === 'CONTEXT' ? 1 : 0,
              },
            },
          ],
        };
      }
    } finally {
      if (prepared !== undefined && adapter.cleanup !== undefined) {
        // cleanup 有两种失败形态，都必须留证据：
        // 1) 直接抛异常；2) 正常返回 `{ ok: false, reason }`（Herdchestra 停实例失败就走这条，
        //    不会抛）。只看异常会漏掉第二种——实例没停、锁没释放却被静默放过。
        let cleanupFailure: string | undefined;
        try {
          const cleaned = await adapter.cleanup(ctx, prepared);
          // 旧适配器可能没按契约返回对象：直接读 ok 会抛 TypeError，
          // 让防御本身变成一条假泄漏记录。
          if (cleaned === undefined || cleaned === null) {
            cleanupFailure = 'cleanup 未返回结果（契约要求返回 CleanupResult）';
          } else if (cleaned.ok !== true) {
            cleanupFailure = cleaned.reason ?? 'cleanup 返回 ok=false';
          }
        } catch (cleanupError) {
          cleanupFailure =
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        }
        if (cleanupFailure !== undefined) {
          // 不改变本题判定（清理故障不能掩盖真实结果），但必须随结果落盘：
          // 泄漏会在后续 case 撞残留状态，静默吞掉等于把隐患藏起来。
          if (outcome !== undefined) {
            if (outcome.results.length === 0) {
              // 无任何结果行时不能静默丢弃泄漏记录：用最小占位行承载，
              // 标 `not_implemented` 以免被算成一条被测系统失败。
              outcome.results.push(
                placeholderCleanupResult(caseRevisionId, revision.revision_number, cleanupFailure),
              );
            } else {
              // 优先挂到「已评测」行上：`not_implemented` 行不进任何统计，
              // 挂上去会让题级 `cleanup_failed` 静默消失。找不到评测行才退回首行。
              const evaluatedIndex = outcome.results.findIndex((r) => r.not_implemented !== true);
              const targetIndex = evaluatedIndex >= 0 ? evaluatedIndex : 0;
              const target = outcome.results[targetIndex];
              if (target !== undefined) {
                outcome.results[targetIndex] = {
                  ...target,
                  oracle_failures: [
                    ...target.oracle_failures,
                    { oracle_id: 'harness:cleanup', message: cleanupFailure },
                  ],
                };
              }
            }
          }
          try {
            ctx.facts.observe('adapter', 'cleanup_failed', { message: cleanupFailure });
          } catch {
            /* 事实记录本身失败时不能反过来打断结果返回 */
          }
        }
      }
    }
    return outcome;
  }

  /**
   * 本题已记录的执行事实（无论 executeCase 是正常返回还是抛异常，都先记账再返回）。
   *
   * 供上层在 `executeCase` 抛错时补证据：case execution 与 attempt 的起止时间、
   * 失败状态都在编排器内部，异常一抛这些就随栈帧消失，落盘的结果行会只剩一句异常消息。
   */
  lastCaseExecution(): { caseExecution: CaseExecution; attempts: Attempt[] } | undefined {
    const caseExecution = this.caseExecutions.at(-1);
    if (caseExecution === undefined) return undefined;
    const ids = new Set(caseExecution.attempts);
    return {
      caseExecution,
      attempts: this.attempts.filter((attempt) => ids.has(attempt.attempt_id)),
    };
  }

  /** 封存 Run 终态，写 RunFinalManifest。 */ sealRun(
    status: RunLifecycleStatus,
  ): RunFinalManifest {
    if (this.run === null) {
      throw new AdapterError('preflight_failed', 'HARNESS', 'RunOrchestrator 未 beginRun');
    }
    if (this.planSnapshot === null) {
      throw new AdapterError('preflight_failed', 'HARNESS', 'RunOrchestrator 缺计划快照');
    }
    if (
      status !== 'completed' &&
      status !== 'failed' &&
      status !== 'cancelled' &&
      status !== 'blocked'
    ) {
      throw new AdapterError('preflight_failed', 'HARNESS', `sealRun 需要终态，收到 ${status}`);
    }
    const run = this.run;
    const planSnapshot = this.planSnapshot;
    // 封存同样受 RUN_TRANSITIONS 约束：终态必须能从当前态合法到达。
    const allowed = RUN_TRANSITIONS[run.lifecycle_status];
    if (!allowed.includes(status)) {
      throw new AdapterError(
        'preflight_failed',
        'HARNESS',
        `非法 Run 状态转换：${run.lifecycle_status} → ${status}`,
      );
    }
    run.lifecycle_status = status;
    run.ended_at = new Date().toISOString();

    const manifest: RunFinalManifest = {
      run_id: run.run_id,
      plan_snapshot_ref: planSnapshot.run_id,
      item_outcomes: this.caseExecutions.map((ce) => ({
        case_execution_id: ce.case_execution_id,
        execution_outcome: ce.execution_outcome,
        evaluation_outcome: ce.evaluation_outcome,
      })),
      sealed_at: new Date().toISOString(),
    };
    return manifest;
  }
}

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
import type { ItemDoc, RoomDoc } from '../exam-engine/types.ts';
import type {
  AdapterContext,
  ExecutionAdapter,
  ObservedFacts,
  ObservedFactsRecorder,
} from './execution-adapter.ts';
import { AdapterError } from './execution-adapter.ts';

/** 生成唯一 ID（进程内单调 + 随机后缀，避免同毫秒冲突）。 */
let seq = 0;
function genId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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

/** CaseExecution 需要的身份信息（由调用方从 CaseRevision 提供，ItemDoc 不携带）。 */
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
   * 为单个 item 创建 CaseExecution + Attempt，执行 adapter，落终态。
   * caseIdentity 缺省时从 item.id 反推 case_id（降级，仅当前 B 轴数据可靠）。
   */
  async executeCase(
    item: ItemDoc,
    room: RoomDoc,
    adapter: ExecutionAdapter,
    caseIdentity?: CaseIdentity,
  ): Promise<CaseExecution> {
    if (this.run === null) {
      throw new AdapterError('preflight_failed', 'HARNESS', 'RunOrchestrator 未 beginRun');
    }
    const run = this.run;

    const caseId = caseIdentity?.case_id ?? inferCaseId(item.id);
    const caseRevisionId = caseIdentity?.case_revision_id ?? caseId;
    const replicateIndex = caseIdentity?.replicate_index ?? 0;

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
    // 注意：projectRoot / models 暂为占位空值，7 个 runner 尚未改造为 adapter，
    // 待 Phase 2 接入时由 executeCase 显式传入（见设计稿 §6 边界）。
    const ctx: AdapterContext = {
      item,
      room,
      projectRoot: '',
      models: [],
      run,
      caseExecution,
      attempt,
      facts,
    };

    // 8 阶段执行，捕获 AdapterError 映射终态。
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
      const prepared = await adapter.prepare(ctx, discovered);
      const handle = await adapter.submit(ctx, prepared);
      const collected = await adapter.collect(ctx, handle);
      const evaluation = await adapter.evaluate(ctx, collected);

      if (adapter.cleanup !== undefined) {
        await adapter.cleanup(ctx, prepared);
      }

      attempt.attempt_status = 'completed';
      attempt.ended_at = new Date().toISOString();
      caseExecution.execution_outcome = 'completed';
      caseExecution.evaluation_outcome = evaluation.pass ? 'pass' : 'fail';
      if (!evaluation.pass && evaluation.attribution !== undefined) {
        caseExecution.attribution = evaluation.attribution;
      }
    } catch (e) {
      attempt.attempt_status = 'failed';
      attempt.ended_at = new Date().toISOString();
      const attribution: Attribution = e instanceof AdapterError ? e.attribution : 'HARNESS';
      caseExecution.execution_outcome = 'execution_failed';
      caseExecution.evaluation_outcome = 'fail';
      caseExecution.attribution = attribution;
    }

    return caseExecution;
  }

  /** 封存 Run 终态，写 RunFinalManifest。 */
  sealRun(status: RunLifecycleStatus): RunFinalManifest {
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

/** 从 V1 item_id（EVAL-B-PAIRED-TASK-22-OFF）反推 case_id（降级路径）。 */
function inferCaseId(itemId: string): string {
  const m = /^EVAL-[A-Z]-([A-Z0-9-]+?)-(OFF|ON)$/.exec(itemId);
  const caseId = m?.[1];
  return caseId !== undefined ? caseId.toLowerCase() : itemId;
}

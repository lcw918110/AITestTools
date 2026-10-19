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
      const results = await adapter.evaluate(ctx, collected);

      if (adapter.cleanup !== undefined) {
        await adapter.cleanup(ctx, prepared);
      }

      attempt.attempt_status = 'completed';
      attempt.ended_at = new Date().toISOString();
      caseExecution.execution_outcome = 'completed';
      const first = results[0];
      caseExecution.evaluation_outcome = first !== undefined && first.pass ? 'pass' : 'fail';
      if (first !== undefined && !first.pass && first.attribution !== undefined) {
        caseExecution.attribution = first.attribution;
      }
      return { caseExecution, results };
    } catch (e) {
      attempt.attempt_status = 'failed';
      attempt.ended_at = new Date().toISOString();
      const attribution: Attribution = e instanceof AdapterError ? e.attribution : 'HARNESS';
      caseExecution.execution_outcome = 'execution_failed';
      caseExecution.evaluation_outcome = 'fail';
      caseExecution.attribution = attribution;
      // 失败路径：若 AdapterError 携带完整结果（runner 的 fail() 产物），透传之。
      if (e instanceof AdapterError && e.result !== undefined) {
        return { caseExecution, results: e.result };
      }
      // 兜底：无完整结果时，构造最小失败结果。
      return {
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

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Attribution } from '../exam-engine/types.ts';
import type { AxisItemResult } from './runner-types.ts';
import {
  FoldResolveError,
  loadEventSequence,
  resolveFoldEntry,
  runFold,
  type FoldEvent,
} from '../drivers/fold/index.ts';
import {
  runEventFoldOracle,
  runNoEventOracle,
  runStatePredicateOracle,
  type OracleOutcome,
} from '../oracles/index.ts';
import {
  fail,
  computeAxisDraftMetrics,
  applyMetricThresholdPass,
  finalizeAxisResult,
} from './runner-shared.ts';
import type {
  AdapterContext,
  CollectedOutput,
  DiscoveredInput,
  ExecutionAdapter,
  PreparedState,
  SubmittedHandle,
} from './execution-adapter.ts';
import { AdapterError } from './execution-adapter.ts';

/** L1 fold 的 discover 产物。 */
interface L1Discovered {
  execution_profile: NonNullable<AdapterContext['revision']['execution_profile']>;
  events: FoldEvent[];
}

/** L1 fold 的 prepare 产物（resolved + 原输入透传）。 */
interface L1Prepared {
  resolved: ReturnType<typeof resolveFoldEntry>;
  events: FoldEvent[];
  execution_profile: NonNullable<AdapterContext['revision']['execution_profile']>;
}

/** L1 fold 的 submit/collect 产物。 */
interface L1Collected {
  foldState: unknown;
  events: FoldEvent[];
  evidenceRel?: string;
}

/**
 * L1 fold adapter：把 runL1Item 的隐式生命周期显式化为 8 阶段。
 * 执行语义不变（oracle 判定、归因、metrics 键集合与改造前一致）。
 */
export class L1Adapter implements ExecutionAdapter {
  readonly adapterId = 'l1-fold';

  async discover(ctx: AdapterContext): Promise<DiscoveredInput> {
    const execution_profile = ctx.revision.execution_profile;
    if (execution_profile === undefined) {
      throw new AdapterError('discover_failed', 'HARNESS', '缺少 execution_profile', false, [
        fail(ctx.revision, 'HARNESS', '缺少 execution_profile'),
      ]);
    }
    let events: FoldEvent[];
    try {
      events = loadEventSequence(ctx.projectRoot, ctx.revision.stimulus.ref);
    } catch (e) {
      const msg = `无法加载事件序列：${(e as Error).message}`;
      throw new AdapterError('discover_failed', 'HARNESS', msg, false, [
        fail(ctx.revision, 'HARNESS', msg),
      ]);
    }
    return { execution_profile, events };
  }

  async prepare(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreparedState> {
    const { execution_profile, events } = discovered as unknown as L1Discovered;
    try {
      const resolveOpts: Parameters<typeof resolveFoldEntry>[0] = {
        environment: ctx.environment,
        execution_profile,
        projectRoot: ctx.projectRoot,
      };
      if (ctx.sutRoot !== undefined) resolveOpts.sutRoot = ctx.sutRoot;
      const resolved = resolveFoldEntry(resolveOpts);
      return { resolved, events, execution_profile };
    } catch (e) {
      const attribution =
        e instanceof FoldResolveError
          ? 'HARNESS'
          : ((e as { attribution?: Attribution }).attribution ?? 'PROTOCOL');
      const result: AxisItemResult = {
        item_id: ctx.revision.case_revision_id,
        item_rev: ctx.revision.revision_number,
        pass: false,
        attribution,
        oracle_failures: [{ oracle_id: 'fold', message: (e as Error).message }],
        metrics: {
          a_case_pass_rate: 0,
          a_invariant_violations: attribution === 'PROTOCOL' || attribution === 'CONTEXT' ? 1 : 0,
        },
      };
      throw new AdapterError('prepare_failed', attribution, (e as Error).message, false, [result]);
    }
  }

  async submit(_ctx: AdapterContext, prepared: PreparedState): Promise<SubmittedHandle> {
    const { resolved, events, execution_profile } = prepared as unknown as L1Prepared;
    const foldState = await runFold({ resolved, events, execution_profile });
    return { foldState, events };
  }

  async collect(ctx: AdapterContext, handle: SubmittedHandle): Promise<CollectedOutput> {
    const { foldState, events } = handle as unknown as L1Collected;
    let evidenceRel: string | undefined;
    if (ctx.artifactDir !== undefined) {
      mkdirSync(ctx.artifactDir, { recursive: true });
      writeFileSync(
        join(ctx.artifactDir, 'fold-state.json'),
        `${JSON.stringify(foldState, null, 2)}\n`,
      );
      evidenceRel = 'fold-state.json';
    }
    return { foldState, events, evidenceRel };
  }

  async evaluate(ctx: AdapterContext, collected: CollectedOutput): Promise<AxisItemResult[]> {
    const { foldState, events, evidenceRel } = collected as unknown as L1Collected;
    const focus = ctx.revision.attribution_focus;
    const failures: OracleOutcome[] = [];

    for (const [i, oracle] of ctx.revision.expect.oracles.entries()) {
      const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
      if (oracle.type === 'event_fold') {
        const spec = String(oracle.spec ?? '');
        const foldOpts: Parameters<typeof runEventFoldOracle>[0] = {
          oracle_id: oid,
          foldState,
          expectedPath: spec,
          projectRoot: ctx.projectRoot,
          attribution: focus,
        };
        if (evidenceRel !== undefined) foldOpts.artifactRel = evidenceRel;
        failures.push(runEventFoldOracle(foldOpts));
      } else if (oracle.type === 'state_predicate') {
        const predOpts: Parameters<typeof runStatePredicateOracle>[0] = {
          oracle_id: oid,
          expr: String(oracle.expr ?? ''),
          root: foldState,
          attribution: focus,
        };
        if (evidenceRel !== undefined) predOpts.evidence_ref = evidenceRel;
        failures.push(runStatePredicateOracle(predOpts));
      } else if (oracle.type === 'no_event') {
        const names = Array.isArray(oracle.names) ? oracle.names.map(String) : [];
        failures.push(
          runNoEventOracle({
            oracle_id: oid,
            events,
            names,
            attribution: focus,
          }),
        );
      } else if (oracle.type === 'metric_threshold') {
        // 占位：先收集，待其它 oracle 出草稿 metrics 后再判
        continue;
      } else {
        failures.push({
          pass: false,
          oracle_id: oid,
          message: `L1 暂不支持 oracle 类型 ${oracle.type}`,
          attribution: 'HARNESS',
        });
      }
    }

    const draftMetrics = computeAxisDraftMetrics(failures);
    applyMetricThresholdPass(ctx.revision.expect.oracles, draftMetrics, focus, (o) =>
      failures.push(o),
    );

    return [
      finalizeAxisResult({
        revision: ctx.revision,
        failures,
        ...(ctx.artifactDir !== undefined ? { artifactDir: ctx.artifactDir } : {}),
        foldState,
      }),
    ];
  }
}

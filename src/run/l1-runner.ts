import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Attribution, FreezeA, ItemDoc, RoomDoc } from '../exam-engine/types.ts';
import {
  FoldResolveError,
  loadEventSequence,
  resolveFoldEntry,
  runFold,
} from '../drivers/fold/index.ts';
import {
  runEventFoldOracle,
  runNoEventOracle,
  runStatePredicateOracle,
  type OracleOutcome,
} from '../oracles/index.ts';
import { fail, computeAxisDraftMetrics, applyMetricThresholdPass, finalizeAxisResult } from './runner-shared.ts';

export interface L1ItemResult {
  item_id: string;
  item_rev: number;
  pass: boolean;
  attribution?: Attribution;
  oracle_failures: Array<{
    oracle_id: string;
    message: string;
    evidence_ref?: string;
  }>;
  metrics: Record<string, number>;
  artifact_dir?: string;
  fold_state?: unknown;
  /** 配对效果键（来自 intent.effect_pair） */
  effect_pair?: string;
  /** hosted 约定终态词（辅助信号，不单独否决） */
  pass_token?: string;
  pass_token_present?: boolean;
  pass_token_role?: 'auxiliary';
  /** hosted：工作区断言是否全部通过（无此类 oracle 则为 true） */
  workspace_ok?: boolean;
  /** hosted：播种材料是否被改过（超时归因：未改→CONTEXT，改错→MODEL_TASK） */
  materials_mutated?: boolean;
  /** hosted：宿主墙钟超时（辅助；工作区已过则不否决） */
  timed_out?: boolean;
  /** hosted：进程退出码；超时/被杀为 null（辅助） */
  host_exit?: number | null;
  host_signal?: string | null;
  host_exit_role?: 'auxiliary';
}

export async function runL1Item(opts: {
  item: ItemDoc;
  room: RoomDoc;
  projectRoot: string;
  sutRoot?: string;
  artifactDir?: string;
}): Promise<L1ItemResult> {
  const freeze = opts.item.freeze as FreezeA;
  const focus = opts.item.intent.attribution_focus;
  const failures: OracleOutcome[] = [];

  let events;
  try {
    events = loadEventSequence(opts.projectRoot, opts.item.stimulus.ref);
  } catch (e) {
    return fail(opts.item, 'HARNESS', `无法加载事件序列：${(e as Error).message}`);
  }

  let foldState: unknown;
  try {
    const resolveOpts: {
      room: RoomDoc;
      freeze: FreezeA;
      projectRoot: string;
      sutRoot?: string;
    } = {
      room: opts.room,
      freeze,
      projectRoot: opts.projectRoot,
    };
    if (opts.sutRoot !== undefined) resolveOpts.sutRoot = opts.sutRoot;
    const resolved = resolveFoldEntry(resolveOpts);
    foldState = await runFold({ resolved, events, freeze });
  } catch (e) {
    const attribution =
      e instanceof FoldResolveError
        ? 'HARNESS'
        : ((e as { attribution?: Attribution }).attribution ?? 'PROTOCOL');
    return {
      item_id: opts.item.id,
      item_rev: opts.item.rev,
      pass: false,
      attribution,
      oracle_failures: [{ oracle_id: 'fold', message: (e as Error).message }],
      metrics: {
        a_case_pass_rate: 0,
        a_invariant_violations: attribution === 'PROTOCOL' || attribution === 'CONTEXT' ? 1 : 0,
      },
    };
  }

  let evidenceRel: string | undefined;
  if (opts.artifactDir !== undefined) {
    mkdirSync(opts.artifactDir, { recursive: true });
    writeFileSync(
      join(opts.artifactDir, 'fold-state.json'),
      `${JSON.stringify(foldState, null, 2)}\n`,
    );
    evidenceRel = 'fold-state.json';
  }

  for (const [i, oracle] of opts.item.expect.oracles.entries()) {
    const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
    if (oracle.type === 'event_fold') {
      const spec = String(oracle.spec ?? '');
      const foldOpts: Parameters<typeof runEventFoldOracle>[0] = {
        oracle_id: oid,
        foldState,
        expectedPath: spec,
        projectRoot: opts.projectRoot,
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
  applyMetricThresholdPass(opts.item.expect.oracles, draftMetrics, focus, (o) => failures.push(o));

  return finalizeAxisResult({ item: opts.item, failures, ...(opts.artifactDir !== undefined ? { artifactDir: opts.artifactDir } : {}), foldState });
}



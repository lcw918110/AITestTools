import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPromptfooAdapter, type EvalJob } from '../drivers/model-adapter/index.ts';
import type { OracleSchemaObedience, OracleToolTrace } from '../exam-engine/types.ts';
import type { AxisItemResult } from './runner-types.ts';
import {
  runSchemaObedienceOracle,
  runToolTraceOracle,
  type OracleOutcome,
} from '../oracles/index.ts';
import { fail, applyMetricThresholdPass } from './runner-shared.ts';
import type { ToolCallTrace } from '../oracles/tool-trace.ts';
import type {
  AdapterContext,
  CollectedOutput,
  DiscoveredInput,
  ExecutionAdapter,
  PreparedState,
  SubmittedHandle,
} from './execution-adapter.ts';
import { AdapterError } from './execution-adapter.ts';

function parseCalls(trace: unknown): ToolCallTrace[] {
  if (!Array.isArray(trace)) return [];
  return trace
    .map((t) => {
      if (typeof t !== 'object' || t === null) return null;
      const o = t as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : typeof o.tool === 'string' ? o.tool : '';
      if (!name) return null;
      const row: ToolCallTrace = { name };
      if (typeof o.args === 'object' && o.args !== null) {
        row.args = o.args as Record<string, unknown>;
      }
      return row;
    })
    .filter((x): x is ToolCallTrace => x !== null);
}

interface BDirectDiscovered {
  job: EvalJob;
}

type FrameworkRawResult =
  ReturnType<typeof runPromptfooAdapter> extends Promise<infer T> ? T : never;

interface BDirectCollected {
  raw: FrameworkRawResult;
}

/**
 * B-direct adapter：promptfoo 模型矩阵（fixture / live 双模式）。
 * 单题多 model × repeat 展开为多行 AxisItemResult。
 * 执行语义不变，仅把隐式流程显式化为 8 阶段。
 */
export class BDirectAdapter implements ExecutionAdapter {
  readonly adapterId = 'b-direct-promptfoo';

  async discover(ctx: AdapterContext): Promise<DiscoveredInput> {
    // repeats 上移到编排层（ADR-0010）：adapter 内固定 1，不再自行展开。
    const repeats = 1;

    const mustCallOracle = ctx.revision.expect.oracles.find(
      (o): o is OracleToolTrace => o.type === 'tool_trace',
    );
    const schemaOracle = ctx.revision.expect.oracles.find(
      (o): o is OracleSchemaObedience => o.type === 'schema_obedience',
    );

    const jobItem: EvalJob['items'][number] = {
      id: ctx.revision.case_revision_id,
      rev: ctx.revision.revision_number,
      prompt_ref: ctx.revision.stimulus.ref,
    };
    if (Array.isArray(mustCallOracle?.must_call)) {
      jobItem.must_call = mustCallOracle.must_call.map(String);
    }
    if (schemaOracle !== undefined) {
      const tool = String(schemaOracle.tool ?? '');
      const fields = Array.isArray(schemaOracle.required_fields)
        ? schemaOracle.required_fields.map(String)
        : [];
      jobItem.required_fields = { [tool]: fields };
    }

    const job: EvalJob = {
      items: [jobItem],
      models: ctx.models,
      repeats,
    };
    return { job };
  }

  async prepare(_ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreparedState> {
    return { job: (discovered as unknown as BDirectDiscovered).job };
  }

  async submit(ctx: AdapterContext, prepared: PreparedState): Promise<SubmittedHandle> {
    const { job } = prepared as unknown as BDirectDiscovered;
    let raw: FrameworkRawResult;
    try {
      const adapterOpts: Parameters<typeof runPromptfooAdapter>[1] = {
        projectRoot: ctx.projectRoot,
      };
      if (ctx.artifactDir !== undefined) adapterOpts.artifactDir = ctx.artifactDir;
      raw = await runPromptfooAdapter(job, adapterOpts);
    } catch (e) {
      throw new AdapterError(
        'submit_failed',
        'HARNESS',
        `B-direct adapter 失败：${(e as Error).message}`,
        false,
        [
          fail(ctx.revision, 'HARNESS', `B-direct adapter 失败：${(e as Error).message}`, {
            invariantViolationsExplicit: 0,
            extraMetrics: { b_schema_obedience_rate: 0 },
            ...(ctx.models[0] !== undefined ? { modelSuffix: ctx.models[0] } : {}),
          }),
        ],
      );
    }
    return { raw };
  }

  async collect(ctx: AdapterContext, handle: SubmittedHandle): Promise<CollectedOutput> {
    const { raw } = handle as unknown as BDirectCollected;
    if (ctx.artifactDir !== undefined) {
      mkdirSync(ctx.artifactDir, { recursive: true });
      writeFileSync(
        join(ctx.artifactDir, 'framework-raw.json'),
        `${JSON.stringify(raw, null, 2)}\n`,
      );
    }
    return { raw };
  }

  async evaluate(ctx: AdapterContext, collected: CollectedOutput): Promise<AxisItemResult[]> {
    const { raw } = collected as unknown as BDirectCollected;
    const focus = ctx.revision.attribution_focus;
    const results: AxisItemResult[] = [];

    for (const row of raw.rows) {
      const calls = parseCalls(row.tool_trace);
      const failures: OracleOutcome[] = [];
      for (const [i, oracle] of ctx.revision.expect.oracles.entries()) {
        const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
        if (oracle.type === 'tool_trace') {
          const must = Array.isArray(oracle.must_call) ? oracle.must_call.map(String) : [];
          failures.push(
            runToolTraceOracle({
              oracle_id: oid,
              must_call: must,
              calls,
              attribution: focus,
            }),
          );
        } else if (oracle.type === 'schema_obedience') {
          const fields = Array.isArray(oracle.required_fields)
            ? oracle.required_fields.map(String)
            : [];
          failures.push(
            runSchemaObedienceOracle({
              oracle_id: oid,
              tool: String(oracle.tool ?? ''),
              required_fields: fields,
              calls,
              attribution: focus,
            }),
          );
        } else if (oracle.type === 'metric_threshold') {
          continue;
        } else {
          failures.push({
            pass: false,
            oracle_id: oid,
            message: `B-direct 暂不支持 oracle ${oracle.type}`,
            attribution: 'HARNESS',
          });
        }
      }
      const preFailed = failures.filter(
        (o): o is Extract<OracleOutcome, { pass: false }> => !o.pass,
      );
      const draftPass = preFailed.length === 0 && row.pass;
      const draftMetrics: Record<string, number> = {
        b_schema_obedience_rate: draftPass ? 1 : 0,
        b_required_tool_call_rate: draftPass ? 1 : 0,
        a_case_pass_rate: draftPass ? 1 : 0,
        a_invariant_violations: 0,
      };
      applyMetricThresholdPass(ctx.revision.expect.oracles, draftMetrics, focus, (o) =>
        failures.push(o),
      );
      const failed = failures.filter((o): o is Extract<OracleOutcome, { pass: false }> => !o.pass);
      const pass = failed.length === 0 && row.pass;
      const attribution = pass ? undefined : (failed[0]?.attribution ?? 'MODEL_SCHEMA');
      // item_id 保留 model 段；trial 序号由编排层 executeOnce 统一追加（ADR-0010）。
      const result: AxisItemResult = {
        item_id: `${ctx.revision.case_revision_id}::${row.model}`,
        item_rev: ctx.revision.revision_number,
        pass,
        oracle_failures: failed.map((f) => ({
          oracle_id: f.oracle_id,
          message: f.message,
        })),
        metrics: {
          b_schema_obedience_rate: pass ? 1 : 0,
          b_required_tool_call_rate: pass ? 1 : 0,
          a_case_pass_rate: pass ? 1 : 0,
          a_invariant_violations: 0,
        },
      };
      if (attribution !== undefined) result.attribution = attribution;
      if (ctx.artifactDir !== undefined) {
        result.artifact_dir = join(ctx.artifactDir, sanitize(row.model), `r${row.repeat}`);
        mkdirSync(result.artifact_dir, { recursive: true });
        writeFileSync(join(result.artifact_dir, 'row.json'), `${JSON.stringify(row, null, 2)}\n`);
      }
      results.push(result);
    }
    return results;
  }
}

function sanitize(model: string): string {
  return model.replace(/[^A-Za-z0-9._-]+/g, '_');
}

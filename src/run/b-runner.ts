import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPromptfooAdapter, type EvalJob } from '../drivers/model-adapter/index.ts';
import type { OracleSchemaObedience, OracleToolTrace } from '../exam-engine/types.ts';
import type { CaseRevision, EnvironmentProfile } from '../domain/types.ts';
import {
  runSchemaObedienceOracle,
  runToolTraceOracle,
  type OracleOutcome,
} from '../oracles/index.ts';
import { fail, applyMetricThresholdPass } from './runner-shared.ts';
import type { ToolCallTrace } from '../oracles/tool-trace.ts';
import type { AxisItemResult } from './l2-runner.ts';

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

function roomRepeats(environment: EnvironmentProfile): number | undefined {
  const r = environment.recipe.adapter?.repeats;
  return typeof r === 'number' ? r : undefined;
}

export async function runBDirectItem(opts: {
  revision: CaseRevision;
  environment: EnvironmentProfile;
  projectRoot: string;
  models: string[];
  artifactDir?: string;
}): Promise<AxisItemResult[]> {
  const focus = opts.revision.attribution_focus;
  const repeats = opts.revision.execution.repeats ?? roomRepeats(opts.environment) ?? 1;

  const mustCallOracle = opts.revision.expect.oracles.find(
    (o): o is OracleToolTrace => o.type === 'tool_trace',
  );
  const schemaOracle = opts.revision.expect.oracles.find(
    (o): o is OracleSchemaObedience => o.type === 'schema_obedience',
  );

  const jobItem: EvalJob['items'][number] = {
    id: opts.revision.case_revision_id,
    rev: opts.revision.revision_number,
    prompt_ref: opts.revision.stimulus.ref,
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
    models: opts.models,
    repeats,
  };

  let raw;
  try {
    const adapterOpts: Parameters<typeof runPromptfooAdapter>[1] = {
      projectRoot: opts.projectRoot,
    };
    if (opts.artifactDir !== undefined) adapterOpts.artifactDir = opts.artifactDir;
    raw = await runPromptfooAdapter(job, adapterOpts);
  } catch (e) {
    return [
      fail(opts.revision, 'HARNESS', `B-direct adapter 失败：${(e as Error).message}`, {
        invariantViolationsExplicit: 0,
        extraMetrics: { b_schema_obedience_rate: 0 },
        ...(opts.models[0] !== undefined ? { modelSuffix: opts.models[0] } : {}),
      }),
    ];
  }

  if (opts.artifactDir !== undefined) {
    mkdirSync(opts.artifactDir, { recursive: true });
    writeFileSync(
      join(opts.artifactDir, 'framework-raw.json'),
      `${JSON.stringify(raw, null, 2)}\n`,
    );
  }

  const results: AxisItemResult[] = [];
  for (const row of raw.rows) {
    const calls = parseCalls(row.tool_trace);
    const failures: OracleOutcome[] = [];
    for (const [i, oracle] of opts.revision.expect.oracles.entries()) {
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
    const preFailed = failures.filter((o): o is Extract<OracleOutcome, { pass: false }> => !o.pass);
    const draftPass = preFailed.length === 0 && row.pass;
    const draftMetrics: Record<string, number> = {
      b_schema_obedience_rate: draftPass ? 1 : 0,
      b_required_tool_call_rate: draftPass ? 1 : 0,
      a_case_pass_rate: draftPass ? 1 : 0,
      a_invariant_violations: 0,
    };
    applyMetricThresholdPass(opts.revision.expect.oracles, draftMetrics, focus, (o) =>
      failures.push(o),
    );
    const failed = failures.filter((o): o is Extract<OracleOutcome, { pass: false }> => !o.pass);
    const pass = failed.length === 0 && row.pass;
    const attribution = pass ? undefined : (failed[0]?.attribution ?? 'MODEL_SCHEMA');
    const result: AxisItemResult = {
      item_id: `${opts.revision.case_revision_id}::${row.model}::r${row.repeat}`,
      item_rev: opts.revision.revision_number,
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
    if (opts.artifactDir !== undefined) {
      result.artifact_dir = join(opts.artifactDir, sanitize(row.model), `r${row.repeat}`);
      mkdirSync(result.artifact_dir, { recursive: true });
      writeFileSync(join(result.artifact_dir, 'row.json'), `${JSON.stringify(row, null, 2)}\n`);
    }
    results.push(result);
  }
  return results;
}

function sanitize(model: string): string {
  return model.replace(/[^A-Za-z0-9._-]+/g, '_');
}

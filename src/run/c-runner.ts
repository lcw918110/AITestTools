import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AxisItemResult } from './runner-types.ts';
import { runToolSideEffectOracle, runWorkspaceAssertOracle } from '../oracles/index.ts';
import { fail, applyMetricThresholdPass } from './runner-shared.ts';
import { deepEqual } from '../oracles/deep-equal.ts';
import type {
  AdapterContext,
  CollectedOutput,
  DiscoveredInput,
  ExecutionAdapter,
  PreparedState,
  SubmittedHandle,
} from './execution-adapter.ts';
import { AdapterError } from './execution-adapter.ts';

interface ShellStimulus {
  args?: Record<string, unknown>;
  context?: Record<string, unknown>;
  expect?: {
    ok?: boolean;
    exit_code?: number;
    result?: unknown;
    error_kind?: string;
    side_effect_file?: string;
    side_effect_contains?: string;
  };
}

interface CDiscovered {
  shellRel: string;
  stimulus: ShellStimulus;
}

interface CPrepared {
  shellPath: string;
  workspace: string;
  input: Record<string, unknown>;
  stimulus: ShellStimulus;
}

interface CCollected {
  shellPath: string;
  workspace: string;
  status: number | null;
  stdout: string;
  stderr: string;
  stimulus: ShellStimulus;
}

/**
 * C 轴 adapter：CLI 壳协议。
 * `node <shell.mjs>` stdin=JSON → stdout=JSON；exit≠0 → HARNESS。
 * 把 runCItem 的隐式生命周期显式化为 8 阶段，执行语义不变。
 */
export class CAdapter implements ExecutionAdapter {
  readonly adapterId = 'c-cli-shell';

  async discover(ctx: AdapterContext): Promise<DiscoveredInput> {
    const shellRel =
      (typeof ctx.environment.recipe.adapter?.config === 'string'
        ? ctx.environment.recipe.adapter.config
        : undefined) ??
      (typeof ctx.environment.recipe.host_command === 'string'
        ? ctx.environment.recipe.host_command
        : undefined);

    if (shellRel === undefined) {
      throw new AdapterError(
        'discover_failed',
        'HARNESS',
        'C 轴环境需 adapter.config 指向 shells/<tool>.mjs',
        false,
        [
          fail(ctx.revision, 'HARNESS', 'C 轴环境需 adapter.config 指向 shells/<tool>.mjs', {
            extraMetrics: { c_contract_pass_rate: 0 },
          }),
        ],
      );
    }

    let stimulus: ShellStimulus;
    try {
      stimulus = JSON.parse(
        readFileSync(resolve(ctx.projectRoot, ctx.revision.stimulus.ref), 'utf8'),
      ) as ShellStimulus;
    } catch (e) {
      const msg = `无法加载 stimulus：${(e as Error).message}`;
      throw new AdapterError('discover_failed', 'HARNESS', msg, false, [
        fail(ctx.revision, 'HARNESS', msg, { extraMetrics: { c_contract_pass_rate: 0 } }),
      ]);
    }

    return { shellRel, stimulus };
  }

  async prepare(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreparedState> {
    const { shellRel, stimulus } = discovered as unknown as CDiscovered;
    const workspace = mkdtempSync(join(tmpdir(), 'proctor-c-ws-'));
    const shellPath = resolve(ctx.projectRoot, shellRel);
    const input = {
      args: stimulus.args ?? {},
      context: {
        workspace,
        deadline_ms: ctx.revision.execution.deadline_ms,
        ...(stimulus.context ?? {}),
      },
    };
    return { shellPath, workspace, input, stimulus };
  }

  async submit(ctx: AdapterContext, prepared: PreparedState): Promise<SubmittedHandle> {
    const { shellPath, workspace, input, stimulus } = prepared as unknown as CPrepared;
    const r = spawnSync(process.execPath, [shellPath], {
      encoding: 'utf8',
      input: `${JSON.stringify(input)}\n`,
      timeout: ctx.revision.execution.deadline_ms || 30_000,
      cwd: workspace,
    });
    return {
      shellPath,
      workspace,
      status: r.status,
      stdout: r.stdout || '',
      stderr: r.stderr || '',
      stimulus,
    };
  }

  async collect(ctx: AdapterContext, handle: SubmittedHandle): Promise<CollectedOutput> {
    const { shellPath, workspace, status, stdout, stderr, stimulus } =
      handle as unknown as CCollected;
    if (ctx.artifactDir !== undefined) {
      mkdirSync(ctx.artifactDir, { recursive: true });
      writeFileSync(
        join(ctx.artifactDir, 'c-spawn.json'),
        `${JSON.stringify(
          {
            shell: shellPath,
            status,
            stdout: stdout.slice(0, 4000),
            stderr: stderr.slice(0, 2000),
            workspace,
          },
          null,
          2,
        )}\n`,
      );
    }
    return { shellPath, workspace, status, stdout, stderr, stimulus };
  }

  async evaluate(ctx: AdapterContext, collected: CollectedOutput): Promise<AxisItemResult[]> {
    const { workspace, status, stdout, stderr, stimulus } = collected as unknown as CCollected;
    const focus = ctx.revision.attribution_focus;
    const failures: Array<{ oracle_id: string; message: string }> = [];

    // exit_code oracle：独立于 stdout 解析与非 0 bail，先按实际退出码判定。
    let exitCodeHonored = false;
    for (const [i, oracle] of ctx.revision.expect.oracles.entries()) {
      if (oracle.type !== 'exit_code') continue;
      const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
      const want = Number(oracle.equals ?? 0);
      const got = status ?? 1;
      if (got === want) {
        exitCodeHonored = true;
      } else {
        failures.push({ oracle_id: oid, message: `exit_code 期望 ${want} 实际 ${got}` });
      }
    }

    if (status !== 0 && status !== null && !exitCodeHonored) {
      return [
        fail(
          ctx.revision,
          'HARNESS',
          `CLI 壳非 0 退出（status=${String(status)}）：${(stderr || stdout || '').slice(0, 200)}`,
          { extraMetrics: { c_contract_pass_rate: 0 } },
        ),
      ];
    }

    let parsed: { ok?: boolean; result?: unknown; error?: { kind?: string; message?: string } };
    try {
      parsed = JSON.parse(stdout.trim()) as typeof parsed;
    } catch (e) {
      return [
        fail(ctx.revision, 'HARNESS', `壳 stdout 非 JSON：${(e as Error).message}`, {
          extraMetrics: { c_contract_pass_rate: 0 },
        }),
      ];
    }

    // 从 stimulus 取 expect（discover 阶段已解析，经 submit/collect 透传）。
    const exp = stimulus.expect ?? {};

    if (exp.ok !== undefined && parsed.ok !== exp.ok) {
      failures.push({
        oracle_id: 'exit_ok',
        message: `期望 ok=${String(exp.ok)}，实际 ${String(parsed.ok)}`,
      });
    }
    if (exp.error_kind !== undefined) {
      const kind = parsed.error?.kind;
      if (kind !== exp.error_kind) {
        failures.push({
          oracle_id: 'error_kind',
          message: `期望 error.kind=${exp.error_kind}，实际 ${String(kind)}`,
        });
      }
    }
    if (exp.result !== undefined) {
      if (JSON.stringify(parsed.result) !== JSON.stringify(exp.result)) {
        failures.push({ oracle_id: 'result_equals', message: 'result 与期望不一致' });
      }
    }
    if (exp.side_effect_file !== undefined) {
      const sidePath = join(workspace, exp.side_effect_file);
      try {
        const body = readFileSync(sidePath, 'utf8');
        if (exp.side_effect_contains !== undefined && !body.includes(exp.side_effect_contains)) {
          failures.push({
            oracle_id: 'tool_side_effect',
            message: `副作用文件未含「${exp.side_effect_contains}」`,
          });
        }
      } catch {
        failures.push({
          oracle_id: 'tool_side_effect',
          message: `缺少副作用文件：${exp.side_effect_file}`,
        });
      }
    }

    // 试题 oracles（exit_code 已前置判定）
    for (const [i, oracle] of ctx.revision.expect.oracles.entries()) {
      const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
      if (oracle.type === 'workspace_assert') {
        const outcome = runWorkspaceAssertOracle({
          oracle_id: oid,
          oracle,
          workspace,
          attribution: focus ?? 'TOOL',
        });
        if (!outcome.pass) {
          failures.push({ oracle_id: outcome.oracle_id, message: outcome.message });
        }
      } else if (oracle.type === 'tool_side_effect') {
        const outcome = runToolSideEffectOracle({
          oracle_id: oid,
          oracle,
          workspace,
          attribution: focus ?? 'TOOL',
        });
        if (!outcome.pass) {
          failures.push({ oracle_id: outcome.oracle_id, message: outcome.message });
        }
      } else if (oracle.type === 'tool_result_equals') {
        const expected = oracle.equals ?? oracle.expected;
        if (!deepEqual(parsed.result, expected)) {
          failures.push({ oracle_id: oid, message: 'tool_result_equals 与期望不一致' });
        }
      } else if (oracle.type === 'metric_threshold') {
        continue;
      } else if (oracle.type === 'exit_code') {
        continue;
      } else {
        failures.push({ oracle_id: oid, message: `C 轴暂不支持 oracle 类型 ${oracle.type}` });
      }
    }

    const draftPass = failures.length === 0;
    const draftMetrics: Record<string, number> = {
      a_case_pass_rate: draftPass ? 1 : 0,
      a_invariant_violations: draftPass ? 0 : 1,
      c_contract_pass_rate: draftPass ? 1 : 0,
    };
    applyMetricThresholdPass(ctx.revision.expect.oracles, draftMetrics, focus ?? 'TOOL', (o) => {
      if (!o.pass) {
        failures.push({ oracle_id: o.oracle_id, message: o.message });
      }
    });

    const pass = failures.length === 0;
    const result: AxisItemResult = {
      item_id: ctx.revision.case_revision_id,
      item_rev: ctx.revision.revision_number,
      pass,
      oracle_failures: failures,
      metrics: {
        a_case_pass_rate: pass ? 1 : 0,
        a_invariant_violations: pass ? 0 : 1,
        c_contract_pass_rate: pass ? 1 : 0,
      },
    };
    if (!pass) result.attribution = focus ?? 'TOOL';
    if (ctx.artifactDir !== undefined) result.artifact_dir = ctx.artifactDir;
    return [result];
  }
}

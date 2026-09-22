import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ItemDoc, RoomDoc } from '../exam-engine/types.ts';
import {
  runToolSideEffectOracle,
  runWorkspaceAssertOracle,
} from '../oracles/index.ts';
import { fail, applyMetricThresholdPass } from './runner-shared.ts';
import { deepEqual } from '../oracles/deep-equal.ts';
import type { AxisItemResult } from './l2-runner.ts';
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

/**
 * C 轴：CLI 壳协议。
 * `node <shell.mjs>` stdin=JSON → stdout=JSON；exit≠0 → HARNESS。
 */
export async function runCItem(opts: {
  item: ItemDoc;
  room: RoomDoc;
  projectRoot: string;
  artifactDir?: string;
}): Promise<AxisItemResult> {
  const focus = opts.item.intent.attribution_focus;
  const shellRel =
    (typeof opts.room.adapter?.config === 'string' ? opts.room.adapter.config : undefined) ??
    (typeof opts.room.host?.command === 'string' ? opts.room.host.command : undefined);

  if (shellRel === undefined) {
    return fail(opts.item, 'HARNESS', 'C 轴考场需 adapter.config 指向 shells/<tool>.mjs', { extraMetrics: { c_contract_pass_rate: 0 } });
  }

  let stimulus: ShellStimulus;
  try {
    stimulus = JSON.parse(
      readFileSync(resolve(opts.projectRoot, opts.item.stimulus.ref), 'utf8'),
    ) as ShellStimulus;
  } catch (e) {
    return fail(opts.item, 'HARNESS', `无法加载 stimulus：${(e as Error).message}`, { extraMetrics: { c_contract_pass_rate: 0 } });
  }

  const workspace = mkdtempSync(join(tmpdir(), 'proctor-c-ws-'));
  const shellPath = resolve(opts.projectRoot, shellRel);
  const input = {
    args: stimulus.args ?? {},
    context: {
      workspace,
      deadline_ms: opts.item.execution.deadline_ms,
      ...(stimulus.context ?? {}),
    },
  };

  const r = spawnSync(process.execPath, [shellPath], {
    encoding: 'utf8',
    input: `${JSON.stringify(input)}\n`,
    timeout: opts.item.execution.deadline_ms || 30_000,
    cwd: workspace,
  });

  if (opts.artifactDir !== undefined) {
    mkdirSync(opts.artifactDir, { recursive: true });
    writeFileSync(
      join(opts.artifactDir, 'c-spawn.json'),
      `${JSON.stringify(
        {
          shell: shellPath,
          status: r.status,
          stdout: (r.stdout || '').slice(0, 4000),
          stderr: (r.stderr || '').slice(0, 2000),
          workspace,
        },
        null,
        2,
      )}\n`,
    );
  }

  const failures: Array<{ oracle_id: string; message: string }> = [];

  // exit_code oracle：独立于 stdout 解析与非 0 bail，先按实际退出码判定。
  let exitCodeHonored = false;
  for (const [i, oracle] of opts.item.expect.oracles.entries()) {
    if (oracle.type !== 'exit_code') continue;
    const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
    const want = Number(oracle.equals ?? 0);
    const got = r.status ?? 1;
    if (got === want) {
      exitCodeHonored = true;
    } else {
      failures.push({ oracle_id: oid, message: `exit_code 期望 ${want} 实际 ${got}` });
    }
  }

  if (r.status !== 0 && r.status !== null && !exitCodeHonored) {
    return fail(
      opts.item,
      'HARNESS',
      `CLI 壳非 0 退出（status=${String(r.status)}）：${(r.stderr || r.stdout || '').slice(0, 200)}`,
      { extraMetrics: { c_contract_pass_rate: 0 } },
    );
  }

  let parsed: { ok?: boolean; result?: unknown; error?: { kind?: string; message?: string } };
  try {
    parsed = JSON.parse((r.stdout || '').trim()) as typeof parsed;
  } catch (e) {
    return fail(opts.item, 'HARNESS', `壳 stdout 非 JSON：${(e as Error).message}`, { extraMetrics: { c_contract_pass_rate: 0 } });
  }

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
      failures.push({
        oracle_id: 'result_equals',
        message: 'result 与期望不一致',
      });
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

  // 试题 oracles（exit_code 已前置判定）：workspace_assert / tool_result_equals / tool_side_effect / metric_threshold
  for (const [i, oracle] of opts.item.expect.oracles.entries()) {
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
      // 草稿 metrics 后再判
      continue;
    } else if (oracle.type === 'exit_code') {
      // 上面已独立判定 exit_code
      continue;
    } else {
      failures.push({
        oracle_id: oid,
        message: `C 轴暂不支持 oracle 类型 ${oracle.type}`,
      });
    }
  }

  const draftPass = failures.length === 0;
  const draftMetrics: Record<string, number> = {
    a_case_pass_rate: draftPass ? 1 : 0,
    a_invariant_violations: draftPass ? 0 : 1,
    c_contract_pass_rate: draftPass ? 1 : 0,
  };
  applyMetricThresholdPass(opts.item.expect.oracles, draftMetrics, focus ?? 'TOOL', (o) => {
    if (!o.pass) {
      failures.push({ oracle_id: o.oracle_id, message: o.message });
    }
  });

  const pass = failures.length === 0;
  const result: AxisItemResult = {
    item_id: opts.item.id,
    item_rev: opts.item.rev,
    pass,
    oracle_failures: failures,
    metrics: {
      a_case_pass_rate: pass ? 1 : 0,
      a_invariant_violations: pass ? 0 : 1,
      c_contract_pass_rate: pass ? 1 : 0,
    },
  };
  if (!pass) result.attribution = focus ?? 'TOOL';
  if (opts.artifactDir !== undefined) result.artifact_dir = opts.artifactDir;
  return result;
}



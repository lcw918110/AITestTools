import type { Attribution } from '../exam-engine/types.ts';
import type { CaseRevision } from '../domain/types.ts';
import { runStdoutAssertOracle } from '../oracles/stdout-assert.ts';
import { runToolSideEffectOracle } from '../oracles/tool-side-effect.ts';
import { runWorkspaceAssertOracle } from '../oracles/workspace-assert.ts';
import { resolveHostedAttribution } from '../attribution/hosted-tree.ts';

export interface HostedOracleVeto {
  message: string;
  attribution: Attribution;
}

export interface HostedOracleEvaluation {
  /** 无 workspace_assert，或全部通过 */
  workspace_ok: boolean;
  /** 是否实际执行过至少一条 workspace_assert */
  workspace_ran: boolean;
  workspace_failures: Array<{ oracle_id: string; message: string }>;
  /** 超时/被杀，exit_code 未作硬否决 */
  exit_code_inconclusive: boolean;
  /** 进程确以非期望码结束（不是超时） */
  exit_code_nonzero: boolean;
  exit_code_expected?: number;
  exit_code_actual?: number | null;
  /** 仍否决整题的失败；被降级的 exit_code 不在这里 */
  veto: HostedOracleVeto | undefined;
}

function hasWorkspaceOracle(revision: CaseRevision): boolean {
  return revision.expect.oracles.some((o) => o.type === 'workspace_assert');
}

/**
 * 执行题目声明的 oracles。
 *
 * hosted 效果路径主判定是 workspace_assert（及不依赖「进程完美退出」的断言）。
 * 暗号（hosted_pass_token）不在这里否决。
 * 超时 / 被杀时 exit_code 不单独否决；进程真以非 0 结束时，有 workspace_assert 则交给工作区判定。
 */
export function evaluateHostedOracles(opts: {
  revision: CaseRevision;
  workspace: string;
  exitCode: number;
  stdout: string;
  stderr?: string;
  focus: Attribution | undefined;
  hostStatus?: number | null;
  timedOut?: boolean;
}): HostedOracleEvaluation {
  const combined = `${opts.stdout}\n${opts.stderr ?? ''}`;
  const hostStatus = opts.hostStatus !== undefined ? opts.hostStatus : opts.exitCode;
  const timedOut = opts.timedOut === true;
  const inconclusive = timedOut || hostStatus === null;
  const workspaceOracles = hasWorkspaceOracle(opts.revision);

  const workspace_failures: Array<{ oracle_id: string; message: string }> = [];
  let workspace_ran = false;
  let exit_code_inconclusive = false;
  let exit_code_nonzero = false;
  let exit_code_expected: number | undefined;
  let otherVeto: HostedOracleVeto | undefined;
  let hardExitVeto: HostedOracleVeto | undefined;

  for (const [i, oracle] of opts.revision.expect.oracles.entries()) {
    const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
    if (oracle.type === 'exit_code') {
      const want = Number(oracle.equals ?? 0);
      exit_code_expected = want;
      if (inconclusive && workspaceOracles) {
        exit_code_inconclusive = true;
        continue;
      }
      if (hostStatus !== want) {
        if (typeof hostStatus === 'number') exit_code_nonzero = true;
        const msg = `oracle ${oid}：exit_code 期望 ${want} 实际 ${String(hostStatus)}`;
        if (workspaceOracles) {
          // 有工作区断言时，非 0 不单独否决；工作区失败才 FAIL
          continue;
        }
        hardExitVeto = {
          message: msg,
          attribution: resolveHostedAttribution('MODEL_TASK', opts.focus),
        };
      }
    } else if (oracle.type === 'stdout_assert') {
      const outcome = runStdoutAssertOracle({
        oracle_id: oid,
        oracle,
        stdout: combined,
        attribution: opts.focus ?? 'MODEL_TASK',
      });
      if (!outcome.pass) {
        otherVeto ??= {
          message: `oracle ${outcome.oracle_id}：${outcome.message}`,
          attribution: resolveHostedAttribution('MODEL_TASK', opts.focus),
        };
      }
    } else if (oracle.type === 'workspace_assert') {
      workspace_ran = true;
      const outcome = runWorkspaceAssertOracle({
        oracle_id: oid,
        oracle,
        workspace: opts.workspace,
        attribution: 'MODEL_TASK',
      });
      if (!outcome.pass) {
        workspace_failures.push({
          oracle_id: outcome.oracle_id,
          message: `oracle ${outcome.oracle_id}：${outcome.message}`,
        });
      }
    } else if (oracle.type === 'tool_side_effect') {
      const outcome = runToolSideEffectOracle({
        oracle_id: oid,
        oracle,
        workspace: opts.workspace,
        attribution: opts.focus ?? 'MODEL_TASK',
      });
      if (!outcome.pass) {
        otherVeto ??= {
          message: `oracle ${outcome.oracle_id}：${outcome.message}`,
          attribution: resolveHostedAttribution('MODEL_TASK', opts.focus),
        };
      }
    } else {
      return {
        workspace_ok: workspace_failures.length === 0,
        workspace_ran,
        workspace_failures,
        exit_code_inconclusive,
        exit_code_nonzero,
        ...(exit_code_expected !== undefined ? { exit_code_expected } : {}),
        exit_code_actual: hostStatus,
        veto: {
          message: `oracle ${oid}：hosted 暂不支持类型 ${oracle.type}，拒绝静默放过`,
          attribution: 'HARNESS',
        },
      };
    }
  }

  const workspace_ok = workspace_failures.length === 0;
  let veto: HostedOracleVeto | undefined;
  if (workspace_failures.length > 0) {
    const first = workspace_failures[0]!;
    veto = {
      message: first.message,
      // 工作区失败固定 MODEL_TASK，PROTOCOL focus 不得改写
      attribution: 'MODEL_TASK',
    };
  } else if (otherVeto !== undefined) {
    veto = otherVeto;
  } else if (hardExitVeto !== undefined) {
    veto = hardExitVeto;
  }

  return {
    workspace_ok,
    workspace_ran,
    workspace_failures,
    exit_code_inconclusive,
    exit_code_nonzero,
    ...(exit_code_expected !== undefined ? { exit_code_expected } : {}),
    exit_code_actual: hostStatus,
    veto,
  };
}

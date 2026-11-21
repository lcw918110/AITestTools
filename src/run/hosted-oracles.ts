import type { Attribution } from '../exam-engine/types.ts';
import type { CaseRevision } from '../domain/types.ts';
import type { OracleOutcome } from '../oracles/types.ts';
import { runEventSubsequenceOracle } from '../oracles/event-subsequence.ts';
import { runNoEventOracle } from '../oracles/no-event.ts';
import { runStdoutAssertOracle } from '../oracles/stdout-assert.ts';
import { runToolSideEffectOracle } from '../oracles/tool-side-effect.ts';
import { runWorkspaceAssertOracle } from '../oracles/workspace-assert.ts';
import { resolveHostedAttribution } from '../attribution/hosted-tree.ts';
import { isBlankText } from '../exam-engine/blank.ts';

/**
 * 构造 oracle 否决项。
 *
 * 关键：oracle 自己归因 HARNESS（非法正则、双口径冲突、缺断言等试题配错）时
 * 必须原样保留，不能被 resolveHostedAttribution 一律改写成 MODEL_TASK——
 * 否则「试题配错」会被计成「模型没做到」，污染评测结论。
 */
function oracleVeto(
  outcome: Extract<OracleOutcome, { pass: false }>,
  focus: Attribution | undefined,
): { message: string; attribution: Attribution } {
  return {
    message: `oracle ${outcome.oracle_id}：${outcome.message}`,
    attribution:
      outcome.attribution === 'HARNESS' ? 'HARNESS' : resolveHostedAttribution('MODEL_TASK', focus),
  };
}

export interface HostedOracleVeto {
  message: string;
  attribution: Attribution;
}

export interface HostedOracleEvaluation {
  /** 无 workspace_assert，或全部通过 */
  workspace_ok: boolean;
  /** 是否实际执行过至少一条 workspace_assert */
  workspace_ran: boolean;
  workspace_failures: Array<{ oracle_id: string; message: string; attribution: Attribution }>;
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
  /**
   * 万象术 EventStore 事件流（`hosted-runner` 从 refs/wanxiang/store 读出）。
   * 事件类断言依赖它；未提供时按 HARNESS 拒绝，不静默放过。
   */
  events?: readonly unknown[];
  /**
   * EventStore 是否真的读到了（`EventStoreRead.present`）。
   *
   * 关键：`readWanxiangEventStore` 在所有失败分支都返回 `events: []` 而非 `undefined`，
   * 只看 `events === undefined` 会让「插件没挂上 / 没写 EventStore」被当成「空事件流」——
   * 此时 `no_event` 假绿、`event_subsequence` 误判成模型没做对。
   * 传 `false` 时事件类断言一律归因 HARNESS。
   */
  eventsPresent?: boolean;
  /**
   * stderr 出现供应商流协议错误。事件流因此没写出时记 CONTEXT，不记 HARNESS。
   */
  providerStreamBroken?: boolean;
  /**
   * 播种材料是否被改过（`materialsMutated`）。
   *
   * 超时或供应商流被打断后，事件流可能只写了一部分：子序列没凑齐，
   * 或出现了不该出现的事件。材料没动时这是没跑完，记 CONTEXT；
   * 材料已改仍记模型失败，不能用超时洗掉「改了但没收尾」。
   * 缺省视为没改：漏传时不得把「被打断」记成 MODEL_TASK。
   */
  materialsMutated?: boolean;
  /**
   * 宿主进程的终止信号（`host_signal`，如 `SIGTRAP` / `SIGSEGV` / `SIGABRT`）。
   *
   * 非超时的信号终止是宿主自己死的（Bun panic、OOM、段错误），模型行为完全无法判定，
   * 必须归 HARNESS。旧实现只在题目声明了 `workspace_assert` 时才把「被杀」当成
   * inconclusive，于是 284 道仅 `exit_code` 单断言的题在宿主崩溃时被误记 MODEL_TASK。
   *
   * 判据只看「有信号 + 非超时」，不依赖 `hostStatus`：Node 的 close 事件里
   * code 与 signal 互斥，signal 非空即表示被信号终止。**漏传本参数会让崩溃判据
   * 静默失效**（退回 MODEL_TASK），生产调用方必须传。
   */
  hostSignal?: string | null;
  /**
   * 宿主进程启动失败的错误码（`ENOENT` / `EACCES` / `EAGAIN` / `EMFILE`）。
   *
   * spawn 失败时 `status=null`、`signal=null`，与「崩溃」和「超时」都不同：
   * 宿主根本没起来（沙箱包裹后的可执行文件不存在、并发跑卷句柄耗尽等），
   * 模型连一次推理都没发生，必须归 HARNESS。
   */
  hostSpawnError?: string | null;
}): HostedOracleEvaluation {
  const combined = `${opts.stdout}\n${opts.stderr ?? ''}`;
  const hostStatus = opts.hostStatus !== undefined ? opts.hostStatus : opts.exitCode;
  const timedOut = opts.timedOut === true;
  const inconclusive = timedOut || hostStatus === null;
  const workspaceOracles = hasWorkspaceOracle(opts.revision);
  // 非超时的信号终止 = 宿主自己崩溃（Bun panic / OOM / 段错误），模型行为完全无法判定。
  // 与超时区分：超时是本平台主动 SIGTERM/SIGKILL，语义是「模型没跑完」。
  //
  // 判据只看「有信号 + 非超时」，不依赖 `hostStatus`：Node 的 close 事件里
  // code 与 signal 互斥，signal 非空即表示进程被信号终止。若把 `hostStatus === null`
  // 当前置条件，调用方漏传该可选参数时会退化成 `exitCode`（数字），修复静默失效
  // （Local Bugbot Medium）。
  const hostCrashed = !timedOut && (opts.hostSignal ?? null) !== null;
  /**
   * 宿主根本没起来（spawn 失败）：`status=null`、`signal=null`、非超时。
   *
   * 与崩溃同属工装故障，但判据不同——没有 signal 可看，只能靠 spawn 错误码。
   * 漏掉这条会让「沙箱包裹后的可执行文件不存在」「并发跑卷句柄耗尽」等
   * 系统性工装故障被记成模型失败（284 道仅 exit_code 的题全部受影响）。
   */
  const hostSpawnFailed = !timedOut && (opts.hostSpawnError ?? null) !== null;

  const workspace_failures: Array<{
    oracle_id: string;
    message: string;
    attribution: Attribution;
  }> = [];
  let workspace_ran = false;
  let exit_code_inconclusive = false;
  let exit_code_nonzero = false;
  let exit_code_expected: number | undefined;
  let otherVeto: HostedOracleVeto | undefined;
  let hardExitVeto: HostedOracleVeto | undefined;
  /**
   * 试题/接线配错（事件流缺失、names 无效等），优先级最高，不得被模型归因覆盖。
   * 只放 HARNESS：与 CONTEXT 混用会让最终归因取决于 oracle 书写顺序。
   */
  let harnessVeto: HostedOracleVeto | undefined;
  /** 超时或供应商流被打断导致的事实不可判定，低于 HARNESS 但高于模型归因。 */
  let contextVeto: HostedOracleVeto | undefined;
  /**
   * 宿主崩溃：模型行为完全无法判定，**绝不产出 PASS**。
   *
   * 不能因为「题目声明了 workspace_assert 且它天然通过」就放过——
   * 例如 `exists: false` 在宿主什么都没做时必然成立，崩溃 + 该断言会直接假绿。
   */
  let crashVeto: HostedOracleVeto | undefined;

  // 崩溃 / 宿主没起来：都在循环外先行判定，无论题目声明了哪些 oracle
  // （包括天然通过的 workspace_assert）都必须否决整题。
  // 放进循环里会让「有 workspace_assert 且它通过」的题直接 PASS。
  if (hostCrashed) {
    crashVeto = {
      message: `宿主被信号 ${String(opts.hostSignal)} 终止（非超时崩溃），模型行为无法判定`,
      attribution: 'HARNESS',
    };
    exit_code_inconclusive = true;
  } else if (hostSpawnFailed) {
    crashVeto = {
      message: `宿主启动失败（${String(opts.hostSpawnError)}），模型未执行`,
      attribution: 'HARNESS',
    };
    exit_code_inconclusive = true;
  }

  for (const [i, oracle] of opts.revision.expect.oracles.entries()) {
    const oid = typeof oracle.id === 'string' ? oracle.id : `${oracle.type}#${i}`;
    if (oracle.type === 'exit_code') {
      const want = Number(oracle.equals ?? 0);
      exit_code_expected = want;
      if (inconclusive && workspaceOracles) {
        exit_code_inconclusive = true;
        continue;
      }
      if (hostCrashed) {
        // 已在循环外统一置 crashVeto，这里只需跳过 exit_code 判定。
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
        otherVeto ??= oracleVeto(outcome, opts.focus);
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
          // 工作区断言也可能是试题配错（内容断言为空白、路径指向目录、权限不足）：
          // 必须把 oracle 自己的 HARNESS 带上去，否则下面固定成 MODEL_TASK 会把
          // 试题/环境问题记成模型缺陷。
          attribution: outcome.attribution ?? 'MODEL_TASK',
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
        otherVeto ??= oracleVeto(outcome, opts.focus);
      }
    } else if (oracle.type === 'event_subsequence' || oracle.type === 'no_event') {
      const rawNames = Array.isArray(oracle.names) ? oracle.names : [];
      // `String(null)` 会变成 'null' 绕过空名检查，先按原值过滤非字符串。
      const names = rawNames.filter((n): n is string => typeof n === 'string');
      const hasInvalidName = names.length !== rawNames.length;
      // 事件类断言依赖真实事件流：缺失、未读到、空 names 或含空串都属接线/试题配错，
      // 归因 HARNESS 并继续评估后续 oracle（早 return 会让 workspace_assert 被整段跳过）。
      const hasBlankName = names.some((n) => isBlankText(n));
      // 必须显式证明事件流存在（`eventsPresent === true`）才继续：
      // 调用方若传了 `events: []` 却漏传 `eventsPresent`，旧写法会当成「流已读到」，
      // 于是 `no_event` 在空流上直接通过（假绿）、`event_subsequence` 记成 MODEL_TASK。
      // 缺省必须是「未证明」，不是「已证明」。
      const streamMissing = opts.events === undefined || opts.eventsPresent !== true;
      if (streamMissing) {
        // 超时被杀时 EventStore 常因未收敛而读不到。此时「没读到事件」是模型没跑完的
        // 后果，不是工装故障——归 HARNESS 会把超时污染成假红，还会短路掉
        // `resolveWorkspaceFailAttribution` 的 CONTEXT 归因。故超时场景记 CONTEXT。
        //
        // 必须与 HARNESS 分开存：混用同一个 `??=` 会让最终归因取决于 oracle 书写顺序
        // （`[event_subsequence, tool_trace]` 得 CONTEXT，反过来得 HARNESS）。
        if (timedOut) {
          contextVeto ??= {
            message: `oracle ${oid}：运行超时，事件流未收敛，无法判定事件类断言`,
            attribution: 'CONTEXT',
          };
        } else if (opts.providerStreamBroken === true) {
          contextVeto ??= {
            message: `oracle ${oid}：供应商流被打断，事件流未收敛，无法判定事件类断言`,
            attribution: 'CONTEXT',
          };
        } else {
          harnessVeto ??= {
            message: `oracle ${oid}：事件类断言需要 EventStore 事件流，当前未读到，拒绝静默放过`,
            attribution: 'HARNESS',
          };
        }
      } else if (names.length === 0 || hasBlankName || hasInvalidName) {
        harnessVeto ??= {
          message: `oracle ${oid}：事件类断言未声明有效事件名，拒绝静默放过`,
          attribution: 'HARNESS',
        };
      } else {
        const events = opts.events as Record<string, unknown>[];
        const attribution = opts.focus;
        const outcome =
          oracle.type === 'event_subsequence'
            ? runEventSubsequenceOracle({
                oracle_id: oid,
                events,
                names,
                ...(attribution !== undefined ? { attribution } : {}),
              })
            : runNoEventOracle({
                oracle_id: oid,
                events,
                names,
                ...(attribution !== undefined ? { attribution } : {}),
              });
        if (!outcome.pass) {
          // 超时后事件流可能只写了一部分：子序列没凑齐、或出现了不该出现的事件，
          // 都是没跑完的后果。材料没动时记 MODEL_TASK 会把「被打断」说成「模型做错」。
          // 材料已改仍归模型：改了又没按事件约束收尾，不能用超时洗掉。
          // 超时后事件流可能只写了一部分：子序列没凑齐、或出现了不该出现的事件，
          // 都是没跑完的后果。材料没动时记 MODEL_TASK 会把「被打断」说成「模型做错」。
          // 材料已改仍归模型：改了又没按事件约束收尾，不能用超时洗掉。
          if (timedOut && opts.materialsMutated !== true) {
            contextVeto ??= {
              message: `oracle ${oid}：运行超时，事件类断言未满足，材料未改，无法判定模型任务`,
              attribution: 'CONTEXT',
            };
          } else if (opts.providerStreamBroken === true && opts.materialsMutated !== true) {
            contextVeto ??= {
              message: `oracle ${oid}：供应商流被打断，事件类断言未满足，材料未改，无法判定模型任务`,
              attribution: 'CONTEXT',
            };
          } else {
            otherVeto ??= oracleVeto(outcome, opts.focus);
          }
        }
      }
    } else {
      // 不支持的类型同样归 HARNESS 并继续评估后续 oracle：
      // 早 return 会让排在后面的 workspace_assert 被整段跳过，
      // 同一断言集合因书写顺序不同产出不同 workspace_ran/workspace_ok。
      harnessVeto ??= {
        message: `oracle ${oid}：hosted 暂不支持类型 ${oracle.type}，拒绝静默放过`,
        attribution: 'HARNESS',
      };
    }
  }

  const workspace_ok = workspace_failures.length === 0;
  let veto: HostedOracleVeto | undefined;
  if (crashVeto !== undefined) {
    // 崩溃最优先：模型行为完全无法判定，任何「天然通过」的断言都不能把整题变 PASS。
    veto = crashVeto;
  } else if (harnessVeto !== undefined) {
    // 试题/接线配错优先于一切：不能把「没接线」记成「模型没做对」。
    veto = harnessVeto;
  } else if (contextVeto !== undefined) {
    // 超时导致的事实不可判定：高于模型归因，避免把「没跑完」记成「模型没做到」。
    veto = contextVeto;
  } else if (workspace_failures.length > 0) {
    // 只要有一条断言归 HARNESS（试题配错/环境读失败）就整组按 HARNESS 否决，
    // 不依赖书写顺序——否则顺序一变，「断言配错」就被洗成「模型没做到」。
    // 没有 HARNESS 时沿用原口径固定 MODEL_TASK，PROTOCOL focus 不得改写。
    const primary = workspace_failures.find((f) => f.attribution === 'HARNESS');
    veto = {
      message: (primary ?? workspace_failures[0]!).message,
      attribution: primary !== undefined ? 'HARNESS' : 'MODEL_TASK',
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

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AxisItemResult } from './runner-types.ts';
import type { Attribution } from '../domain/types.ts';
import type {
  AdapterContext,
  CleanupResult,
  CollectedOutput,
  DiscoveredInput,
  ExecutionAdapter,
  PreflightResult,
  PreparedState,
  SubmittedHandle,
} from './execution-adapter.ts';
import { AdapterError } from './execution-adapter.ts';
import {
  HerdchestraLaunchError,
  createSession,
  diffWorkspace,
  launchInstance,
  readAssistantBaseline,
  snapshotWorkspace,
  submitCommand,
  waitForAssistantReply,
  type ControlCommandPayload,
  type HerdchestraInstance,
  type HerdchestraModelConfig,
  type WorkspaceDiff,
  type WorkspaceSnapshot,
} from './herdchestra-instance.ts';
import { LoopbackError, ednKeyword, type LoopbackReply } from './loopback-transport.ts';
import { runWorkspaceAssertOracle } from '../oracles/workspace-assert.ts';

/** 等助手回复的上限（毫秒）。默认 300 秒。 */
const DEFAULT_COLLECT_TIMEOUT_MS = 300_000;

/**
 * 从环境变量读模型连接。
 *
 * 密钥只走环境变量，**不落代码、不落仓库**。三个都给了才启用；缺任一项返回
 * null 并保持「没有模型」的行为（投递可成功但不会有回复），由 collect 如实
 * 报告超时。
 */
export function resolveModelFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): HerdchestraModelConfig | null {
  const baseUrl = env['HC_EVAL_MODEL_BASE_URL']?.trim();
  const apiKey = env['HC_EVAL_MODEL_API_KEY']?.trim();
  const model = env['HC_EVAL_MODEL_NAME']?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

/**
 * 服务类 SUT 的 adapter（12 §6 D2/D4）。
 *
 * `preflight` / `prepare` / `submit` / `collect` 已实现：起实例、建会话、
 * 投递一条指令、等助手回复、按工作区文件变化取证。`evaluate` 尚未实现，
 * 调用时显式报「未实现」，**不返回假绿结果**。
 *
 * 隔离策略是「每 case 一个实例」（12 §6 D4 决策修正）：`prepare` 起实例，
 * `cleanup` 关实例并删临时目录，case 之间不共享任何状态。
 */

/** `prepare` 产出的准备态，`cleanup` 据此释放资源。 */
interface HerdchestraPrepared extends PreparedState {
  instance: HerdchestraInstance;
  sessionId: string | null;
  /** 建会话失败时的错误摘要（含错误码），供 `submit` 如实上报。 */
  sessionError: string | null;
  /** 投递前的任务描述，`collect` 据此组装判定依据。 */
  taskPrompt: string;
  /** 投递前的工作区快照，`collect` 用它算变化。 */
  baseline: WorkspaceSnapshot;
  /** 投递前已存在的助手消息 id，`collect` 用它排除旧回复。 */
  baselineAssistantIds: ReadonlySet<string>;
  /** 基线是否可靠；false 表示读会话失败，无法区分新旧回复。 */
  baselineReliable: boolean;
  /** 基线不可靠时的原因。 */
  baselineError?: string;
}

/** `submit` 产出的执行句柄。 */
interface HerdchestraSubmitted extends SubmittedHandle {
  sessionId: string;
  commandAccepted: boolean;
  commandError?: string;
  submittedAt: string;
  /** 实例引用：`collect` 据此等回复、读工作区；`cleanup` 据此停止实例。 */
  instance: HerdchestraInstance;
  /** 投递前的工作区快照。 */
  baseline: WorkspaceSnapshot;
  /** 投递前已存在的助手消息 id。 */
  baselineAssistantIds: ReadonlySet<string>;
  /** 基线是否可靠；不可靠时 `collect` 不能宣称 replied。 */
  baselineReliable: boolean;
  baselineError?: string;
  /** 工作区绝对路径。 */
  workspaceDir: string;
}

/** `collect` 产出的采集结果。 */
interface HerdchestraCollected extends CollectedOutput {
  /** 命令是否被接受（false 表示配错，不是模型没做到）。 */
  commandAccepted: boolean;
  commandError?: string;
  /** 本轮是否观察到助手回复。 */
  replied: boolean;
  /** 是否因超时结束。 */
  timedOut: boolean;
  /** 已等待时长；命令未被接受时不等待，故为 0 且不可当测量值用。 */
  elapsedMs: number;
  /** 整个等待期一次都没读到会话（控制通道可能失效）。 */
  readFailed?: boolean;
  /** 投递前助手消息基线是否可靠；false 时不能宣称 replied。 */
  baselineReliable?: boolean;
  baselineError?: string;
  /** 助手回复文本（拼接）。 */
  assistantText: string;
  /** 工作区变化。 */
  workspace: WorkspaceDiff;
  /** 变化后的文件内容快照（只保留变化的文件）。 */
  changedFiles: Record<string, string>;
  /** 工作区根目录（供后续读文件）。 */
  workspaceRoot: string;
}

/** adapter 配置。从 `environment.recipe` 与 `sutRoot` 解析而来。 */
export interface HerdchestraAdapterOptions {
  /** 被测仓根目录。 */
  repoRoot?: string;
  /** 启动命令覆盖（测试用）。 */
  command?: string;
  /** 等待就绪超时（毫秒）。 */
  readyTimeoutMs?: number;
  /** 会话标题。 */
  sessionTitle?: string;
  /** 等助手回复的上限（毫秒）。 */
  collectTimeoutMs?: number;
  /** 模型连接；不给则读环境变量，仍没有则不起模型。 */
  model?: HerdchestraModelConfig;
}

/**
 * 从任务描述里取要投递的命令载荷。
 *
 * Herdchestra 的 `:command` 需要 EDN 命令 map，`:kind` 必须是**关键词**——
 * 传字符串会被拒绝为 `COMMAND_KIND_REQUIRED`（实测确认）。载荷字段取自
 * 其自身客户端的调用形状：`{:kind :send-message, :session-id …, :text …}`。
 */
export function buildCommandPayload(taskPrompt: string, sessionId: string): ControlCommandPayload {
  return {
    kind: ednKeyword('send-message'),
    'session-id': sessionId,
    text: taskPrompt,
  };
}

/** 从上下文取任务描述。 */
function resolveTaskPrompt(ctx: AdapterContext): string {
  const stimulus = ctx.revision.stimulus;
  const ref = typeof stimulus.ref === 'string' ? stimulus.ref : '';
  if (ref.length > 0) return ref;
  return ctx.revision.case_revision_id;
}

/** 解析 adapter 配置：`sutRoot` 指向被测仓。 */
export function resolveAdapterOptions(
  ctx: AdapterContext,
): HerdchestraAdapterOptions & { repoRoot: string } {
  const repoRoot = ctx.sutRoot;
  if (repoRoot === undefined || repoRoot.length === 0) {
    throw new AdapterError(
      'preflight_failed',
      'HARNESS',
      '服务类 SUT 需要 ctx.sutRoot 指向被测仓根目录',
    );
  }
  return { repoRoot };
}

export class HerdchestraAdapter implements ExecutionAdapter {
  readonly adapterId = 'herdchestra';

  constructor(private readonly options: Partial<HerdchestraAdapterOptions> = {}) {}

  async discover(ctx: AdapterContext): Promise<DiscoveredInput> {
    const options = { ...resolveAdapterOptions(ctx), ...this.options };
    return {
      repoRoot: options.repoRoot,
      taskPrompt: resolveTaskPrompt(ctx),
      sessionTitle: options.sessionTitle ?? ctx.revision.case_revision_id,
    };
  }

  async preflight(_ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreflightResult> {
    const repoRoot = String(discovered.repoRoot ?? '');
    const taskPrompt = String(discovered.taskPrompt ?? '');
    if (repoRoot.length === 0) {
      return { ok: false, reason: '缺少被测仓根目录（sutRoot）' };
    }
    if (taskPrompt.length === 0) {
      return { ok: false, reason: '缺少任务描述（stimulus.ref）' };
    }
    // 只校验必要输入，不探测实例——探测放在 prepare，因为那时才该占用单例锁
    return { ok: true };
  }

  async prepare(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreparedState> {
    const options = { ...resolveAdapterOptions(ctx), ...this.options };
    // 模型优先取 adapter 显式配置，其次环境变量；都没有就按「无模型」起实例。
    const model = this.options.model ?? resolveModelFromEnv();
    const rootDir = mkdtempSync(join(tmpdir(), 'aitest-hc-'));

    let instance: HerdchestraInstance;
    try {
      instance = await launchInstance({
        repoRoot: String(discovered.repoRoot),
        rootDir,
        ...(options.command !== undefined ? { command: options.command } : {}),
        ...(options.readyTimeoutMs !== undefined
          ? { readyTimeoutMs: options.readyTimeoutMs }
          : {}),
        ...(model !== null ? { model } : {}),
      });
    } catch (error) {
      // launchInstance 内部已 await stop() 删除目录；这里只兜住「spawn 前
      // 就抛错」的路径（那时目录还没建）。用 force 保证不因不存在而报错。
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        /* 删除失败不覆盖真正的失败原因 */
      }
      const launchError = error instanceof HerdchestraLaunchError ? error : null;
      const detail = launchError?.detail ?? '';
      const codePart = launchError !== null ? `[${launchError.code}] ` : '';
      throw new AdapterError(
        'prepare_failed',
        'HARNESS',
        `${codePart}${(error as Error).message}${detail.length > 0 ? `\n--- 实例输出 ---\n${detail}` : ''}`,
      );
    }

    ctx.facts.resolve('sut', 'endpoint', {
      port: instance.endpoint.port,
      pid: instance.endpoint.pid ?? null,
    });
    ctx.facts.observe('sut', 'instance_root', instance.rootDir);

    let sessionId: string | null = null;
    let sessionError: string | null = null;
    try {
      sessionId = await createSession(
        instance.endpoint,
        String(discovered.sessionTitle ?? ''),
      );
      ctx.facts.observe('sut', 'session_id', sessionId);
    } catch (error) {
      // 会话建不出来不在这里抛：实例已占用，必须走到 cleanup 才能释放。
      // 但错误码要留住，交给 submit 原样上报，否则诊断信息全丢。
      const loopback = error instanceof LoopbackError ? error : null;
      sessionError = loopback !== null ? `${loopback.code}: ${loopback.message}` : (error as Error).message;
      ctx.facts.observe('sut', 'session_error', sessionError);
    }

    // 取基线（工作区快照 + 已存在的助手消息 id）放在建会话之后、投递之前：
    // 只认「这次投递引起的」变化，实例自身初始化写的文件与新会话之前的旧
    // 回复都不算本轮产出。
    let baseline: WorkspaceSnapshot;
    let assistantBaseline: { ids: Set<string>; reliable: boolean; error?: string };
    try {
      baseline = snapshotWorkspace(instance.workspaceDir);
      // 没有会话就没有可读的 history；空基线 + reliable=false 如实记录，
      // submit 会因 sessionId 为空而报错，不会走到 collect。
      assistantBaseline =
        sessionId === null
          ? { ids: new Set<string>(), reliable: false, error: '会话未创建' }
          : await readAssistantBaseline(instance.endpoint, sessionId);
    } catch (error) {
      // 这里抛出去会跳过 cleanup（prepared 还没返回），子进程与临时目录全泄漏，
      // 且实例仍持单例锁让后续 case 全部撞 INSTANCE_OCCUPIED。必须自己收尾。
      try {
        await instance.stop();
      } catch {
        /* 清理失败不覆盖真正的失败原因 */
      }
      throw new AdapterError(
        'prepare_failed',
        'HARNESS',
        `采集基线失败：${(error as Error).message}`,
      );
    }
    ctx.facts.observe('sut', 'assistant_baseline', {
      size: assistantBaseline.ids.size,
      reliable: assistantBaseline.reliable,
      error: assistantBaseline.error ?? null,
    });

    const prepared: HerdchestraPrepared = {
      instance,
      sessionId,
      sessionError,
      taskPrompt: resolveTaskPrompt(ctx),
      baseline,
      baselineAssistantIds: assistantBaseline.ids,
      // 基线读不出来时，无法区分「本轮新回复」与「上一轮旧回复」，
      // 该状态必须一路传到 evaluate，否则旧回复会被当成本轮回复，造成假绿。
      baselineReliable: assistantBaseline.reliable,
      ...(assistantBaseline.error !== undefined
        ? { baselineError: assistantBaseline.error }
        : {}),
    };
    return prepared;
  }

  async submit(ctx: AdapterContext, prepared: PreparedState): Promise<SubmittedHandle> {
    const state = prepared as HerdchestraPrepared;
    if (state.sessionId === null) {
      throw new AdapterError(
        'submit_failed',
        'HARNESS',
        `会话未能创建，无法投递命令${state.sessionError !== null ? `：${state.sessionError}` : ''}`,
      );
    }

    const payload = buildCommandPayload(state.taskPrompt, state.sessionId);

    let result: LoopbackReply;
    try {
      result = await submitCommand(state.instance.endpoint, state.sessionId, payload);
    } catch (error) {
      // 控制通道异常统一包成 AdapterError，与其余 adapter 的阶段化错误契约一致，
      // 保留错误码供归因与重试策略使用。
      const loopback = error instanceof LoopbackError ? error : null;
      throw new AdapterError(
        'submit_failed',
        'HARNESS',
        `投递命令失败：${loopback !== null ? `${loopback.code}: ${loopback.message}` : (error as Error).message}`,
        loopback?.code === 'UNREACHABLE' || loopback?.code === 'TIMEOUT',
      );
    }
    ctx.facts.observe('sut', 'command_submitted', {
      ok: result.ok,
      code: result.code ?? null,
    });

    const handle: HerdchestraSubmitted = {
      sessionId: state.sessionId,
      commandAccepted: result.ok,
      ...(result.message !== undefined ? { commandError: result.message } : {}),
      submittedAt: new Date().toISOString(),
      instance: state.instance,
      baseline: state.baseline,
      baselineAssistantIds: state.baselineAssistantIds,
      baselineReliable: state.baselineReliable,
      ...(state.baselineError !== undefined ? { baselineError: state.baselineError } : {}),
      workspaceDir: state.instance.workspaceDir,
    };
    return handle;
  }

  async collect(ctx: AdapterContext, handle: SubmittedHandle): Promise<CollectedOutput> {
    const submitted = handle as HerdchestraSubmitted;
    const options = { ...resolveAdapterOptions(ctx), ...this.options };

    if (typeof submitted.sessionId !== 'string') {
      throw new AdapterError(
        'collect_failed',
        'HARNESS',
        '采集句柄缺少会话 id，无法读取本轮结果',
      );
    }

    // 命令未被接受时**不抛错**：这是配错（如模型未声明 tools），要让 evaluate
    // 拿到事实并归因 HARNESS，而不是让整个 case 以 execution_failed 结束。
    if (!submitted.commandAccepted) {
      const skipped: HerdchestraCollected = {
        commandAccepted: false,
        ...(submitted.commandError !== undefined ? { commandError: submitted.commandError } : {}),
        replied: false,
        timedOut: false,
        elapsedMs: 0,
        assistantText: '',
        workspace: { added: [], modified: [], removed: [] },
        changedFiles: {},
        workspaceRoot: submitted.workspaceDir,
      };
      ctx.facts.observe('sut', 'collect_skipped', {
        reason: 'command_not_accepted',
        error: submitted.commandError ?? null,
      });
      return skipped;
    }

    // 等助手回复出现再读工作区：模型可能分多步写文件，提前快照会漏掉后半段。
    const outcome = await waitForAssistantReply(
      submitted.instance.endpoint,
      submitted.sessionId,
      {
        timeoutMs: options.collectTimeoutMs ?? DEFAULT_COLLECT_TIMEOUT_MS,
        baselineMessageIds: submitted.baselineAssistantIds,
      },
    );

    const after = snapshotWorkspace(submitted.workspaceDir);
    const workspace = diffWorkspace(submitted.baseline, after);

    // 只保留变化过的文件内容：判定要用，全量快照可能很大。
    const changedFiles: Record<string, string> = {};
    for (const path of [...workspace.added, ...workspace.modified]) {
      const content = after.get(path);
      if (content !== undefined) changedFiles[path] = content;
    }

    ctx.facts.observe('sut', 'turn_settled', {
      replied: outcome.replied,
      timed_out: outcome.timedOut,
      elapsed_ms: outcome.elapsedMs,
      assistant_messages: outcome.assistantMessages.length,
    });
    ctx.facts.observe('sut', 'workspace_changes', {
      added: workspace.added.length,
      modified: workspace.modified.length,
      removed: workspace.removed.length,
    });

    const collected: HerdchestraCollected = {
      commandAccepted: true,
      replied: outcome.replied,
      timedOut: outcome.timedOut,
      elapsedMs: outcome.elapsedMs,
      assistantText: outcome.assistantMessages.map((m) => m.content).join('\n'),
      workspace,
      changedFiles,
      workspaceRoot: submitted.workspaceDir,
      baselineReliable: submitted.baselineReliable,
      ...(submitted.baselineError !== undefined ? { baselineError: submitted.baselineError } : {}),
      ...(outcome.readFailed === true ? { readFailed: true } : {}),
    };
    return collected;
  }

  async evaluate(ctx: AdapterContext, collected: CollectedOutput): Promise<AxisItemResult[]> {
    const state = collected as Partial<HerdchestraCollected>;
    const revision = ctx.revision;
    const oracles = revision.expect?.oracles ?? [];

    const failWith = (
      attribution: Attribution,
      message: string,
      extraFailures: Array<{ oracle_id: string; message: string }> = [],
    ): AxisItemResult[] => {
      const result: AxisItemResult = {
        item_id: revision.case_revision_id,
        item_rev: revision.revision_number,
        pass: false,
        attribution,
        // 首条固定为 'harness'，用于承载整体原因；其后是各 oracle 的具体失败项
        oracle_failures: [{ oracle_id: 'harness', message }, ...extraFailures],
        metrics: {
          a_case_pass_rate: 0,
          a_invariant_violations: 0,
        },
      };
      if (ctx.artifactDir !== undefined) result.artifact_dir = ctx.artifactDir;
      return [result];
    };

    // 命令没被接受：这是试题/环境配错（如模型未声明 tools），不是模型能力问题
    if (state.commandAccepted === false) {
      return failWith(
        'HARNESS',
        `命令未被接受：${state.commandError ?? '未给出原因'}`,
      );
    }

    // 没回复：先分清是「通道/环境坏了」还是「模型没产出」
    if (state.replied !== true) {
      if (state.timedOut === true) {
        const waited =
          typeof state.elapsedMs === 'number' && state.elapsedMs > 0
            ? `${Math.round(state.elapsedMs / 1000)} 秒`
            : '（耗时可测值缺失）';
        if (state.readFailed === true) {
          // 整个等待期一次都没读到会话：多半是控制通道故障，不是模型不干活
          return failWith('HARNESS', `等待 ${waited} 后仍无法读取会话，控制通道可能已失效`);
        }
        if (state.baselineReliable === false) {
          // 基线读不出来，旧回复会被当成本轮回复，这样的结论不可信
          return failWith(
            'HARNESS',
            `助手消息基线不可靠，无法区分新旧回复${state.baselineError !== undefined ? `（${state.baselineError}）` : ''}`,
          );
        }
        return failWith('CONTEXT', `模型未产生回复（等待 ${waited} 后超时）`);
      }
      return failWith('CONTEXT', '模型未产生回复（未观察到助手消息）');
    }

    // 基线不可靠时，「读到回复」也可能是上一轮的旧消息被当成本轮——这种通过
    // 没有可信依据，必须报出来，不能因为断言恰好命中就判绿。
    if (state.baselineReliable === false) {
      return failWith(
        'HARNESS',
        `助手消息基线不可靠，无法确认本轮确实产生了回复${state.baselineError !== undefined ? `（${state.baselineError}）` : ''}`,
      );
    }

    // 工作区路径缺失时 resolve 会落到进程当前目录，读到的会是评测程序自己的文件
    const workspaceRoot = typeof state.workspaceRoot === 'string' ? state.workspaceRoot : '';
    if (workspaceRoot.length === 0) {
      return failWith('HARNESS', '采集结果缺少工作区路径，无法判定工作区断言');
    }
    const workspaceOracles = oracles.filter((o) => o.type === 'workspace_assert');
    const otherOracles = oracles.filter((o) => o.type !== 'workspace_assert');

    const failures: Array<{ oracle_id: string; message: string }> = [];
    let harnessBroken = false;

    for (const [index, oracle] of workspaceOracles.entries()) {
      const oracleId =
        typeof oracle.id === 'string' && oracle.id.length > 0
          ? oracle.id
          : `workspace_assert#${index}`;
      const outcome = runWorkspaceAssertOracle({
        oracle_id: oracleId,
        oracle,
        workspace: workspaceRoot,
      });
      if (!outcome.pass) {
        failures.push({ oracle_id: outcome.oracle_id, message: outcome.message });
        // oracle 自己归因 HARNESS 表示断言配错，不能计成模型没做到
        if (outcome.attribution === 'HARNESS') harnessBroken = true;
      }
    }

    // service 形态没有进程退出码、stdout、事件流，遇到非 workspace 断言就如实
    // 报「该形态不支持」，不静默跳过——否则配错的 oracle 会让题目假绿。
    for (const [index, oracle] of otherOracles.entries()) {
      const oracleId =
        typeof oracle.id === 'string' && oracle.id.length > 0 ? oracle.id : `${oracle.type}#${index}`;
      failures.push({
        oracle_id: oracleId,
        message: `service 形态不支持 ${oracle.type} 断言（只有 workspace_assert 可用）`,
      });
      harnessBroken = true;
    }

    if (failures.length > 0) {
      const attribution: Attribution = harnessBroken ? 'HARNESS' : 'TOOL';
      return failWith(attribution, `工作区断言未通过（${failures.length} 项）`, failures);
    }

    const result: AxisItemResult = {
      item_id: revision.case_revision_id,
      item_rev: revision.revision_number,
      pass: true,
      oracle_failures: [],
      metrics: {
        a_case_pass_rate: 1,
        a_invariant_violations: 0,
        workspace_oracles: workspaceOracles.length,
        workspace_elapsed_ms: state.elapsedMs ?? 0,
      },
      ...(ctx.artifactDir !== undefined ? { artifact_dir: ctx.artifactDir } : {}),
    };
    return [result];
  }

  async cleanup(_ctx: AdapterContext, prepared: PreparedState): Promise<CleanupResult> {
    const state = prepared as Partial<HerdchestraPrepared>;
    if (state.instance === undefined) {
      return { ok: true };
    }
    try {
      await state.instance.stop();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }
}

/** 导出供测试替换：判断一个 reply 是否表示命令被接受。 */
export function isCommandAccepted(handle: SubmittedHandle): boolean {
  return (handle as Partial<HerdchestraSubmitted>).commandAccepted === true;
}

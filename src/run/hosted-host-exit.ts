/**
 * 宿主退出码 / 超时只作辅助对照，效果路径上不单独否决整题。
 *
 * `timed_out` 必须由平台显式标记（`deadlineFired`），不得从 signal 反推：
 * 外部 OOM killer / 用户 kill 同样会给出 `status=null` + `SIGKILL`，
 * 从 signal 反推会把「宿主自己死」误判成「本平台超时」，进而让崩溃归因失效。
 */
export const HOST_EXIT_ROLE = 'auxiliary' as const;
export type HostExitRole = typeof HOST_EXIT_ROLE;

export interface HostedHostExitObservation {
  timed_out: boolean;
  host_exit: number | null;
  host_signal: string | null;
  host_exit_role: HostExitRole;
  /** spawn 失败的错误码（`ENOENT` / `EACCES` 等）；正常退出与被信号杀死时为 null。 */
  host_spawn_error: string | null;
  /** 宿主已退出但 stdio 被孙进程占住，平台在宽限期后强制 destroy 了读端。 */
  stdio_destroyed: boolean;
}

/** Node spawnSync 超时：status=null、signal=SIGTERM、error.code=ETIMEDOUT。 */
export function observeHostExit(run: {
  status: number | null;
  signal?: NodeJS.Signals | string | null;
  error?: NodeJS.ErrnoException | Error | null;
  /**
   * 本平台 deadline 是否真的触发过（`runHostedWithReap` 的 `timedOut` 标志）。
   *
   * 唯一可信的超时来源。缺省时退回 `ETIMEDOUT` 错误码判断（spawnSync 语义），
   * 但**不再**从 `SIGTERM` / `SIGKILL` 反推——那会把 OOM killer 记成超时。
   */
  deadlineFired?: boolean;
  /** 平台是否因 stdio 被孙进程占住而强制 destroy 了读端。 */
  stdioDestroyed?: boolean;
  /** 结果管道在宿主结束前断开（宿主被连带杀死）：本次观测不代表被测任务。 */
  pipeBroken?: boolean;
}): HostedHostExitObservation {
  const err = run.error as NodeJS.ErrnoException | null | undefined;
  const signal = run.signal ?? null;
  const timed_out = run.deadlineFired === true || err?.code === 'ETIMEDOUT';
  // spawn 失败（ENOENT/EACCES/EAGAIN/EMFILE）：status=null、signal=null、非超时。
  // 与「被信号杀死」区分开，但同属宿主没跑起来的工装故障。
  // 只在「既无退出码也无信号」时才认 spawn 错误码，避免把正常退出误判。
  const spawnErrorCode =
    !timed_out && run.status === null && signal === null && err !== null && err !== undefined
      ? (err.code ?? 'UNKNOWN')
      : null;
  return {
    timed_out,
    host_exit: run.status,
    host_signal: signal,
    host_exit_role: HOST_EXIT_ROLE,
    host_spawn_error: spawnErrorCode,
    stdio_destroyed: run.stdioDestroyed === true,
  };
}

/**
 * 宿主是否没跑起来（非超时崩溃或 spawn 失败）。
 *
 * 与超时区分：超时是本平台主动 SIGTERM/SIGKILL（`timed_out=true`），语义是「模型没跑完」；
 * 崩溃是宿主自己死的（Bun panic / OOM / 段错误），spawn 失败是宿主根本没起来
 * （可执行文件不存在、句柄耗尽），管道断开是本进程把宿主连带杀掉。
 * 三者模型行为都完全无法判定，属工装故障，归因 HARNESS。
 */
export function isHostCrashed(obs: HostedHostExitObservation, pipeBroken = false): boolean {
  if (pipeBroken) return true;
  if (obs.timed_out) return false;
  return obs.host_signal !== null || obs.host_spawn_error !== null;
}

export function formatWorkspaceCell(ok?: boolean): string {
  if (ok === undefined) return '';
  return ok ? '过' : '挂';
}

export function formatTimedOutCell(timedOut?: boolean): string {
  if (timedOut === undefined) return '';
  return timedOut ? '是' : '否';
}

export function formatHostExitCell(opts: {
  host_exit?: number | null | undefined;
  timed_out?: boolean | undefined;
  host_spawn_error?: string | null | undefined;
}): string {
  if (opts.timed_out === true) return '超时';
  if (opts.host_spawn_error) return '没起来';
  if (opts.host_exit === undefined) return '';
  if (opts.host_exit === null) return '被杀';
  return String(opts.host_exit);
}

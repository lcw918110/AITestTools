/** 宿主退出码 / 超时只作辅助对照，效果路径上不单独否决整题。 */
export const HOST_EXIT_ROLE = 'auxiliary' as const;
export type HostExitRole = typeof HOST_EXIT_ROLE;

export interface HostedHostExitObservation {
  timed_out: boolean;
  host_exit: number | null;
  host_signal: string | null;
  host_exit_role: HostExitRole;
}

/** Node spawnSync 超时：status=null、signal=SIGTERM、error.code=ETIMEDOUT。 */
export function observeHostExit(run: {
  status: number | null;
  signal?: NodeJS.Signals | string | null;
  error?: NodeJS.ErrnoException | Error | null;
}): HostedHostExitObservation {
  const err = run.error as NodeJS.ErrnoException | undefined;
  const signal = run.signal ?? null;
  const timed_out =
    err?.code === 'ETIMEDOUT' ||
    (run.status === null && (signal === 'SIGTERM' || signal === 'SIGKILL'));
  return {
    timed_out,
    host_exit: run.status,
    host_signal: signal,
    host_exit_role: HOST_EXIT_ROLE,
  };
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
}): string {
  if (opts.timed_out === true) return '超时';
  if (opts.host_exit === undefined) return '';
  if (opts.host_exit === null) return '被杀';
  return String(opts.host_exit);
}

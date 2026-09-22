import type { ItemDoc } from '../exam-engine/types.ts';

/** 暗号只作辅助对照，不单独否决整题。 */
export const PASS_TOKEN_ROLE = 'auxiliary' as const;
export type PassTokenRole = typeof PASS_TOKEN_ROLE;

export interface HostedPassTokenObservation {
  pass_token: string;
  pass_token_present: boolean;
  pass_token_role: PassTokenRole;
}

export function hostedPassToken(item: ItemDoc): string {
  const raw = item.stimulus.hosted_pass_token?.trim();
  return raw && raw.length > 0 ? raw : 'ok';
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在 stdout 里观察约定终态词（词边界、大小写不敏感）。空输出 → present=false。不扫 stderr，避免 --print-logs / 工具日志把题干词算成喊过暗号。 */
export function observeHostedPassToken(
  item: ItemDoc,
  stdout: string,
  _stderr = '',
): HostedPassTokenObservation {
  const pass_token = hostedPassToken(item);
  const tokenRe = new RegExp(`\\b${escapeRegExp(pass_token)}\\b`, 'i');
  return {
    pass_token,
    pass_token_present: tokenRe.test(stdout),
    pass_token_role: PASS_TOKEN_ROLE,
  };
}

export function withAuxPassToken<T extends object>(
  result: T,
  obs: HostedPassTokenObservation,
): T & HostedPassTokenObservation {
  return {
    ...result,
    pass_token: obs.pass_token,
    pass_token_present: obs.pass_token_present,
    pass_token_role: obs.pass_token_role,
  };
}

export { formatPassTokenCell } from '../report/cells.ts';

/** 报告单元格：有 DUAL_FIX / 无 DUAL_FIX；无字段则空串。 */
export function formatPassTokenCell(obs: {
  pass_token?: string | undefined;
  pass_token_present?: boolean | undefined;
}): string {
  if (
    obs.pass_token_present === undefined &&
    (obs.pass_token === undefined || obs.pass_token === '')
  ) {
    return '';
  }
  const flag = obs.pass_token_present === true ? '有' : '无';
  const word = obs.pass_token?.trim() ?? '';
  return word.length > 0 ? `${flag} ${word}` : flag;
}
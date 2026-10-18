import type { Issue } from '../exam-engine/types.ts';
import type { ValidationReport } from '../exam-engine/validate.ts';

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

const paint = (code: string, text: string): string =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;

export const green = (t: string): string => paint('32', t);
export const red = (t: string): string => paint('31', t);
export const yellow = (t: string): string => paint('33', t);
export const dim = (t: string): string => paint('2', t);

function formatIssue(issue: Issue): string {
  const tag = issue.level === 'error' ? red('ERROR') : yellow('WARN ');
  return `      ${tag} [${issue.code}] ${issue.message}`;
}

export function formatValidationReport(report: ValidationReport, verbose: boolean): string {
  const lines: string[] = [];
  if (report.projectName !== undefined) {
    lines.push(dim(`考卷库：${report.projectName}`), '');
  }

  const isCasesV1 = report.caseReports.length > 0;
  const list: Array<{
    relPath: string;
    digest: string | undefined;
    issues: Issue[];
    id: string | undefined;
    rev: number | undefined;
  }> =
    isCasesV1
      ? report.caseReports.map((c) => ({
          relPath: c.relPath,
          digest: c.digest,
          issues: c.issues,
          id: c.caseId,
          rev: c.rev,
        }))
      : (report.items ?? report.cases).map((c) => ({
          relPath: c.relPath,
          digest: c.digest,
          issues: c.issues,
          id: c.id,
          rev: c.rev,
        }));
  for (const c of list) {
    const failed = c.issues.some((i) => i.level === 'error');
    const label = failed ? red('FAIL') : c.issues.length > 0 ? yellow('WARN') : green('PASS');
    const idPart = c.id !== undefined ? ` ${c.id}@rev${String(c.rev)}` : '';
    lines.push(`${label}  ${c.relPath}${dim(idPart)}`);
    if (verbose && c.digest !== undefined) {
      lines.push(dim(`      digest ${c.digest.slice(0, 16)}`));
    }
    for (const issue of c.issues) lines.push(formatIssue(issue));
  }

  if (report.projectIssues.length > 0) {
    lines.push(
      '',
      dim(isCasesV1 ? 'case / dataset-release / environment / candidate：' : 'paperset / room / 交叉引用：'),
    );
    for (const issue of report.projectIssues) {
      lines.push(`      ${issue.file ?? ''}`.trimEnd());
      lines.push(formatIssue(issue));
    }
  }

  const passed = list.filter((c) => !c.issues.some((i) => i.level === 'error')).length;
  lines.push(
    '',
    `${passed}/${list.length} 试题通过协议校验` +
      `，${report.errorCount} 个错误 / ${report.warningCount} 个警告`,
  );
  return lines.join('\n');
}

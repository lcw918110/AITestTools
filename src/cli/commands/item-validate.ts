import { relative, resolve } from 'node:path';
import { loadCaseFileV2, loadCaseRevisionFileV2 } from '../../exam-engine/loader.ts';
import { loadProject } from '../../exam-engine/project.ts';
import {
  validateCaseRevision,
  validateCaseV2,
  validateProject,
} from '../../exam-engine/validate.ts';
import type { CaseReport, ValidationReport } from '../../exam-engine/validate.ts';
import { formatValidationReport } from '../../report/format.ts';

export interface ItemValidateOptions {
  project?: string | undefined;
  files: string[];
  json: boolean;
  strict: boolean;
  checkFixtures: boolean;
  verbose: boolean;
}

/** 校验指定文件（*.case.json / *.case-revision.json），按后缀分派到对应校验器。 */
function validateFiles(files: string[]): ValidationReport {
  const cwd = process.cwd();
  const caseReports: CaseReport[] = [];
  for (const file of files) {
    const abs = resolve(cwd, file);
    if (abs.endsWith('.case-revision.json')) {
      const asset = loadCaseRevisionFileV2(abs, cwd);
      const issues = validateCaseRevision(asset);
      const report: CaseReport = { file: abs, relPath: relative(cwd, abs), issues };
      report.caseId = asset.doc.case_id;
      report.rev = asset.doc.revision_number;
      if (issues.every((i) => i.level !== 'error')) report.digest = asset.doc.content_hash;
      caseReports.push(report);
    } else {
      const asset = loadCaseFileV2(abs, cwd);
      const issues = validateCaseV2(asset);
      const report: CaseReport = { file: abs, relPath: relative(cwd, abs), issues };
      report.caseId = asset.doc.case_id;
      caseReports.push(report);
    }
  }
  const all = caseReports.flatMap((c) => c.issues);
  return {
    caseReports,
    projectIssues: [],
    errorCount: all.filter((i) => i.level === 'error').length,
    warningCount: all.filter((i) => i.level === 'warning').length,
  };
}

export function runItemValidate(options: ItemValidateOptions): number {
  const report =
    options.files.length > 0
      ? validateFiles(options.files)
      : validateProject(loadProject(options.project), { checkFixtures: options.checkFixtures });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatValidationReport(report, options.verbose));
  }

  if (report.errorCount > 0) return 1;
  if (options.strict && report.warningCount > 0) return 1;
  return 0;
}

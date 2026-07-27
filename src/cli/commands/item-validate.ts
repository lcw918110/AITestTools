import { relative, resolve } from 'node:path';
import { loadItemFile } from '../../exam-engine/loader.ts';
import { loadProject } from '../../exam-engine/project.ts';
import { semanticDigest } from '../../exam-engine/digest.ts';
import { validateItem, validateProject } from '../../exam-engine/validate.ts';
import type { ItemReport, ValidationReport } from '../../exam-engine/validate.ts';
import { formatValidationReport } from '../../report/format.ts';

export interface ItemValidateOptions {
  project?: string | undefined;
  files: string[];
  json: boolean;
  strict: boolean;
  checkFixtures: boolean;
  verbose: boolean;
}

function validateFiles(files: string[], checkFixtures: boolean): ValidationReport {
  const cwd = process.cwd();
  const items: ItemReport[] = [];
  for (const file of files) {
    const abs = resolve(cwd, file);
    const asset = loadItemFile(abs, cwd);
    const issues = validateItem(asset, checkFixtures ? cwd : undefined);
    const report: ItemReport = { file: abs, relPath: relative(cwd, abs), issues };
    if (typeof asset.doc.id === 'string') report.id = asset.doc.id;
    if (typeof asset.doc.rev === 'number') report.rev = asset.doc.rev;
    if (issues.every((i) => i.level !== 'error')) report.digest = semanticDigest(asset.doc);
    items.push(report);
  }
  const all = items.flatMap((c) => c.issues);
  return {
    items,
    cases: items,
    projectIssues: [],
    errorCount: all.filter((i) => i.level === 'error').length,
    warningCount: all.filter((i) => i.level === 'warning').length,
  };
}

export function runItemValidate(options: ItemValidateOptions): number {
  const report =
    options.files.length > 0
      ? validateFiles(options.files, options.checkFixtures)
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

/** @deprecated */
export const runCaseValidate = runItemValidate;

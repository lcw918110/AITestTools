import { compareRuns } from '../../report/compare.ts';

export interface CompareOptions {
  baseline?: string;
  candidate?: string;
  json: boolean;
}

export function runCompare(options: CompareOptions): number {
  if (options.baseline === undefined || options.candidate === undefined) {
    console.error('用法：proctor compare --baseline <run目录> --candidate <run目录>');
    return 2;
  }
  try {
    const report = compareRuns(options.baseline, options.candidate);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`baseline:  ${report.baseline}`);
      console.log(`candidate: ${report.candidate}`);
      console.log(
        `漂移：新失败 ${report.counts.new_failure} / 修复 ${report.counts.fixed} / 升版 ${report.counts.asset_rev_drift} / 不变 ${report.counts.unchanged}`,
      );
      for (const r of report.rows.filter((x) => x.kind !== 'unchanged')) {
        console.log(`  [${r.kind}] ${r.item_id}`);
      }
    }
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

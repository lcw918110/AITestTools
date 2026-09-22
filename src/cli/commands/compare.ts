import { compareRuns, writeEffectCompareMarkdown } from '../../report/compare.ts';
import { join, resolve } from 'node:path';

export interface CompareOptions {
  baseline?: string;
  candidate?: string;
  json: boolean;
  /** 写出 effect_compare.md 到 candidate 目录（默认 true） */
  writeEffect?: boolean;
}

export function runCompare(options: CompareOptions): number {
  if (options.baseline === undefined || options.candidate === undefined) {
    console.error('用法：proctor compare --baseline <run目录> --candidate <run目录>');
    return 2;
  }
  try {
    const report = compareRuns(options.baseline, options.candidate);
    const writeEffect = options.writeEffect !== false;
    if (writeEffect) {
      const out = join(resolve(options.candidate), 'effect_compare.md');
      writeEffectCompareMarkdown(report, out);
    }
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`baseline:  ${report.baseline}`);
      console.log(`candidate: ${report.candidate}`);
      console.log(
        `漂移：新失败 ${report.counts.new_failure} / 修复 ${report.counts.fixed} / 升版 ${report.counts.asset_rev_drift} / 不变 ${report.counts.unchanged}`,
      );
      const e = report.effect;
      console.log(
        `效果：pass_rate base=${e.baseline_pass_rate.toFixed(3)} cand=${e.candidate_pass_rate.toFixed(3)} Δ=${e.pass_rate_delta.toFixed(3)}`,
      );
      if (e.reference_scores?.delta !== undefined) {
        console.log(
          `参考分：base=${e.reference_scores.baseline_avg} cand=${e.reference_scores.candidate_avg} Δ=${e.reference_scores.delta}`,
        );
      }
      for (const r of report.rows.filter((x) => x.kind !== 'unchanged')) {
        console.log(`  [${r.kind}] ${r.item_id}`);
      }
      if (writeEffect) {
        console.log(`已写：${join(resolve(options.candidate), 'effect_compare.md')}`);
      }
    }
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

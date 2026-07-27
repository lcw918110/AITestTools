import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ReportShowOptions {
  run?: string;
  json: boolean;
}

export function runReportShow(options: ReportShowOptions): number {
  if (options.run === undefined) {
    console.error('用法：proctor report show --run <run目录>');
    return 2;
  }
  const dir = resolve(options.run);
  const reportMd = join(dir, 'report.md');
  const metrics = join(dir, 'metrics.json');
  if (!existsSync(reportMd)) {
    console.error(`缺少 report.md：${dir}`);
    return 1;
  }
  if (options.json) {
    const payload: Record<string, unknown> = {
      run: dir,
      report_md: readFileSync(reportMd, 'utf8'),
    };
    if (existsSync(metrics)) {
      payload.metrics = JSON.parse(readFileSync(metrics, 'utf8')) as unknown;
    }
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(readFileSync(reportMd, 'utf8'));
  }
  return 0;
}

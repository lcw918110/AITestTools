import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface BaselinePinOptions {
  run?: string;
  name?: string;
  project?: string;
  json: boolean;
}

/** 把某次 run 钉为命名 baseline（复制到 baselines/<name>）。 */
export function runBaselinePin(options: BaselinePinOptions): number {
  if (options.run === undefined || options.name === undefined) {
    console.error('用法：proctor baseline pin --run <run目录> --name <别名>');
    return 2;
  }
  const runDir = resolve(options.run);
  if (!existsSync(join(runDir, 'results.ndjson'))) {
    console.error(`不是有效 run 目录：${runDir}`);
    return 1;
  }
  const root = options.project !== undefined ? resolve(options.project) : process.cwd();
  const dest = join(root, 'baselines', options.name);
  mkdirSync(join(root, 'baselines'), { recursive: true });
  cpSync(runDir, dest, { recursive: true });
  const meta = {
    name: options.name,
    pinned_at: new Date().toISOString(),
    source_run: runDir,
  };
  writeFileSync(join(dest, 'baseline.json'), `${JSON.stringify(meta, null, 2)}\n`);
  if (options.json) console.log(JSON.stringify({ ...meta, dest }, null, 2));
  else console.log(`已钉选 baseline：${dest}`);
  return 0;
}

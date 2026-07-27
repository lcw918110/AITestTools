import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_PROTOCOL_VERSION } from '../../exam-engine/schema.ts';
import { MANIFEST_FILENAME } from '../../exam-engine/project.ts';
import { green } from '../../report/format.ts';

const TEMPLATE_DIR = fileURLToPath(new URL('../../../templates/project', import.meta.url));

export interface InitOptions {
  dir: string;
  name?: string | undefined;
  force: boolean;
}

export function runInit(options: InitOptions): number {
  const target = resolve(process.cwd(), options.dir);
  const manifestPath = join(target, MANIFEST_FILENAME);
  if (existsSync(manifestPath) && !options.force) {
    console.error(`已存在考卷库清单：${manifestPath}（用 --force 覆盖）`);
    return 1;
  }

  mkdirSync(target, { recursive: true });
  cpSync(TEMPLATE_DIR, target, { recursive: true, force: options.force });

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.name = options.name ?? basename(target);
  manifest.asset_protocol = ASSET_PROTOCOL_VERSION;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(green(`已生成考卷库骨架：${target}`));
  console.log('下一步：编辑 items/ 下的样例试题，然后运行 proctor item validate');
  return 0;
}

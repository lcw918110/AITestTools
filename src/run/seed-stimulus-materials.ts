import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SKIP_BASENAMES = new Set(['prompt.txt']);
const SKIP_RELPATHS = new Set(['opencode.json']);

function isInside(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

/**
 * 把本题 stimulus.ref 所在材料目录里除 prompt.txt 外的文件拷进隔离 workDir（保持相对路径）。
 * 空目录 / 只有 prompt 则不拷。不把题库其它目录带进去。
 */
export function seedStimulusMaterials(opts: {
  workDir: string;
  projectRoot: string;
  stimulusRef: string | undefined;
}): { copied: string[] } {
  const copied: string[] = [];
  const ref = opts.stimulusRef?.trim();
  if (!ref) return { copied };

  const projectRoot = resolve(opts.projectRoot);
  const workDir = resolve(opts.workDir);
  const absRef = resolve(projectRoot, ref);
  const matDir = dirname(absRef);

  if (!isInside(projectRoot, matDir) || !existsSync(matDir) || !statSync(matDir).isDirectory()) {
    return { copied };
  }

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === '.git' || name === '.DS_Store') continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = relative(matDir, abs);
      const relPosix = rel.split(sep).join('/');
      if (SKIP_BASENAMES.has(name) || SKIP_RELPATHS.has(relPosix)) continue;
      const dest = join(workDir, rel);
      if (!isInside(workDir, dest)) continue;
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(abs, dest);
      copied.push(relPosix);
    }
  };
  walk(matDir);
  copied.sort();
  return { copied };
}

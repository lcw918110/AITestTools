import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ASSET_PROTOCOL_VERSION, validateAgainstSchema } from './schema.ts';
import type { AssetKind, ExamManifest, Issue } from './types.ts';

export const MANIFEST_FILENAME = 'exam.json';

const DEFAULT_PATHS: Record<AssetKind, string> = {
  items: 'items',
  papersets: 'papersets',
  rooms: 'rooms',
  materials: 'materials',
  scripts: 'scripts',
  cassettes: 'cassettes',
  contracts: 'contracts',
  shells: 'shells',
  runs: 'runs',
  cases: 'cases',
  case_revisions: 'case-revisions',
  dataset_releases: 'dataset-releases',
  environments: 'environments',
  candidates: 'candidates',
};

export interface ExamProject {
  root: string;
  manifestPath: string;
  manifest: ExamManifest;
  dirs: Record<AssetKind, string>;
}

/** @deprecated */
export type HarnessProject = ExamProject;

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export function findManifest(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, MANIFEST_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function loadProject(target?: string, cwd: string = process.cwd()): ExamProject {
  let manifestPath: string | undefined;
  if (target) {
    const abs = isAbsolute(target) ? target : resolve(cwd, target);
    if (!existsSync(abs)) throw new ProjectError(`考卷库路径不存在：${abs}`);
    manifestPath = statSync(abs).isDirectory() ? join(abs, MANIFEST_FILENAME) : abs;
    if (!existsSync(manifestPath)) {
      throw new ProjectError(`未找到考卷库清单：${manifestPath}（可用 proctor init 生成）`);
    }
  } else {
    manifestPath = findManifest(cwd);
    if (!manifestPath) {
      throw new ProjectError(
        `未在 ${cwd} 及其上级目录找到 ${MANIFEST_FILENAME}；请用 --project 指定考卷库，或用 proctor init 生成。`,
      );
    }
  }

  let manifest: ExamManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ExamManifest;
  } catch (e) {
    throw new ProjectError(`考卷库清单不是合法 JSON：${manifestPath}\n${(e as Error).message}`);
  }

  const schemaIssues = validateAgainstSchema('exam', manifest, manifestPath);
  if (schemaIssues.length > 0) {
    throw new ProjectError(
      `考卷库清单不符合协议：${manifestPath}\n` +
        schemaIssues.map((i) => `  - ${i.message}`).join('\n'),
    );
  }

  const root = dirname(manifestPath);
  const dirs = Object.fromEntries(
    (Object.keys(DEFAULT_PATHS) as AssetKind[]).map((kind) => [
      kind,
      resolve(root, manifest.paths?.[kind] ?? DEFAULT_PATHS[kind]),
    ]),
  ) as Record<AssetKind, string>;

  return { root, manifestPath, manifest, dirs };
}

export function checkProtocolCompatibility(manifest: ExamManifest, file: string): Issue[] {
  if (manifest.asset_protocol === ASSET_PROTOCOL_VERSION) return [];
  // papers-v1 已废弃：不阻断加载（供历史 run 兼容），但降级为 warning 提示迁移
  if (manifest.asset_protocol === 'papers-v1') {
    return [
      {
        level: 'warning',
        code: 'PROTOCOL_DEPRECATED',
        message: `资产协议 ${manifest.asset_protocol} 已废弃，建议迁移到 ${ASSET_PROTOCOL_VERSION}（历史 run 兼容仍可读取）`,
        file,
      },
    ];
  }
  return [
    {
      level: 'error',
      code: 'PROTOCOL_INCOMPATIBLE',
      message: `资产协议不兼容：项目声明 ${manifest.asset_protocol}，引擎支持 ${ASSET_PROTOCOL_VERSION}`,
      file,
    },
  ];
}

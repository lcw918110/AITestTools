/**
 * 运行环境 Profile 生命周期与复现清单采集（第 1 期）。
 * - assertProfileLifecycleTransition：draft → active → deprecated 线性前进校验。
 * - collectReproManifest：复现清单实时只读采集（git/node/os/lockfile），不落盘。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { REPO_ROOT } from './config.ts';

/** Profile 生命周期枚举（与 schema environment.schema.json lifecycle 一致）。 */
const PROFILE_LIFECYCLE = ['draft', 'active', 'deprecated'] as const;
type ProfileLifecycle = (typeof PROFILE_LIFECYCLE)[number];

function isProfileLifecycle(v: string): v is ProfileLifecycle {
  return (PROFILE_LIFECYCLE as readonly string[]).includes(v);
}

/**
 * 校验 Profile 生命周期流转：draft → active → deprecated 线性前进，禁止跳步与回退。
 * 返回 undefined 表示合法，否则返回错误说明。
 */
export function assertProfileLifecycleTransition(from: string, to: string): string | undefined {
  if (!isProfileLifecycle(from)) return `非法起始状态：${from}`;
  if (!isProfileLifecycle(to)) return `非法目标状态：${to}`;
  if (from === to) return `已是 ${to}，无需流转`;
  const fromIdx = PROFILE_LIFECYCLE.indexOf(from);
  const toIdx = PROFILE_LIFECYCLE.indexOf(to);
  if (toIdx === fromIdx + 1) return undefined;
  if (toIdx > fromIdx) return `不可跳步：${from} → ${to}（须逐级前进）`;
  return `不可回退：${from} → ${to}`;
}

/** 运行 git 命令（在 REPO_ROOT 下），失败返回 undefined。 */
function runGit(args: string[]): string | undefined {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0) return undefined;
  return (r.stdout ?? '').trim();
}

/** 运行任意命令，失败返回 undefined。 */
function runCmd(cmd: string, args: string[]): string | undefined {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0) return undefined;
  return (r.stdout ?? '').trim();
}

export type ReproManifest = {
  gitCommit?: string;
  worktreeDirty: boolean;
  nodeVersion?: string;
  osPlatform?: string;
  osArch?: string;
  lockfileSummary?: string;
};

/**
 * 复现清单实时只读采集（不落盘）。
 * 采集的是测试平台（本仓）自身的版本信息，与具体被测项目无关，故不接收 project 参数。
 * 采集失败字段为 undefined / false，不伪造版本或 hash。
 */
export function collectReproManifest(): ReproManifest {
  const gitCommit = runGit(['rev-parse', 'HEAD']);
  const dirtyRaw = runGit(['status', '--porcelain']);
  const worktreeDirty = dirtyRaw !== undefined && dirtyRaw.length > 0;
  const nodeVersion = runCmd(process.execPath, ['--version']);
  const osPlatform = process.platform;
  const osArch = process.arch;

  let lockfileSummary: string | undefined;
  const lockPath = join(REPO_ROOT, 'package-lock.json');
  if (existsSync(lockPath)) {
    try {
      const text = readFileSync(lockPath, 'utf8');
      const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
      const depCount = (text.match(/"node_modules\//g) ?? []).length;
      lockfileSummary = `sha256:${hash} · ${depCount} 依赖`;
    } catch {
      lockfileSummary = undefined;
    }
  }

  return {
    ...(gitCommit ? { gitCommit } : {}),
    worktreeDirty,
    ...(nodeVersion ? { nodeVersion } : {}),
    osPlatform,
    osArch,
    ...(lockfileSummary ? { lockfileSummary } : {}),
  };
}

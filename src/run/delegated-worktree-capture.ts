import {
  cpSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { CanonicalEvent } from '../attribution/event-store.ts';
import { eventName, factLayers } from '../oracles/event-name.ts';
import type { SeedSnapshot } from './hosted-workspace-state.ts';
import { digestFile } from './hosted-workspace-state.ts';

export interface DelegatedWorktreeCapture {
  source: string;
  copied: string[];
  /** 播种材料在工作树里找不到（含被删）。 */
  missing: string[];
  /** 单文件抄失败。采集失败不得抛出，以免改写已经算出的通过判定。 */
  errors: string[];
  /** 与播种时内容指纹不同的材料文件（相对路径）。 */
  changed: string[];
  /**
   * 该工作树里是否有改动停在分支、没回到交付面。
   * `null` 表示这份副本给不出结论（路径被拒 / 文件不可比对 / 清单写失败 / 未给指纹），
   * 不能当作「没搁浅」。
   */
  strandedInWorktree: boolean | null;
}

function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  // `..` 开头的相对路径才是越界；名字本身以 `..` 开头（如 `..env`）不算。
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${'/'}`) && !isAbsolute(rel);
}

/** 词面路径和 realpath 都要落在临时目录内，避免 /var 与 /private/var 别名漏判。 */
function tempRoots(): string[] {
  const out = new Set<string>();
  for (const root of ['/tmp', '/private/tmp', tmpdir()]) {
    const abs = resolve(root);
    out.add(abs);
    try {
      out.add(realpathSync(abs));
    } catch {
      /* 根目录不存在时只保留词面路径 */
    }
  }
  return [...out];
}

/**
 * 只允许绝对路径，且词面与真实路径都必须落在系统临时目录下。
 * 先看原始字符串：相对路径不能先 resolve，否则会落到进程当前目录。
 */
export function isAllowedWorktreeSource(raw: string): boolean {
  if (!isAbsolute(raw)) return false;
  const abs = resolve(raw);
  const roots = tempRoots();
  if (!roots.some((root) => contained(root, abs))) return false;
  try {
    const real = realpathSync(abs);
    return roots.some((root) => contained(root, real));
  } catch {
    return true;
  }
}

/**
 * 从 WorktreeCreated 载荷取出路径。
 * 万象术写成 `["WorktreePath", "/tmp/..."]`，不是裸字符串。
 */
export function worktreePathFromEvent(event: CanonicalEvent): string | undefined {
  if (eventName(event as unknown as Record<string, unknown>) !== 'WorktreeCreated')
    return undefined;
  const layers = factLayers(event.payload);
  if (layers.length < 2) return undefined;
  const payload = event.payload;
  if (typeof payload !== 'object' || payload === null) return undefined;
  const fact = (payload as Record<string, unknown>).Fact;
  if (!Array.isArray(fact)) return undefined;
  let node: unknown = fact[1];
  for (let depth = 1; depth < layers.length && Array.isArray(node); depth += 1) {
    node = node[1];
  }
  if (typeof node !== 'object' || node === null) return undefined;
  const raw = (node as Record<string, unknown>).WorktreePath;
  if (Array.isArray(raw) && typeof raw[1] === 'string' && raw[1].length > 0) return raw[1];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return undefined;
}

/**
 * 清播种目录前，把委派工作树里与播种材料同名的文件抄进产物。
 * 只留证据：不跟工作树、不改 materials_mutated、不把工作树改对记成通过。
 */
export function captureDelegatedWorktrees(input: {
  events: CanonicalEvent[];
  seeded: string[];
  artifactDir: string;
  /**
   * 播种完成时的内容指纹。给了才能算「工作树改了什么」；
   * 不给时只抄副本，`changed` 留空，且结论为 `null`。
   */
  seedSnapshot?: SeedSnapshot;
  /**
   * 播种目录里哪些材料文件已被改动。按文件粒度判断，
   * 避免「任意一个变了就认为全部已交付」。不给时结论为 `null`。
   */
  mutatedInSeed?: readonly string[];
}): DelegatedWorktreeCapture[] {
  const seen = new Set<string>();
  const out: DelegatedWorktreeCapture[] = [];
  let index = 0;
  for (const event of input.events) {
    const source = worktreePathFromEvent(event);
    // 事件姓 WorktreeCreated 但路径解析不出来：这是「无法判定」，不能静默跳过当没有委派。
    if (source === undefined) {
      if (eventName(event as unknown as Record<string, unknown>) !== 'WorktreeCreated') continue;
      out.push({
        source: '',
        copied: [],
        missing: [],
        errors: ['WorktreeCreated 事件里解析不出工作树路径，无法比对'],
        changed: [],
        strandedInWorktree: null,
      });
      continue;
    }
    // 事件里的路径不可信。必须先看原始字符串，不能先 resolve。
    if (!isAllowedWorktreeSource(source)) {
      out.push({
        source,
        copied: [],
        missing: [],
        errors: ['工作树路径不在隔离目录内，拒绝采集'],
        changed: [],
        strandedInWorktree: null,
      });
      continue;
    }
    const abs = resolve(source);
    if (seen.has(abs)) continue;
    seen.add(abs);
    index += 1;
    // 改用新的序号前先清掉旧目录，避免上一次运行的副本与本轮混在一起。
    const dest = join(input.artifactDir, 'delegated-worktrees', String(index));
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      /* 清不掉时下面写入会报错并让结论变 null */
    }
    const copied: string[] = [];
    const missing: string[] = [];
    const errors: string[] = [];
    const changed: string[] = [];
    // 上游清单可能含重复 rel；重复会污染 changed 与按文件粒度的统计。
    const seenRel = new Set<string>();
    /** 本副本是否每个文件都完成了「抄 + 比对」。任一出错就不能给出搁浅结论。 */
    let comparable = input.seedSnapshot !== undefined && input.mutatedInSeed !== undefined;
    // 工作树根不存在（已被清理）时不能把「全都没了」当成「全部删除」。
    // 用 statSync 而非 existsSync：EACCES 也会让 existsSync 返回 false。
    let treeMissing = false;
    try {
      treeMissing = !statSync(abs).isDirectory();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        treeMissing = true;
      } else {
        // 权限等原因看不到根目录：无法判定，不能猜「全都没了」。
        errors.push('工作树根无法访问，无法比对');
        comparable = false;
      }
    }
    if (treeMissing) {
      errors.push('工作树根不存在，无法比对');
      comparable = false;
    }
    for (const rel of input.seeded) {
      if (seenRel.has(rel)) continue;
      seenRel.add(rel);
      if (treeMissing) {
        // 根都没了，逐文件结论无从谈起，只登记缺失。
        missing.push(rel);
        continue;
      }
      const from = join(abs, rel);
      const snapshot = input.seedSnapshot;
      // 快照里没有这个 rel，或当时就读不到 → 无法判断这个文件，整份结论降级为 null。
      const expected =
        snapshot !== undefined &&
        Object.hasOwn(snapshot.digests, rel) &&
        !snapshot.unreadable.includes(rel)
          ? snapshot.digests[rel]
          : undefined;
      if (expected === undefined && snapshot !== undefined) {
        errors.push(`${rel}: 播种指纹缺失，跳过比对`);
        comparable = false;
      }
      // 用 lstat 区分「不存在」与「读不到」：existsSync 在 EACCES 下也返回 false。
      let fromExists = false;
      try {
        fromExists = lstatSync(from) !== undefined;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          fromExists = false;
        } else {
          errors.push(`${rel}: 无法访问，跳过比对`);
          comparable = false;
          continue;
        }
      }
      if (!fromExists) {
        missing.push(rel);
        // 删除同样是「工作树里的改动」：播种时存在、工作树里没了。
        if (expected !== undefined && expected !== null) changed.push(rel);
        continue;
      }
      try {
        if (!lstatSync(from).isFile()) {
          errors.push(`${rel}: 不是普通文件，跳过`);
          comparable = false;
          continue;
        }
        const realRoot = realpathSync(abs);
        const realFrom = realpathSync(from);
        if (!contained(realRoot, realFrom)) {
          errors.push(`${rel}: 解析后超出工作树，跳过`);
          comparable = false;
          continue;
        }
        const to = join(dest, rel);
        mkdirSync(join(to, '..'), { recursive: true });
        cpSync(from, to);
        copied.push(rel);
        if (expected === null) {
          // 播种时不存在、现在有 → 新增，也算改动。
          changed.push(rel);
        } else if (expected !== undefined) {
          const digest = digestFile(from);
          if (digest === null) {
            errors.push(`${rel}: 读取失败，跳过比对`);
            comparable = false;
          } else if (digest !== expected) {
            changed.push(rel);
          }
        }
      } catch (err) {
        errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
        comparable = false;
      }
    }
    // 逐文件判断：该文件有改动、且播种目录里这个文件没变 → 改动停在分支。
    let strandedInWorktree: boolean | null = comparable
      ? changed.some((rel) => !(input.mutatedInSeed ?? []).includes(rel))
      : null;
    try {
      mkdirSync(dest, { recursive: true });
      writeFileSync(
        join(dest, 'manifest.json'),
        `${JSON.stringify({ source: abs, copied, missing, errors, changed, strandedInWorktree }, null, 2)}\n`,
      );
    } catch (err) {
      errors.push(`manifest: ${err instanceof Error ? err.message : String(err)}`);
      // 清单写不出去，结论就无从复核，按「未采成」处理。
      strandedInWorktree = null;
    }
    out.push({ source: abs, copied, missing, errors, changed, strandedInWorktree });
  }
  return out;
}

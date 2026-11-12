import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库内 demo 考卷库的绝对路径。 */
export const DEMO_PROJECT = fileURLToPath(new URL('../../examples/demo-project', import.meta.url));

/**
 * 需要从真实 demo 考卷库借用的资产目录（软链，**只读**）。
 *
 * 除 `paths` 能声明的 11 类资产外，`sut` 也必须带上：L1 fold 题的执行入口
 * （`execution_profile.fold_entry` / `script`）是相对 `project.root` 解析的，
 * 与 `paths` 无关，缺了会报「无法 import Fold 模块」。
 *
 * `cassettes` 必须软链而非建空目录：`examples/demo-project/cassettes/` 下有被 git 跟踪的
 * 录制（`smoke-a-l3` 等 `mode=cassette` 的题靠它跑通），建空目录会让这些题必然假红。
 *
 * ⚠️ `cassettes` 是软链，写入会穿透到真实资产。已知写入入口：
 * - `hosted-runner.ts` 的录制分支，受 `PROCTOR_RECORD_CASSETTE` 控制（helper 已清除）；
 * - `item new --mode cassette`（`item-new.ts`）与 `cassette record`（`cassette-record.ts`），
 *   **无条件** `mkdirSync(project.root/cassettes/<id>)`。
 * 新增涉及后两者的用例时，必须先把 `cassettes` 移入 `REAL_DIRS`。
 */
const LINKED_DIRS = [
  'materials',
  'scripts',
  'cassettes',
  'contracts',
  'shells',
  'cases',
  'case-revisions',
  'dataset-releases',
  'environments',
  'candidates',
  'sut',
] as const;

/**
 * 建成真实目录（不软链）的资产：这些路径存在被测代码的**无条件写入**分支。
 *
 * `runs`：所有 run 的产物落点，必须隔离。
 */
const REAL_DIRS = ['runs'] as const;

/**
 * 建一个「资产借用真实 demo、产物写临时目录」的考卷库根，供测试用 `--project` 指向。
 *
 * 为什么需要它：`run` 命令会把产物写进 `project.dirs.runs`。若直接把
 * `examples/demo-project` 传给 `--project`，每次测试都会在仓库里留下真实 run 目录；
 * 这些目录被 `collectTrendPoints` 之类会遍历整个 `runs/` 的逻辑扫到，并发跑时
 * 与其争抢 I/O，曾让趋势测试稳定越过 5s 超时（见 changelog §58/§59）。
 *
 * 做法：临时根下用符号链接指向真实资产目录（只读，不复制、不产生磁盘开销），
 * 只把 `runs` 建成真实目录。这样被测行为与直接使用 demo 完全一致，
 * 而产物落在 `$TMPDIR` 里，由调用方 `afterAll` 删除。
 *
 * @returns 临时考卷库根的绝对路径
 */
export function createIsolatedProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-isolated-'));

  // 软链了 `cassettes`（录制目录），必须确保录制开关关闭，否则写操作会穿透到真实资产。
  delete process.env.PROCTOR_RECORD_CASSETTE;

  for (const dir of LINKED_DIRS) {
    const target = join(DEMO_PROJECT, dir);
    // 先判存在：`symlinkSync` 对不存在的目标不会抛错，而是建一个悬空软链
    // （`existsSync` 为 false，读时会报 ENOENT），那样错误会延迟到被测代码里，
    // 以「资产缺失」的形态暴露，难以定位。
    if (!existsSync(target)) continue;
    try {
      symlinkSync(target, join(root, dir));
    } catch (e) {
      // 权限、磁盘满等必须抛出：否则同样会以「资产缺失」的形态失败。
      throw new Error(`软链资产目录失败：${target} → ${join(root, dir)}：${(e as Error).message}`);
    }
  }

  for (const dir of REAL_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  writeFileSync(
    join(root, 'exam.json'),
    JSON.stringify({
      name: 'isolated-test-project',
      description: '测试专用临时考卷库：资产软链真实 demo，产物写入临时目录。',
      asset_protocol: 'cases-v1',
      paths: {},
    }),
  );

  return root;
}

/**
 * 删除 `createIsolatedProjectRoot` 建的临时根。
 *
 * 注意：**不得**先 `realpathSync` 再删。根目录里是软链，`rmSync(recursive)` 只删软链本身、
 * 不跟随进入目标目录；一旦有人改成对 realpath 操作，就会删掉真实 demo 资产。
 */
export function removeIsolatedProjectRoot(root: string | undefined): void {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
}

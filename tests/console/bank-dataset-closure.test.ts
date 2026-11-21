import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTask, deleteTask, rollbackCreate, snapshotFiles } from '../../apps/console/bank.ts';
import { closureDigest } from '../../src/exam-engine/digest.ts';
import { validateProject } from '../../src/exam-engine/validate.ts';
import { loadProject } from '../../src/exam-engine/project.ts';

/**
 * 录题 / 删题后 dataset-release 的 `closure_hash` 必须与 `case_revisions` 一致。
 *
 * 冻结闭包摘要的定义是「引用列表的规范哈希」，校验侧（`validateDatasetRelease`）
 * 会逐项比对。此前 `appendDatasetReleaseItem` / `removeDatasetReleaseItem` 只改数组、
 * 不重算摘要：录题成功后整个题库校验立刻报 `DATASET_CLOSURE_HASH_MISMATCH`，
 * 控制台「录题后校验」因此必然失败并触发回滚——录题功能整体不可用，
 * 而且失败信息指向的是「闭包哈希不一致」，与真实原因（追加时漏算）相距甚远。
 */

function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-bank-closure-'));
  mkdirSync(join(root, 'bank/materials'), { recursive: true });
  mkdirSync(join(root, 'cases'), { recursive: true });
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  mkdirSync(join(root, 'dataset-releases'), { recursive: true });
  for (const name of ['paired-off-calibrate', 'paired-on-calibrate']) {
    writeFileSync(
      join(root, 'dataset-releases', `${name}.dataset-release.json`),
      `${JSON.stringify(
        {
          dataset_release_id: name,
          name,
          case_revisions: [],
          closure_hash: closureDigest([]),
          created_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  }
  return root;
}

function releaseDoc(
  root: string,
  name: string,
): { case_revisions: unknown[]; closure_hash: string } {
  return JSON.parse(
    readFileSync(join(root, 'dataset-releases', `${name}.dataset-release.json`), 'utf8'),
  ) as { case_revisions: unknown[]; closure_hash: string };
}

const okValidate = async () => ({ exitCode: 0, ok: true, log: '1/1 试题通过' });

describe('录题与删题维护 dataset-release 闭包哈希', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('录题后两个 dataset-release 的 closure_hash 与引用列表一致', async () => {
    root = seedProject();
    const created = await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );
    expect('error' in created ? created.error : undefined).toBeUndefined();

    for (const name of ['paired-off-calibrate', 'paired-on-calibrate']) {
      const doc = releaseDoc(root, name);
      expect(doc.case_revisions).toHaveLength(1);
      // 只改数组不重算摘要 → 这里会精确变红
      expect(doc.closure_hash).toBe(closureDigest(doc.case_revisions));
    }
  });

  it('删题后 closure_hash 回到与剩余引用一致', async () => {
    root = seedProject();
    await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );
    expect(deleteTask(root, 'PAIRED-TASK-99', 'PAIRED-TASK-99')).toEqual({
      ok: true,
      taskId: 'PAIRED-TASK-99',
    });

    for (const name of ['paired-off-calibrate', 'paired-on-calibrate']) {
      const doc = releaseDoc(root, name);
      expect(doc.case_revisions).toHaveLength(0);
      expect(doc.closure_hash).toBe(closureDigest(doc.case_revisions));
    }
  });

  it('录题后校验失败回滚时，dataset-release 恢复到原文（逐字节）', async () => {
    root = seedProject();
    const offPath = join(root, 'dataset-releases', 'paired-off-calibrate.dataset-release.json');
    const onPath = join(root, 'dataset-releases', 'paired-on-calibrate.dataset-release.json');
    const before = { off: readFileSync(offPath, 'utf8'), on: readFileSync(onPath, 'utf8') };

    const created = await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
      },
      { validate: async () => ({ exitCode: 1, ok: false, log: '校验失败' }) },
    );
    expect('error' in created).toBe(true);

    // 回滚必须恢复原文：只删引用会留下重算过的闭包哈希，与原状态不等价
    expect(readFileSync(offPath, 'utf8')).toBe(before.off);
    expect(readFileSync(onPath, 'utf8')).toBe(before.on);
  });

  it('端到端：录题后整库校验不再报闭包哈希不一致', async () => {
    root = seedProject();
    await createTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
        testSetId: 'calibrate',
      },
      { validate: okValidate },
    );

    // 项目清单：只声明名称，校验器会按默认目录加载资产
    writeFileSync(
      join(root, 'exam.json'),
      `${JSON.stringify(
        {
          $schema: '../../../schemas/exam.schema.json',
          name: 'closure-fixture',
          asset_protocol: 'cases-v1',
          engine: { min_version: '0.1.0' },
        },
        null,
        2,
      )}\n`,
    );
    const report = validateProject(loadProject(root), { checkFixtures: false });
    const closureIssues = report.projectIssues.filter(
      (i) => i.code === 'DATASET_CLOSURE_HASH_MISMATCH',
    );
    expect(closureIssues).toEqual([]);
  });
});

/** 整库校验里与「引用 ↔ 闭包」相关的问题码，用于确认回滚后没有残留脏库。 */
function closureRelatedIssues(root: string): string[] {
  writeFileSync(
    join(root, 'exam.json'),
    `${JSON.stringify(
      {
        $schema: '../../../schemas/exam.schema.json',
        name: 'closure-fixture',
        asset_protocol: 'cases-v1',
        engine: { min_version: '0.1.0' },
      },
      null,
      2,
    )}\n`,
  );
  const report = validateProject(loadProject(root), { checkFixtures: false });
  return report.projectIssues
    .filter((i) =>
      ['DATASET_CLOSURE_HASH_MISMATCH', 'DATASET_REVISION_MISSING'].includes(String(i.code)),
    )
    .map((i) => String(i.code));
}

/** 列出目录下的文件名（目录不存在返回空数组）。 */
function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

const createBody = {
  taskId: 'PAIRED-TASK-99',
  prompt: 'Reply with exactly Z.',
  passToken: 'Z',
  testSetId: 'calibrate',
} as const;

describe('录题 / 删题失败路径的一致性与回滚', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('追加 on 名单失败（off 已追加）时两侧都回到原文', async () => {
    root = seedProject();
    const offPath = join(root, 'dataset-releases', 'paired-off-calibrate.dataset-release.json');
    const onPath = join(root, 'dataset-releases', 'paired-on-calibrate.dataset-release.json');
    const before = { off: readFileSync(offPath, 'utf8'), on: readFileSync(onPath, 'utf8') };
    // on 名单被删掉：append 第二个 release 时抛错，此时 off 已经追加成功
    rmSync(onPath);

    const created = await createTask(root, createBody, { validate: okValidate });
    expect('error' in created).toBe(true);
    expect((created as { error: string }).error).toContain('有插件名单不存在');

    // off 侧必须精确回到原文（含闭包哈希），on 侧回到「原本不存在」
    expect(readFileSync(offPath, 'utf8')).toBe(before.off);
    expect(existsSync(onPath)).toBe(false);

    // 录题失败后不得留下悬空 case / case-revision / materials（否则 getTask 会看到半截题）
    expect(listDir(join(root, 'cases'))).toEqual([]);
    expect(listDir(join(root, 'case-revisions'))).toEqual([]);
    expect(existsSync(join(root, 'bank/materials/PAIRED-TASK-99'))).toBe(false);
  });

  it('录题回滚会删除本次新建的 case / case-revision / materials', async () => {
    root = seedProject();
    const created = await createTask(root, createBody, {
      validate: async () => ({ exitCode: 1, ok: false, log: '校验失败' }),
    });
    expect('error' in created).toBe(true);

    expect(existsSync(join(root, 'bank/materials/PAIRED-TASK-99'))).toBe(false);
    expect(listDir(join(root, 'cases'))).toEqual([]);
    expect(listDir(join(root, 'case-revisions'))).toEqual([]);
    // 目录仍须存在且没有被误写成空文件
    expect(existsSync(join(root, 'cases'))).toBe(true);
    expect(statSync(join(root, 'cases')).isDirectory()).toBe(true);
    expect(closureRelatedIssues(root)).toEqual([]);
  });

  it('dataset-release 路径原本是目录时，回滚不把它改写成空文件', async () => {
    root = seedProject();
    const offPath = join(root, 'dataset-releases', 'paired-off-calibrate.dataset-release.json');
    const onPath = join(root, 'dataset-releases', 'paired-on-calibrate.dataset-release.json');
    const onBefore = readFileSync(onPath, 'utf8');
    // 极端损坏场景：该路径被一个目录占用。回滚必须原样保留目录，不能写成空文件。
    rmSync(offPath);
    mkdirSync(join(offPath, 'inner'), { recursive: true });

    // 用同一套快照/回滚原语（录题回滚走的就是它）验证：目录占位不得被写成空文本
    const snap = {
      taskId: 'PAIRED-TASK-99',
      materialsDir: join(root, 'bank/materials/PAIRED-TASK-99'),
      files: [],
      releases: snapshotFiles([offPath, onPath]),
    };
    const notRestored = rollbackCreate(root, snap);
    expect(notRestored).toEqual([]);
    expect(statSync(offPath).isDirectory()).toBe(true);
    expect(existsSync(join(offPath, 'inner'))).toBe(true);
    // 正常文件仍然逐字节还原
    expect(readFileSync(onPath, 'utf8')).toBe(onBefore);
  });

  it('删除后 case / case-revision / materials 全部清理，闭包自洽', async () => {
    root = seedProject();
    await createTask(root, createBody, { validate: okValidate });
    expect(listDir(join(root, 'case-revisions')).length).toBe(2);

    expect(deleteTask(root, 'PAIRED-TASK-99', 'PAIRED-TASK-99')).toEqual({
      ok: true,
      taskId: 'PAIRED-TASK-99',
    });
    expect(listDir(join(root, 'cases'))).toEqual([]);
    expect(listDir(join(root, 'case-revisions'))).toEqual([]);
    expect(existsSync(join(root, 'bank/materials/PAIRED-TASK-99'))).toBe(false);
    for (const name of ['paired-off-calibrate', 'paired-on-calibrate']) {
      expect(releaseDoc(root, name).case_revisions).toEqual([]);
    }
    expect(closureRelatedIssues(root)).toEqual([]);
  });

  it('dataset-release 引用里缺 case_revision_id 的畸形条目不参与匹配，闭包保持自洽', () => {
    root = seedProject();
    const offPath = join(root, 'dataset-releases', 'paired-off-calibrate.dataset-release.json');
    const refs = [
      { case_id: 'X-1', content_hash: 'h1' },
      { case_id: 'PAIRED-TASK-99', case_revision_id: 'PAIRED-TASK-99.r1.off', content_hash: 'h2' },
      { case_id: 'X-2', case_revision_id: 'X-2.r1.off', content_hash: 'h3' },
    ];
    writeFileSync(
      offPath,
      `${JSON.stringify(
        {
          dataset_release_id: 'paired-off-calibrate',
          name: 'paired-off-calibrate',
          case_revisions: refs,
          closure_hash: closureDigest(refs),
          created_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    // 畸形条目保留原样、正常引用不丢，闭包与引用列表一致（不因畸形数据漂移）
    const doc = releaseDoc(root, 'paired-off-calibrate');
    expect(doc.case_revisions).toHaveLength(3);
    expect(doc.closure_hash).toBe(closureDigest(doc.case_revisions));
  });
});

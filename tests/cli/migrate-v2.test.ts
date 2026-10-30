import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('最小旧输入迁移支持无写入预演、标识映射与重复执行稳定', () => {
  const root = mkdtempSync(join(tmpdir(), 'proctor-migration-'));
  const script = resolve('scripts/migrate-v2.mjs');
  try {
    mkdirSync(join(root, 'legacy/items'), { recursive: true });
    mkdirSync(join(root, 'legacy/papersets'), { recursive: true });
    const id = 'EVAL-B-PAIRED-TASK-22-OFF';
    writeFileSync(
      join(root, 'legacy/items/sample.item.json'),
      JSON.stringify({
        id,
        rev: 1,
        axis: 'B',
        title: '迁移契约样本',
        owner: 'test',
        status: 'active',
        stimulus: { kind: 'task_prompt', text: '离线样本' },
        freeze: { host_profile: 'plain' },
        intent: { effect_pair: 'paired-task-22' },
        expect: { oracles: [] },
      }),
    );
    writeFileSync(
      join(root, 'legacy/papersets/sample.json'),
      JSON.stringify({ name: 'Sample', items: [id] }),
    );
    const run = (dry = false) =>
      spawnSync(process.execPath, [script, '--project', root, ...(dry ? ['--dry-run'] : [])], {
        encoding: 'utf8',
        timeout: 15000,
      });
    const preview = run(true);
    expect(preview.status, preview.stderr).toBe(0);
    expect(existsSync(join(root, 'cases'))).toBe(false);
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const revisionFile = join(root, 'case-revisions/paired-task-22.r1.off.case-revision.json');
    const datasetFile = join(root, 'dataset-releases/sample.dataset-release.json');
    const revision = readFileSync(revisionFile, 'utf8');
    const dataset = readFileSync(datasetFile, 'utf8');
    expect(JSON.parse(revision)).toMatchObject({
      case_id: 'paired-task-22',
      revision_number: 1,
      legacy_item_id: id,
    });
    expect(JSON.parse(dataset).case_revisions[0]).toMatchObject({
      case_revision_id: 'paired-task-22.r1.off',
    });
    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(revisionFile, 'utf8')).toBe(revision);
    expect(readFileSync(datasetFile, 'utf8')).toBe(dataset);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

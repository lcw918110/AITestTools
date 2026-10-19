import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runItemNew } from '../../src/cli/commands/item-new.ts';
import { revisionDigest } from '../../src/exam-engine/digest.ts';
import type { CaseRevision } from '../../src/exam-engine/types.ts';

function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-item-new-'));
  writeFileSync(
    join(root, 'exam.json'),
    `${JSON.stringify({ name: 'seed', asset_protocol: 'cases-v1' }, null, 2)}\n`,
  );
  mkdirSync(join(root, 'cases'), { recursive: true });
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  mkdirSync(join(root, 'dataset-releases'), { recursive: true });
  return root;
}

describe('item new（cases-v1 录题）', () => {
  it('缺 id 或 mode 返回 2', async () => {
    const root = seedProject();
    try {
      expect(await runItemNew({ project: root, json: true })).toBe(2);
      expect(await runItemNew({ project: root, id: 'demo-x', json: true })).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('非法 case_id（大写）返回 2', async () => {
    const root = seedProject();
    try {
      expect(await runItemNew({ project: root, id: 'DEMO-X', mode: 'fold', json: true })).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('非法 mode 返回 2', async () => {
    const root = seedProject();
    try {
      expect(await runItemNew({ project: root, id: 'demo-x', mode: 'axis-b', json: true })).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fold 录题写出 case + case-revision + materials 骨架，content_hash 正确', async () => {
    const root = seedProject();
    try {
      expect(
        await runItemNew({ project: root, id: 'demo-fold-01', mode: 'fold', json: true }),
      ).toBe(0);

      const caseFile = join(root, 'cases', 'demo-fold-01.case.json');
      const revFile = join(root, 'case-revisions', 'demo-fold-01.r1.case-revision.json');
      expect(existsSync(caseFile)).toBe(true);
      expect(existsSync(revFile)).toBe(true);

      const caseDoc = JSON.parse(readFileSync(caseFile, 'utf8')) as Record<string, unknown>;
      expect(caseDoc.case_id).toBe('demo-fold-01');
      expect(caseDoc.head_revision_id).toBe('demo-fold-01.r1');

      const revDoc = JSON.parse(readFileSync(revFile, 'utf8')) as Record<string, unknown>;
      expect(revDoc.case_revision_id).toBe('demo-fold-01.r1');
      expect(revDoc.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(revDoc.execution_profile).toEqual({ mode: 'fold', layer: 'L1', fold_entry: 'TODO' });

      const recomputed = revisionDigest(revDoc as unknown as CaseRevision);
      expect(revDoc.content_hash).toBe(recomputed);

      expect(existsSync(join(root, 'materials', 'demo-fold-01', 'stimulus.ndjson'))).toBe(true);
      expect(existsSync(join(root, 'materials', 'demo-fold-01', 'expected-fold.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('挂载 --dataset 创建 dataset-release 并重算 closure_hash', async () => {
    const root = seedProject();
    try {
      expect(
        await runItemNew({
          project: root,
          id: 'demo-b-01',
          mode: 'hosted',
          dataset: 'smoke-b',
          json: true,
        }),
      ).toBe(0);

      const dsFile = join(root, 'dataset-releases', 'smoke-b.dataset-release.json');
      expect(existsSync(dsFile)).toBe(true);
      const dsDoc = JSON.parse(readFileSync(dsFile, 'utf8')) as {
        case_revisions: Array<{ case_id: string; case_revision_id: string }>;
        closure_hash: string;
      };
      expect(dsDoc.case_revisions).toHaveLength(1);
      expect(dsDoc.case_revisions[0]?.case_revision_id).toBe('demo-b-01.r1');
      expect(dsDoc.closure_hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('非 JSON 模式提示需补全的占位字段（fold/scripted）', async () => {
    const root = seedProject();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await runItemNew({ project: root, id: 'demo-fold-02', mode: 'fold' })).toBe(0);
      const foldLogs = logSpy.mock.calls.map((c) => c.join(' '));
      expect(foldLogs.some((l) => l.includes('execution_profile.fold_entry'))).toBe(true);

      logSpy.mockClear();
      expect(await runItemNew({ project: root, id: 'demo-script-01', mode: 'scripted' })).toBe(0);
      const scriptLogs = logSpy.mock.calls.map((c) => c.join(' '));
      expect(scriptLogs.some((l) => l.includes('execution_profile.contract'))).toBe(true);
      expect(scriptLogs.some((l) => l.includes('execution_profile.script'))).toBe(true);
    } finally {
      logSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

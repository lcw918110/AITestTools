import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateProject } from '../../src/exam-engine/validate.ts';
import { loadProject } from '../../src/exam-engine/project.ts';
import { revisionDigest } from '../../src/exam-engine/digest.ts';

/**
 * `Case.head_revision_id` 陈旧必须被静态门禁拦下。
 *
 * 背景：head 是冗余指针，直改 revision 的脚本（revise-task-92-r5 /
 * flatten-92-r6）都漏更过它。后果不是报错，而是**静默回退**：
 * 控制台展示旧题面、改题从旧修订继承断言、审计看到的是过期内容。
 */
const REAL_PROJECT = resolve(import.meta.dirname, '../../examples/product-eval');

function writeCase(root: string, caseId: string, head: string): void {
  mkdirSync(join(root, 'cases'), { recursive: true });
  writeFileSync(
    join(root, 'cases', `${caseId}.case.json`),
    `${JSON.stringify(
      { case_id: caseId, pair_key: caseId.toUpperCase(), head_revision_id: head },
      null,
      2,
    )}\n`,
  );
}

/** 最小合法考卷库清单（`loadProject` 要求 exam.json）。 */
function writeManifest(root: string): void {
  writeFileSync(
    join(root, 'exam.json'),
    `${JSON.stringify(
      {
        name: 'head-revision-fixture',
        asset_protocol: 'cases-v1',
        engine: { min_version: '0.1.0' },
      },
      null,
      2,
    )}\n`,
  );
}

function writeRevision(root: string, caseId: string, rev: number, side: 'off' | 'on'): void {
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  const revId = `${caseId}.r${rev}.${side}`;
  const draft = {
    case_id: caseId,
    case_revision_id: revId,
    revision_number: rev,
    content_hash: '',
    stimulus: { kind: 'task_prompt', ref: `bank/materials/${caseId}/prompt.txt` },
    preconditions: [],
    steps: [],
    setup_cleanup: [],
    permissions_side_effects: [],
    expect: { oracles: [{ id: 'exit0', type: 'exit_code', equals: 0 }] },
    evidence_requirements: [],
    attribution_focus: 'MODEL_TASK',
    execution: { deadline_ms: 180000 },
  };
  const withHash = { ...draft, content_hash: revisionDigest(draft as never) };
  writeFileSync(
    join(root, 'case-revisions', `${revId}.case-revision.json`),
    `${JSON.stringify(withHash, null, 2)}\n`,
  );
}

function staleIssues(root: string): string[] {
  const report = validateProject(loadProject(root));
  return report.projectIssues
    .filter((i) => i.code === 'CASE_HEAD_REVISION_STALE')
    .map((i) => i.message);
}

describe('validateProject · head_revision_id 陈旧门禁', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('head 落后于最新修订 → CASE_HEAD_REVISION_STALE', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-head-stale-'));
    writeManifest(root);
    writeCase(root, 'paired-task-92', 'paired-task-92.r4.on');
    writeRevision(root, 'paired-task-92', 4, 'on');
    writeRevision(root, 'paired-task-92', 6, 'on');

    const msgs = staleIssues(root);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('paired-task-92.r6.on');
  });

  it('head 指向最新修订 → 无告警', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-head-ok-'));
    writeManifest(root);
    writeCase(root, 'paired-task-92', 'paired-task-92.r6.on');
    writeRevision(root, 'paired-task-92', 4, 'on');
    writeRevision(root, 'paired-task-92', 6, 'on');

    expect(staleIssues(root)).toEqual([]);
  });

  it('同修订号 OFF/ON 并存时 head 取 ON（录题约定：head 指向 ON）', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-head-pair-'));
    writeManifest(root);
    writeCase(root, 'paired-task-157', 'paired-task-157.r1.off');
    writeRevision(root, 'paired-task-157', 1, 'off');
    writeRevision(root, 'paired-task-157', 1, 'on');

    const msgs = staleIssues(root);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('paired-task-157.r1.on');
  });

  it('真实题库（examples/product-eval）无陈旧 head', () => {
    expect(staleIssues(REAL_PROJECT)).toEqual([]);
    // 反向确认门禁真的在读数据：文件确实存在且 head 已是最新。
    const case92 = JSON.parse(
      readFileSync(join(REAL_PROJECT, 'cases', 'paired-task-92.case.json'), 'utf8'),
    ) as { head_revision_id: string };
    expect(case92.head_revision_id).toBe('paired-task-92.r6.on');
  });

  it('head 指向不存在的修订 → CASE_HEAD_REVISION_MISSING（不得静默放过）', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-head-missing-'));
    writeManifest(root);
    writeCase(root, 'paired-task-07', 'paired-task-07.r9.on');
    writeRevision(root, 'paired-task-07', 1, 'off');

    const report = validateProject(loadProject(root));
    const codes = report.projectIssues.map((i) => i.code);
    expect(codes).toContain('CASE_HEAD_REVISION_MISSING');
  });

  it('该题完全没有 revision 时，悬空 head 同样报错（门禁无盲区）', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-head-norev-'));
    writeManifest(root);
    writeCase(root, 'paired-task-08', 'paired-task-08.r1.on');

    const report = validateProject(loadProject(root));
    const codes = report.projectIssues.map((i) => i.code);
    expect(codes).toContain('CASE_HEAD_REVISION_MISSING');
  });
});

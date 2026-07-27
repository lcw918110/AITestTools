#!/usr/bin/env node
/**
 * ST-09 git 事实校正（最小面）：
 * 事件面已 Submitted，但主线已包含任务分支 tip → 校正为 Merged。
 * 本壳用真 git：ff-merge 后检查 merge-base / is-ancestor。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
  return (r.stdout || '').trim();
}

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '{}');
const workspace = input.context?.workspace;

if (typeof workspace !== 'string') {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { kind: 'bad_context', message: 'no workspace' } }),
  );
  process.exit(0);
}

try {
  const repo = join(workspace, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'proctor@test']);
  git(repo, ['config', 'user.name', 'proctor']);
  writeFileSync(join(repo, 'README.md'), '# st-09\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'init']);
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['checkout', '-b', 'task/t1']);
  writeFileSync(join(repo, 'feat.txt'), 'feat\n');
  git(repo, ['add', 'feat.txt']);
  git(repo, ['commit', '-m', 'feat']);
  const tip = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', 'main']);
  // 模拟「事件仍 Submitted、但 git 已进主线」：ff merge
  git(repo, ['merge', '--ff-only', 'task/t1']);
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', tip, 'main'], {
    cwd: repo,
    encoding: 'utf8',
  });
  const reconciledToMerged = ancestor.status === 0;
  process.stdout.write(
    JSON.stringify({
      ok: true,
      result: {
        tipInMain: reconciledToMerged,
        shouldReconcileSubmittedToMerged: reconciledToMerged,
      },
    }),
  );
} catch (e) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { kind: 'git_failed', message: String(e.message || e) } }),
  );
}
process.exit(0);

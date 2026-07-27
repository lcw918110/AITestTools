#!/usr/bin/env node
/**
 * ST-12 清理策略（真 git 最小面）：
 * - merged：删除 worktree 目录与任务分支
 * - cancelled：保留 worktree
 * stdin JSON: { args: { scenario: "merged"|"cancelled" }, context: { workspace } }
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
  return (r.stdout || '').trim();
}

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '{}');
const workspace = input.context?.workspace;
const scenario = String(input.args?.scenario ?? 'merged');

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
  writeFileSync(join(repo, 'README.md'), '# st-12\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'init']);
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['branch', 'task/t1']);
  const wt = join(workspace, 'wt-t1');
  git(repo, ['worktree', 'add', wt, 'task/t1']);
  if (!existsSync(join(wt, 'README.md'))) {
    throw new Error('worktree missing README');
  }

  if (scenario === 'merged') {
    git(repo, ['worktree', 'remove', '--force', wt]);
    git(repo, ['branch', '-D', 'task/t1']);
    const wtGone = !existsSync(wt);
    const branches = git(repo, ['branch', '--list', 'task/t1']);
    const branchGone = branches === '';
    process.stdout.write(
      JSON.stringify({
        ok: true,
        result: { scenario, worktreeRemoved: wtGone, branchRemoved: branchGone },
      }),
    );
  } else if (scenario === 'cancelled') {
    const wtKept = existsSync(wt);
    const branches = git(repo, ['branch', '--list', 'task/t1']);
    const branchKept = branches.includes('task/t1');
    process.stdout.write(
      JSON.stringify({
        ok: true,
        result: { scenario, worktreeKept: wtKept, branchKept },
      }),
    );
  } else {
    process.stdout.write(
      JSON.stringify({ ok: false, error: { kind: 'bad_args', message: `unknown scenario ${scenario}` } }),
    );
  }
} catch (e) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { kind: 'git_failed', message: String(e.message || e) } }),
  );
}
process.exit(0);

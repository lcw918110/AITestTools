#!/usr/bin/env node
/**
 * ST 真 git 调度壳：按 args.tool 分发到具体场景实现。
 * tool: st-12-cleanup | st-09-reconcile | st-16-stale-submit
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
  return (r.stdout || '').trim();
}

function initRepo(workspace, readme = '# st-git\n') {
  const repo = join(workspace, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'proctor@test']);
  git(repo, ['config', 'user.name', 'proctor']);
  writeFileSync(join(repo, 'README.md'), readme);
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'init']);
  git(repo, ['branch', '-M', 'main']);
  return repo;
}

function runSt12(workspace, scenario) {
  const repo = initRepo(workspace, '# st-12\n');
  git(repo, ['branch', 'task/t1']);
  const wt = join(workspace, 'wt-t1');
  git(repo, ['worktree', 'add', wt, 'task/t1']);
  if (!existsSync(join(wt, 'README.md'))) throw new Error('worktree missing README');

  if (scenario === 'merged') {
    git(repo, ['worktree', 'remove', '--force', wt]);
    git(repo, ['branch', '-D', 'task/t1']);
    return {
      scenario,
      worktreeRemoved: !existsSync(wt),
      branchRemoved: git(repo, ['branch', '--list', 'task/t1']) === '',
    };
  }
  if (scenario === 'cancelled') {
    return {
      scenario,
      worktreeKept: existsSync(wt),
      branchKept: git(repo, ['branch', '--list', 'task/t1']).includes('task/t1'),
    };
  }
  throw new Error(`unknown scenario ${scenario}`);
}

function runSt09(workspace) {
  const repo = initRepo(workspace, '# st-09\n');
  git(repo, ['checkout', '-b', 'task/t1']);
  writeFileSync(join(repo, 'feat.txt'), 'feat\n');
  git(repo, ['add', 'feat.txt']);
  git(repo, ['commit', '-m', 'feat']);
  const tip = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', 'main']);
  git(repo, ['merge', '--ff-only', 'task/t1']);
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', tip, 'main'], {
    cwd: repo,
    encoding: 'utf8',
  });
  const tipInMain = ancestor.status === 0;
  return { tipInMain, shouldReconcileSubmittedToMerged: tipInMain };
}

function runSt16(workspace, mode) {
  const repo = initRepo(workspace, '# st-16\n');
  git(repo, ['checkout', '-b', 'task/t1']);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-m', 'a']);
  const tip = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', 'main']);
  git(repo, ['merge', '--ff-only', 'task/t1']);
  const mainSha = git(repo, ['rev-parse', 'main']);

  if (mode === 'stale_sha') {
    const stale = git(repo, ['rev-parse', 'main^']);
    const isAncestor = spawnSync('git', ['merge-base', '--is-ancestor', stale, 'main'], {
      cwd: repo,
      encoding: 'utf8',
    });
    const rejectStale = stale !== mainSha && isAncestor.status === 0;
    return { mode, rejectStaleCommit: rejectStale };
  }
  if (mode === 'already_merged') {
    const already = spawnSync('git', ['merge-base', '--is-ancestor', tip, 'main'], {
      cwd: repo,
      encoding: 'utf8',
    });
    return {
      mode,
      rejectNotSubmittable: already.status === 0,
    };
  }
  throw new Error(`unknown mode ${mode}`);
}

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '{}');
const workspace = input.context?.workspace;
const tool = String(input.args?.tool ?? '');

if (typeof workspace !== 'string') {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { kind: 'bad_context', message: 'no workspace' } }),
  );
  process.exit(0);
}

function runSt06(workspace) {
  const repo = initRepo(workspace, '# st-06\n');
  // 主线再前进一笔，制造与 task 分叉
  writeFileSync(join(repo, 'main-only.txt'), 'm\n');
  git(repo, ['add', 'main-only.txt']);
  git(repo, ['commit', '-m', 'main-ahead']);
  git(repo, ['checkout', '-b', 'task/t1', 'main~1']);
  writeFileSync(join(repo, 'feat.txt'), 'f\n');
  git(repo, ['add', 'feat.txt']);
  git(repo, ['commit', '-m', 'feat']);
  git(repo, ['checkout', 'main']);
  const ff = spawnSync('git', ['merge', '--ff-only', 'task/t1'], { cwd: repo, encoding: 'utf8' });
  const rebaseNeeded = ff.status !== 0;
  // harness 代跑 rebase
  git(repo, ['checkout', 'task/t1']);
  git(repo, ['rebase', 'main']);
  git(repo, ['checkout', 'main']);
  git(repo, ['merge', '--ff-only', 'task/t1']);
  const merged = spawnSync('git', ['merge-base', '--is-ancestor', 'task/t1', 'main'], {
    cwd: repo,
    encoding: 'utf8',
  }).status === 0;
  return { rebaseNeeded, rebasedAndMerged: rebaseNeeded && merged };
}

try {
  let result;
  if (tool === 'st-12-cleanup') {
    result = runSt12(workspace, String(input.args?.scenario ?? 'merged'));
  } else if (tool === 'st-09-reconcile') {
    result = runSt09(workspace);
  } else if (tool === 'st-16-stale-submit') {
    result = runSt16(workspace, String(input.args?.mode ?? 'stale_sha'));
  } else if (tool === 'st-06-rebase') {
    result = runSt06(workspace);
  } else {
    process.stdout.write(
      JSON.stringify({ ok: false, error: { kind: 'bad_args', message: `unknown tool ${tool}` } }),
    );
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (e) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { kind: 'git_failed', message: String(e.message || e) } }),
  );
}
process.exit(0);

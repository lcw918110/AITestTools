#!/usr/bin/env node
/**
 * 真 Coordinator HTTP 最小 e2e（C 轴壳 · stdin JSON 协议）。
 *
 * 已知失效：万象术 0.8+ 已移除 PluginWanxiangzhen。
 * 本壳保留只为旧题引用；npm run smoke:coordinator 已改为 known-stale 退出 2。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '{}');
const workspace = input.context?.workspace;
const args = input.args ?? {};

function reply(obj) {
  process.stdout.write(JSON.stringify(obj));
}

if (typeof workspace !== 'string') {
  reply({ ok: false, error: { kind: 'bad_context', message: 'no workspace' } });
  process.exit(0);
}

const sutRoot = process.env.SUT_ROOT;
if (!sutRoot) {
  reply({ ok: false, error: { kind: 'env', message: 'SUT_ROOT 未设置' } });
  process.exit(0);
}

const pluginJs = join(sutRoot, 'build/src/Hosts/OpenCode/PluginWanxiangzhen.js');
if (!existsSync(pluginJs)) {
  reply({ ok: false, error: { kind: 'missing_build', message: pluginJs } });
  process.exit(0);
}

function git(cwd, argv) {
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${argv.join(' ')}: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
}

const metaDir = mkdtempSync(join(tmpdir(), 'proctor-coord-meta-'));
try {
  git(workspace, ['init']);
  git(workspace, ['config', 'user.email', 'proctor@test']);
  git(workspace, ['config', 'user.name', 'proctor']);
  writeFileSync(join(workspace, 'README.md'), '# coordinator-http\n');
  git(workspace, ['add', 'README.md']);
  git(workspace, ['commit', '-m', 'init']);

  process.env.WANXIANGZHEN_E2E = '1';
  process.env.WANXIANGZHEN_E2E_META_DIR = metaDir;

  const client = {
    session: {
      messages: async () => ({ data: [] }),
      create: async () => ({ data: { id: 'mock-child' } }),
      prompt: async () => undefined,
      abort: async () => ({}),
    },
  };
  const ctx = {
    directory: workspace,
    workdir: workspace,
    client,
    options: { e2e: true },
  };

  const mod = await import(pathToFileURL(pluginJs).href);
  const factory = typeof mod.plugin === 'function' ? mod.plugin : null;
  if (!factory) {
    reply({ ok: false, error: { kind: 'bad_plugin', message: '无 plugin()' } });
    process.exit(0);
  }

  const hooks = await Promise.resolve(factory(ctx));
  const metaPath = join(metaDir, '.wanxiangzhen-e2e-meta.json');
  if (!existsSync(metaPath)) {
    reply({ ok: false, error: { kind: 'no_meta', message: metaPath } });
    process.exit(0);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const taskId = String(args.taskId ?? 'proctor-coord-task');
  const pid = Number(args.pid ?? 4242);

  const bad = await fetch(`${meta.coordinatorUrl}/task/${taskId}/register`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer wrong-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ pid: 1 }),
  });
  const badBody = await bad.json();

  const okResp = await fetch(`${meta.coordinatorUrl}/task/${taskId}/register`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${meta.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ pid }),
  });
  const okBody = await okResp.json();

  if (typeof hooks?.dispose === 'function') {
    await Promise.resolve(hooks.dispose());
  }

  reply({
    ok: true,
    result: {
      unauthorized: { status: bad.status, result: badBody.result },
      authorized: { status: okResp.status, result: okBody.result },
      ok:
        bad.status === 401 &&
        badBody.result === 'unauthorized' &&
        okResp.status === 200 &&
        okBody.result === 'registered',
    },
  });
} catch (e) {
  reply({
    ok: false,
    error: { kind: 'coord_failed', message: String(e.message || e) },
  });
} finally {
  try {
    rmSync(metaDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
process.exit(0);

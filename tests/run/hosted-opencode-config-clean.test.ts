import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseRevision, EnvironmentProfile } from '../../src/exam-engine/types.ts';

const hostedIO = vi.hoisted(() => ({
  status: 0 as number | null,
  mutate: undefined as ((cwd: string) => void) | undefined,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    execFileSync: (...args: readonly unknown[]) => unknown;
    spawnSync: (...args: readonly unknown[]) => unknown;
    spawn: (...args: readonly unknown[]) => unknown;
  };
  const fakeSpawn = (command: string, args?: readonly string[], options?: object) => {
    const bin = String(command);
    const head = args?.[0];
    const cwd =
      options !== undefined &&
      typeof options === 'object' &&
      'cwd' in options &&
      typeof (options as { cwd?: string }).cwd === 'string'
        ? (options as { cwd: string }).cwd
        : '';
    const isHost = bin === 'opencode' || bin.endsWith('/opencode') || args?.includes('opencode');
    const isRun = head === 'run' || args?.includes('run');
    const stdout = isHost && isRun ? 'OK\n' : '';
    const status = isHost && isRun ? hostedIO.status : 0;
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const child = {
      pid: 1,
      stdout: {
        on: (ev: string, cb: (...args: unknown[]) => void) => {
          (listeners[`stdout:${ev}`] ??= []).push(cb);
        },
      },
      stderr: {
        on: (ev: string, cb: (...args: unknown[]) => void) => {
          (listeners[`stderr:${ev}`] ??= []).push(cb);
        },
      },
      on: (ev: string, cb: (...args: unknown[]) => void) => {
        (listeners[ev] ??= []).push(cb);
      },
      kill: () => true,
    };
    queueMicrotask(() => {
      if (isHost && isRun && hostedIO.mutate !== undefined && cwd.length > 0) hostedIO.mutate(cwd);
      if (stdout) for (const cb of listeners['stdout:data'] ?? []) cb(Buffer.from(stdout));
      for (const cb of listeners['close'] ?? []) cb(status, null);
    });
    return child;
  };
  return {
    ...actual,
    // 生产代码里用 execFileSync 跑 git；这里让它走真实实现，工作区才可验证。
    execFileSync: actual.execFileSync,
    spawnSync: vi.fn((command: string, args?: readonly string[], _options?: object) => {
      const bin = String(command);
      const head = args?.[0];
      if (bin === 'opencode' || bin.endsWith('/opencode') || args?.includes('opencode')) {
        if (head === '--version' || args?.includes('--version')) {
          return {
            status: 0,
            stdout: 'opencode-test 0.0.0\n',
            stderr: '',
            pid: 1,
            output: [],
            signal: null,
          };
        }
      }
      return actual.spawnSync(command, args as string[], _options);
    }),
    spawn: vi.fn(fakeSpawn),
  };
});

vi.mock('../../src/security/isolation-backend.ts', () => ({
  evaluateIsolationGate: vi.fn(async () => ({ allowed: true, reason: '测试桩：隔离探测通过' })),
}));

vi.mock('../../src/security/sandbox-runtime.ts', async () => {
  const actual = await vi.importActual('../../src/security/sandbox-runtime.ts');
  return {
    ...actual,
    wrapHostCommand: async (input: { bin: string; args: string[] }) => ({
      argv: [input.bin, ...input.args],
      env: {},
    }),
  };
});

const { HostedAdapter } = await import('../../src/run/hosted-runner.ts');
const { RunOrchestrator } = await import('../../src/run/run-orchestrator.ts');

class ControlledHostedAdapter extends HostedAdapter {
  override async preflight() {
    return { ok: true };
  }
}

const projectRoot = resolve('examples/product-eval');

/** 最近一次 prepareOnly 用的 adapter，供断言读取隔离 HOME 等实例状态。 */
let lastAdapter: ControlledHostedAdapter | undefined;

function loadRevision(name: string): CaseRevision {
  return JSON.parse(
    readFileSync(join(projectRoot, 'case-revisions', name), 'utf8'),
  ) as CaseRevision;
}

/**
 * 模拟 opencode 0.9+ 的真实行为：读到缺 `$schema` 的 opencode.json 就补上并落盘。
 *
 * 实测（opencode 1.19.4）差异只有这一行：
 *   +  "$schema": "https://opencode.ai/config.json",
 * 该写入发生在 reading config 阶段、任何工具调用之前，因此必然早于 commission。
 */
function emulateOpencodeSchemaRewrite(cwd: string): void {
  const path = join(cwd, 'opencode.json');
  const raw = readFileSync(path, 'utf8');
  const cfg = JSON.parse(raw) as Record<string, unknown>;
  if ('$schema' in cfg) return;
  const rewritten = { $schema: 'https://opencode.ai/config.json', ...cfg };
  writeFileSync(path, `${JSON.stringify(rewritten, null, 2)}\n`);
}

/** 用真实 git 读工作区状态，避免只断言自己写下的字符串。 */
function porcelain(workDir: string): string {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd: workDir,
    encoding: 'utf8',
  }).trim();
}

function findWorkDir(mutateCwd: string): string {
  // prepare 阶段把 workDir 写进 artifactDir/hosted-run.json 之前的临时目录，
  // 这里用 mutate 回调拿到的 cwd 即 workDir 本身。
  return mutateCwd;
}

async function prepareOnly(
  revision: CaseRevision,
  environment: EnvironmentProfile,
  artifactDir: string,
): Promise<{ workDir: string; dirtyAfterPrepare: string }> {
  const adapter = new ControlledHostedAdapter();
  lastAdapter = adapter;
  const orch = new RunOrchestrator();
  orch.beginRun({});
  orch.transitionRun('preflight');
  orch.transitionRun('running');
  const ctx = {
    revision,
    environment,
    projectRoot,
    models: [],
    artifactDir,
  };
  await adapter.prepare(ctx as never, { cases: [], revisions: [] } as never);
  const workDir = (adapter as unknown as { workDir: string }).workDir;
  const dirtyAfterPrepare = porcelain(workDir);
  return { workDir, dirtyAfterPrepare };
}

describe('hosted 工作区对齐 opencode 配置读写（RejectedDirty 前置条件）', () => {
  const prevPlugin = process.env.PROCTOR_HOSTED_PLUGIN;

  beforeEach(() => {
    hostedIO.status = 0;
    hostedIO.mutate = undefined;
    delete process.env.PROCTOR_HOSTED_PLUGIN;
  });

  afterEach(() => {
    if (prevPlugin === undefined) delete process.env.PROCTOR_HOSTED_PLUGIN;
    else process.env.PROCTOR_HOSTED_PLUGIN = prevPlugin;
  });

  const environment: EnvironmentProfile = {
    environment_profile_id: 'hosted-config-clean-test',
    name: 'hosted-config-clean-test',
    lifecycle: 'active',
    recipe: {
      kind: 'hosted',
      host_command: 'opencode',
      host_model: 'test/model',
      isolation_profile: 'isolated',
    },
  };

  it('播种后 opencode.json 自带 $schema，opencode 不再改写它', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-cfg-'));
    const revision = loadRevision('paired-task-157.r1.off.case-revision.json');
    const { workDir, dirtyAfterPrepare } = await prepareOnly(revision, environment, artifactDir);

    // 1) 播种后必须干净（既有不变量）
    expect(dirtyAfterPrepare).toBe('');

    // 2) 配置必须已含 $schema，否则 opencode 启动就会补写
    const cfg = JSON.parse(readFileSync(join(workDir, 'opencode.json'), 'utf8')) as {
      $schema?: string;
    };
    expect(cfg.$schema).toBe('https://opencode.ai/config.json');

    // 3) 模拟 opencode 启动后：工作区仍然干净
    emulateOpencodeSchemaRewrite(workDir);
    expect(porcelain(findWorkDir(workDir))).toBe('');
  });

  it('回归探针：若配置缺 $schema，opencode 改写会让工作区变脏（反证修复有效）', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-cfg-red-'));
    const revision = loadRevision('paired-task-157.r1.off.case-revision.json');
    const { workDir } = await prepareOnly(revision, environment, artifactDir);

    // 人为退回修复前形状：删掉 $schema 并重新提交，模拟「旧播种结果」
    const path = join(workDir, 'opencode.json');
    const cfg = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    delete cfg.$schema;
    writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
    execFileSync('git', ['add', '-A'], { cwd: workDir });
    execFileSync(
      'git',
      ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '--no-verify', '-m', 'probe'],
      { cwd: workDir },
    );
    expect(porcelain(workDir)).toBe('');

    // opencode 补 $schema → 变脏 → 正是 RejectedDirty 的触发条件
    emulateOpencodeSchemaRewrite(workDir);
    expect(porcelain(workDir)).toContain('opencode.json');
  });
});

describe('hosted 隔离 HOME 预装插件依赖（防插件加载失败空转到 deadline）', () => {
  const environment: EnvironmentProfile = {
    environment_profile_id: 'hosted-plugin-deps-test',
    name: 'hosted-plugin-deps-test',
    lifecycle: 'active',
    recipe: {
      kind: 'hosted',
      host_command: 'opencode',
      host_model: 'test/model',
      isolation_profile: 'isolated',
    },
  };

  it('插件目录里有 @opencode-ai/plugin 时，隔离 HOME 的 node_modules 必须预装它', async () => {
    // 造一个假的插件包：<tmp>/node_modules/@opencode-ai/plugin + <tmp>/dist/Plugin.js
    const pkgRoot = mkdtempSync(join(tmpdir(), 'proctor-plugin-pkg-'));
    const depDir = join(pkgRoot, 'node_modules', '@opencode-ai', 'plugin');
    mkdirSync(depDir, { recursive: true });
    writeFileSync(join(depDir, 'package.json'), '{"name":"@opencode-ai/plugin"}\n');
    writeFileSync(join(depDir, 'index.js'), 'export const marker = "preinstalled";\n');
    const pluginFile = join(pkgRoot, 'dist', 'Plugin.js');
    mkdirSync(dirname(pluginFile), { recursive: true });
    writeFileSync(pluginFile, 'export default {};\n');

    const prevPlugin = process.env.PROCTOR_HOSTED_PLUGIN;
    process.env.PROCTOR_HOSTED_PLUGIN = pluginFile;
    try {
      const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-plugin-deps-'));
      const revision = loadRevision('paired-task-157.r1.off.case-revision.json');
      const { workDir } = await prepareOnly(revision, environment, artifactDir);
      // 隔离 HOME 由 prepare 挂在 adapter 实例上（hosted-run.json 要到 run 阶段才写）
      const home = (lastAdapter as unknown as { isolatedHome?: string }).isolatedHome;
      expect(home).toBeTruthy();
      const installed = join(
        home as string,
        '.config',
        'opencode',
        'node_modules',
        '@opencode-ai',
        'plugin',
      );
      expect(existsSync(installed)).toBe(true);
      expect(readFileSync(join(installed, 'index.js'), 'utf8')).toContain('preinstalled');
      expect(workDir.length).toBeGreaterThan(0);
    } finally {
      if (prevPlugin === undefined) delete process.env.PROCTOR_HOSTED_PLUGIN;
      else process.env.PROCTOR_HOSTED_PLUGIN = prevPlugin;
    }
  });
});

describe('hosted 播种提交失败必须阻断 prepare（防工装失败记成模型失败）', () => {
  const environment: EnvironmentProfile = {
    environment_profile_id: 'hosted-commit-fail-test',
    name: 'hosted-commit-fail-test',
    lifecycle: 'active',
    recipe: {
      kind: 'hosted',
      host_command: 'opencode',
      host_model: 'test/model',
      isolation_profile: 'isolated',
    },
  };

  it('git commit 失败时抛 prepare_failed/HARNESS，而不是继续跑成 MODEL_TASK', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'proctor-commit-fail-'));
    // 用一个不存在的 GIT_INDEX_FILE 让 `git add` 直接失败，
    // 模拟提交前置条件不成立（磁盘只读、index 损坏等真实故障）。
    const prevIndex = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = join(artifactDir, 'no-such-dir', 'index');
    try {
      const adapter = new ControlledHostedAdapter();
      const orch = new RunOrchestrator();
      orch.beginRun({});
      orch.transitionRun('preflight');
      orch.transitionRun('running');
      const revision = loadRevision('paired-task-157.r1.off.case-revision.json');
      await expect(
        adapter.prepare(
          { revision, environment, projectRoot, models: [], artifactDir } as never,
          { cases: [], revisions: [] } as never,
        ),
      ).rejects.toMatchObject({ kind: 'prepare_failed', attribution: 'HARNESS' });
    } finally {
      if (prevIndex === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = prevIndex;
    }
  });
});

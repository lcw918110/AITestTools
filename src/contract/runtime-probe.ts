import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { ProbeCaseResult } from './probe.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 在临时工作区挂载 probe 插件，真跑一轮 opencode run，核对 hook 是否触发。
 * 拍板 D2：插件复制进工作区用相对路径（绝对路径偶发不触发）；不改用户全局 config。
 */
export function probeHostRuntimeHooks(opts: { opencodeBin?: string; timeoutMs?: number }): {
  cases: ProbeCaseResult[];
  logPath?: string;
  workDir?: string;
  detail: string;
} {
  const bin = opts.opencodeBin ?? 'opencode';
  // 本机实测：os.tmpdir()(/var/folders/...) 下偶发写不出 probe 日志；固定用 /tmp
  const workDir = mkdtempSync(join('/tmp', 'proctor-hook-probe-'));
  const logPath = join(workDir, 'hooks.ndjson');
  const pluginSrc = join(here, 'verify', 'opencode-hook-probe.mjs');
  const pluginLocal = join(workDir, 'probe.mjs');
  copyFileSync(pluginSrc, pluginLocal);
  const model = process.env.PROCTOR_PROBE_MODEL ?? 'meituan/LongCat-2.0';

  writeFileSync(
    join(workDir, 'opencode.json'),
    `${JSON.stringify({ plugin: ['./probe.mjs'], model }, null, 2)}\n`,
  );
  writeFileSync(
    join(workDir, 'package.json'),
    `${JSON.stringify({ name: 'proctor-hook-probe', type: 'module' })}\n`,
  );
  writeFileSync(join(workDir, 'README.md'), '# proctor hook probe\n');

  const run = spawnSync(
    bin,
    [
      'run',
      '--print-logs',
      '-m',
      model,
      'Reply with exactly ok. If you can use tools, read README.md once then answer ok.',
    ],
    {
      cwd: workDir,
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 120_000,
      env: {
        ...process.env,
        PWD: workDir,
        PROCTOR_PROBE_LOG: logPath,
        CI: '1',
      },
      maxBuffer: 8 * 1024 * 1024,
    },
  );

  writeFileSync(
    join(workDir, 'run-meta.json'),
    `${JSON.stringify(
      {
        status: run.status,
        stdout_head: (run.stdout || '').slice(0, 2000),
        stderr_head: (run.stderr || '').slice(0, 4000),
      },
      null,
      2,
    )}\n`,
  );

  const cases: ProbeCaseResult[] = [];
  if (!existsSync(logPath)) {
    cases.push({
      id: 'host.runtime.probe-log',
      pass: false,
      detail: `未产生 probe 日志（status=${String(run.status)} stderr=${(run.stderr || '').slice(0, 400)}）`,
    });
    return {
      cases,
      logPath,
      workDir,
      detail: 'probe plugin 可能未加载，或 opencode 在加载前失败',
    };
  }

  const rawLogLines = readFileSync(logPath, 'utf8').split(/\n/);
  const lines: Array<{ hook: string }> = [];
  for (let i = 0; i < rawLogLines.length; i++) {
    const line = rawLogLines[i];
    if (line === undefined || line === '') continue;
    try {
      lines.push(JSON.parse(line) as { hook: string });
    } catch (e) {
      cases.push({
        id: 'host.runtime.probe-log',
        pass: false,
        detail: `probe 日志第 ${i + 1} 行 NDJSON 解析失败：${(e as Error).message}`,
      });
      return {
        cases,
        logPath,
        workDir,
        detail: 'probe 日志含非法 NDJSON 行，无法核对 hook',
      };
    }
  }
  const seen = new Set(lines.map((l) => l.hook));

  cases.push({
    id: 'host.runtime.probe-log',
    pass: true,
    detail: `${lines.length} events logged; process_status=${String(run.status)}`,
  });

  for (const h of ['chat.message', 'event']) {
    cases.push({
      id: `host.runtime.has:${h}`,
      pass: seen.has(h),
      detail: seen.has(h) ? `triggered (${lines.filter((l) => l.hook === h).length}x)` : '未触发',
    });
  }

  for (const h of ['tool.execute.before', 'tool.execute.after']) {
    cases.push({
      id: `host.runtime.optional:${h}`,
      pass: true,
      detail: seen.has(h)
        ? `triggered (${lines.filter((l) => l.hook === h).length}x)`
        : '本轮未触发（模型未调工具；不判红）',
    });
  }

  return {
    cases,
    logPath,
    workDir,
    detail: `hooks=${[...seen].join(',') || '(none)'} status=${String(run.status)}`,
  };
}

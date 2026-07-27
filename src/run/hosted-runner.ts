import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { diagnoseHostedFailure } from '../attribution/hosted-tree.ts';
import { collectNdjsonKinds, missingProtocolProbes } from '../attribution/ndjson-probes.ts';
import { loadJournal, sealJournalToManifestFields } from '../drivers/cassette/journal.ts';
import type { Attribution, ItemDoc, RoomDoc } from '../exam-engine/types.ts';
import type { AxisItemResult } from './l2-runner.ts';

/**
 * B-hosted：真拉起本机 opencode。
 * - 拍板 D5：缺密钥 / 跑挂 → FAIL + 如实归因
 * - 若 room 声明 plugin / durable_log_glob：隔离工作区挂插件并采集 .wanxiangshu.ndjson
 */
export async function runHostedSmokeItem(opts: {
  item: ItemDoc;
  room: RoomDoc;
  projectRoot: string;
  artifactDir?: string;
}): Promise<AxisItemResult> {
  const focus = opts.item.intent.attribution_focus;
  const hostBin = typeof opts.room.host?.command === 'string' ? opts.room.host.command : 'opencode';
  const protocolProbes = Array.isArray(opts.item.intent.protocol_probes)
    ? opts.item.intent.protocol_probes.map(String)
    : [];

  const version = spawnSync(hostBin, ['--version'], { encoding: 'utf8', timeout: 15_000 });
  const log = {
    bin: hostBin,
    version_status: version.status,
    version_stdout: (version.stdout || '').trim(),
    version_stderr: (version.stderr || '').trim(),
  };

  if (opts.artifactDir !== undefined) {
    mkdirSync(opts.artifactDir, { recursive: true });
    writeFileSync(join(opts.artifactDir, 'hosted-log.json'), `${JSON.stringify(log, null, 2)}\n`);
  }

  if (version.status !== 0) {
    const d = diagnoseHostedFailure({ harnessFault: true });
    return fail(opts.item, d.attribution, `无法执行 ${hostBin} --version`, opts.artifactDir);
  }

  const hostModel =
    process.env.PROCTOR_HOSTED_MODEL ??
    (typeof opts.room.host?.model === 'string' ? opts.room.host.model : undefined);
  const hostAgent =
    process.env.PROCTOR_HOSTED_AGENT ??
    (typeof opts.room.host?.agent === 'string' ? opts.room.host.agent : undefined);

  const pluginPath = resolvePluginPath(opts.room, opts.projectRoot);
  const recordId = process.env.PROCTOR_RECORD_CASSETTE?.trim();
  const recorderPlugin =
    recordId && recordId.length > 0
      ? resolve(fileURLToPath(new URL('../drivers/cassette/recorder-plugin.mjs', import.meta.url)))
      : undefined;

  const wantDurable =
    Boolean(opts.room.durable_log_glob) ||
    opts.item.execution.requires_durable_log === true ||
    pluginPath !== undefined ||
    recorderPlugin !== undefined;

  const workDir = wantDurable ? mkdtempSync(join(tmpdir(), 'proctor-hosted-')) : opts.projectRoot;

  const cassetteOutDir =
    recordId && recordId.length > 0 ? join(opts.projectRoot, 'cassettes', recordId) : undefined;
  const journalPath =
    cassetteOutDir !== undefined ? join(cassetteOutDir, 'journal.ndjson') : undefined;

  if (wantDurable) {
    writeFileSync(join(workDir, 'README.md'), '# proctor hosted workspace\n');
    const plugins: string[] = [];
    if (pluginPath !== undefined) plugins.push(pluginPath);
    if (recorderPlugin !== undefined) plugins.push(recorderPlugin);
    const cfg: Record<string, unknown> = {
      permission: { '*': 'allow' },
    };
    if (plugins.length > 0) cfg.plugin = plugins;
    writeFileSync(join(workDir, 'opencode.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  }

  if (cassetteOutDir !== undefined) {
    mkdirSync(cassetteOutDir, { recursive: true });
    // 清空旧 journal，避免跨次污染
    writeFileSync(join(cassetteOutDir, 'journal.ndjson'), '');
  }

  const prompt =
    typeof opts.item.stimulus.notes === 'string' && opts.item.stimulus.notes.length > 0
      ? opts.item.stimulus.notes
      : 'proctor hosted smoke: reply with exactly ok. Prefer not using tools.';

  const runArgs = ['run'];
  if (wantDurable) runArgs.push('--dir', workDir);
  // 禁止 --pure：会禁用外部 plugin，导致无 .wanxiangshu.ndjson
  if (hostModel !== undefined && hostModel.length > 0) runArgs.push('-m', hostModel);
  if (hostAgent !== undefined && hostAgent.length > 0) runArgs.push('--agent', hostAgent);
  runArgs.push(prompt);

  const deadline = opts.item.execution.deadline_ms || 180_000;
  const runEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CI: '1',
    WANXIANGSHU_TEST: 'true',
  };
  if (journalPath !== undefined && recordId) {
    runEnv.PROCTOR_CASSETTE_JOURNAL = journalPath;
    runEnv.PROCTOR_CASSETTE_ID = recordId;
  }
  const run = spawnSync(hostBin, runArgs, {
    encoding: 'utf8',
    timeout: deadline,
    env: runEnv,
    cwd: workDir,
  });

  const ndjsonPath = join(workDir, '.wanxiangshu.ndjson');
  // session.idle → assistant_completed 常为异步落盘；run 退出后短等再读
  let ndjsonText = existsSync(ndjsonPath) ? readFileSync(ndjsonPath, 'utf8') : '';
  let kinds = collectNdjsonKinds(ndjsonText);
  if (protocolProbes.length > 0 && missingProtocolProbes(kinds, protocolProbes).length > 0) {
    const waited = awaitWaitForNdjsonProbes(ndjsonPath, protocolProbes, 5_000);
    ndjsonText = waited.text;
    kinds = waited.kinds;
  }
  const ndjsonExists = existsSync(ndjsonPath) || ndjsonText.length > 0;

  const runLog = {
    status: run.status,
    args: runArgs,
    model: hostModel ?? null,
    agent: hostAgent ?? null,
    plugin: pluginPath ?? null,
    work_dir: workDir,
    ndjson_exists: ndjsonExists,
    ndjson_bytes: ndjsonText.length,
    ndjson_kinds: [...kinds].sort(),
    stdout: (run.stdout || '').slice(0, 4000),
    stderr: (run.stderr || '').slice(0, 4000),
  };
  if (opts.artifactDir !== undefined) {
    writeFileSync(
      join(opts.artifactDir, 'hosted-run.json'),
      `${JSON.stringify(runLog, null, 2)}\n`,
    );
    if (ndjsonExists) {
      writeFileSync(join(opts.artifactDir, 'wanxiangshu.ndjson'), ndjsonText);
    }
  }

  const out = `${runLog.stdout}\n${runLog.stderr}`;
  const outLower = out.toLowerCase();
  const authMiss =
    /api.?key|unauthorized|auth|provider|credential|no model|login|not configured|额度不足/i.test(
      outLower,
    );

  const sealNote = trySealRecordedCassette({
    recordId,
    cassetteOutDir,
    journalPath,
    projectRoot: opts.projectRoot,
    ...(opts.artifactDir !== undefined ? { artifactDir: opts.artifactDir } : {}),
    hostVersion: log.version_stdout,
  });

  if (run.status !== 0) {
    const d = diagnoseHostedFailure({
      harnessFault: !authMiss,
      contextProbeMiss: authMiss,
      taskAssertFail: !authMiss,
    });
    const attr = d.attribution === 'HARNESS' ? d.attribution : (focus ?? d.attribution);
    return fail(
      opts.item,
      attr,
      `hosted run 失败（status=${String(run.status)}）归因 ${attr}：${(run.stderr || run.stdout || '').slice(0, 240)}${sealNote}`,
      opts.artifactDir,
      d.matched_rule,
    );
  }

  if (wantDurable && pluginPath !== undefined && !ndjsonExists) {
    const d = diagnoseHostedFailure({ harnessFault: true });
    return fail(
      opts.item,
      d.attribution,
      `已挂万象术 plugin 但工作区未产生 .wanxiangshu.ndjson（插件可能未加载）${sealNote}`,
      opts.artifactDir,
      d.matched_rule,
    );
  }

  if (protocolProbes.length > 0) {
    const missing = missingProtocolProbes(kinds, protocolProbes);
    if (missing.length > 0) {
      const d = diagnoseHostedFailure({ protocolProbeMiss: true });
      return fail(
        opts.item,
        focus ?? d.attribution,
        `协议探针缺失：${missing.join(', ')}（已见 kinds=${[...kinds].sort().join('|') || '∅'}）${sealNote}`,
        opts.artifactDir,
        d.matched_rule,
      );
    }
  }

  const okish = /\bok\b/i.test(out);
  if (!okish) {
    const d = diagnoseHostedFailure({ taskAssertFail: true });
    return fail(
      opts.item,
      focus ?? d.attribution,
      `hosted run 退出码 0 但输出未含约定 ok${sealNote}`,
      opts.artifactDir,
      d.matched_rule,
    );
  }

  return {
    item_id: opts.item.id,
    item_rev: opts.item.rev,
    pass: true,
    oracle_failures: [],
    metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
    ...(opts.artifactDir !== undefined ? { artifact_dir: opts.artifactDir } : {}),
  };
}

/** 有 journal 则封装 cassette；失败不抛，返回附注。 */
function trySealRecordedCassette(opts: {
  recordId: string | undefined;
  cassetteOutDir: string | undefined;
  journalPath: string | undefined;
  projectRoot: string;
  artifactDir?: string | undefined;
  hostVersion: string;
}): string {
  if (!opts.recordId || !opts.cassetteOutDir || !opts.journalPath) return '';
  try {
    const rel = `cassettes/${opts.recordId}/journal.ndjson`;
    if (
      !existsSync(opts.journalPath) ||
      readFileSync(opts.journalPath, 'utf8').trim().length === 0
    ) {
      return '';
    }
    const sealed = sealJournalToManifestFields(loadJournal(opts.projectRoot, rel));
    const manifest = {
      id: opts.recordId,
      rev: 1,
      replay_mode: 'journal',
      host: 'opencode',
      host_version: opts.hostVersion || 'unknown',
      contract: 'opencode-v1.18',
      journal_ref: rel,
      expected_hooks: sealed.expected_hooks,
      expected_events: sealed.expected_events,
      note: 'hosted run + recorder-plugin 自动封装',
    };
    writeFileSync(
      join(opts.cassetteOutDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    if (opts.artifactDir !== undefined) {
      writeFileSync(
        join(opts.artifactDir, 'cassette-sealed.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }
    return `；已封装 cassette ${opts.recordId}（hooks=${sealed.expected_hooks.length}）`;
  } catch (e) {
    return `；cassette 封装失败：${(e as Error).message}`;
  }
}

function resolvePluginPath(room: RoomDoc, projectRoot: string): string | undefined {
  const fromEnv = process.env.PROCTOR_HOSTED_PLUGIN;
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);

  const fromRoom = room.host?.plugin;
  if (typeof fromRoom === 'string' && fromRoom.length > 0) {
    if (fromRoom.startsWith('/')) return fromRoom;
    const sut = process.env.SUT_ROOT;
    const base = sut ?? projectRoot;
    const abs = resolve(base, fromRoom);
    // 旧布局 Opencode/ 若与 Hosts/OpenCode 并存，优先重建后的 Hosts 路径
    if (fromRoom.includes('Opencode/Plugin.js') && !fromRoom.includes('Hosts/')) {
      const modern = resolve(base, 'build/src/Hosts/OpenCode/Plugin.js');
      if (existsSync(modern)) return modern;
    }
    if (existsSync(abs)) return abs;
    return abs;
  }

  const sut = process.env.SUT_ROOT;
  if (sut) {
    const candidates = [
      join(sut, 'build/src/Hosts/OpenCode/Plugin.js'),
      join(sut, 'build/src/Opencode/Plugin.js'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }
  return undefined;
}

/** 同步短等：插件异步 append assistant_completed 时避免误报 PROTOCOL。 */
function awaitWaitForNdjsonProbes(
  ndjsonPath: string,
  probes: string[],
  timeoutMs: number,
): { text: string; kinds: Set<string> } {
  const deadline = Date.now() + timeoutMs;
  let text = existsSync(ndjsonPath) ? readFileSync(ndjsonPath, 'utf8') : '';
  let kinds = collectNdjsonKinds(text);
  while (missingProtocolProbes(kinds, probes).length > 0 && Date.now() < deadline) {
    spawnSync(
      process.execPath,
      ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150)'],
      {
        timeout: 2_000,
      },
    );
    text = existsSync(ndjsonPath) ? readFileSync(ndjsonPath, 'utf8') : '';
    kinds = collectNdjsonKinds(text);
  }
  return { text, kinds };
}

function fail(
  item: ItemDoc,
  attribution: Attribution,
  message: string,
  artifactDir?: string,
  matchedRule?: string,
): AxisItemResult {
  const r: AxisItemResult = {
    item_id: item.id,
    item_rev: item.rev,
    pass: false,
    attribution,
    oracle_failures: [
      {
        oracle_id: 'harness',
        message: matchedRule !== undefined ? `${message} [rule ${matchedRule}]` : message,
      },
    ],
    metrics: { a_case_pass_rate: 0, a_invariant_violations: 0 },
  };
  if (artifactDir !== undefined) r.artifact_dir = artifactDir;
  return r;
}

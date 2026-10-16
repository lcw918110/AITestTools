import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  diagnoseHostedFailure,
  resolveHostedAttribution,
  resolveWorkspaceFailAttribution,
} from '../attribution/hosted-tree.ts';
import {
  collectNdjsonKinds,
  missingProtocolProbes,
  partitionHostedProtocolProbes,
} from '../attribution/ndjson-probes.ts';
import { ensureHostedGitRepo, readWanxiangEventStore } from '../attribution/event-store.ts';
import { loadJournal, sealJournalToManifestFields } from '../drivers/cassette/journal.ts';
import type { ItemDoc, RoomDoc } from '../exam-engine/types.ts';
import type { AxisItemResult } from './l2-runner.ts';
import { fail } from './runner-shared.ts';
import { evaluateHostedOracles } from './hosted-oracles.ts';
import { observeHostExit, type HostedHostExitObservation } from './hosted-host-exit.ts';
import { observeHostedPassToken, type HostedPassTokenObservation } from './hosted-pass-token.ts';
import { resolveHostedPrompt } from './hosted-prompt.ts';
import { resolvePluginPath } from './plugin-path.ts';
import { seedStimulusMaterials } from './seed-stimulus-materials.ts';
import { materialsMutated, snapshotSeededFiles } from './hosted-workspace-state.ts';

/**
 * B-hosted：真拉起本机 opencode。
 * - 拍板 D5：缺密钥 / 跑挂 → FAIL + 如实归因
 * - 若 room 声明 plugin / durable_log_glob：隔离工作区挂插件
 * - 耐久归因读 `refs/wanxiang/store`（EventStore）；`.wanxiangshu.ndjson` / 旧 WanEvent 不当挂载信号
 */
export async function runHostedSmokeItem(opts: {
  item: ItemDoc;
  room: RoomDoc;
  projectRoot: string;
  artifactDir?: string;
}): Promise<AxisItemResult> {
  const focus = opts.item.intent.attribution_focus;
  const hostBin = typeof opts.room.host?.command === 'string' ? opts.room.host.command : 'opencode';
  const protocolProbesRaw = Array.isArray(opts.item.intent.protocol_probes)
    ? opts.item.intent.protocol_probes.map(String)
    : [];
  const { active: protocolProbes, skippedStale: staleProtocolProbes } =
    partitionHostedProtocolProbes(protocolProbesRaw);

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
    return fail(opts.item, d.attribution, `无法执行 ${hostBin} --version`, {
      artifactDir: opts.artifactDir,
      effectPair: opts.item.intent.effect_pair,
    });
  }

  // .env 里的 PROCTOR_HOSTED_MODEL 会盖掉考场声明。必须把来源记进产物，
  // 否则报告显示的实验条件与真实执行不符，配对结论无从复现。
  const envModel = process.env.PROCTOR_HOSTED_MODEL;
  const roomModel = typeof opts.room.host?.model === 'string' ? opts.room.host.model : undefined;
  const hostModel = envModel ?? roomModel;
  const modelSource =
    envModel === undefined
      ? 'room'
      : roomModel !== undefined && roomModel !== envModel
        ? 'env-override-room'
        : 'env';
  // A 轴 freeze 无 model_id；B/C 轴才冻结模型
  const frozenModel =
    'model_id' in opts.item.freeze ? String(opts.item.freeze.model_id) : undefined;
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

  /**
   * 工作区隔离必须与「是否挂插件」解耦：否则 OFF 侧落在 projectRoot（能看到题库与引擎源码），
   * ON 侧落在临时空仓，配对实验就同时变了工作区内容与插件两个因子，分差无法归因。
   * room.workspace = "isolated" 让无插件的对照侧拿到同构空仓。
   */
  const wantIsolated = wantDurable || opts.room.workspace === 'isolated';

  const workDir = wantIsolated ? mkdtempSync(join(tmpdir(), 'proctor-hosted-')) : opts.projectRoot;
  let isolatedHome: string | undefined;
  try {
    const cassetteOutDir =
      recordId && recordId.length > 0 ? join(opts.projectRoot, 'cassettes', recordId) : undefined;
    const journalPath =
      cassetteOutDir !== undefined ? join(cassetteOutDir, 'journal.ndjson') : undefined;

    if (wantIsolated) {
      writeFileSync(join(workDir, 'README.md'), '# proctor hosted workspace\n');
      const gitInit = ensureHostedGitRepo(workDir);
      if (!gitInit.ok && opts.artifactDir !== undefined) {
        writeFileSync(
          join(opts.artifactDir, 'hosted-git-init.json'),
          `${JSON.stringify({ ok: false, error: gitInit.error ?? null }, null, 2)}\n`,
        );
      }
      const plugins: string[] = [];
      if (pluginPath !== undefined) plugins.push(pluginPath);
      if (recorderPlugin !== undefined) plugins.push(recorderPlugin);
      const cfg: Record<string, unknown> = {
        permission: { '*': 'allow' },
      };
      if (plugins.length > 0) cfg.plugin = plugins;
      writeFileSync(join(workDir, 'opencode.json'), `${JSON.stringify(cfg, null, 2)}\n`);
    }

    const seeded = wantIsolated
      ? seedStimulusMaterials({
          workDir,
          projectRoot: opts.projectRoot,
          stimulusRef: opts.item.stimulus.ref,
        }).copied
      : [];
    const seedSnapshot = snapshotSeededFiles(workDir, seeded);

    if (cassetteOutDir !== undefined) {
      mkdirSync(cassetteOutDir, { recursive: true });
      // 清空旧 journal，避免跨次污染
      writeFileSync(join(cassetteOutDir, 'journal.ndjson'), '');
    }

    const prompt = resolveHostedPrompt(opts.item, opts.projectRoot);

    const runArgs = ['run'];
    // 隔离仓必须显式 --dir：只设 spawn cwd 时，OpenCode 仍会发现并切到引擎仓
    // （OFF 无插件时 wantDurable=false，缺 --dir 就会让模型改错仓库，播种与 workspace_assert 脱节）。
    if (wantIsolated || wantDurable) runArgs.push('--dir', workDir);
    // 禁止 --pure：会禁用外部 plugin
    if (hostModel !== undefined && hostModel.length > 0) runArgs.push('-m', hostModel);
    if (hostAgent !== undefined && hostAgent.length > 0) runArgs.push('--agent', hostAgent);
    // 宿主内部错误默认不落盘，失败时只剩一个 UnknownError ref，无从归因
    runArgs.push('--print-logs');
    const extraArgsRaw = opts.room.host?.args;
    if (Array.isArray(extraArgsRaw)) runArgs.push(...extraArgsRaw.map(String));
    runArgs.push(prompt);

    const deadline = opts.item.execution.deadline_ms || 180_000;
    const managedAgentsRaw = opts.room.host?.managed_agents;
    const managedAgents = Array.isArray(managedAgentsRaw) ? managedAgentsRaw.map(String) : [];
    const hostConfig = prepareIsolatedHostConfig({ managedAgents, model: hostModel });
    isolatedHome = hostConfig.home;
    const runEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CI: '1',
      WANXIANGSHU_TEST: 'true',
      HOME: hostConfig.home,
      XDG_CONFIG_HOME: hostConfig.configHome,
    };
    if (journalPath !== undefined && recordId) {
      runEnv.PROCTOR_CASSETTE_JOURNAL = journalPath;
      runEnv.PROCTOR_CASSETTE_ID = recordId;
    }
    // 墙钟耗时是目前唯一能从 opencode CLI 稳定取到的经济指标：
    // 它不吐 token/成本（--print-logs 只在建会话时打一行全零计数）。
    const startedAt = Date.now();
    const run = spawnSync(hostBin, runArgs, {
      encoding: 'utf8',
      timeout: deadline,
      env: runEnv,
      cwd: workDir,
    });
    const durationMs = Date.now() - startedAt;
    const hostObs = observeHostExit(run);

    const ndjsonPath = join(workDir, '.wanxiangshu.ndjson');
    // 旧 ndjson 若偶然存在仍解析，但不作健康信号；主路径读 EventStore
    let ndjsonText = existsSync(ndjsonPath) ? readFileSync(ndjsonPath, 'utf8') : '';
    let store = readWanxiangEventStore(workDir);
    let kinds = mergeHostedKinds(ndjsonText, store.kinds);
    // 宿主已超时则不再空等 EventStore（否则每道 ON 再堵 5s）
    if (
      !hostObs.timed_out &&
      protocolProbes.length > 0 &&
      missingProtocolProbes(kinds, protocolProbes).length > 0
    ) {
      const waited = await awaitWaitForHostedProbes(workDir, ndjsonPath, protocolProbes, 5_000);
      ndjsonText = waited.ndjsonText;
      store = waited.store;
      kinds = waited.kinds;
    }
    const ndjsonExists = existsSync(ndjsonPath) || ndjsonText.length > 0;
    const stdoutFull = run.stdout || '';
    const stderrFull = run.stderr || '';
    const tokenObs = observeHostedPassToken(opts.item, stdoutFull);
    const mutated = materialsMutated(workDir, seeded, seedSnapshot);
    const oracleEval = evaluateHostedOracles({
      item: opts.item,
      workspace: workDir,
      exitCode: typeof run.status === 'number' ? run.status : 1,
      hostStatus: run.status,
      timedOut: hostObs.timed_out,
      stdout: stdoutFull,
      stderr: stderrFull,
      focus,
    });

    const out = `${stdoutFull}\n${stderrFull}`;
    const outLower = out.toLowerCase();
    // --print-logs 会打 providerID / llm.provider，不能用光秃的 provider|auth 当鉴权失败
    const authMiss =
      /额度不足|insufficient.?quota|unauthorized|invalid.?api.?key|not configured|no model|login required/i.test(
        outLower,
      );
    const envAuthFail = authMiss && (hostObs.timed_out || hostObs.host_exit !== 0);

    const missingProbes =
      protocolProbes.length > 0 ? missingProtocolProbes(kinds, protocolProbes) : [];
    // 超时且工作区已过：探针未齐只记辅助，不否决（避免 ON 因慢落盘被 PROTOCOL 误杀）
    const skipProtocolVeto = hostObs.timed_out && oracleEval.workspace_ok;
    const protocolProbesMissing = missingProbes.length > 0 && !skipProtocolVeto;

    const runLog = {
      status: run.status,
      duration_ms: durationMs,
      deadline_ms: deadline,
      stdout_chars: (run.stdout || '').length,
      args: runArgs,
      model: hostModel ?? null,
      model_source: modelSource,
      model_room: roomModel ?? null,
      model_env: envModel ?? null,
      model_frozen: frozenModel ?? null,
      model_matches_freeze: frozenModel === undefined ? null : hostModel === frozenModel,
      agent: hostAgent ?? null,
      plugin: pluginPath ?? null,
      work_dir: workDir,
      workspace_isolated: wantIsolated,
      materials_seeded: seeded,
      materials_mutated: mutated,
      timed_out: hostObs.timed_out,
      host_exit: hostObs.host_exit,
      host_signal: hostObs.host_signal,
      host_exit_role: hostObs.host_exit_role,
      workspace_ok: oracleEval.workspace_ok,
      workspace_ran: oracleEval.workspace_ran,
      workspace_failures: oracleEval.workspace_failures,
      exit_code_inconclusive: oracleEval.exit_code_inconclusive,
      exit_code_nonzero: oracleEval.exit_code_nonzero,
      protocol_probes_skipped_on_timeout: skipProtocolVeto && missingProbes.length > 0,
      // 只记 provider 名与来源路径，绝不落密钥
      config_home: hostConfig.configHome,
      config_isolated_home: hostConfig.home,
      config_inherited_from: hostConfig.inheritedFrom,
      config_provider_names: hostConfig.providerNames,
      config_managed_agents: hostConfig.managedAgents,
      config_scheduler_model: hostConfig.schedulerModel,
      event_store_present: store.present,
      event_store_reason: store.reason ?? null,
      event_store_ref: 'refs/wanxiang/store',
      event_store_source: store.source ?? null,
      event_store_kinds: store.kinds,
      ndjson_exists: ndjsonExists,
      ndjson_bytes: ndjsonText.length,
      ndjson_kinds: [...collectNdjsonKinds(ndjsonText)].sort(),
      ndjson_health_signal: false,
      attribution_kinds: [...kinds].sort(),
      stale_protocol_probes: staleProtocolProbes,
      pass_token: tokenObs.pass_token,
      pass_token_present: tokenObs.pass_token_present,
      pass_token_role: tokenObs.pass_token_role,
      stdout: stdoutFull.slice(0, 4000),
      stderr: stderrFull.slice(0, 4000),
    };
    if (opts.artifactDir !== undefined) {
      writeFileSync(
        join(opts.artifactDir, 'hosted-run.json'),
        `${JSON.stringify(runLog, null, 2)}\n`,
      );
      // runLog 里的 stdout/stderr 是截断版；归因常常要看宿主日志全文
      writeFileSync(join(opts.artifactDir, 'hosted-stdout.log'), run.stdout || '');
      writeFileSync(join(opts.artifactDir, 'hosted-stderr.log'), run.stderr || '');
      writeFileSync(
        join(opts.artifactDir, 'event-store.json'),
        `${JSON.stringify(
          {
            present: store.present,
            reason: store.reason ?? null,
            rootOid: store.rootOid ?? null,
            kinds: store.kinds,
            events: store.events,
          },
          null,
          2,
        )}\n`,
      );
      if (ndjsonExists) {
        writeFileSync(join(opts.artifactDir, 'wanxiangshu.ndjson'), ndjsonText);
      }
    }

    const sealNote = trySealRecordedCassette({
      recordId,
      cassetteOutDir,
      journalPath,
      projectRoot: opts.projectRoot,
      ...(opts.artifactDir !== undefined ? { artifactDir: opts.artifactDir } : {}),
      hostVersion: log.version_stdout,
    });

    const storeNote = store.present
      ? `；EventStore kinds=${store.kinds.join('|') || '∅'}`
      : `；EventStore 未写入（${store.reason ?? 'unknown'}；万象术 0.8+ 耐久为 refs/wanxiang/store，不再读 .wanxiangshu.ndjson 当挂载）`;
    const staleProbeNote =
      staleProtocolProbes.length > 0 ? `；已跳过失效探针 ${staleProtocolProbes.join(', ')}` : '';
    const hostNote = hostObs.timed_out
      ? `；timed_out=true host_exit=${String(hostObs.host_exit)}`
      : hostObs.host_exit !== 0
        ? `；host_exit=${String(hostObs.host_exit)}`
        : '';

    const finish = (result: AxisItemResult): AxisItemResult =>
      attachHostedObs(result, tokenObs, hostObs, oracleEval.workspace_ok, mutated);

    if (!oracleEval.workspace_ok) {
      const attr = resolveWorkspaceFailAttribution({
        timedOut: hostObs.timed_out,
        materialsMutated: mutated,
        authMiss: envAuthFail,
      });
      const why =
        oracleEval.workspace_failures[0]?.message ?? oracleEval.veto?.message ?? '工作区断言失败';
      const untouched =
        hostObs.timed_out && !mutated ? '超时且材料未改；' : hostObs.timed_out ? '超时；' : '';
      return finish(
        fail(
          opts.item,
          attr,
          `${untouched}${why}${hostNote}${sealNote}${storeNote}${staleProbeNote}`,
          {
            artifactDir: opts.artifactDir,
            effectPair: opts.item.intent.effect_pair,
            extraFailures: oracleEval.workspace_failures,
          },
        ),
      );
    }

    if (envAuthFail && !oracleEval.workspace_ran) {
      const d = diagnoseHostedFailure({ contextProbeMiss: true });
      return finish(
        fail(
          opts.item,
          d.attribution,
          `hosted 鉴权/额度失败（status=${String(run.status)}）${hostNote}：${(run.stderr || run.stdout || '').slice(0, 240)}${sealNote} [rule ${d.matched_rule}]`,
          {
            artifactDir: opts.artifactDir,
            effectPair: opts.item.intent.effect_pair,
          },
        ),
      );
    }

    if (protocolProbesMissing) {
      const d = diagnoseHostedFailure({ protocolProbeMiss: true });
      return finish(
        fail(
          opts.item,
          resolveHostedAttribution(d.attribution, focus),
          `协议探针缺失：${missingProbes.join(', ')}（已见 kinds=${[...kinds].sort().join('|') || '∅'}）${sealNote}${storeNote}${staleProbeNote} [rule ${d.matched_rule}]`,
          {
            artifactDir: opts.artifactDir,
            effectPair: opts.item.intent.effect_pair,
          },
        ),
      );
    }

    if (oracleEval.veto !== undefined) {
      return finish(
        fail(
          opts.item,
          oracleEval.veto.attribution,
          `${oracleEval.veto.message}${hostNote}${sealNote}${storeNote}${staleProbeNote}`,
          {
            artifactDir: opts.artifactDir,
            effectPair: opts.item.intent.effect_pair,
          },
        ),
      );
    }

    return finish({
      item_id: opts.item.id,
      item_rev: opts.item.rev,
      pass: true,
      oracle_failures: [],
      metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
      ...(opts.artifactDir !== undefined ? { artifact_dir: opts.artifactDir } : {}),
      ...(opts.item.intent.effect_pair !== undefined
        ? { effect_pair: opts.item.intent.effect_pair }
        : {}),
    });
  } finally {
    if (wantIsolated) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* 清理失败可忽略 */
      }
    }
    if (isolatedHome !== undefined) {
      try {
        rmSync(isolatedHome, { recursive: true, force: true });
      } catch {
        /* 清理失败可忽略 */
      }
    }
  }
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

/** 宿主全局配置中只有 provider 段可继承；其余字段一律不带入隔离配置。 */
function inheritedProviderConfig(): { provider?: unknown; source?: string } {
  const bases = [process.env.XDG_CONFIG_HOME, join(homedir(), '.config')].filter(
    (b): b is string => typeof b === 'string' && b.length > 0,
  );
  for (const base of bases) {
    const path = join(base, 'opencode', 'opencode.json');
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      const provider = raw.provider;
      if (provider !== null && typeof provider === 'object' && !Array.isArray(provider)) {
        return { provider, source: path };
      }
      return { source: path };
    } catch {
      /* 宿主配置坏了不阻塞跑卷：按「无可继承 provider」处理 */
    }
  }
  return {};
}

/**
 * 受控模型调度器：万象术自带调度器按角色分派不同模型，会覆盖 `-m`。
 * 配对实验只允许「有无插件」一个变量，故所有角色收敛到考场声明的同一模型与推理档。
 * 它读 `homedir()/.config/opencode/wanxiangshu.mjs`（不看 XDG_CONFIG_HOME），故必须隔离 HOME。
 */
function controlledSchedulerSource(model: string): string {
  return `// 由 agent-proctor 生成的受控模型调度器（评测隔离用）。
// 所有角色收敛到同一目标：配对实验只允许「有无插件」这一个变量。
const TARGET = { model: ${JSON.stringify(model)}, reasoning: 'none' }
const CONCURRENCY_LIMIT = 8

export default function route(role, running, previous) {
  if (Array.isArray(running) && running.length >= CONCURRENCY_LIMIT) return null
  return { ...TARGET }
}
`;
}

/**
 * hosted 真跑一律用隔离的 HOME + XDG_CONFIG_HOME，理由有三条：
 * - 宿主全局 agent 段会带入 legacy 名（万象术 managed-agent 校验直接 fatal）
 * - 被测插件的模型调度器落在 `~/.config/opencode/`，不隔离就被个人配置左右
 * - OFF/ON 必须只差插件一项；继承开发者个人配置会让对照失去意义
 * provider 段仍需继承，否则隔离后无可用模型。
 */
function prepareIsolatedHostConfig(opts: { managedAgents: string[]; model?: string | undefined }): {
  home: string;
  configHome: string;
  providerNames: string[];
  inheritedFrom: string | null;
  managedAgents: string[];
  schedulerModel: string | null;
} {
  const home = mkdtempSync(join(tmpdir(), 'proctor-opencode-home-'));
  try {
    const configHome = join(home, '.config');
    const dir = join(configHome, 'opencode');
    mkdirSync(dir, { recursive: true });

    const inherited = inheritedProviderConfig();
    const cfg: Record<string, unknown> = {
      $schema: 'https://opencode.ai/config.json',
      permission: { '*': 'allow' },
    };
    if (inherited.provider !== undefined) cfg.provider = inherited.provider;

    // 受管 agent 若无 model 绑定，宿主会落到未鉴权的内置默认模型，题就白跑了
    const model = opts.model !== undefined && opts.model.length > 0 ? opts.model : undefined;
    if (opts.managedAgents.length > 0 && model !== undefined) {
      const agent: Record<string, unknown> = {};
      for (const name of opts.managedAgents) agent[name] = { model };
      cfg.agent = agent;
    }
    writeFileSync(join(dir, 'opencode.json'), `${JSON.stringify(cfg, null, 2)}\n`);

    if (model !== undefined) {
      writeFileSync(join(dir, 'wanxiangshu.mjs'), controlledSchedulerSource(model));
    }

    const providerNames =
      inherited.provider !== undefined ? Object.keys(inherited.provider as object).sort() : [];
    return {
      home,
      configHome,
      providerNames,
      inheritedFrom: inherited.source ?? null,
      managedAgents: opts.managedAgents,
      schedulerModel: model ?? null,
    };
  } catch (e) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* 清理失败可忽略 */
    }
    throw e;
  }
}

function mergeHostedKinds(ndjsonText: string, storeKinds: string[]): Set<string> {
  const kinds = collectNdjsonKinds(ndjsonText);
  for (const k of storeKinds) kinds.add(k);
  return kinds;
}

/** 进程内短睡：替代原先为等 EventStore 而 spawn 子进程跑 Atomics.wait。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 短等 EventStore tip（及偶然残留的 ndjson）；失效探针已在上层跳过。 */
async function awaitWaitForHostedProbes(
  workTree: string,
  ndjsonPath: string,
  probes: string[],
  timeoutMs: number,
): Promise<{
  ndjsonText: string;
  store: ReturnType<typeof readWanxiangEventStore>;
  kinds: Set<string>;
}> {
  const deadline = Date.now() + timeoutMs;
  let ndjsonText = existsSync(ndjsonPath) ? readFileSync(ndjsonPath, 'utf8') : '';
  let store = readWanxiangEventStore(workTree);
  let kinds = mergeHostedKinds(ndjsonText, store.kinds);
  while (missingProtocolProbes(kinds, probes).length > 0 && Date.now() < deadline) {
    await sleep(150);
    ndjsonText = existsSync(ndjsonPath) ? readFileSync(ndjsonPath, 'utf8') : '';
    store = readWanxiangEventStore(workTree);
    kinds = mergeHostedKinds(ndjsonText, store.kinds);
  }
  return { ndjsonText, store, kinds };
}

function attachHostedObs(
  result: AxisItemResult,
  tokenObs: HostedPassTokenObservation,
  hostObs: HostedHostExitObservation,
  workspace_ok: boolean,
  materials_mutated: boolean,
): AxisItemResult {
  return {
    ...result,
    ...tokenObs,
    timed_out: hostObs.timed_out,
    host_exit: hostObs.host_exit,
    host_signal: hostObs.host_signal,
    host_exit_role: hostObs.host_exit_role,
    workspace_ok,
    materials_mutated,
  };
}

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
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
import type { AxisItemResult } from './runner-types.ts';
import { fail } from './runner-shared.ts';
import type {
  AdapterContext,
  CollectedOutput,
  DiscoveredInput,
  ExecutionAdapter,
  PreparedState,
  SubmittedHandle,
} from './execution-adapter.ts';
import { AdapterError } from './execution-adapter.ts';
import { evaluateHostedOracles } from './hosted-oracles.ts';
import { observeHostExit, type HostedHostExitObservation } from './hosted-host-exit.ts';
import { observeHostedPassToken, type HostedPassTokenObservation } from './hosted-pass-token.ts';
import { resolveHostedPrompt } from './hosted-prompt.ts';
import { resolvePluginPath } from './plugin-path.ts';
import { seedStimulusMaterials } from './seed-stimulus-materials.ts';
import { materialsMutated, snapshotSeededFiles } from './hosted-workspace-state.ts';
import { buildCanaryInjection, detectCanaryLeak } from '../security/canary.ts';
import { evaluateIsolationGate, type IsolationGateResult } from '../security/isolation-backend.ts';
import {
  allowedDomainsFromEnv,
  modelEndpointHost,
  wrapHostCommand,
} from '../security/sandbox-runtime.ts';

/**
 * B-hosted adapter：真拉起本机 opencode。
 * - 拍板 D5：缺密钥 / 跑挂 → FAIL + 如实归因
 * - 若 environment 声明 plugin / durable_log_glob：隔离工作区挂插件
 * - 耐久归因读 `refs/wanxiang/store`（EventStore）；`.wanxiangshu.ndjson` / 旧 WanEvent 不当挂载信号
 * 把 runHostedSmokeItem 的隐式生命周期显式化为 8 阶段，执行语义不变。
 */
export class HostedAdapter implements ExecutionAdapter {
  readonly adapterId = 'b-hosted-opencode';

  private hostBin = 'opencode';
  private protocolProbes: string[] = [];
  private staleProtocolProbes: string[] = [];
  private log: Record<string, unknown> = {};
  private workDir = '';
  private isolatedHome: string | undefined;
  private wantIsolated = false;
  private seeded: string[] = [];
  private seedSnapshot: Record<string, string> = {};
  private hostObs!: ReturnType<typeof observeHostExit>;
  private tokenObs!: ReturnType<typeof observeHostedPassToken>;
  private mutated = false;
  private oracleEval!: ReturnType<typeof evaluateHostedOracles>;
  private runLog: Record<string, unknown> = {};
  private sealNote = '';
  private storeNote = '';
  private staleProbeNote = '';
  private hostNote = '';
  private envAuthFail = false;
  private protocolProbesMissing = false;
  private pairKey: string | undefined;
  // prepare 阶段元数据（供 collect 落盘 runLog / sealNote）
  private hostConfig!: ReturnType<typeof prepareIsolatedHostConfig>;
  private hostModel: string | undefined;
  private modelSource = 'environment';
  private frozenModel: string | undefined;
  private roomModel: string | undefined;
  private hostAgent: string | undefined;
  private pluginPath: string | undefined;
  private recordId: string | undefined;
  private cassetteOutDir: string | undefined;
  private journalPath: string | undefined;
  private deadline = 180_000;
  private runArgs: string[] = [];
  private canarySecret: string | undefined;
  private canaryLeak: { leaked: boolean; locations: string[] } | undefined;
  private isolationGate: IsolationGateResult | undefined;
  private sandboxBypassed = false;
  private inheritedProvider: unknown;
  private allowedDomains: string[] = [];

  async discover(ctx: AdapterContext): Promise<DiscoveredInput> {
    this.pairKey = ctx.pairKey;
    this.hostBin =
      typeof ctx.environment.recipe.host_command === 'string'
        ? ctx.environment.recipe.host_command
        : 'opencode';
    const protocolProbesRaw = Array.isArray(ctx.revision.protocol_probes)
      ? ctx.revision.protocol_probes.map(String)
      : [];
    const { active: protocolProbes, skippedStale: staleProtocolProbes } =
      partitionHostedProtocolProbes(protocolProbesRaw);
    this.protocolProbes = protocolProbes;
    this.staleProtocolProbes = staleProtocolProbes;

    const version = spawnSync(this.hostBin, ['--version'], { encoding: 'utf8', timeout: 15_000 });
    this.log = {
      bin: this.hostBin,
      version_status: version.status,
      version_stdout: (version.stdout || '').trim(),
      version_stderr: (version.stderr || '').trim(),
    };

    if (ctx.artifactDir !== undefined) {
      mkdirSync(ctx.artifactDir, { recursive: true });
      writeFileSync(
        join(ctx.artifactDir, 'hosted-log.json'),
        `${JSON.stringify(this.log, null, 2)}\n`,
      );
    }

    return { versionStatus: version.status };
  }

  async preflight(
    ctx: AdapterContext,
    discovered: DiscoveredInput,
  ): Promise<{ ok: boolean; reason?: string }> {
    const versionStatus = (discovered as { versionStatus?: number | null }).versionStatus;
    if (versionStatus !== 0) {
      const d = diagnoseHostedFailure({ harnessFault: true });
      throw new AdapterError(
        'preflight_failed',
        d.attribution,
        `无法执行 ${this.hostBin} --version`,
        false,
        [
          fail(ctx.revision, d.attribution, `无法执行 ${this.hostBin} --version`, {
            artifactDir: ctx.artifactDir,
            effectPair: this.pairKey,
          }),
        ],
      );
    }
    // 驱动标签不是隔离证明；本机探测未通过时不允许任何宿主执行。
    const gate = await evaluateIsolationGate();
    this.isolationGate = gate;
    if (!gate.allowed) {
      const msg = `当前缺少经验证的操作系统级隔离后端，已拒绝启动真实宿主任务：${gate.reason}`;
      throw new AdapterError('preflight_failed', 'HARNESS', msg, false, [
        fail(ctx.revision, 'HARNESS', msg, {
          artifactDir: ctx.artifactDir,
          effectPair: this.pairKey,
        }),
      ]);
    }
    return { ok: true };
  }

  async prepare(ctx: AdapterContext, _discovered: DiscoveredInput): Promise<PreparedState> {
    // .env 里的 PROCTOR_HOSTED_MODEL 会盖掉环境声明。必须把来源记进产物，
    // 否则报告显示的实验条件与真实执行不符，配对结论无从复现。
    const envModel = process.env.PROCTOR_HOSTED_MODEL;
    const roomModel =
      typeof ctx.environment.recipe.host_model === 'string'
        ? ctx.environment.recipe.host_model
        : undefined;
    const hostModel = envModel ?? roomModel;
    const modelSource =
      envModel === undefined
        ? 'environment'
        : roomModel !== undefined && roomModel !== envModel
          ? 'env-override-environment'
          : 'env';
    const frozenModel =
      ctx.revision.model_id !== undefined ? String(ctx.revision.model_id) : undefined;
    const hostAgent =
      process.env.PROCTOR_HOSTED_AGENT ??
      (typeof ctx.environment.recipe.host_agent === 'string'
        ? ctx.environment.recipe.host_agent
        : undefined);

    const pluginPath = resolvePluginPath(ctx.environment, ctx.projectRoot);
    const recordId = process.env.PROCTOR_RECORD_CASSETTE?.trim();
    const recorderPlugin =
      recordId && recordId.length > 0
        ? resolve(
            fileURLToPath(new URL('../drivers/cassette/recorder-plugin.mjs', import.meta.url)),
          )
        : undefined;

    const wantDurable =
      Boolean(ctx.environment.recipe.durable_log_glob) ||
      ctx.revision.execution.requires_durable_log === true ||
      pluginPath !== undefined ||
      recorderPlugin !== undefined;

    this.wantIsolated = wantDurable || ctx.environment.recipe.isolation_profile === 'isolated';
    // 工作目录取真实路径：macOS 的 /var 是 /private/var 的符号链接，
    // Seatbelt 按真实路径授权，若这里留 /var/... 就会与授权路径不一致而 EPERM。
    this.workDir = this.wantIsolated
      ? realpathSync(mkdtempSync(join(tmpdir(), 'proctor-hosted-')))
      : ctx.projectRoot;

    const cassetteOutDir =
      recordId && recordId.length > 0 ? join(ctx.projectRoot, 'cassettes', recordId) : undefined;
    const journalPath =
      cassetteOutDir !== undefined ? join(cassetteOutDir, 'journal.ndjson') : undefined;

    if (this.wantIsolated) {
      writeFileSync(join(this.workDir, 'README.md'), '# proctor hosted workspace\n');
      const gitInit = ensureHostedGitRepo(this.workDir);
      if (!gitInit.ok && ctx.artifactDir !== undefined) {
        writeFileSync(
          join(ctx.artifactDir, 'hosted-git-init.json'),
          `${JSON.stringify({ ok: false, error: gitInit.error ?? null }, null, 2)}\n`,
        );
      }
      const plugins: string[] = [];
      if (pluginPath !== undefined) plugins.push(pluginPath);
      if (recorderPlugin !== undefined) plugins.push(recorderPlugin);
      const cfg: Record<string, unknown> = { permission: { '*': 'allow' } };
      if (plugins.length > 0) cfg.plugin = plugins;
      writeFileSync(join(this.workDir, 'opencode.json'), `${JSON.stringify(cfg, null, 2)}\n`);
    }

    this.seeded = this.wantIsolated
      ? seedStimulusMaterials({
          workDir: this.workDir,
          projectRoot: ctx.projectRoot,
          stimulusRef: ctx.revision.stimulus.ref,
        }).copied
      : [];
    this.seedSnapshot = snapshotSeededFiles(this.workDir, this.seeded);

    // 安全红队：canary 注入（独立于常规 run；ctx.security 存在时在隔离 workspace 播种 canary 指令文件）。
    this.canarySecret = ctx.security?.canary_secret;
    if (this.canarySecret !== undefined) {
      if (!this.wantIsolated) {
        // 安全红队必须隔离执行（docs/11 优化项 ③ 关键约束）；非隔离环境静默跳过会产出假阴性。
        throw new AdapterError(
          'prepare_failed',
          'HARNESS',
          '安全红队要求隔离 workspace（isolation_profile=isolated 或 durable_log_glob），当前环境未隔离',
        );
      }
      writeFileSync(join(this.workDir, 'canary.txt'), buildCanaryInjection(this.canarySecret));
    }

    if (cassetteOutDir !== undefined) {
      mkdirSync(cassetteOutDir, { recursive: true });
      writeFileSync(join(cassetteOutDir, 'journal.ndjson'), '');
    }

    const prompt = resolveHostedPrompt(ctx.revision, ctx.projectRoot);
    const runArgs = ['run'];
    if (this.wantIsolated || wantDurable) runArgs.push('--dir', this.workDir);
    if (hostModel !== undefined && hostModel.length > 0) runArgs.push('-m', hostModel);
    if (hostAgent !== undefined && hostAgent.length > 0) runArgs.push('--agent', hostAgent);
    runArgs.push('--print-logs');
    runArgs.push(prompt);

    const deadline = ctx.revision.execution.deadline_ms || 180_000;
    const managedAgentsRaw = ctx.environment.recipe.managed_agents;
    const managedAgents = Array.isArray(managedAgentsRaw) ? managedAgentsRaw.map(String) : [];
    const hostConfig = prepareIsolatedHostConfig({ managedAgents, model: hostModel });
    this.isolatedHome = hostConfig.home;
    // 模型端点域名要并入沙箱放行名单，故记下本次实际继承的 provider 段。
    this.inheritedProvider = inheritedProviderConfig().provider;
    // 代理变量必须剥掉：IDE 沙箱注入的 http(s)_proxy 会拦下 opencode 的模型请求
    // （ERR_PROXY_TUNNEL 403），client-server 架构下 server 端静默重试直到超时，
    // 表象是 stderr 停在 init 无模型流。隔离环境一律直连模型端点。
    const proxyStripped: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(proxyStripped)) {
      if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete proxyStripped[key];
    }
    const runEnv: NodeJS.ProcessEnv = {
      ...proxyStripped,
      CI: '1',
      WANXIANGSHU_TEST: 'true',
      HOME: hostConfig.home,
      XDG_CONFIG_HOME: hostConfig.configHome,
      // opencode 日志等数据目录若未重定向，会回退到真实 HOME（沙箱内不可写）导致 FileSystem.open 崩溃。
      // 全部收进隔离 HOME，与 allowedWrite 白名单一致。
      XDG_DATA_HOME: join(hostConfig.home, '.local', 'share'),
      XDG_STATE_HOME: join(hostConfig.home, '.local', 'state'),
      XDG_CACHE_HOME: join(hostConfig.home, '.cache'),
    };
    if (journalPath !== undefined && recordId) {
      runEnv.PROCTOR_CASSETTE_JOURNAL = journalPath;
      runEnv.PROCTOR_CASSETTE_ID = recordId;
    }

    // 元数据落实例字段，供 collect 阶段补全 runLog / sealNote。
    this.hostConfig = hostConfig;
    this.hostModel = hostModel;
    this.modelSource = modelSource;
    this.frozenModel = frozenModel;
    this.roomModel = roomModel;
    this.hostAgent = hostAgent;
    this.pluginPath = pluginPath;
    this.recordId = recordId;
    this.cassetteOutDir = cassetteOutDir;
    this.journalPath = journalPath;
    this.deadline = deadline;
    this.runArgs = runArgs;

    return { runArgs, deadline, runEnv, wantDurable };
  }

  async submit(ctx: AdapterContext, prepared: PreparedState): Promise<SubmittedHandle> {
    const p = prepared as unknown as {
      runArgs: string[];
      deadline: number;
      runEnv: NodeJS.ProcessEnv;
    };
    if (this.isolationGate !== undefined && this.isolationGate.allowed !== true) {
      throw new AdapterError(
        'preflight_failed',
        'HARNESS',
        '真实宿主未经过已通过的隔离探测，已拒绝启动',
        false,
      );
    }
    const startedAt = Date.now();
    // 沙箱旁路：PROCTOR_SANDBOX_BYPASS=1 时跳过 Seatbelt 包裹（如 opencode client-server 在
    // 沙箱内 listen/init 挂起问题）。仅用于诊断与链路打通；隔离门禁仍必须通过，
    // 产物里如实标注 sandbox_bypassed，报告读取方据此区分证据等级。
    const sandboxBypass = process.env.PROCTOR_SANDBOX_BYPASS === '1';
    this.sandboxBypassed = sandboxBypass;
    let execArgv: string[];
    let sandboxEnv: NodeJS.ProcessEnv = {};
    if (sandboxBypass) {
      execArgv = [this.hostBin, ...p.runArgs];
    } else {
      // 模型端点域名来自本机受控 provider 配置（不是被测对象输入），必须一并放行，
      // 否则沙箱代理会以 403 拒绝 opencode 的模型请求。
      const endpointHost = modelEndpointHost(this.inheritedProvider, this.hostModel);
      const allowedDomains = allowedDomainsFromEnv(p.runEnv);
      if (endpointHost !== undefined && !allowedDomains.includes(endpointHost)) {
        allowedDomains.push(endpointHost);
      }
      this.allowedDomains = allowedDomains;
      const wrapped = await wrapHostCommand({
        bin: this.hostBin,
        args: p.runArgs,
        cwd: this.workDir,
        allowedWrite: [
          this.workDir,
          ...(this.isolatedHome !== undefined ? [this.isolatedHome] : []),
        ],
        allowedDomains,
      });
      const command = wrapped.argv[0];
      if (command === undefined) {
        throw new AdapterError('submit_failed', 'HARNESS', '隔离后端没有返回可执行命令', false);
      }
      execArgv = wrapped.argv;
      sandboxEnv = wrapped.env;
    }
    const execBin = execArgv[0];
    if (execBin === undefined) {
      throw new AdapterError('submit_failed', 'HARNESS', '宿主命令缺少可执行文件', false);
    }
    const run = await runHostedWithReap(execBin, execArgv.slice(1), {
      env: { ...p.runEnv, ...sandboxEnv },
      cwd: this.workDir,
      timeoutMs: p.deadline,
    });
    const durationMs = Date.now() - startedAt;
    this.hostObs = observeHostExit(run);

    const ndjsonPath = join(this.workDir, '.wanxiangshu.ndjson');
    let ndjsonText = existsSync(ndjsonPath) ? readFileSync(ndjsonPath, 'utf8') : '';
    let store = readWanxiangEventStore(this.workDir);
    let kinds = mergeHostedKinds(ndjsonText, store.kinds);
    if (
      !this.hostObs.timed_out &&
      this.protocolProbes.length > 0 &&
      missingProtocolProbes(kinds, this.protocolProbes).length > 0
    ) {
      const waited = await awaitWaitForHostedProbes(
        this.workDir,
        ndjsonPath,
        this.protocolProbes,
        5_000,
      );
      ndjsonText = waited.ndjsonText;
      store = waited.store;
      kinds = waited.kinds;
    }
    const ndjsonExists = existsSync(ndjsonPath) || ndjsonText.length > 0;
    const stdoutFull = run.stdout || '';
    const stderrFull = run.stderr || '';
    this.tokenObs = observeHostedPassToken(ctx.revision, stdoutFull);
    this.mutated = materialsMutated(this.workDir, this.seeded, this.seedSnapshot);
    // 安全红队：canary 泄露检测（工具 judge，程序化）。检测面 = 输出 + 工作区新写入文件。
    if (this.canarySecret !== undefined) {
      this.canaryLeak = detectCanaryLeak(this.canarySecret, [
        { name: 'stdout', content: stdoutFull },
        { name: 'stderr', content: stderrFull },
      ]);
    }
    this.oracleEval = evaluateHostedOracles({
      revision: ctx.revision,
      workspace: this.workDir,
      exitCode: typeof run.status === 'number' ? run.status : 1,
      hostStatus: run.status,
      timedOut: this.hostObs.timed_out,
      stdout: stdoutFull,
      stderr: stderrFull,
      focus: ctx.revision.attribution_focus,
    });

    const out = `${stdoutFull}\n${stderrFull}`;
    const outLower = out.toLowerCase();
    const authMiss =
      /额度不足|insufficient.?quota|unauthorized|invalid.?api.?key|not configured|no model|login required/i.test(
        outLower,
      );
    this.envAuthFail = authMiss && (this.hostObs.timed_out || this.hostObs.host_exit !== 0);

    const missingProbes =
      this.protocolProbes.length > 0 ? missingProtocolProbes(kinds, this.protocolProbes) : [];
    const skipProtocolVeto = this.hostObs.timed_out && this.oracleEval.workspace_ok;
    this.protocolProbesMissing = missingProbes.length > 0 && !skipProtocolVeto;

    return {
      run,
      durationMs,
      ndjsonText,
      ndjsonExists,
      store,
      kinds,
      stdoutFull,
      stderrFull,
      missingProbes,
      skipProtocolVeto,
    };
  }

  async collect(ctx: AdapterContext, handle: SubmittedHandle): Promise<CollectedOutput> {
    const h = handle as unknown as {
      run: ReturnType<typeof spawnSync>;
      durationMs: number;
      ndjsonText: string;
      ndjsonExists: boolean;
      store: ReturnType<typeof readWanxiangEventStore>;
      kinds: Set<string>;
      stdoutFull: string;
      stderrFull: string;
      missingProbes: string[];
      skipProtocolVeto: boolean;
    };

    this.runLog = {
      sandbox_bypassed: this.sandboxBypassed,
      sandbox_allowed_domains: this.allowedDomains,
      isolation_gate_status: this.isolationGate?.status ?? null,
      isolation_gate_reason: this.isolationGate?.reason ?? null,
      status: h.run.status,
      duration_ms: h.durationMs,
      deadline_ms: this.deadline,
      stdout_chars: (h.run.stdout || '').length,
      args: this.runArgs,
      model: this.hostModel ?? null,
      model_source: this.modelSource,
      model_environment: this.roomModel ?? null,
      model_env: process.env.PROCTOR_HOSTED_MODEL ?? null,
      model_frozen: this.frozenModel ?? null,
      model_matches_freeze:
        this.frozenModel === undefined ? null : this.hostModel === this.frozenModel,
      agent: this.hostAgent ?? null,
      plugin: this.pluginPath ?? null,
      work_dir: this.workDir,
      workspace_isolated: this.wantIsolated,
      materials_seeded: this.seeded,
      materials_mutated: this.mutated,
      timed_out: this.hostObs.timed_out,
      host_exit: this.hostObs.host_exit,
      host_signal: this.hostObs.host_signal,
      host_exit_role: this.hostObs.host_exit_role,
      workspace_ok: this.oracleEval.workspace_ok,
      workspace_ran: this.oracleEval.workspace_ran,
      workspace_failures: this.oracleEval.workspace_failures,
      exit_code_inconclusive: this.oracleEval.exit_code_inconclusive,
      exit_code_nonzero: this.oracleEval.exit_code_nonzero,
      protocol_probes_skipped_on_timeout: h.skipProtocolVeto && h.missingProbes.length > 0,
      config_home: this.hostConfig.configHome,
      config_isolated_home: this.hostConfig.home,
      config_inherited_from: this.hostConfig.inheritedFrom,
      config_provider_names: this.hostConfig.providerNames,
      config_managed_agents: this.hostConfig.managedAgents,
      config_scheduler_model: this.hostConfig.schedulerModel,
      event_store_present: h.store.present,
      event_store_reason: h.store.reason ?? null,
      event_store_ref: 'refs/wanxiang/store',
      event_store_source: h.store.source ?? null,
      event_store_kinds: h.store.kinds,
      ndjson_exists: h.ndjsonExists,
      ndjson_bytes: h.ndjsonText.length,
      ndjson_kinds: [...collectNdjsonKinds(h.ndjsonText)].sort(),
      ndjson_health_signal: false,
      attribution_kinds: [...h.kinds].sort(),
      stale_protocol_probes: this.staleProtocolProbes,
      pass_token: this.tokenObs.pass_token,
      pass_token_present: this.tokenObs.pass_token_present,
      pass_token_role: this.tokenObs.pass_token_role,
      stdout: h.stdoutFull.slice(0, 4000),
      stderr: h.stderrFull.slice(0, 4000),
      ...(this.canaryLeak !== undefined
        ? {
            canary_leak: this.canaryLeak.leaked,
            canary_leak_locations: this.canaryLeak.locations,
          }
        : {}),
    };
    if (ctx.artifactDir !== undefined) {
      writeFileSync(
        join(ctx.artifactDir, 'hosted-run.json'),
        `${JSON.stringify(this.runLog, null, 2)}\n`,
      );
      writeFileSync(join(ctx.artifactDir, 'hosted-stdout.log'), h.run.stdout || '');
      writeFileSync(join(ctx.artifactDir, 'hosted-stderr.log'), h.run.stderr || '');
      writeFileSync(
        join(ctx.artifactDir, 'event-store.json'),
        `${JSON.stringify(
          {
            present: h.store.present,
            reason: h.store.reason ?? null,
            rootOid: h.store.rootOid ?? null,
            kinds: h.store.kinds,
            events: h.store.events,
          },
          null,
          2,
        )}\n`,
      );
      if (h.ndjsonExists) {
        writeFileSync(join(ctx.artifactDir, 'wanxiangshu.ndjson'), h.ndjsonText);
      }
    }

    this.sealNote = trySealRecordedCassette({
      recordId: this.recordId,
      cassetteOutDir: this.cassetteOutDir,
      journalPath: this.journalPath,
      projectRoot: ctx.projectRoot,
      ...(ctx.artifactDir !== undefined ? { artifactDir: ctx.artifactDir } : {}),
      hostVersion: String(this.log.version_stdout ?? ''),
    });
    this.storeNote = h.store.present
      ? `；EventStore kinds=${h.store.kinds.join('|') || '∅'}`
      : `；EventStore 未写入（${h.store.reason ?? 'unknown'}；万象术 0.8+ 耐久为 refs/wanxiang/store，不再读 .wanxiangshu.ndjson 当挂载）`;
    this.staleProbeNote =
      this.staleProtocolProbes.length > 0
        ? `；已跳过失效探针 ${this.staleProtocolProbes.join(', ')}`
        : '';
    this.hostNote = this.hostObs.timed_out
      ? `；timed_out=true host_exit=${String(this.hostObs.host_exit)}`
      : this.hostObs.host_exit !== 0
        ? `；host_exit=${String(this.hostObs.host_exit)}`
        : '';

    return { collected: true };
  }

  async evaluate(ctx: AdapterContext, _collected: CollectedOutput): Promise<AxisItemResult[]> {
    const finish = (result: AxisItemResult): AxisItemResult =>
      attachHostedObs(
        result,
        this.tokenObs,
        this.hostObs,
        this.oracleEval.workspace_ok,
        this.mutated,
      );

    if (!this.oracleEval.workspace_ok) {
      const attr = resolveWorkspaceFailAttribution({
        timedOut: this.hostObs.timed_out,
        materialsMutated: this.mutated,
        authMiss: this.envAuthFail,
      });
      const why =
        this.oracleEval.workspace_failures[0]?.message ??
        this.oracleEval.veto?.message ??
        '工作区断言失败';
      const untouched =
        this.hostObs.timed_out && !this.mutated
          ? '超时且材料未改；'
          : this.hostObs.timed_out
            ? '超时；'
            : '';
      return [
        finish(
          fail(
            ctx.revision,
            attr,
            `${untouched}${why}${this.hostNote}${this.sealNote}${this.storeNote}${this.staleProbeNote}`,
            {
              artifactDir: ctx.artifactDir,
              effectPair: this.pairKey,
              extraFailures: this.oracleEval.workspace_failures,
            },
          ),
        ),
      ];
    }

    if (this.envAuthFail && !this.oracleEval.workspace_ran) {
      const d = diagnoseHostedFailure({ contextProbeMiss: true });
      return [
        finish(
          fail(
            ctx.revision,
            d.attribution,
            `hosted 鉴权/额度失败${this.hostNote}${this.sealNote} [rule ${d.matched_rule}]`,
            {
              artifactDir: ctx.artifactDir,
              effectPair: this.pairKey,
            },
          ),
        ),
      ];
    }

    if (this.protocolProbesMissing) {
      const d = diagnoseHostedFailure({ protocolProbeMiss: true });
      return [
        finish(
          fail(
            ctx.revision,
            resolveHostedAttribution(d.attribution, ctx.revision.attribution_focus),
            `协议探针缺失${this.sealNote}${this.storeNote}${this.staleProbeNote} [rule ${d.matched_rule}]`,
            {
              artifactDir: ctx.artifactDir,
              effectPair: this.pairKey,
            },
          ),
        ),
      ];
    }

    if (this.oracleEval.veto !== undefined) {
      return [
        finish(
          fail(
            ctx.revision,
            this.oracleEval.veto.attribution,
            `${this.oracleEval.veto.message}${this.hostNote}${this.sealNote}${this.storeNote}${this.staleProbeNote}`,
            {
              artifactDir: ctx.artifactDir,
              effectPair: this.pairKey,
            },
          ),
        ),
      ];
    }

    return [
      finish({
        item_id: ctx.revision.case_revision_id,
        item_rev: ctx.revision.revision_number,
        pass: true,
        oracle_failures: [],
        metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
        ...(ctx.artifactDir !== undefined ? { artifact_dir: ctx.artifactDir } : {}),
        ...(this.pairKey !== undefined ? { effect_pair: this.pairKey } : {}),
      }),
    ];
  }

  async cleanup(_ctx: AdapterContext, _prepared: PreparedState): Promise<{ ok: boolean }> {
    if (this.wantIsolated) {
      try {
        rmSync(this.workDir, { recursive: true, force: true });
      } catch {
        /* 清理失败可忽略 */
      }
    }
    if (this.isolatedHome !== undefined) {
      try {
        rmSync(this.isolatedHome, { recursive: true, force: true });
      } catch {
        /* 清理失败可忽略 */
      }
    }
    return { ok: true };
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
  // 隔离 HOME 同样取真实路径，理由与 workDir 相同（/var → /private/var）。
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'proctor-opencode-home-')));
  try {
    const configHome = join(home, '.config');
    const dir = join(configHome, 'opencode');
    mkdirSync(dir, { recursive: true });
    // opencode 启动时会在 XDG 目录下逐层 mkdir（.local/share/opencode/log、
    // .local/share/opencode/repos、.cache/opencode/bin 等）。Seatbelt 的写入授权
    // 不覆盖运行期新建目录，按已知清单预建，避免 EPERM mkdir。
    for (const sub of [
      join(home, '.local'),
      join(home, '.local', 'share'),
      join(home, '.local', 'share', 'opencode'),
      join(home, '.local', 'share', 'opencode', 'log'),
      join(home, '.local', 'share', 'opencode', 'repos'),
      join(home, '.local', 'state'),
      join(home, '.local', 'state', 'opencode'),
      join(home, '.cache'),
      join(home, '.cache', 'opencode'),
      join(home, '.cache', 'opencode', 'bin'),
    ]) {
      mkdirSync(sub, { recursive: true });
    }

    const inherited = inheritedProviderConfig();
    const cfg: Record<string, unknown> = {
      $schema: 'https://opencode.ai/config.json',
      permission: { '*': 'allow' },
    };
    if (inherited.provider !== undefined) cfg.provider = inherited.provider;

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

/**
 * 运行真实宿主命令，超时或异常时递归清理整棵进程树。
 *
 * 与探测阶段的 process_tree_reaped 保持一致：detached 起独立进程组，
 * 超时先 SIGTERM 再 SIGKILL，并逐层 pgrep 收集后代（含自行换组的孙进程）
 * 兜底清理，避免 opencode 内部 spawn 的孙进程在超时后残留。
 * 返回形状兼容 spawnSync（status / signal / error / stdout / stderr），
 * 供 observeHostExit 与 collect 阶段沿用。
 */
async function runHostedWithReap(
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number },
): Promise<{
  status: number | null;
  signal: NodeJS.Signals | null;
  error: NodeJS.ErrnoException | null;
  stdout: string;
  stderr: string;
}> {
  const isPosix = process.platform !== 'win32';
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      detached: isPosix,
      // stdin 必须是 ignore：opencode 检测到 stdin 是常开管道时会一直等输入，
      // 表现为停在日志 init 之后、stdout 为空、永不退出，只能等 deadline 杀进程。
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (
      status: number | null,
      signal: NodeJS.Signals | null,
      error: NodeJS.ErrnoException | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      resolve({ status, signal, error, stdout, stderr });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      reapTree(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => {
        reapTree(child, 'SIGKILL');
      }, 500);
      forceKillTimer.unref();
    }, opts.timeoutMs);
    timer.unref();

    child.stdout?.on('data', (buf: Buffer) => {
      stdout += buf.toString('utf8');
    });
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString('utf8');
    });
    child.on('error', (err) => {
      finish(null, null, err as NodeJS.ErrnoException);
    });
    child.on('close', (code, signal) => {
      const timedOutErr: NodeJS.ErrnoException | null = timedOut
        ? Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
        : null;
      finish(code, signal ?? null, timedOutErr);
    });
  });
}

/** 终止子进程及其进程树（POSIX 负 PID 杀进程组 + pgrep 后代遍历兜底；Windows taskkill /T /F）。 */
function reapTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* ignore */
    }
  }
  // 兜底：逐层收集自行换组的后代并单独终止
  for (const descendant of collectDescendantPids(pid)) {
    try {
      process.kill(descendant, signal);
    } catch {
      /* 已退出，忽略 */
    }
  }
}

/** 通过 pgrep -P 逐层收集后代 PID（含自行 detach 换组的后代），限制深度防环。 */
function collectDescendantPids(rootPid: number): number[] {
  if (process.platform === 'win32') return [];
  const result: number[] = [];
  const visited = new Set<number>([rootPid]);
  let frontier = [rootPid];
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const pid of frontier) {
      const probe = spawnSync('pgrep', ['-P', String(pid)], {
        encoding: 'utf8',
        timeout: 1000,
      });
      if (probe.error || probe.status !== 0) continue;
      for (const line of probe.stdout.split(/\r?\n/)) {
        const childPid = Number.parseInt(line, 10);
        if (!Number.isInteger(childPid) || childPid <= 1 || visited.has(childPid)) continue;
        visited.add(childPid);
        result.push(childPid);
        next.push(childPid);
      }
    }
    frontier = next;
  }
  return result;
}

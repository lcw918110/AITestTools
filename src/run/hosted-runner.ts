import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import {
  diagnoseHostedFailure,
  resolveHostedAttribution,
  resolveWorkspaceFailAttribution,
  isProviderStreamBroken,
} from '../attribution/hosted-tree.ts';
import {
  collectNdjsonKinds,
  missingProtocolProbes,
  partitionHostedProtocolProbes,
} from '../attribution/ndjson-probes.ts';
import {
  ensureHostedGitRepo,
  commitHostedSeed,
  readWanxiangEventStore,
} from '../attribution/event-store.ts';
import { loadJournal, sealJournalToManifestFields } from '../drivers/cassette/journal.ts';
import type { AxisItemResult } from './runner-types.ts';
import type { Attribution } from '../exam-engine/types.ts';
import type { CaseRevision } from '../domain/types.ts';
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
import {
  observeHostExit,
  isHostCrashed,
  type HostedHostExitObservation,
} from './hosted-host-exit.ts';
import { observeHostedPassToken, type HostedPassTokenObservation } from './hosted-pass-token.ts';
import { resolveHostedPrompt } from './hosted-prompt.ts';
import { resolvePluginPath } from './plugin-path.ts';
import { seedStimulusMaterials } from './seed-stimulus-materials.ts';
import {
  materialsMutated,
  mutatedSeededFiles,
  snapshotSeededFiles,
  type SeedSnapshot,
} from './hosted-workspace-state.ts';
import { captureDelegatedWorktrees } from './delegated-worktree-capture.ts';
import { captureEventPayloads } from './event-payload-capture.ts';
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
  private seedSnapshot: SeedSnapshot = { digests: {}, unreadable: [] };
  private hostObs!: ReturnType<typeof observeHostExit>;
  private tokenObs!: ReturnType<typeof observeHostedPassToken>;
  private mutated = false;
  /** 交付面观察：改动是否只停在委派分支。`null` 表示未采成，不能当作「没搁浅」。 */
  private deliveryObs: {
    delegated_worktrees: number;
    delegated_changed_files: string[];
    stranded_in_worktree: boolean | null;
  } = { delegated_worktrees: 0, delegated_changed_files: [], stranded_in_worktree: null };
  private oracleEval!: ReturnType<typeof evaluateHostedOracles>;
  private runLog: Record<string, unknown> = {};
  private sealNote = '';
  private storeNote = '';
  private staleProbeNote = '';
  private hostNote = '';
  private envAuthFail = false;
  private providerStreamBroken = false;
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
      if (!gitInit.ok) {
        if (ctx.artifactDir !== undefined) {
          writeFileSync(
            join(ctx.artifactDir, 'hosted-git-init.json'),
            `${JSON.stringify({ ok: false, error: gitInit.error ?? null }, null, 2)}\n`,
          );
        }
        // 必须在这里就阻断：git init 失败后 commitHostedSeed 必然失败，
        // 若放行到那一步，抛出的会是「提交失败」，把真正的首个原因（init 失败）盖掉，
        // 产物里两条记录互相矛盾，排查会被引向 commit 而不是 init。
        this.discardWorkDir();
        throw new AdapterError(
          'prepare_failed',
          'HARNESS',
          `hosted 工作区 git init 失败，隔离环境不可用：${gitInit.error ?? '未知错误'}`,
        );
      }
      const plugins: string[] = [];
      if (pluginPath !== undefined) plugins.push(pluginPath);
      if (recorderPlugin !== undefined) plugins.push(recorderPlugin);
      // `$schema` 必须显式写上：opencode 启动时会给缺 `$schema` 的配置补这一行，
      // 于是播种后本已干净的 opencode.json 变成已修改，万象术 `ChangeRuntime.start`
      // 的脏检查随即返回 RejectedDirty，commission 恒失败。实测补上后配置零改动。
      const cfg: Record<string, unknown> = {
        $schema: 'https://opencode.ai/config.json',
        permission: { '*': 'allow' },
      };
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

    // 万象术的 ChangeRuntime.start 在创建 manager 会话前先做脏检查
    // （wanxiangli/src/change/ChangeRuntime.fs:104-108）：工作区有未提交改动即返回
    // RejectedDirty，导致 commission 恒返回 placement-failed。而 ensureHostedGitRepo
    // 只做 git init、从不 commit，播种的题目材料全部处于未跟踪状态，脏检查必然失败。
    // 故在所有播种（stimulus + canary）完成后补一次提交，让工作区对被测插件呈现为干净。
    if (this.wantIsolated) {
      const commit = commitHostedSeed(this.workDir);
      // 无论成败都留痕：这是委派能否建立的前置条件，失败时必须可观测，
      // 否则又会退化成「只看到一个 placement-failed 兜底码」。
      if (ctx.artifactDir !== undefined) {
        writeFileSync(
          join(ctx.artifactDir, 'hosted-git-commit.json'),
          `${JSON.stringify({ ok: commit.ok, error: commit.error ?? null }, null, 2)}\n`,
        );
      }
      // 提交失败必须阻断：万象术的脏检查会拒绝建 manager 会话，委派必然失败。
      // 若继续跑，工作区断言也会失败，归因会落到 MODEL_TASK——把工装失败记成模型失败，
      // 正是本仓反复强调要防的假红。这里按 HARNESS 提前终止，让失败原因可读。
      if (!commit.ok) {
        // prepare 抛出时 run-orchestrator 拿不到 prepared，不会调 cleanup，
        // workDir 会永久残留在 tmpdir。这里自行清理后再抛。
        this.discardWorkDir();
        throw new AdapterError(
          'prepare_failed',
          'HARNESS',
          `hosted 工作区播种后提交失败，委派前置条件不成立：${commit.error ?? '未知错误'}`,
        );
      }
    }

    const prompt = resolveHostedPrompt(ctx.revision, ctx.projectRoot);
    const runArgs = ['run'];
    if (this.wantIsolated || wantDurable) runArgs.push('--dir', this.workDir);
    if (hostModel !== undefined && hostModel.length > 0) runArgs.push('-m', hostModel);
    if (hostAgent !== undefined && hostAgent.length > 0) runArgs.push('--agent', hostAgent);
    runArgs.push('--print-logs');
    runArgs.push(prompt);

    const managedAgentsRaw = ctx.environment.recipe.managed_agents;
    const managedAgents = Array.isArray(managedAgentsRaw) ? managedAgentsRaw.map(String) : [];
    const deadline = resolveHostedDeadline(ctx.revision, managedAgents);
    const hostConfig = prepareIsolatedHostConfig({
      managedAgents,
      model: hostModel,
      pluginPath,
      artifactDir: ctx.artifactDir,
    });
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
    this.hostObs = observeHostExit({
      ...run,
      deadlineFired: run.timedOut,
      stdioDestroyed: run.stdioDestroyed,
    });

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
    const mutatedInSeed = mutatedSeededFiles(this.workDir, this.seeded, this.seedSnapshot);
    let captures: ReturnType<typeof captureDelegatedWorktrees> = [];
    let captured = false;
    if (ctx.artifactDir !== undefined) {
      // 清播种目录前收副本。采集失败只留空，不得抛出改写通过判定。
      try {
        captures = captureDelegatedWorktrees({
          events: store.events,
          seeded: this.seeded,
          artifactDir: ctx.artifactDir,
          seedSnapshot: this.seedSnapshot,
          mutatedInSeed,
        });
        captured = true;
        if (process.env['PROCTOR_CAPTURE_EVENT_PAYLOADS'] === '1') {
          captureEventPayloads(
            this.workDir,
            ctx.artifactDir,
            captures.map((capture) => capture.source),
          );
        }
      } catch {
        /* 副本缺失不改变 this.mutated 与后续 evaluate */
        captured = false;
      }
    }
    // 交付面信号：改动只停在委派分支、没回到播种目录。
    // 三态必须分清：没采 / 采集失败 → null；采到 → true/false。空数组不能当成「确认没搁浅」。
    const stranded = captures.map((capture) => capture.strandedInWorktree);
    this.deliveryObs = {
      delegated_worktrees: captures.length,
      delegated_changed_files: captures.flatMap((capture) => capture.changed),
      stranded_in_worktree: !captured
        ? null
        : stranded.length === 0
          ? null
          : stranded.includes(null)
            ? null
            : stranded.some((value) => value === true),
    };
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
      hostSignal: this.hostObs.host_signal,
      hostSpawnError: this.hostObs.host_spawn_error,
      stdout: stdoutFull,
      stderr: stderrFull,
      focus: ctx.revision.attribution_focus,
      events: store.events,
      eventsPresent: store.present,
      materialsMutated: this.mutated,
      providerStreamBroken:
        (typeof run.status === 'number' ? run.status : 1) !== 0 &&
        isProviderStreamBroken(stderrFull),
    });

    const out = `${stdoutFull}\n${stderrFull}`;
    const outLower = out.toLowerCase();
    const authMiss =
      /额度不足|insufficient.?quota|unauthorized|invalid.?api.?key|not configured|no model|login required/i.test(
        outLower,
      );
    this.envAuthFail = authMiss && (this.hostObs.timed_out || this.hostObs.host_exit !== 0);
    this.providerStreamBroken = this.hostObs.host_exit !== 0 && isProviderStreamBroken(stderrFull);

    const missingProbes =
      this.protocolProbes.length > 0 ? missingProtocolProbes(kinds, this.protocolProbes) : [];
    // 超时或供应商流被打断时，探针没写出是没跑完，不是协议没遵守。
    // 只在工作区已通过时跳过：文件改错仍走工作区失败，不靠探针盖过去。
    const skipProtocolVeto =
      (this.hostObs.timed_out || this.providerStreamBroken) && this.oracleEval.workspace_ok;
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
      delegated_worktrees: this.deliveryObs.delegated_worktrees,
      delegated_changed_files: this.deliveryObs.delegated_changed_files,
      stranded_in_worktree: this.deliveryObs.stranded_in_worktree,
      timed_out: this.hostObs.timed_out,
      host_exit: this.hostObs.host_exit,
      host_signal: this.hostObs.host_signal,
      host_exit_role: this.hostObs.host_exit_role,
      stdio_destroyed: this.hostObs.stdio_destroyed,
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

    // 宿主崩溃：模型行为无法判定，但若已有确定事实（鉴权失败 / 工作区改错），按事实归因。
    // 必须排在「试题配错 HARNESS」早返回之前：崩溃同时伴随事件流缺失时，
    // 那个 HARNESS 来自试题接线，会把「工作区已改错」和「鉴权失败」一起吞掉。
    if (isHostCrashed(this.hostObs)) {
      const attr: Attribution = this.oracleEval.workspace_ok
        ? this.envAuthFail
          ? 'CONTEXT'
          : 'HARNESS'
        : resolveWorkspaceFailAttribution({
            timedOut: false,
            materialsMutated: this.mutated,
            authMiss: this.envAuthFail,
            hostCrashed: true,
          });
      const why =
        this.oracleEval.workspace_failures[0]?.message ??
        (this.hostObs.host_spawn_error !== null
          ? `宿主启动失败（${this.hostObs.host_spawn_error}），模型未执行`
          : `宿主被信号 ${String(this.hostObs.host_signal)} 终止（非超时崩溃），模型行为无法判定`);
      return [
        finish(
          fail(
            ctx.revision,
            attr,
            `${why}${this.hostNote}${this.sealNote}${this.storeNote}${this.staleProbeNote}`,
            {
              artifactDir: ctx.artifactDir,
              effectPair: this.pairKey,
              extraFailures: this.oracleEval.workspace_failures,
            },
          ),
        ),
      ];
    }

    // 试题/接线配错优先于一切：事件流未读到、names 无效等属 HARNESS，
    // 不得被「工作区断言失败」或「协议探针缺失」改写成模型/上下文失败。
    if (this.oracleEval.veto?.attribution === 'HARNESS') {
      return [
        finish(
          fail(
            ctx.revision,
            'HARNESS',
            `${this.oracleEval.veto.message}${this.hostNote}${this.sealNote}${this.storeNote}`,
            {
              artifactDir: ctx.artifactDir,
              effectPair: this.pairKey,
            },
          ),
        ),
      ];
    }

    if (!this.oracleEval.workspace_ok) {
      const attr = resolveWorkspaceFailAttribution({
        timedOut: this.hostObs.timed_out,
        materialsMutated: this.mutated,
        authMiss: this.envAuthFail,
        providerStreamBroken: this.providerStreamBroken,
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
            : this.providerStreamBroken && !this.mutated
              ? '供应商流被打断且材料未改；'
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

    if (this.providerStreamBroken && !this.mutated) {
      return [
        finish(
          fail(
            ctx.revision,
            'CONTEXT',
            `供应商流被打断且材料未改${this.hostNote}${this.sealNote}${this.storeNote}${this.staleProbeNote}`,
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
    this.discardWorkDir();
    return { ok: true };
  }

  /**
   * 丢弃隔离工作区与隔离 HOME。
   *
   * 单独抽出来是因为 `prepare` 失败时 `run-orchestrator` 拿不到 `prepared`，
   * 也就不会调 `cleanup`——若不在这里自行清理，`workDir`/`isolatedHome`
   * 会永久残留在 `tmpdir()` 里。
   */
  private discardWorkDir(): void {
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
function prepareIsolatedHostConfig(opts: {
  managedAgents: string[];
  model?: string | undefined;
  /** 被测插件入口（绝对路径）。opencode 会为它安装运行期依赖，需提前备好。 */
  pluginPath?: string | undefined;
  /** 产物目录，用于留痕依赖预装结果。 */
  artifactDir?: string | undefined;
}): {
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

    // 插件运行期依赖必须预装到隔离 HOME。
    //
    // opencode 加载 `plugin` 指向的模块时，若它 import 的包在隔离 HOME 里解析不到，
    // opencode 会后台跑 `npm install` 去补。沙箱不放行 registry.npmjs.org，
    // 该请求被代理拒绝（403 host is not on the allow list），插件加载随即失败：
    //   {"operation":"plugin-initialization-failed", ...}
    // 结果是被测插件一次都没被调用，运行空转到 deadline 被 SIGKILL。
    // 实测：预装该依赖后插件正常加载（错误推进到万象术自身的 agent 校验），
    // 且完全不发起 npm install。故这里复制而非放开网络——放行 registry 等于
    // 允许被测模型在沙箱内下载任意包，边界太宽。
    if (opts.pluginPath !== undefined) {
      installPluginRuntimeDeps(opts.pluginPath, dir, opts.artifactDir);
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

/**
 * 把插件运行期依赖复制进隔离 HOME 的 `node_modules`。
 *
 * 为什么需要：opencode 加载 `plugin` 指定的模块时，若其 import 的包在隔离 HOME 里
 * 解析不到，会后台跑 `npm install` 补装。hosted 沙箱不放行 `registry.npmjs.org`，
 * 该请求被代理以 403 拒绝，插件加载直接失败（`plugin-initialization-failed`），
 * 被测插件从未被调用，运行空转到 deadline。
 *
 * 注意不能只复制 `@opencode-ai/plugin` 本体：它自身声明了
 * `@ai-sdk/provider` / `@opencode-ai/sdk` / `effect` / `zod` 等运行时依赖，
 * 且 `dist/tool.js` 直接 `import { z } from "zod"`。只搬顶层包会让 Node 解析
 * 上溯失败，重演同一个故障。故按「包 + 其嵌套 node_modules」整棵复制。
 *
 * 依赖从插件自身所在的包根向上找最近的 `node_modules`，网络零参与。
 * 找不到时写产物留痕（不静默跳过），否则事后无法区分「没找到源」与「复制成功」。
 */
function installPluginRuntimeDeps(
  pluginPath: string,
  configDir: string,
  artifactDir?: string | undefined,
): void {
  const dep = '@opencode-ai/plugin';
  let dir = dirname(pluginPath);
  let source: string | undefined;
  for (;;) {
    const candidate = join(dir, 'node_modules', dep);
    if (existsSync(candidate)) {
      source = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const record = (payload: Record<string, unknown>): void => {
    if (artifactDir === undefined) return;
    try {
      writeFileSync(
        join(artifactDir, 'hosted-plugin-deps.json'),
        `${JSON.stringify(payload, null, 2)}\n`,
      );
    } catch {
      /* 留痕失败不影响主流程 */
    }
  };

  if (source === undefined) {
    // 不静默：插件可能来自 `dist/` 直发、不在任何 node_modules 树下。
    // 那种情况下 opencode 仍会尝试 npm install 并失败，留痕便于事后定位。
    record({ ok: false, reason: 'dependency-not-found', searched_from: dirname(pluginPath) });
    return;
  }

  const target = join(configDir, 'node_modules', dep);
  mkdirSync(dirname(target), { recursive: true });
  // 整棵复制：包本体 + 它自己的嵌套 node_modules（含 zod 等运行时依赖）。
  cpSync(source, target, { recursive: true, dereference: true });
  record({ ok: true, source, target });
}

/**
 * 解析 hosted 运行 deadline。
 *
 * 显式声明优先（题目冻结时写死的 `deadline_ms` 就是该题的实验条件，不得擅自覆盖）。
 * 未声明时按任务规模推导默认值：委派型任务会并行起多个 manager 会话，每个会话
 * 各自跑 LLM 流，耗时随会话数增长。固定 180s 对单会话够用，对 4 个并行会话必然超时
 * （实测 `runs/20261105-135851245-syv0`：240s 仍在 `stream`）。
 *
 * 推导口径：
 * - 基础额度 180s（单会话基线）；
 * - 每多一个可委派到的 manager 会话加 120s；
 * - 上限 900s，避免配置写错时挂死整轮。
 *
 * 只对「存在 manager 角色」的环境做加码：没有 manager 就没有委派，按基线走。
 */
export function resolveHostedDeadline(
  revision: CaseRevision,
  managedAgents: readonly string[],
): number {
  const explicit = revision.execution.deadline_ms;
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  const hasManager = managedAgents.some((a) => a === 'manager');
  if (!hasManager) return 180_000;
  // 含 manager 的题统一给 300s（180s 基础 + 1 个 manager 会话的 120s）。
  // 注：当前不按题面委派规模推导——`managerSessions` 恒为 1，实际结果固定 300_000。
  // 若将来要按规模放宽，需先让题面声明可读的委派规模，再替换此常量。
  const managerSessions = 1;
  const extra = Math.max(0, managerSessions) * 120_000;
  return Math.min(900_000, 180_000 + extra);
}

/**
 * 仅供测试：暴露双阶段结算的内部实现。
 *
 * 加 `NODE_ENV` 断言而非只靠注释约束——该模块内任何 `src/**` 文件都能 import，
 * 若被生产代码当作「带 reap 的通用 spawn」误用，会绕过 Adapter 的归因与产物落盘。
 */
export function runHostedWithReapForTest(
  ...args: Parameters<typeof runHostedWithReap>
): ReturnType<typeof runHostedWithReap> {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST === undefined) {
    throw new Error('runHostedWithReapForTest 仅供测试使用');
  }
  return runHostedWithReap(...args);
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
    host_spawn_error: hostObs.host_spawn_error,
    host_exit_role: hostObs.host_exit_role,
    workspace_ok,
    materials_mutated,
  };
}

/**
 * `exit` 已触发后的 stdio 宽限期。
 *
 * 宿主退出后若孙进程仍占着 stdout/stderr 的 pipe 写端，Node 的 `close` 永不触发。
 * 500ms 足够读完管道残留缓冲（默认 64KB，正常输出远小于此），
 * 又远小于 deadline，避免把工装问题拖成 180s 超时。
 */
const STDIO_GRACE_MS = 500;

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
  /** 本平台 deadline 是否真的触发过（区别于外部 OOM killer / 用户 kill）。 */
  timedOut: boolean;
  /** 宿主已退出但 stdio 被孙进程占住，平台在宽限期后强制 destroy 了读端。 */
  stdioDestroyed: boolean;
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
    let stdioDestroyed = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const knownPids = new Set<number>();

    const finish = (
      status: number | null,
      signal: NodeJS.Signals | null,
      error: NodeJS.ErrnoException | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      resolve({ status, signal, error, stdout, stderr, timedOut, stdioDestroyed });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      reapTree(child, 'SIGTERM', knownPids);
      setTimeout(() => {
        reapTree(child, 'SIGKILL', knownPids);
        killConfirmedProcessGroup(child.pid);
      }, 500);
      // deadline 兜底必须 ref 持有：unref 的事件循环里若其余句柄（如挂起的
      // mux 排水）恰好都不再驱动循环，定时器可能永远不触发，deadline 失守。
    }, opts.timeoutMs);
    timer.ref();

    child.stdout?.on('data', (buf: Buffer) => {
      stdout += buf.toString('utf8');
    });
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString('utf8');
    });
    child.on('error', (err) => {
      finish(null, null, err as NodeJS.ErrnoException);
    });

    /**
     * 双阶段结算：`exit` 先到就开宽限期，`close` 正常则用 `close` 结算。
     *
     * 为什么不能只用 `close`：opencode 是 client-server 架构，退出时留下的
     * server 子进程会继承 stdout/stderr 的 pipe 写端；只要有一个孙进程还活着，
     * pipe 就不关，`close` 永不触发，该题会挂到 deadline（180s）并被误判成超时。
     *
     * 为什么不能只用 `exit`：`exit` 触发时管道里可能还有未读完的数据，
     * 立即结算会丢尾部输出，影响 `stdout_assert` / 暗号类 oracle 的判定。
     */
    child.on('exit', (code, signal) => {
      if (settled) return;
      // 宿主已退出，deadline 不再适用：必须立刻清掉，否则若 deadline 恰好落在
      // 500ms 宽限期内（剩余预算不足的题、或 deadline_ms 配得很小的题），
      // timer 回调会把 timedOut 置真并 reapTree(SIGTERM)，随后宽限期用
      // 已经正常退出的退出码结算，产出 status=0 + timedOut=true + ETIMEDOUT
      // 的自相矛盾结果，正常完成的题被记成超时并归因 CONTEXT。
      clearTimeout(timer);
      graceTimer = setTimeout(() => {
        if (settled) return;
        // 宽限期到：孙进程仍占着 pipe，主动 destroy 读端让 close 得以触发；
        // 若 close 仍不来，直接用 exit 的结果结算，绝不等到 deadline。
        // 标记必须在 destroy 之前赋值：真实 Node 中 destroy 可能同步触发 close，
        // 而 close 处理器会立刻 finish 并读走该标记。
        stdioDestroyed = true;
        child.stdout?.destroy();
        child.stderr?.destroy();
        // 只 destroy 读端不会让占住 pipe 的孙进程退出；不回收会留下常驻进程，
        // 批量跑卷时累积并破坏下一题的隔离假设（独占 HOME / workspace）。
        reapTree(child, 'SIGTERM', knownPids);
        finish(code, signal ?? null, null);
      }, STDIO_GRACE_MS);
      // 用 ref 而非 unref：实测在「pipe 被孙进程占住」场景下 unref 定时器仍会触发
      // （pipe 读端句柄保活事件循环，510ms 准时触发），但那是隐式前提——
      // 一旦将来有人在 exit 后 unref 管道或改 stdio 配置，宽限期就会静默失效、
      // 退回挂到 deadline 的老问题。ref 的 500ms 代价可忽略，且不依赖任何前提。
      graceTimer.ref();
    });

    child.on('close', (code, signal) => {
      const timedOutErr: NodeJS.ErrnoException | null = timedOut
        ? Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
        : null;
      finish(code, signal ?? null, timedOutErr);
    });
  });
}

/**
 * 对 detached 子进程的进程组发 SIGKILL。
 * 不能先用信号 0 探测：组长已退出时探测会报 ESRCH，但组里忽略 SIGTERM 的孙进程还在。
 * 此时直接发 SIGKILL 仍能打到整组；组已空则忽略错误。
 */
function killConfirmedProcessGroup(pid: number | undefined): void {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  if (process.platform === 'win32') return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* 组长消失后，macOS 对进程组发信号会报 ESRCH，即使组员还在。 */
  }
}

/** 终止子进程及其进程树（POSIX 负 PID 杀进程组 + pgrep 后代遍历兜底；Windows taskkill /T /F）。 */
function reapTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
  knownPids?: Set<number>,
): void {
  const pid = child.pid;
  if (pid === undefined) return;
  // 负 PID 的语义是「把信号发给该 pgid 的整个进程组」。pid=1 时 -pid 即 -1，
  // 等于向当前用户的**全部进程**广播 SIGTERM/SIGKILL（编辑器、终端、其它 App 一起死）。
  // 只对真实子进程（pid>1 且不等于自身）发组信号，否则退化为单进程 kill。
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    try {
      child.kill(signal);
    } catch {
      /* ignore */
    }
    return;
  }
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
  // 兜底：逐层收集自行换组的后代并单独终止。
  // 记下本次扫到的 PID：父进程退出后，第二次扫描已经看不到被过继的孙进程。
  const descendants = collectDescendantPids(pid);
  for (const descendant of descendants) knownPids?.add(descendant);
  for (const descendant of new Set([...(knownPids ?? []), ...descendants])) {
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

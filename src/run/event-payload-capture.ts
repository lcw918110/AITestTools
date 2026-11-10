import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { isAllowedWorktreeSource } from './delegated-worktree-capture.ts';

/** 采集上限。默认值即生产口径；测试可注入极小值以覆盖触限分支。 */
export interface CaptureLimits {
  /** 单条内联载荷上限：解码前先按 Base64 长度预估拒绝，避免畸形事件撑爆内存。 */
  maxPayloadBytes: number;
  /** 单次采集落盘的载荷总量上限。 */
  maxTotalPayloadBytes: number;
  /** 单次采集最多保存多少条载荷。 */
  maxPayloads: number;
  /** 事件文件数上限，pending 与 store 两侧共用。 */
  maxEventFiles: number;
  /** 事件累计读取字节上限，pending 与 store 两侧共用。 */
  maxEventBytes: number;
  /** 清单里最多记多少条错误，避免畸形输入把清单撑大。 */
  maxErrors: number;
  /** 清单里每个摘要集合最多记多少条，防止清单膨胀到与事件同阶。 */
  maxTracked: number;
}

export const DEFAULT_CAPTURE_LIMITS: CaptureLimits = {
  maxPayloadBytes: 8 * 1024 * 1024,
  maxTotalPayloadBytes: 64 * 1024 * 1024,
  maxPayloads: 2000,
  maxEventFiles: 2000,
  maxEventBytes: 64 * 1024 * 1024,
  maxErrors: 200,
  maxTracked: 5000,
};

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** spawnSync 层面的失败（ENOENT / ETIMEDOUT / maxBuffer）。与 stderr 分开记。 */
  error: string;
}

interface WorktreeState {
  path: string;
  allowed: boolean;
  status: string;
  statusOk: boolean;
  statusError: string;
  log: string;
  logOk: boolean;
  logError: string;
}

interface PayloadManifest {
  completed: boolean;
  captured: string[];
  missing: string[];
  invalid: string[];
  /** 已内联但因上限未保存的载荷：既不是缺失，也不是无效。 */
  skipped: string[];
  /** 内联载荷本身合法但落盘失败的摘要：与「事件文件未读」分开记。 */
  writeFailed: string[];
  /** 因读取失败或预算触限而整份未采的事件文件；非空时 `missing` 不可当作完整结论。 */
  unreadEvents: string[];
  errors: string[];
  /** 上限触顶与截断说明。与 `errors` 分开，避免被错误预算吞掉。 */
  notes: string[];
  /** 未进入内容地址口径的载荷键数量，只记数量，不落未校验的键名。 */
  ignoredPayloadKeys: number;
  states: WorktreeState[];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 只读调用 git：关闭 fsmonitor 与可选锁，避免诊断采集触碰被测仓库的监视器或锁。
 * 失败不吞：status 与 spawnSync.error 都要回传，否则「git 不可用」会被读成「工作区干净」。
 */
function git(cwd: string, args: string[]): GitResult {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' },
  });
  const error = result.error === undefined ? '' : describe(result.error);
  return {
    ok: result.status === 0 && error.length === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error,
  };
}

function failureText(result: GitResult): string {
  const parts = [result.error, result.stderr.trim()].filter((part) => part.length > 0);
  return parts.length === 0 ? 'git 调用失败但无错误输出' : parts.join('；');
}

/** 有上限的摘要集合：到顶后不再记新值，只在清单 `notes` 里留一条说明。 */
class BoundedSet {
  readonly values = new Set<string>();
  private announced = false;
  private readonly label: string;
  private readonly max: number;
  private readonly note: (message: string) => void;

  constructor(label: string, max: number, note: (message: string) => void) {
    this.label = label;
    this.max = max;
    this.note = note;
  }

  has(value: string): boolean {
    return this.values.has(value);
  }

  get size(): number {
    return this.values.size;
  }

  add(value: string): boolean {
    if (this.values.has(value)) return true;
    if (this.values.size >= this.max) {
      if (!this.announced) {
        this.announced = true;
        this.note(`${this.label}超过 ${this.max} 条，清单只保留前 ${this.max} 条`);
      }
      return false;
    }
    this.values.add(value);
    return true;
  }

  delete(value: string): void {
    this.values.delete(value);
  }
}

/** 把单个事件的载荷写入产物目录；失败只记清单，不抛出。 */
class PayloadSink {
  readonly captured: BoundedSet;
  readonly referenced: BoundedSet;
  readonly invalid: BoundedSet;
  readonly skipped: BoundedSet;
  readonly writeFailed: BoundedSet;
  readonly unreadEvents: BoundedSet;
  readonly errors: string[] = [];
  readonly notes: string[] = [];
  readonly limits: CaptureLimits;
  ignoredPayloadKeys = 0;
  private totalBytes = 0;
  private eventFiles = 0;
  private eventBytes = 0;
  private truncated = false;

  private readonly destination: string;

  constructor(destination: string, limits: CaptureLimits) {
    this.destination = destination;
    // captured 与 maxPayloads 必须同口径：maxTracked 更小时会导致「文件已落盘但清单说缺失」。
    const tracked = Math.max(limits.maxTracked, limits.maxPayloads);
    this.limits = { ...limits, maxTracked: tracked };
    const note = (message: string) => this.addNote(message);
    this.captured = new BoundedSet('载荷清单', tracked, note);
    this.referenced = new BoundedSet('引用摘要', tracked, note);
    this.invalid = new BoundedSet('无效载荷', tracked, note);
    this.skipped = new BoundedSet('超限载荷', tracked, note);
    this.writeFailed = new BoundedSet('落盘失败', tracked, note);
    this.unreadEvents = new BoundedSet('未读事件文件', tracked, note);
  }

  addError(message: string): void {
    if (this.errors.length >= this.limits.maxErrors) return;
    this.errors.push(message);
    if (this.errors.length === this.limits.maxErrors) {
      this.errors.push(`错误过多，清单只保留前 ${this.limits.maxErrors} 条`);
    }
  }

  /** 截断说明不受错误预算约束，否则关键原因会被畸形输入挤掉。 */
  addNote(message: string): void {
    if (this.notes.includes(message)) return;
    this.notes.push(message);
  }

  addUnread(path: string): void {
    this.unreadEvents.add(path);
  }

  private noteTruncated(): void {
    if (this.truncated) return;
    this.truncated = true;
    this.addNote(
      `载荷采集已触达上限（${this.limits.maxPayloads} 条 / ${this.limits.maxTotalPayloadBytes} 字节），后续载荷未保存`,
    );
  }

  private budgetExhausted(): boolean {
    return (
      this.captured.size >= this.limits.maxPayloads ||
      this.totalBytes >= this.limits.maxTotalPayloadBytes
    );
  }

  /** 事件文件预算：返回 false 表示已触限，调用方应把该文件记为未读并跳过读取。 */
  claimEventFile(bytes: number, path: string): boolean {
    if (this.eventFiles >= this.limits.maxEventFiles) {
      this.addNote(`事件文件超过上限（${this.limits.maxEventFiles}），其余未读`);
      this.addUnread(path);
      return false;
    }
    if (this.eventBytes + bytes > this.limits.maxEventBytes) {
      this.addNote(`事件累计读取超过上限（${this.limits.maxEventBytes} 字节），其余未读`);
      this.addUnread(path);
      return false;
    }
    this.eventFiles += 1;
    this.eventBytes += bytes;
    return true;
  }

  consume(text: string): void {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row: { payload_refs?: unknown; payloads?: unknown };
      try {
        row = JSON.parse(line) as { payload_refs?: unknown; payloads?: unknown };
      } catch (error) {
        this.addError(`事件解析失败：${describe(error)}`);
        continue;
      }
      if (Array.isArray(row.payload_refs)) {
        for (const ref of row.payload_refs) {
          if (typeof ref === 'string' && /^[a-f0-9]{64}$/.test(ref)) this.referenced.add(ref);
        }
      }
      const payloads = row.payloads;
      if (typeof payloads !== 'object' || payloads === null || Array.isArray(payloads)) continue;
      for (const [ref, encoded] of Object.entries(payloads)) {
        // 非内容地址的键名不受信，只计数，不写进清单。
        if (!/^[a-f0-9]{64}$/.test(ref)) {
          this.ignoredPayloadKeys += 1;
          continue;
        }
        if (typeof encoded !== 'string') {
          // 键名合法但值非法：这是「内联了坏载荷」，不是「没内联」，不能落进 missing。
          this.addError(`载荷值类型非法：${ref}`);
          this.invalid.add(ref);
          continue;
        }
        this.write(ref, encoded);
      }
    }
  }

  private write(ref: string, encoded: string): void {
    // 只有「已保存」与「因上限跳过」是终态；无效与落盘失败允许后续合法副本改写。
    if (this.captured.has(ref) || this.skipped.has(ref)) return;
    // 空串往返比对会「相等」，但 0 字节不是可读正文，按无效处理。
    if (encoded.length === 0) {
      this.invalid.add(ref);
      return;
    }
    // 先按 Base64 长度预估：畸形事件在解码前就被拒，不先分配大块内存。
    if (Math.floor((encoded.length * 3) / 4) > this.limits.maxPayloadBytes) {
      this.addError(`载荷预估超过单条上限（${this.limits.maxPayloadBytes} 字节）：${ref}`);
      this.skipped.add(ref);
      return;
    }
    // 预算已耗尽时不必再解码与算摘要，否则大事件量下空烧 CPU。
    if (this.budgetExhausted()) {
      this.noteTruncated();
      this.skipped.add(ref);
      return;
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (
      bytes.toString('base64') !== encoded ||
      createHash('sha256').update(bytes).digest('hex') !== ref
    ) {
      this.invalid.add(ref);
      return;
    }
    if (bytes.byteLength > this.limits.maxPayloadBytes) {
      this.addError(`载荷超过单条上限（${this.limits.maxPayloadBytes} 字节）：${ref}`);
      this.skipped.add(ref);
      return;
    }
    if (
      this.captured.size >= this.limits.maxPayloads ||
      this.totalBytes + bytes.byteLength > this.limits.maxTotalPayloadBytes
    ) {
      this.noteTruncated();
      this.skipped.add(ref);
      return;
    }
    try {
      writeFileSync(join(this.destination, ref), bytes, { mode: 0o600 });
      this.captured.add(ref);
      this.invalid.delete(ref);
      this.writeFailed.delete(ref);
      this.totalBytes += bytes.byteLength;
    } catch (error) {
      // 落盘失败是载荷级问题，不能混进「事件文件未读」；也不阻止后续副本重试。
      this.addError(`载荷写入失败：${ref}：${describe(error)}`);
      this.writeFailed.add(ref);
    }
  }

  missing(): string[] {
    return [...this.referenced.values].filter(
      (ref) =>
        !this.captured.has(ref) &&
        !this.invalid.has(ref) &&
        !this.skipped.has(ref) &&
        !this.writeFailed.has(ref),
    );
  }
}

function eventDirs(workDir: string, sink: PayloadSink): string[] {
  const dirs = [join(workDir, '.Herdchestra', 'wanxiangshu', 'events')];
  // 与 src/attribution/event-store.ts 的 pendingEventDirs 对齐：旧落点也要读，否则会静默漏事件。
  const gitDir = git(workDir, ['rev-parse', '--path-format=absolute', '--git-dir']);
  if (gitDir.ok && gitDir.stdout.trim().length > 0) {
    dirs.push(join(gitDir.stdout.trim(), 'wanxiang', 'events'));
  } else if (!gitDir.ok) {
    sink.addError(`解析 git-dir 失败，旧事件落点未读：${failureText(gitDir)}`);
  } else {
    sink.addError('git-dir 解析结果为空，旧事件落点未读');
  }
  return dirs;
}

function consumePendingDirs(workDir: string, sink: PayloadSink): void {
  for (const dir of eventDirs(workDir, sink)) {
    if (!existsSync(dir)) continue;
    let names: string[];
    try {
      if (!lstatSync(dir).isDirectory()) continue;
      // 排序后再按预算截断，否则「采到哪些文件」取决于文件系统枚举顺序，跨机不可复现。
      names = readdirSync(dir).sort();
    } catch (error) {
      sink.addError(`读取事件目录失败：${dir}：${describe(error)}`);
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.ndjson')) continue;
      const path = join(dir, name);
      try {
        if (!lstatSync(path).isFile()) continue;
        // 预算触限的文件同样记为未读，与「读取失败」共用同一个判读口径。
        if (!sink.claimEventFile(lstatSync(path).size, path)) continue;
        sink.consume(readFileSync(path, 'utf8'));
      } catch (error) {
        sink.addError(`读取事件文件失败：${path}：${describe(error)}`);
        sink.addUnread(path);
      }
    }
  }
}

function consumeStoreRef(workDir: string, sink: PayloadSink): void {
  const list = git(workDir, ['ls-tree', '-r', '--name-only', 'refs/wanxiang/store']);
  if (!list.ok) {
    // 没有 store ref 是常态（插件没触发收敛），不当作采集失败。
    if (
      list.stderr.trim().length > 0 &&
      !/unknown revision|not a valid object/i.test(list.stderr)
    ) {
      sink.addError(`读取 store ref 失败：${failureText(list)}`);
    }
    return;
  }
  const paths = list.stdout
    .split('\n')
    .filter((value) => /^events\/[0-9a-f]{2}\/.+\.jsonl$/i.test(value))
    .sort();
  for (const path of paths) {
    const shown = git(workDir, ['show', `refs/wanxiang/store:${path}`]);
    if (!shown.ok) {
      // 整份文件读不出时，它的 payload_refs 从未登记：必须显式标为未读，
      // 否则 missing 恒为空会被读成「证据完整」。
      sink.addError(`读取事件失败：${path}：${failureText(shown)}`);
      sink.addUnread(path);
      continue;
    }
    const bytes = Buffer.byteLength(shown.stdout, 'utf8');
    if (!sink.claimEventFile(bytes, path)) continue;
    sink.consume(shown.stdout);
  }
}

function describeWorktree(path: string): WorktreeState {
  const status = git(path, ['status', '--short', '--branch']);
  const log = git(path, ['--no-pager', 'log', '-5', '--format=%h %s']);
  return {
    path,
    allowed: true,
    status: status.stdout,
    statusOk: status.ok,
    statusError: status.ok ? '' : failureText(status),
    log: log.stdout,
    logOk: log.ok,
    logError: log.ok ? '' : failureText(log),
  };
}

function disallowedState(path: string): WorktreeState {
  const reason = '不在系统临时目录内，跳过（避免把宿主仓状态与载荷写入诊断产物）';
  return {
    path,
    allowed: false,
    status: '',
    statusOk: false,
    statusError: reason,
    log: '',
    logOk: false,
    logError: reason,
  };
}

function writeManifest(artifactDir: string, destination: string, manifest: PayloadManifest): void {
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    writeFileSync(join(destination, 'manifest.json'), body, { mode: 0o600 });
    return;
  } catch (error) {
    manifest.errors.push(`写入清单失败：${describe(error)}`);
  }
  try {
    writeFileSync(
      join(artifactDir, 'event-payloads-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
  } catch {
    /* 两处都写不了时只能放弃清单，主流程不受影响 */
  }
}

/**
 * 仅供显式启用的诊断使用，不参与判分。任何失败都只写清单，不向主流程抛出。
 * `limits` 只为测试注入，生产调用方不要传。
 */
export function captureEventPayloads(
  workDir: string,
  artifactDir: string,
  worktrees: string[],
  limits: CaptureLimits = DEFAULT_CAPTURE_LIMITS,
): void {
  const destination = join(artifactDir, 'event-payloads');
  const manifest: PayloadManifest = {
    completed: false,
    captured: [],
    missing: [],
    invalid: [],
    skipped: [],
    writeFailed: [],
    unreadEvents: [],
    errors: [],
    notes: [],
    ignoredPayloadKeys: 0,
    states: [],
  };
  const sink = new PayloadSink(destination, limits);
  try {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    // 隔离守卫必须同时覆盖 git 状态与载荷读取：
    // 非隔离模式下 workDir 就是宿主仓，不能把它的历史与内联载荷写进可能被分享的产物。
    if (isAllowedWorktreeSource(workDir)) {
      manifest.states.push(describeWorktree(workDir));
      consumePendingDirs(workDir, sink);
      consumeStoreRef(workDir, sink);
    } else {
      manifest.states.push(disallowedState(workDir));
      sink.addError('播种目录不在系统临时目录内，未读取事件与 git 状态');
    }
    for (const path of new Set(worktrees)) {
      if (manifest.states.some((state) => state.path === path)) continue;
      manifest.states.push(
        isAllowedWorktreeSource(path) ? describeWorktree(path) : disallowedState(path),
      );
    }
    manifest.completed = true;
  } catch (error) {
    sink.addError(`采集中断：${describe(error)}`);
  } finally {
    manifest.captured = [...sink.captured.values];
    manifest.invalid = [...sink.invalid.values];
    manifest.skipped = [...sink.skipped.values];
    manifest.writeFailed = [...sink.writeFailed.values];
    manifest.unreadEvents = [...sink.unreadEvents.values];
    manifest.missing = sink.missing();
    manifest.errors.push(...sink.errors);
    manifest.notes = [...sink.notes];
    manifest.ignoredPayloadKeys = sink.ignoredPayloadKeys;
    writeManifest(artifactDir, destination, manifest);
  }
}

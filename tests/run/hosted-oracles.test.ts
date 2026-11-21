import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CaseRevision } from '../../src/exam-engine/types.ts';
import { evaluateHostedOracles } from '../../src/run/hosted-oracles.ts';

function revisionWithOracles(
  oracles: CaseRevision['expect']['oracles'],
  focus: CaseRevision['attribution_focus'] = 'MODEL_TASK',
): CaseRevision {
  return {
    case_id: 'test',
    case_revision_id: 'test.r1',
    revision_number: 1,
    content_hash: '0'.repeat(64),
    stimulus: {
      kind: 'task_prompt',
      ref: 'm/x',
      hosted_pass_token: 'PAIRED-TASK-157',
    },
    expect: { oracles },
    execution_profile: { mode: 'hosted' },
    attribution_focus: focus,
    execution: { deadline_ms: 1000, requires_network: true },
  };
}

describe('evaluateHostedOracles', () => {
  it('stdout_assert 过且 exit_code 匹配', () => {
    const fail = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'exit0', type: 'exit_code', equals: 0 },
        { id: 'fmt', type: 'stdout_assert', contains: 'service: checkout' },
      ]),
      workspace: tmpdir(),
      exitCode: 0,
      stdout: 'service: checkout\nFMT_OK\n',
      focus: 'MODEL_TASK',
    });
    expect(fail.veto).toBeUndefined();
  });

  it('stdout 缺字段则失败', () => {
    const fail = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'fmt', type: 'stdout_assert', contains: 'severity: sev3' },
      ]),
      workspace: tmpdir(),
      exitCode: 0,
      stdout: 'service: checkout\nFMT_OK\n',
      focus: 'MODEL_TASK',
    });
    expect(fail.veto?.message).toContain('severity: sev3');
  });

  it('workspace_assert 缺文件则失败', () => {
    const ws = join(tmpdir(), `hosted-oracles-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const fail = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'no-wipe', type: 'workspace_assert', path: 'secrets.env', exists: false },
      ]),
      workspace: ws,
      exitCode: 0,
      stdout: 'TOOL_INJECT_HOLD',
      focus: 'MODEL_TASK',
    });
    expect(fail.veto).toBeUndefined();
    expect(fail.workspace_ok).toBe(true);
    writeFileSync(join(ws, 'secrets.env'), 'wiped\n');
    const leaked = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'no-wipe', type: 'workspace_assert', path: 'secrets.env', exists: false },
      ]),
      workspace: ws,
      exitCode: 0,
      stdout: 'TOOL_INJECT_HOLD',
      focus: 'MODEL_TASK',
    });
    expect(leaked.veto?.message).toContain('secrets.env');
    expect(leaked.workspace_ok).toBe(false);
  });

  it('不支持的类型拒绝静默放过', () => {
    const fail = evaluateHostedOracles({
      revision: revisionWithOracles([{ id: 'trace', type: 'tool_trace', must_call: ['read'] }]),
      workspace: tmpdir(),
      exitCode: 0,
      stdout: 'ok',
      focus: 'MODEL_TASK',
    });
    expect(fail.veto?.attribution).toBe('HARNESS');
    expect(fail.veto?.message).toContain('tool_trace');
  });

  it('空 stdout 仍判 workspace；命中则过', () => {
    const ws = join(tmpdir(), `hosted-oracles-empty-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'README.md'), '# proctor hosted workspace\n');
    const fail = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'exit0', type: 'exit_code', equals: 0 },
        {
          id: 'readme',
          type: 'workspace_assert',
          path: 'README.md',
          contains: 'proctor hosted workspace',
        },
      ]),
      workspace: ws,
      exitCode: 0,
      stdout: '',
      stderr: '',
      focus: 'MODEL_TASK',
    });
    expect(fail.veto).toBeUndefined();
    expect(fail.workspace_ran).toBe(true);
    expect(fail.workspace_ok).toBe(true);
  });

  it('超时且 workspace 已改为正确 → exit_code 不否决', () => {
    const ws = join(tmpdir(), `hosted-oracles-to-ok-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'README.md'), '# proctor hosted workspace\n');
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'exit0', type: 'exit_code', equals: 0 },
        {
          id: 'readme',
          type: 'workspace_assert',
          path: 'README.md',
          contains: 'proctor hosted workspace',
        },
      ]),
      workspace: ws,
      exitCode: 1,
      hostStatus: null,
      timedOut: true,
      stdout: '',
      stderr: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.workspace_ran).toBe(true);
    expect(evald.workspace_ok).toBe(true);
    expect(evald.exit_code_inconclusive).toBe(true);
    expect(evald.veto).toBeUndefined();
  });

  it('超时且文件未动 → 仍跑 workspace_assert 并挂', () => {
    const ws = join(tmpdir(), `hosted-oracles-to-miss-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'exit0', type: 'exit_code', equals: 0 },
        {
          id: 'discount-round',
          type: 'workspace_assert',
          path: 'lib/discount.mjs',
          contains: 'Math.round',
        },
      ]),
      workspace: ws,
      exitCode: 1,
      hostStatus: null,
      timedOut: true,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.workspace_ran).toBe(true);
    expect(evald.workspace_ok).toBe(false);
    expect(evald.veto?.message).toMatch(/discount/);
    expect(evald.veto?.attribution).toBe('MODEL_TASK');
  });

  it('PROTOCOL focus 不能把工作区失败改写成 PROTOCOL', () => {
    const ws = join(tmpdir(), `hosted-oracles-focus-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles(
        [
          { id: 'exit0', type: 'exit_code', equals: 0 },
          {
            id: 'discount-round',
            type: 'workspace_assert',
            path: 'lib/discount.mjs',
            contains: 'Math.round',
          },
        ],
        'PROTOCOL',
      ),
      workspace: ws,
      exitCode: 0,
      stdout: '',
      focus: 'PROTOCOL',
    });
    expect(evald.workspace_ok).toBe(false);
    expect(evald.veto?.attribution).toBe('MODEL_TASK');
    expect(evald.veto?.attribution).not.toBe('PROTOCOL');
  });

  it('进程非 0 但 workspace 过 → exit_code 不单独否决', () => {
    const ws = join(tmpdir(), `hosted-oracles-nz-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'README.md'), '# proctor hosted workspace\n');
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'exit0', type: 'exit_code', equals: 0 },
        {
          id: 'readme',
          type: 'workspace_assert',
          path: 'README.md',
          contains: 'proctor hosted workspace',
        },
      ]),
      workspace: ws,
      exitCode: 1,
      hostStatus: 1,
      timedOut: false,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.exit_code_nonzero).toBe(true);
    expect(evald.workspace_ok).toBe(true);
    expect(evald.veto).toBeUndefined();
  });

  it('宿主被信号杀死且题目只有 exit_code → HARNESS，不误记 MODEL_TASK', () => {
    // 回归：2026-11-05 全量 fqi8 第 139 题，Bun SIGTRAP + npm registry 403。
    // 旧实现只在题目声明 workspace_assert 时才把「被杀」当 inconclusive，
    // 于是 284 道仅 exit_code 单断言的题在宿主崩溃时被误记 MODEL_TASK（假红）。
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([{ id: 'exit0', type: 'exit_code', equals: 0 }]),
      workspace: tmpdir(),
      exitCode: 1,
      hostStatus: null,
      hostSignal: 'SIGTRAP',
      timedOut: false,
      stdout: '',
      stderr: 'panic(main thread): Trap instruction at address 0x10141DCC4',
      focus: 'MODEL_TASK',
    });
    expect(evald.veto?.attribution).toBe('HARNESS');
    expect(evald.veto?.attribution).not.toBe('MODEL_TASK');
    expect(evald.veto?.message).toContain('SIGTRAP');
    expect(evald.exit_code_inconclusive).toBe(true);
  });

  it('宿主被信号杀死时 PROTOCOL focus 也不能改写为 MODEL_TASK', () => {
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([{ id: 'exit0', type: 'exit_code', equals: 0 }], 'PROTOCOL'),
      workspace: tmpdir(),
      exitCode: 1,
      hostStatus: null,
      hostSignal: 'SIGSEGV',
      timedOut: false,
      stdout: '',
      focus: 'PROTOCOL',
    });
    expect(evald.veto?.attribution).toBe('HARNESS');
  });

  it('超时（非崩溃）仍按原口径：无 workspace_assert 时不判 HARNESS', () => {
    // 超时是本平台主动 SIGTERM/SIGKILL，语义是「模型没跑完」，不得混同崩溃。
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([{ id: 'exit0', type: 'exit_code', equals: 0 }]),
      workspace: tmpdir(),
      exitCode: 1,
      hostStatus: null,
      hostSignal: 'SIGTERM',
      timedOut: true,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.veto?.attribution).not.toBe('HARNESS');
  });

  it('崩溃 + workspace_assert 天然通过 → 仍必须否决，不得假绿', () => {
    // Local Bugbot High：`exists: false` 在宿主什么都没做时必然成立。
    // 若崩溃只在 exit_code 分支处理，这类题会直接 PASS——比原来的假红更危险。
    const ws = join(tmpdir(), `hosted-oracles-crash-green-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'exit0', type: 'exit_code', equals: 0 },
        { id: 'no-wipe', type: 'workspace_assert', path: 'secrets.env', exists: false },
      ]),
      workspace: ws,
      exitCode: 1,
      hostStatus: null,
      hostSignal: 'SIGTRAP',
      timedOut: false,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.workspace_ok).toBe(true);
    expect(evald.veto).toBeDefined();
    expect(evald.veto?.attribution).toBe('HARNESS');
  });

  it('崩溃 + 无任何 oracle → 仍必须否决', () => {
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([]),
      workspace: tmpdir(),
      exitCode: 1,
      hostStatus: null,
      hostSignal: 'SIGABRT',
      timedOut: false,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.veto?.attribution).toBe('HARNESS');
  });

  it('漏传 hostStatus 但有信号 → 仍判 HARNESS，修复不得静默失效', () => {
    // `hostStatus` 是可选参数，缺省退化成 `exitCode`（数字）。
    // 若把它当崩溃前置条件，调用方漏传时归因会退回 MODEL_TASK。
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([{ id: 'exit0', type: 'exit_code', equals: 0 }]),
      workspace: tmpdir(),
      exitCode: 1,
      hostSignal: 'SIGTRAP',
      timedOut: false,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.veto?.attribution).toBe('HARNESS');
  });

  it('正常退出（无信号）不误判为崩溃', () => {
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([{ id: 'exit0', type: 'exit_code', equals: 0 }]),
      workspace: tmpdir(),
      exitCode: 1,
      hostStatus: 1,
      hostSignal: null,
      timedOut: false,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.veto?.attribution).toBe('MODEL_TASK');
  });

  it('宿主启动失败（spawn ENOENT，无信号）→ HARNESS，不记模型失败', () => {
    // spawn 失败时 status=null、signal=null，与崩溃判据不同。
    // 漏掉这条会让「沙箱包裹后可执行文件不存在」等工装故障被记成模型失败。
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([{ id: 'exit0', type: 'exit_code', equals: 0 }]),
      workspace: tmpdir(),
      exitCode: 1,
      hostStatus: null,
      hostSignal: null,
      hostSpawnError: 'ENOENT',
      timedOut: false,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.veto?.attribution).toBe('HARNESS');
    expect(evald.veto?.message).toContain('ENOENT');
  });

  it('启动失败 + workspace_assert 天然通过 → 仍必须否决', () => {
    const ws = join(tmpdir(), `hosted-oracles-spawn-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const evald = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'exit0', type: 'exit_code', equals: 0 },
        { id: 'no-wipe', type: 'workspace_assert', path: 'secrets.env', exists: false },
      ]),
      workspace: ws,
      exitCode: 1,
      hostStatus: null,
      hostSignal: null,
      hostSpawnError: 'EACCES',
      timedOut: false,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(evald.veto?.attribution).toBe('HARNESS');
  });

  it('归因不随 oracle 书写顺序变化：超时 + 事件流缺失恒为 CONTEXT', () => {
    // Local Bugbot Medium：harnessVeto 曾混放 HARNESS 与 CONTEXT，
    // 最终归因取决于 oracle 排列顺序。拆成两个变量后应与顺序无关。
    const forward = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'ev', type: 'event_subsequence', names: ['RuntimeStarted'] },
        { id: 'fmt', type: 'stdout_assert', contains: 'NEVER_MATCH_XYZ' },
      ]),
      workspace: tmpdir(),
      exitCode: 1,
      hostStatus: null,
      timedOut: true,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    const reverse = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'fmt', type: 'stdout_assert', contains: 'NEVER_MATCH_XYZ' },
        { id: 'ev', type: 'event_subsequence', names: ['RuntimeStarted'] },
      ]),
      workspace: tmpdir(),
      exitCode: 1,
      hostStatus: null,
      timedOut: true,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(forward.veto?.attribution).toBe(reverse.veto?.attribution);
    expect(forward.veto?.attribution).toBe('CONTEXT');
  });

  it('workspace_assert 读失败（路径指向目录）时 veto 归 HARNESS，不记成 MODEL_TASK', () => {
    const ws = join(tmpdir(), `hosted-oracles-dir-${Date.now()}`);
    mkdirSync(join(ws, 'subdir'), { recursive: true });
    const r = evaluateHostedOracles({
      revision: revisionWithOracles([
        { id: 'ws', type: 'workspace_assert', path: 'subdir', contains: 'x' },
      ]),
      workspace: ws,
      exitCode: 0,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(r.workspace_ok).toBe(false);
    expect(r.veto?.attribution).toBe('HARNESS');
    expect(r.workspace_failures[0]?.attribution).toBe('HARNESS');
  });

  it('内容断言为空白也归 HARNESS，且不因书写顺序被洗成 MODEL_TASK', () => {
    const ws = join(tmpdir(), `hosted-oracles-blank-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'ok.txt'), 'hello\n');
    const r = evaluateHostedOracles({
      revision: revisionWithOracles([
        // 第一条是正常的「没做到」失败，第二条才是试题配错：整组必须按 HARNESS 否决
        { id: 'miss', type: 'workspace_assert', path: 'ok.txt', contains: 'NOPE' },
        { id: 'blank', type: 'workspace_assert', path: 'ok.txt', contains: '   ' },
      ]),
      workspace: ws,
      exitCode: 0,
      stdout: '',
      focus: 'MODEL_TASK',
    });
    expect(r.workspace_ok).toBe(false);
    expect(r.veto?.attribution).toBe('HARNESS');
    expect(r.veto?.message).toContain('blank');
  });
});

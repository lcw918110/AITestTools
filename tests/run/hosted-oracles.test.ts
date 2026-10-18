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
});

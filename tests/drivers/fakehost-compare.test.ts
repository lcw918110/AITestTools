import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundledContract } from '../../src/contract/load.ts';
import { FakeHost, FakeHostError } from '../../src/drivers/fakehost/index.ts';
import { loadScript, type ScriptDoc } from '../../src/drivers/scripted/index.ts';
import { compareRuns } from '../../src/report/compare.ts';

describe('FakeHost', () => {
  const script: ScriptDoc = {
    id: 't',
    rev: 1,
    version: 'scripted-model-v1',
    entry: 'start',
    nodes: {
      start: { type: 'assistant_text', text: 'hi', next: 'end' },
      end: { type: 'terminal', reason: 'stop' },
    },
  };

  it('契约外 hook fail-fast', () => {
    const contract = { id: 'opencode-v1.18', hooks: [{ name: 'event' }] };
    const host = new FakeHost(contract, script);
    expect(() => host.triggerHook('not.a.hook')).toThrow(FakeHostError);
  });

  it('可播到 terminal', () => {
    const contract = loadBundledContract('opencode-v1.18');
    const host = new FakeHost(contract, script);
    const trace = host.runUntilTerminal();
    expect(trace.modelSteps.some((n) => n.type === 'terminal')).toBe(true);
  });
});

describe('legacy steps[] script', () => {
  it('归一化为 scripted-model-v1', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-script-'));
    writeFileSync(
      join(root, 'legacy.json'),
      JSON.stringify({
        name: 'legacy',
        steps: [
          { assistant_text: 'a', tool_calls: [] },
          { assistant_text: 'b', tool_calls: [] },
          { terminal: true },
        ],
      }),
    );
    const doc = loadScript(root, 'legacy.json');
    expect(doc.version).toBe('scripted-model-v1');
    expect(doc.entry).toBe('s0');
    expect(doc.nodes.s0?.type).toBe('assistant_text');
    expect(doc.nodes.s2?.type).toBe('terminal');
  });
});

describe('compareRuns', () => {
  it('识别新失败与修复', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-cmp-'));
    const b = join(root, 'b');
    const c = join(root, 'c');
    mkdirSync(b);
    mkdirSync(c);
    writeFileSync(
      join(b, 'results.ndjson'),
      `${JSON.stringify({ item_id: 'X', item_rev: 1, pass: true })}\n${JSON.stringify({ item_id: 'Y', item_rev: 1, pass: false })}\n`,
    );
    writeFileSync(
      join(c, 'results.ndjson'),
      `${JSON.stringify({ item_id: 'X', item_rev: 1, pass: false })}\n${JSON.stringify({ item_id: 'Y', item_rev: 1, pass: true })}\n`,
    );
    const report = compareRuns(b, c);
    expect(report.counts.new_failure).toBe(1);
    expect(report.counts.fixed).toBe(1);
  });

  it('识别资产升版漂移（优先于 pass 变化）', () => {
    const root = mkdtempSync(join(tmpdir(), 'proctor-cmp-rev-'));
    const b = join(root, 'b');
    const c = join(root, 'c');
    mkdirSync(b);
    mkdirSync(c);
    writeFileSync(
      join(b, 'results.ndjson'),
      `${JSON.stringify({ item_id: 'Z', item_rev: 1, pass: true })}\n`,
    );
    writeFileSync(
      join(c, 'results.ndjson'),
      `${JSON.stringify({ item_id: 'Z', item_rev: 2, pass: false })}\n`,
    );
    const report = compareRuns(b, c);
    expect(report.counts.asset_rev_drift).toBe(1);
    expect(report.counts.new_failure).toBe(0);
    expect(report.rows[0]?.kind).toBe('asset_rev_drift');
  });
});

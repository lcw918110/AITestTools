import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/cli/main.ts';

const fixturePlugin = fileURLToPath(
  new URL('../fixtures/opencode-style-plugin.mjs', import.meta.url),
);

let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function writeMiniProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-oc-'));
  mkdirSync(join(root, 'items/A'), { recursive: true });
  mkdirSync(join(root, 'rooms'), { recursive: true });
  mkdirSync(join(root, 'papersets'), { recursive: true });
  mkdirSync(join(root, 'materials/T1'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'contracts'), { recursive: true });
  mkdirSync(join(root, 'sut'), { recursive: true });

  copyFileSync(fixturePlugin, join(root, 'sut/plugin.mjs'));

  writeFileSync(
    join(root, 'exam.json'),
    `${JSON.stringify({
      name: 'oc-mini',
      asset_protocol: 'papers-v1',
      paths: {
        items: 'items',
        papersets: 'papersets',
        rooms: 'rooms',
        materials: 'materials',
        scripts: 'scripts',
      },
    })}\n`,
  );
  writeFileSync(
    join(root, 'contracts/opencode-hooks-v1.json'),
    `${JSON.stringify({
      id: 'opencode-hooks-v1',
      hooks: [
        { name: 'chat.message' },
        { name: 'tool.execute.before' },
        { name: 'tool.execute.after' },
        { name: 'event' },
      ],
    })}\n`,
  );
  writeFileSync(
    join(root, 'rooms/fh.json'),
    `${JSON.stringify({
      name: 'fh',
      kind: 'fake-host',
      model_driver: 'scripted',
      network: false,
      contract: 'opencode-hooks-v1',
      adapter: {
        framework: 'test',
        config: 'sut/plugin.mjs',
        hook_style: 'opencode-v1',
      },
    })}\n`,
  );
  writeFileSync(
    join(root, 'scripts/np.json'),
    `${JSON.stringify({
      name: 'np',
      steps: [
        { assistant_text: 'a', tool_calls: [] },
        { assistant_text: 'b', tool_calls: [] },
        { terminal: true },
      ],
    })}\n`,
  );
  writeFileSync(
    join(root, 'materials/T1/session.json'),
    `${JSON.stringify({ session: { id: 's', nudge_count: 0 } })}\n`,
  );
  writeFileSync(
    join(root, 'items/A/t1.item.json'),
    `${JSON.stringify({
      id: 'T1',
      rev: 1,
      axis: 'A',
      status: 'active',
      title: 'oc nudge',
      intent: { statement: 'x', attribution_focus: 'PROTOCOL' },
      freeze: {
        layer: 'L2',
        model_driver: 'scripted',
        contract: 'opencode-hooks-v1',
        script: 'scripts/np.json',
      },
      stimulus: { kind: 'hook_script', ref: 'materials/T1/session.json' },
      expect: {
        oracles: [
          {
            id: 'n',
            type: 'event_subsequence',
            names: ['TurnCompleted', 'nudge_dispatched', 'TurnStarted'],
          },
        ],
      },
      metrics: { primary: ['a_case_pass_rate'] },
      execution: { deadline_ms: 10000, requires_network: false },
    })}\n`,
  );
  writeFileSync(
    join(root, 'papersets/p.json'),
    `${JSON.stringify({ name: 'p', axis: 'A', room: 'fh', items: ['T1'] })}\n`,
  );
  return root;
}

describe('L2 hook_style=opencode-v1', () => {
  it('假宿主派发 session.idle 后插件可写 nudge_dispatched', async () => {
    const project = writeMiniProject();
    expect(await main(['run', '--axis', 'A', '--paperset', 'p', '--project', project])).toBe(0);
    expect(out.join('\n')).toMatch(/1\/1/);
  });
});

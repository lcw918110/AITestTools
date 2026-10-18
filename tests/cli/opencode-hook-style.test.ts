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
  mkdirSync(join(root, 'cases'), { recursive: true });
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  mkdirSync(join(root, 'dataset-releases'), { recursive: true });
  mkdirSync(join(root, 'environments'), { recursive: true });
  mkdirSync(join(root, 'materials/T1'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'contracts'), { recursive: true });
  mkdirSync(join(root, 'sut'), { recursive: true });

  copyFileSync(fixturePlugin, join(root, 'sut/plugin.mjs'));

  writeFileSync(
    join(root, 'exam.json'),
    `${JSON.stringify({
      name: 'oc-mini',
      asset_protocol: 'cases-v1',
      paths: {
        materials: 'materials',
        scripts: 'scripts',
        contracts: 'contracts',
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
    join(root, 'environments/fh.environment.json'),
    `${JSON.stringify({
      environment_profile_id: 'fh',
      name: 'fh',
      lifecycle: 'active',
      recipe: {
        network_policy: 'deny',
        kind: 'fake-host',
        model_driver: 'scripted',
        contract: 'opencode-hooks-v1',
        adapter: {
          framework: 'test',
          config: 'sut/plugin.mjs',
          hook_style: 'opencode-v1',
        },
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
    join(root, 'cases/t1.case.json'),
    `${JSON.stringify({
      case_id: 't1',
      title: 'oc nudge',
      lifecycle: 'released',
      automation_readiness: 'design_ready',
      head_revision_id: 't1.r1',
    })}\n`,
  );
  writeFileSync(
    join(root, 'case-revisions/t1.r1.case-revision.json'),
    `${JSON.stringify({
      case_id: 't1',
      case_revision_id: 't1.r1',
      revision_number: 1,
      content_hash: 'placeholder',
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
      execution_profile: {
        mode: 'scripted',
        layer: 'L2',
        contract: 'opencode-hooks-v1',
        script: 'scripts/np.json',
      },
      attribution_focus: 'PROTOCOL',
      execution: { deadline_ms: 10000, requires_network: false },
    })}\n`,
  );
  writeFileSync(
    join(root, 'dataset-releases/p.dataset-release.json'),
    `${JSON.stringify({
      dataset_release_id: 'p',
      name: 'p',
      case_revisions: [{ case_id: 't1', case_revision_id: 't1.r1', content_hash: 'placeholder' }],
      closure_hash: 'placeholder',
    })}\n`,
  );
  return root;
}

describe('L2 hook_style=opencode-v1', () => {
  it('假宿主派发 session.idle 后插件可写 nudge_dispatched', async () => {
    const project = writeMiniProject();
    expect(await main(['run', '--dataset', 'p', '--environment', 'fh', '--project', project])).toBe(
      0,
    );
    expect(out.join('\n')).toMatch(/1\/1/);
  });
});

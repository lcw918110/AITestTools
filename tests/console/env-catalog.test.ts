import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addEnvAgent,
  addEnvModel,
  loadEnvCatalog,
  verifyEnvEntry,
} from '../../apps/console/env-catalog.ts';

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-env-'));
  mkdirSync(join(root, 'environments'), { recursive: true });
  writeFileSync(
    join(root, 'environments/hosted-plain-v1.environment.json'),
    `${JSON.stringify(
      {
        environment_profile_id: 'hosted-plain-v1',
        name: 'hosted-plain-v1',
        lifecycle: 'active',
        recipe: {
          runtime: 'opencode',
          host_model: 'wave-ai/gpt-5.4-mini',
          host_agent: 'fast-coder',
          managed_agents: ['fast-coder'],
        },
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

describe('env-catalog', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
    delete process.env.PROCTOR_CONSOLE_VERIFY_STUB;
  });

  it('从房间抽出模型与 Agent', () => {
    root = seed();
    const cat = loadEnvCatalog(root);
    expect(cat.models.some((m) => m.id === 'wave-ai/gpt-5.4-mini')).toBe(true);
    expect(cat.agents.some((a) => a.id === 'fast-coder')).toBe(true);
    expect(cat.models[0]?.verifiedAt).toBeUndefined();
  });

  it('添加后 stub 验证通过', () => {
    root = seed();
    process.env.PROCTOR_CONSOLE_VERIFY_STUB = '1';
    const added = addEnvModel(root, 'vendor/demo-model');
    expect('error' in added).toBe(false);
    const v = verifyEnvEntry(root, 'model', 'vendor/demo-model');
    expect('error' in v).toBe(false);
    if ('error' in v) return;
    expect(v.ok).toBe(true);
    expect(v.catalog.models.find((m) => m.id === 'vendor/demo-model')?.verifiedAt).toBeTruthy();
    const agent = addEnvAgent(root, 'demo-agent');
    expect('error' in agent).toBe(false);
  });
});

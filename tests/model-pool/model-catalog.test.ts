import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findEntry,
  inferProviderId,
  loadModelPool,
  normalizeEntry,
  resolveJudgeModel,
  resolveModel,
  upsert,
  writeModelPool,
  type ModelPool,
} from '../../src/model-pool/model-catalog.ts';

function seed(): string {
  return mkdtempSync(join(tmpdir(), 'proctor-model-pool-'));
}

describe('model-catalog', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('空项目返回空池', () => {
    root = seed();
    expect(loadModelPool(root).entries).toEqual([]);
  });

  it('inferProviderId 取斜杠前段，无斜杠取自身', () => {
    expect(inferProviderId('wave-ai/gpt-5.4-mini')).toBe('wave-ai');
    expect(inferProviderId('gpt-5.4')).toBe('gpt-5.4');
  });

  it('normalizeEntry 丢弃非法字段并归一化 status', () => {
    const e = normalizeEntry({
      model_id: ' wave-ai/gpt-5.4-mini ',
      provider_id: 'wave-ai',
      status: 'weird',
      category: 'judge',
      tags: ['cheap', '', 123],
      params: { temperature: 0.2 },
      api_key_env: 'WAVE_AI_API_KEY',
    });
    expect(e?.model_id).toBe('wave-ai/gpt-5.4-mini');
    expect(e?.status).toBe('active');
    expect(e?.category).toBe('judge');
    expect(e?.tags).toEqual(['cheap']);
    expect(e?.api_key_env).toBe('WAVE_AI_API_KEY');
  });

  it('normalizeEntry 对缺 model_id/provider_id 返回 undefined', () => {
    expect(normalizeEntry({ provider_id: 'x' })).toBeUndefined();
    expect(normalizeEntry({ model_id: 'x' })).toBeUndefined();
  });

  it('resolveModel 未命中时自动登记并回写', () => {
    root = seed();
    const { entry, registered } = resolveModel(root, { model_id: 'vendor/new-model' });
    expect(registered).toBe(true);
    expect(entry.provider_id).toBe('vendor');
    const pool = loadModelPool(root);
    expect(findEntry(pool, 'vendor/new-model')).toBeTruthy();
  });

  it('resolveModel 命中时不再登记', () => {
    root = seed();
    writeModelPool(root, [
      {
        model_id: 'vendor/new-model',
        provider_id: 'vendor',
        status: 'active',
        category: 'general',
      },
    ]);
    const { entry, registered } = resolveModel(root, { model_id: 'vendor/new-model' });
    expect(registered).toBe(false);
    expect(entry.category).toBe('general');
  });

  it('upsert 按 model_id 幂等', () => {
    const a = { model_id: 'a', provider_id: 'p', status: 'active' as const };
    const a2 = { model_id: 'a', provider_id: 'p', status: 'inactive' as const };
    const b = { model_id: 'b', provider_id: 'p', status: 'active' as const };
    const once = upsert([a], a2);
    expect(once).toHaveLength(1);
    expect(once[0]?.status).toBe('inactive');
    const twice = upsert(once, b);
    expect(twice).toHaveLength(2);
  });

  it('resolveJudgeModel 兜底链：显式 → judge → general → undefined', () => {
    const pool: ModelPool = {
      entries: [
        { model_id: 'j', provider_id: 'p', status: 'active', category: 'judge' },
        { model_id: 'g', provider_id: 'p', status: 'active', category: 'general' },
        { model_id: 'off', provider_id: 'p', status: 'inactive', category: 'judge' },
      ],
    };
    expect(resolveJudgeModel(pool, 'g')).toBe('g');
    expect(resolveJudgeModel(pool)).toBe('j');
    const noJudge: ModelPool = {
      entries: [{ model_id: 'g', provider_id: 'p', status: 'active', category: 'general' }],
    };
    expect(resolveJudgeModel(noJudge)).toBe('g');
    const empty: ModelPool = { entries: [] };
    expect(resolveJudgeModel(empty)).toBeUndefined();
  });
});

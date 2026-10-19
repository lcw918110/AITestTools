import { describe, expect, it } from 'vitest';
import {
  buildSecurityReport,
  generateCanarySecrets,
  readCanaryLeakFromArtifact,
} from '../../src/security/redteam.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('generateCanarySecrets', () => {
  it('生成指定数量且互不重复的 canary', () => {
    const secrets = generateCanarySecrets(3);
    expect(secrets).toHaveLength(3);
    expect(new Set(secrets).size).toBe(3);
  });
});

describe('buildSecurityReport', () => {
  it('汇总泄露 / 未泄露 / 无法判定', () => {
    const report = buildSecurityReport({
      run_id: 'r1',
      dataset: 'd1',
      environment: 'e1',
      cases: [
        {
          case_revision_id: 'c1',
          canary_secret: 's1',
          leak: { leaked: true, locations: ['stdout'] },
        },
        { case_revision_id: 'c2', canary_secret: 's2', leak: { leaked: false, locations: [] } },
        { case_revision_id: 'c3', canary_secret: 's3' },
      ],
    });
    expect(report.summary).toEqual({ total: 3, leaked: 1, not_leaked: 1, inconclusive: 1 });
    expect(report.cases[0]?.leaked).toBe(true);
    expect(report.cases[2]?.inconclusive).toBe(true);
  });

  it('空 cases 汇总为零', () => {
    const report = buildSecurityReport({
      run_id: 'r1',
      dataset: 'd1',
      environment: 'e1',
      cases: [],
    });
    expect(report.summary).toEqual({ total: 0, leaked: 0, not_leaked: 0, inconclusive: 0 });
  });
});

describe('readCanaryLeakFromArtifact', () => {
  it('从 hosted-run.json 提取泄露判定', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-redteam-'));
    writeFileSync(
      join(dir, 'hosted-run.json'),
      JSON.stringify({ canary_leak: true, canary_leak_locations: ['stdout'] }),
    );
    expect(readCanaryLeakFromArtifact(dir)).toEqual({ leaked: true, locations: ['stdout'] });
  });

  it('hosted-run.json 缺失返回 undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-redteam-'));
    expect(readCanaryLeakFromArtifact(dir)).toBeUndefined();
  });

  it('hosted-run.json 无 canary_leak 字段返回 undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-redteam-'));
    writeFileSync(join(dir, 'hosted-run.json'), JSON.stringify({ workspace_ok: true }));
    expect(readCanaryLeakFromArtifact(dir)).toBeUndefined();
  });

  it('hosted-run.json 非法 JSON 返回 undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proctor-redteam-'));
    writeFileSync(join(dir, 'hosted-run.json'), 'not-json');
    expect(readCanaryLeakFromArtifact(dir)).toBeUndefined();
  });
});

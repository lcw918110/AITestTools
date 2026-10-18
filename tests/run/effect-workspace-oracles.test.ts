import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CaseRevision } from '../../src/exam-engine/types.ts';
import { evaluateHostedOracles } from '../../src/run/hosted-oracles.ts';
import { seedStimulusMaterials } from '../../src/run/seed-stimulus-materials.ts';

const projectRoot = resolve('examples/product-eval');

function loadRevision(file: string): CaseRevision {
  return JSON.parse(
    readFileSync(join(projectRoot, 'case-revisions', file), 'utf8'),
  ) as CaseRevision;
}

function seedWork(revision: CaseRevision): string {
  const workDir = mkdtempSync(join(tmpdir(), 'proctor-effect-ws-'));
  seedStimulusMaterials({
    workDir,
    projectRoot,
    stimulusRef: revision.stimulus.ref,
  });
  return workDir;
}

describe('效果题 workspace_assert：播种后未改应挂、改对应过', () => {
  it('157 OFF/ON 判定字节级相同；播种后挂、改两处取整后过', () => {
    const off = loadRevision('paired-task-157.r1.off.case-revision.json');
    const on = loadRevision('paired-task-157.r1.on.case-revision.json');
    expect(JSON.stringify(off.expect.oracles)).toBe(JSON.stringify(on.expect.oracles));
    expect(on.protocol_probes).toEqual(['RuntimeStarted', 'JournalEnvelope']);

    const workDir = seedWork(off);
    const before = evaluateHostedOracles({
      revision: off,
      workspace: workDir,
      exitCode: 0,
      stdout: 'DUAL_FIX',
      focus: off.attribution_focus,
    });
    expect(before.veto?.message).toMatch(/discount-round|tax-round/);

    writeFileSync(
      join(workDir, 'lib/discount.mjs'),
      'export function applyDiscount(cents, percent) {\n  return cents - Math.round((cents * percent) / 100);\n}\n',
    );
    writeFileSync(
      join(workDir, 'lib/tax.mjs'),
      'export function addTax(cents, bps) {\n  return Math.round((cents * (10000 + bps)) / 10000);\n}\n',
    );
    const after = evaluateHostedOracles({
      revision: off,
      workspace: workDir,
      exitCode: 0,
      stdout: 'DUAL_FIX',
      focus: off.attribution_focus,
    });
    expect(after.veto).toBeUndefined();
  });

  it('158 播种后挂；三处公网端口对齐且 legacy 不动则过', () => {
    const off = loadRevision('paired-task-158.r1.off.case-revision.json');
    const on = loadRevision('paired-task-158.r1.on.case-revision.json');
    expect(JSON.stringify(off.expect.oracles)).toBe(JSON.stringify(on.expect.oracles));

    const workDir = seedWork(off);
    const before = evaluateHostedOracles({
      revision: off,
      workspace: workDir,
      exitCode: 0,
      stdout: 'PORT_SYNC',
      focus: off.attribution_focus,
    });
    expect(before.veto?.message).toMatch(/config-port.*未含「"port": 8443」/);

    writeFileSync(
      join(workDir, 'config/app.json'),
      '{\n  "name": "billing-api",\n  "port": 8443\n}\n',
    );
    writeFileSync(
      join(workDir, 'src/listen.js'),
      'export const PORT = 8443;\n\nexport function bind() {\n  return PORT;\n}\n',
    );
    writeFileSync(
      join(workDir, 'docs/runbook.md'),
      '# billing-api\n\nThe service listens on 8443 in production. Health checks should use the same port.\n',
    );
    const after = evaluateHostedOracles({
      revision: off,
      workspace: workDir,
      exitCode: 0,
      stdout: 'PORT_SYNC',
      focus: off.attribution_focus,
    });
    expect(after.veto).toBeUndefined();
  });

  it('159 播种后挂；解析+校验改对且 CLI/夹具不动则过', () => {
    const off = loadRevision('paired-task-159.r1.off.case-revision.json');
    const on = loadRevision('paired-task-159.r1.on.case-revision.json');
    expect(JSON.stringify(off.expect.oracles)).toBe(JSON.stringify(on.expect.oracles));

    const workDir = seedWork(off);
    const before = evaluateHostedOracles({
      revision: off,
      workspace: workDir,
      exitCode: 0,
      stdout: 'QUERY_WIRE',
      focus: off.attribution_focus,
    });
    expect(before.veto?.message).toMatch(/query-split.*未含「split」/);

    writeFileSync(
      join(workDir, 'lib/query.js'),
      `export function parseQuery(q) {
  if (!q) return {};
  const out = {};
  for (const part of q.split('&')) {
    const i = part.indexOf('=');
    if (i < 0) out[part] = '';
    else out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
`,
    );
    writeFileSync(
      join(workDir, 'lib/validate.js'),
      `export function isValidName(s) {
  return /^[A-Za-z][A-Za-z0-9_]{1,15}$/.test(s);
}
`,
    );
    const after = evaluateHostedOracles({
      revision: off,
      workspace: workDir,
      exitCode: 0,
      stdout: 'QUERY_WIRE',
      focus: off.attribution_focus,
    });
    expect(after.veto).toBeUndefined();
  });
});

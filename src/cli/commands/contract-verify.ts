import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundledContract } from '../../contract/load.ts';
import { runHookProbes } from '../../contract/probe.ts';
import { probeHostRuntimeHooks } from '../../contract/runtime-probe.ts';

export interface ContractVerifyOptions {
  host: string;
  project?: string | undefined;
  json: boolean;
}

/** 版本钉死 + FakeHost + 二进制 strings + 临时 probe 插件真跑（拍板 D2）。 */
export function runContractVerify(options: ContractVerifyOptions): number {
  const m = /^([^@]+)@(.+)$/.exec(options.host);
  if (m === null) {
    console.error('用法：proctor contract verify --host opencode@1.18.5');
    return 2;
  }
  const [, hostName, hostVer] = m;
  if (hostName !== 'opencode') {
    console.error(`暂只支持 opencode，收到：${hostName}`);
    return 2;
  }

  const contract = loadBundledContract('opencode-v1.18');
  const expected = String(contract.host_version);
  const local = detectOpencodeVersion();
  const opencodePath = detectOpencodePath();
  const issues: string[] = [];
  if (hostVer !== expected) {
    issues.push(`--host 版本 ${hostVer} 与契约钉死 ${expected} 不一致`);
  }
  if (local === undefined) {
    issues.push('本机未找到 opencode 可执行文件');
  } else if (local !== expected) {
    issues.push(`本机 opencode 版本 ${local} 与契约钉死 ${expected} 不一致`);
  }

  const probeOpts: Parameters<typeof runHookProbes>[0] = { contract };
  if (opencodePath !== undefined) probeOpts.opencodePath = opencodePath;
  const probes = runHookProbes(probeOpts);
  for (const c of probes.cases) {
    if (!c.pass) issues.push(`${c.id}: ${c.detail}`);
  }

  const runtime = probeHostRuntimeHooks({
    ...(opencodePath !== undefined ? { opencodeBin: opencodePath } : {}),
  });
  probes.cases.push(...runtime.cases);
  for (const c of runtime.cases) {
    if (!c.pass) issues.push(`${c.id}: ${c.detail}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(process.cwd(), 'runs', 'contract-verify', stamp);
  mkdirSync(outDir, { recursive: true });
  const report = {
    contract_id: contract.id,
    pinned_version: expected,
    requested_host: options.host,
    local_version: local ?? null,
    opencode_path: opencodePath ?? null,
    pass: issues.length === 0,
    issues,
    probes,
    runtime: {
      detail: runtime.detail,
      log_path: runtime.logPath ?? null,
      work_dir: runtime.workDir ?? null,
    },
    note: '版本钉死 + FakeHost + 二进制 strings + 临时工作区 probe 插件真跑（不改全局 config）',
  };
  writeFileSync(join(outDir, 'verify.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    join(outDir, 'report.md'),
    [
      `# contract verify — ${contract.id}`,
      '',
      `- pass: **${report.pass}**`,
      `- pinned: ${expected}`,
      `- local: ${local ?? 'n/a'}`,
      `- path: ${opencodePath ?? 'n/a'}`,
      `- runtime: ${runtime.detail}`,
      '',
      '## probes',
      ...probes.cases.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} \`${c.id}\` — ${c.detail}`),
      '',
      ...(issues.length ? ['## issues', ...issues.map((i) => `- ${i}`), ''] : []),
    ].join('\n'),
  );

  if (options.json) {
    console.log(JSON.stringify({ ...report, out_dir: outDir }, null, 2));
  } else {
    console.log(`contract verify 留档：${outDir}`);
    if (report.pass) console.log(`PASS  opencode@${expected}（${probes.cases.length} probes）`);
    else {
      console.log('FAIL');
      for (const i of issues) console.log(`  - ${i}`);
    }
  }
  return report.pass ? 0 : 1;
}

function detectOpencodeVersion(): string | undefined {
  const r = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) return undefined;
  const line = (r.stdout || r.stderr).trim().split(/\r?\n/)[0] ?? '';
  return line.match(/(\d+\.\d+\.\d+)/)?.[1];
}

function detectOpencodePath(): string | undefined {
  const r = spawnSync('which', ['opencode'], { encoding: 'utf8' });
  if (r.status !== 0) return undefined;
  const p = r.stdout.trim().split(/\r?\n/)[0];
  return p || undefined;
}

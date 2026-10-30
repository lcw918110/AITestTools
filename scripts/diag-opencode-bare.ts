/**
 * 无沙箱裸跑 opencode run 复现脚本：用与 hosted-runner 相同的隔离 HOME 构造，
 * 但不套 SandboxManager——用于二分「挂起」是沙箱引起还是环境本身引起。
 * 用法：node --experimental-strip-types scripts/diag-opencode-bare.ts [秒数]
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const timeoutMs = Number(process.argv[2] ?? '120000');
const home = mkdtempSync(join(tmpdir(), 'proctor-diag-home-'));
const configHome = join(home, '.config');
const dir = join(configHome, 'opencode');
mkdirSync(dir, { recursive: true });

const globalOc = JSON.parse(readFileSync(join(homedir(), '.config', 'opencode', 'opencode.json'), 'utf8'));
const cfg: Record<string, unknown> = {
  $schema: 'https://opencode.ai/config.json',
  permission: { '*': 'allow' },
  provider: globalOc.provider,
  agent: { 'fast-coder': { model: 'ctyun/deepseek-v4-pro-0813-oc' } },
};
writeFileSync(join(dir, 'opencode.json'), JSON.stringify(cfg, null, 2));

const workDir = mkdtempSync(join(tmpdir(), 'proctor-diag-work-'));
writeFileSync(join(workDir, 'README.md'), '# diag\n');

const env: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: configHome,
  XDG_DATA_HOME: join(home, '.local', 'share'),
  XDG_STATE_HOME: join(home, '.local', 'state'),
  XDG_CACHE_HOME: join(home, '.cache'),
  npm_config_cache: join(home, '.npm'),
  OPENCODE_DISABLE_MODELS_FETCH: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
  CI: '1',
};

console.log(`[diag] 隔离 HOME: ${home}`);
console.log(`[diag] 工作目录: ${workDir}`);
console.log(`[diag] 超时: ${timeoutMs}ms，开始…`);
const t0 = Date.now();
const child = spawn(
  'opencode',
  ['run', '--dir', workDir, '-m', 'ctyun/deepseek-v4-pro-0813-oc', '--agent', 'fast-coder', '--print-logs', 'Reply with exactly ok. Prefer not using tools.'],
  { env, cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] },
);
let out = '';
let err = '';
child.stdout.on('data', (d: Buffer) => { out += d; });
child.stderr.on('data', (d: Buffer) => { err += d; });
const timer = setTimeout(() => {
  console.log(`[diag] ${timeoutMs}ms 超时，SIGKILL`);
  child.kill('SIGKILL');
}, timeoutMs);
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  const dur = Date.now() - t0;
  console.log(`[diag] 退出: code=${code} signal=${signal} 耗时=${dur}ms`);
  console.log(`[diag] stdout(${out.length}B): ${out.slice(0, 800)}`);
  console.log(`[diag] stderr 尾部 1500B: ${err.slice(-1500)}`);
  // 找 opencode 自己的日志文件
  const logDir = join(home, '.local', 'share', 'opencode', 'log');
  if (existsSync(logDir)) {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const logs = execSync(`find ${logDir} -name '*.log' | tail -2`).toString().trim().split('\n');
    for (const lg of logs) {
      console.log(`[diag] === ${lg} 尾部 ===`);
      console.log(execSync(`tail -20 ${lg}`).toString());
    }
  } else {
    console.log('[diag] 无 opencode 日志目录');
  }
  process.exit(0);
});

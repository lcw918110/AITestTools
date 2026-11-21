import { spawn } from 'node:child_process';

/**
 * 沙箱执行子进程的受控替身（测试专用）。
 *
 * 被 `sandbox-exec.ts` 以 `process.execPath --experimental-strip-types <entry>` 拉起，
 * 语义与真实入口一致：stdin 收请求，stdout 回**一帧**结果 JSON。
 * 不 import 隔离后端，因此可在任意机器上跑。
 *
 * 环境变量行为（用于回归跨进程环境传递）：
 * - `FAKE_CHILD_ECHO_PROXY=1`：回包 stdout 里带上 `HTTP_PROXY`，证明包裹层产出的
 *   代理变量真的随请求进了子进程环境；
 * - `FAKE_CHILD_MODE`：
 *   - `garbage`：回包不是 JSON（模拟握手损坏）；
 *   - `silent`：什么都不回（模拟子进程被杀）；
 *   - `wrap-fail`：回包 `ok:false, stage:'wrap'`（模拟包裹失败）；
 *   - `spawn-fail`：回包 `ok:false, stage:'spawn'`；
 *   - `noisy`：先回一帧合法结果，再追加几行「日志里恰好是 JSON」的尾部输出。
 */
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    bin: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
  };
  const mode = process.env.FAKE_CHILD_MODE ?? 'run';

  if (mode === 'garbage') {
    process.stdout.write('这不是 JSON\n');
    return;
  }
  if (mode === 'silent') return;
  if (mode === 'wrap-fail') {
    process.stdout.write(
      `${JSON.stringify({ ok: false, stage: 'wrap', message: '测试桩包裹失败' })}\n`,
    );
    return;
  }
  if (mode === 'spawn-fail') {
    process.stdout.write(
      `${JSON.stringify({ ok: false, stage: 'spawn', message: '测试桩启动失败' })}\n`,
    );
    return;
  }

  const proxyNote =
    process.env.FAKE_CHILD_ECHO_PROXY === '1' ? `HTTP_PROXY=${request.env.HTTP_PROXY ?? ''}` : '';
  const child = spawn('sh', ['-c', 'cat; echo HOST_STDERR 1>&2'], {
    cwd: request.cwd,
    env: request.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = proxyNote === '' ? '' : `${proxyNote}\n`;
  let stderr = '';
  child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
  child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
  child.stdin.end([request.bin, ...request.args].join(' '));
  child.on('close', (code) => {
    if (mode === 'noisy') {
      // 模拟未捕获异常栈/句柄告警：尾部某行恰好是 JSON，不得被当成结果帧。
      process.stdout.write(
        `${JSON.stringify({ ok: true, status: code, signal: null, errorCode: null, errorMessage: null, stdout, stderr, timedOut: false, stdioDestroyed: false })}\n`,
      );
      process.stdout.write('{"ok":true,"status":99}\n');
      return;
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        status: code,
        signal: null,
        errorCode: null,
        errorMessage: null,
        stdout,
        stderr,
        timedOut: false,
        stdioDestroyed: false,
      })}\n`,
    );
  });
}

await main();

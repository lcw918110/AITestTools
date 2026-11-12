import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { afterEach, describe, expect, it } from 'vitest';
import { runHostedWithReapForTest } from '../../src/run/hosted-runner.ts';

/**
 * stdout/stderr 的 UTF-8 解码必须在**流级别**保持有状态。
 *
 * 逐 chunk 调 `buf.toString('utf8')` 会在多字节字符被切开时产出替换字符（U+FFFD）：
 * 一个汉字的 3 个字节若分属两个 chunk，前后两截各自解码都成 `\uFFFD`。
 * 真实后果不是「日志难看」——`stdout_assert` 与暗号类 oracle 直接比对文本，
 * 字被截坏会把「模型确实输出了暗号」判成没输出（假红），
 * 或反过来让包含 `\uFFFD` 的错误文本意外命中（假绿）。
 *
 * ## 为什么要按「字节」切
 *
 * 按字符切（如 `['暗', '|', 'DONE']`）时每块本身是完整 UTF-8 序列，
 * 逐块 `toString('utf8')` 也能正确解码——**旧实现同样通过**，用例无法证伪修复。
 * 必须把刀落在多字节字符内部（如把一个汉字的 3 字节切成 1+2）。
 *
 * ## 为什么用「文件握手」而不是 sleep 或忙等
 *
 * 关键要求：chunk 边界必须与父进程调度**完全解耦**。两种朴素做法都不成立：
 *
 * - `setTimeout` 拉间隔：父进程一旦被 GC 或多文件并行占住，多次写会合并成一个
 *   chunk，旧实现同样得到完整字符并通过断言，回归保护静默失效。
 * - 子进程忙等：只是把阈值从 60ms 提到 200ms，**并未消除依赖**。
 *   实测父进程同步阻塞 500ms（> 200ms）时三次写全部落进 pipe 缓冲，
 *   父进程一次 read 拿到合并 chunk，旧实现照样通过。
 *
 * 文件握手把「能否写下一块」绑成**父进程已收到当前块**这一确定事件：
 * 子进程写第 N 块后轮询等待 ack 文件，父进程侧用非阻塞定时器创建 ack。
 * 无论父进程何时被调度，第 N+1 块都只能在其处理完第 N 块之后写入，
 * 因此每个 chunk 必然独立触发一次 `data`，与机器负载无关。
 *
 * 注意 ack 必须由**非阻塞定时器**创建，不能在父进程里同步忙等：
 * 忙等期间事件循环停摆，`data` 回调不会执行，子进程等不到 ack，双方死锁
 * （本文件第一版就是这么挂住的）。
 */
/** 每个握手用例自建的临时目录，`afterEach` 统一清理。 */
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * 生成「按字节偏移分块写出，每块之后等 ack 文件」的脚本。
 *
 * `byteCuts` 必须是**字节偏移**，且至少有一刀落在多字节字符内部，
 * 否则每块都是合法序列，无法证伪旧实现。
 */
function ackChunkedWriter(opts: {
  text: string;
  byteCuts: readonly number[];
  ackPath: string;
  toStderr?: boolean;
  /** 只写到最后一刀为止就退出，故意留下半个字符。 */
  truncateAtEnd?: boolean;
}): string {
  const stream = opts.toStderr === true ? 'process.stderr' : 'process.stdout';
  const full = Buffer.byteLength(opts.text, 'utf8');
  // truncateAtEnd 时终点取最后一刀，不写完整字符。
  const lastCut = opts.byteCuts[opts.byteCuts.length - 1] ?? full;
  const end = opts.truncateAtEnd === true ? lastCut : full;
  return [
    "const fs = require('node:fs');",
    `const ack = ${JSON.stringify(opts.ackPath)};`,
    `const b = Buffer.from(${JSON.stringify(opts.text)}, 'utf8');`,
    `const bounds = ${JSON.stringify([...opts.byteCuts, end])};`,
    'let prev = 0;',
    'let idx = 0;',
    'const pump = () => {',
    '  if (idx >= bounds.length) { process.exit(0); }',
    `  ${stream}.write(b.subarray(prev, bounds[idx]));`,
    '  prev = bounds[idx];',
    '  idx += 1;',
    '  if (idx >= bounds.length) { process.exit(0); }',
    '  const timer = setInterval(() => {',
    '    if (!fs.existsSync(ack)) return;',
    '    clearInterval(timer);',
    '    try { fs.unlinkSync(ack); } catch {}',
    '    pump();',
    '  }, 2);',
    '};',
    'pump();',
  ].join('\n');
}

/**
 * 跑一个握手用例。
 *
 * `blockMs` 模拟「父进程被长时间占住」——它是本文件的核心保障：
 * 即使父进程在开局阻塞，chunk 也不会合并，因为子进程要等 ack 才写下一块，
 * 而 ack 只在父进程的 `data` 回调里创建。
 */
async function runAckCase(opts: {
  text: string;
  byteCuts: readonly number[];
  toStderr?: boolean;
  truncateAtEnd?: boolean;
  blockMs?: number;
}): Promise<{ stdout: string; stderr: string; status: number | null }> {
  const dir = mkdtempSync(join(tmpdir(), 'proctor-ack-'));
  tempDirs.push(dir);
  const ack = join(dir, 'ack');
  const script = ackChunkedWriter({
    text: opts.text,
    byteCuts: opts.byteCuts,
    ackPath: ack,
    ...(opts.toStderr !== undefined ? { toStderr: opts.toStderr } : {}),
    ...(opts.truncateAtEnd !== undefined ? { truncateAtEnd: opts.truncateAtEnd } : {}),
  });

  const pending = runHostedWithReapForTest(process.execPath, ['-e', script], {
    env: {},
    cwd: '/tmp',
    timeoutMs: 30_000,
  });

  // 父进程主动阻塞：若 chunk 边界依赖调度，这里就会合并。
  // 阻塞期间事件循环停摆，子进程停在等 ack，不会写下一块——
  // 这正是与「子进程忙等」方案的本质区别。
  const blockMs = opts.blockMs ?? 0;
  if (blockMs > 0) {
    const t = Date.now();
    while (Date.now() - t < blockMs) {
      /* 阻塞事件循环 */
    }
  }

  // 阻塞结束后用非阻塞定时器持续放行：子进程消费 ack 后自行 unlink，
  // 重复创建只会在消费前被覆盖，不影响正确性。
  const pump = setInterval(() => {
    try {
      writeFileSync(ack, 'go');
    } catch {
      /* 目录已被清理，忽略 */
    }
  }, 3);

  try {
    const run = await pending;
    return { stdout: run.stdout, stderr: run.stderr, status: run.status };
  } finally {
    clearInterval(pump);
  }
}

describe('宿主 stdio 跨 chunk 的 UTF-8 解码', () => {
  it('汉字被切成 1+2 字节时还原成原字符，不产生替换字符', async () => {
    // '暗' = e6 9a 97，刀落在第 1 字节后：第 1 块不是合法 UTF-8。
    const run = await runAckCase({ text: '暗|DONE', byteCuts: [1], blockMs: 500 });

    expect(run.status).toBe(0);
    expect(run.stdout).toBe('暗|DONE');
    expect(run.stdout).not.toContain('\uFFFD');
  }, 40_000);

  it('连续两个汉字逐字节切成三块时也能拼回', async () => {
    // '暗号' = e6 9a 97 e5 8f b7。刀落在 1 与 4：
    // 块1 = e6（非法）、块2 = 9a 97 e5（非法，尾部半字符）、块3 = 8f b7（合法 "号"）。
    const run = await runAckCase({ text: '暗号', byteCuts: [1, 4], blockMs: 500 });

    expect(run.stdout).toBe('暗号');
    expect(run.stdout).not.toContain('\uFFFD');
  }, 40_000);

  it('stderr 同样跨 chunk 还原，且与 stdout 互不干扰', async () => {
    // '错' = e9 94 99，刀落在 1 与 2：三块都非法。
    const run = await runAckCase({
      text: '错',
      byteCuts: [1, 2],
      toStderr: true,
      blockMs: 500,
    });

    expect(run.stderr).toBe('错');
    expect(run.stderr).not.toContain('\uFFFD');
  }, 40_000);

  it('暗号类断言在字节级切分时仍能命中（端到端后果）', async () => {
    const token = 'WANXIANG-DONE';
    const text = `暗号:${token}`;
    // '暗' 前 1 字节、'号' 中间切开：两刀都落在多字节字符内部。
    const run = await runAckCase({ text, byteCuts: [1, 4], blockMs: 500 });

    expect(run.stdout).toBe(text);
    expect(run.stdout).toContain(token);
  }, 40_000);
});

/**
 * 结算前必须 `end()` 冲出尾部残留字节。
 *
 * 与上面四条互补：它们验证「chunk 边界处不产生替换字符」，
 * 这一组验证「流结束时的半字符残片不被吞掉」。两者覆盖的是 `finish` 里
 * `end()` 的两类必要场景。
 */
describe('流结束时的半字符残留', () => {
  it('宿主退出时只写出半个字符，残片被 end() 冲出而不是静默丢弃', async () => {
    // '暗' = e6 9a 97。先写前 2 字节（不完整），等父进程收到后再退出。
    // 若 finish 里不调 end()，这 2 个字节永远留在 decoder 内部，stdout 末尾凭空少一截。
    const run = await runAckCase({ text: '暗', byteCuts: [2], truncateAtEnd: true, blockMs: 500 });

    // 残片被冲出后必然是替换字符：证明数据没丢，只是不完整。
    expect(run.stdout).toBe('\uFFFD');
  }, 40_000);

  it('StringDecoder 契约：write 阶段残留必须由 end() 冲出', () => {
    const decoder = new StringDecoder('utf8');
    const half = Buffer.from('暗', 'utf8').subarray(0, 2);
    // 只有 2/3 个字节：write 阶段解不出东西。
    expect(decoder.write(half)).toBe('');
    // end() 必须把残留冲出来（作为替换字符），证明「不调 end 就丢数据」。
    expect(decoder.end()).toBe('\uFFFD');
  });

  it('StringDecoder 契约：尾字节恰好补全时必须还原成原字符', () => {
    const decoder = new StringDecoder('utf8');
    const all = Buffer.from('暗', 'utf8');
    expect(decoder.write(all.subarray(0, 2))).toBe('');
    expect(decoder.write(all.subarray(2))).toBe('暗');
    // 补全后无残留。
    expect(decoder.end()).toBe('');
  });
});

import { StringDecoder } from 'node:string_decoder';
import { describe, expect, it } from 'vitest';
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
 * ## 为什么要按「字节」切，而不是按「字符」切
 *
 * 按字符切（如 `['暗', '|', 'DONE']`）时每块本身是完整 UTF-8 序列，
 * 逐块 `toString('utf8')` 也能正确解码——**旧实现同样通过**，用例无法证伪修复。
 * 必须把刀落在多字节字符内部（如把一个汉字的 3 字节切成 1+2）。
 *
 * ## 为什么 chunk 边界不靠 setTimeout 拉间隔
 *
 * 靠「子进程 sleep 再写下一块」制造边界时，一旦父进程事件循环被占
 * （vitest 多文件并行、GC、覆盖率插桩、批量跑卷），多次写会合并成一个 chunk，
 * 旧实现同样得到完整字符并**通过**断言，回归保护静默失效。
 * 故改用**子进程自身忙等**：子进程在两次写之间做同步计算，期间父进程事件循环正常运转，
 * chunk 边界由写入方节奏决定，不吃父进程调度。
 */
const BUSY_GAP_MS = 200;

/**
 * 生成「把 text 的 UTF-8 字节按 byteCuts 切开写出」的脚本。
 *
 * `byteCuts` 必须是**字节偏移**，且至少有一刀落在多字节字符内部，
 * 否则每块都是合法序列，无法证伪旧实现。
 */
function byteChunkedWriter(text: string, byteCuts: readonly number[]): string {
  return [
    `const b = Buffer.from(${JSON.stringify(text)}, 'utf8');`,
    `const cuts = ${JSON.stringify(byteCuts)};`,
    'let prev = 0;',
    'for (const c of cuts) {',
    '  process.stdout.write(b.subarray(prev, c));',
    '  prev = c;',
    `  { const t = Date.now(); while (Date.now() - t < ${String(BUSY_GAP_MS)}) {} }`,
    '}',
    'process.stdout.write(b.subarray(prev));',
  ].join('\n');
}

describe('宿主 stdio 跨 chunk 的 UTF-8 解码', () => {
  it('汉字被切成 1+2 字节时还原成原字符，不产生替换字符', async () => {
    // '暗' = e6 9a 97，刀落在第 1 字节后：第 1 块不是合法 UTF-8。
    const script = byteChunkedWriter('暗|DONE', [1]);

    const run = await runHostedWithReapForTest(process.execPath, ['-e', script], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toBe('暗|DONE');
    expect(run.stdout).not.toContain('\uFFFD');
  }, 40_000);

  it('连续两个汉字逐字节切成三块时也能拼回', async () => {
    // '暗号' = e6 9a 97 e5 8f b7，刀落在 1 与 3：三块都非法。
    const script = byteChunkedWriter('暗号', [1, 3]);

    const run = await runHostedWithReapForTest(process.execPath, ['-e', script], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });

    expect(run.stdout).toBe('暗号');
    expect(run.stdout).not.toContain('\uFFFD');
  }, 40_000);

  it('stderr 同样跨 chunk 还原，且与 stdout 互不干扰', async () => {
    // '错' = e9 94 99，刀落在 1 与 2：三块都非法。
    const script = [
      "const be = Buffer.from('错', 'utf8');",
      'process.stdout.write("OK");',
      'process.stderr.write(be.subarray(0, 1));',
      `{ const t = Date.now(); while (Date.now() - t < ${String(BUSY_GAP_MS)}) {} }`,
      'process.stderr.write(be.subarray(1, 2));',
      `{ const t = Date.now(); while (Date.now() - t < ${String(BUSY_GAP_MS)}) {} }`,
      'process.stderr.write(be.subarray(2));',
    ].join('\n');

    const run = await runHostedWithReapForTest(process.execPath, ['-e', script], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });

    expect(run.stdout).toBe('OK');
    expect(run.stderr).toBe('错');
    expect(run.stderr).not.toContain('\uFFFD');
  }, 40_000);

  it('暗号类断言在字节级切分时仍能命中（端到端后果）', async () => {
    const token = 'WANXIANG-DONE';
    const text = `暗号:${token}`;
    // '暗' 前 1 字节、'号' 中间切开：两刀都落在多字节字符内部。
    const script = byteChunkedWriter(text, [1, 4]);

    const run = await runHostedWithReapForTest(process.execPath, ['-e', script], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });

    expect(run.stdout).toBe(text);
    expect(run.stdout).toContain(token);
  }, 40_000);
});

/**
 * 结算前必须 `end()` 冲出尾部残留字节。
 *
 * 这一组直接锁 `StringDecoder` 的契约：半字符残留在流结束时必须被冲出，
 * 否则末尾文本会凭空少一截。用它证明 `finish` 里调 `end()` 的必要性。
 */
describe('流结束时的半字符残留（StringDecoder 契约）', () => {
  it('不足一个完整字符的尾字节在 end() 时被冲出，而不是静默丢弃', () => {
    const decoder = new StringDecoder('utf8');
    const half = Buffer.from('暗', 'utf8').subarray(0, 2);
    // 只有 2/3 个字节：write 阶段解不出东西。
    expect(decoder.write(half)).toBe('');
    // end() 必须把残留冲出来（作为替换字符），证明「不调 end 就丢数据」。
    expect(decoder.end()).toBe('\uFFFD');
  });

  it('尾字节恰好补全时必须还原成原字符', () => {
    const decoder = new StringDecoder('utf8');
    const all = Buffer.from('暗', 'utf8');
    expect(decoder.write(all.subarray(0, 2))).toBe('');
    expect(decoder.write(all.subarray(2))).toBe('暗');
    // 补全后无残留。
    expect(decoder.end()).toBe('');
  });
});

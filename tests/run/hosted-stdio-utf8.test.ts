import { describe, expect, it } from 'vitest';
import { runHostedWithReapForTest } from '../../src/run/hosted-runner.ts';

/**
 * 宿主 stdio 接线的**冒烟**测试。
 *
 * 这里验证 `runHostedWithReap` 确实把子进程的 stdout 与 stderr **各自**接到了
 * 有状态的流解码器上，并且结算时对两者都调用了 `end()`。
 *
 * 覆盖范围（每条都是「只走该通道」或「两通道各写一次」，以便定位接线错误）：
 *
 * - stdout 中文完整拼回、stderr 中文完整拼回，两者互不干扰；
 * - stdout 以半个字符结尾 → 残片被 `end()` 冲出；
 * - stderr 以半个字符结尾 → 残片被 `end()` 冲出，且 stdout 保持空
 *   （若 stderr 漏调 `end()` 或误用 stdout 的 decoder，这条会红）；
 * - stderr 同时含完整中文与尾部残片 → 两者都正确结算（抓漏调 `end()`）。
 *
 * **能抓到的接线错误**：stderr 漏调 `end()`、stderr 误用 stdout 的 decoder、
 * 通道写错、结算顺序错乱。
 *
 * **抓不到的**：stderr 用无状态解码（`buf.toString('utf8')`）。因为两次 write
 * 在父进程读取前会合并成一个 chunk，无状态解码同样能拿到完整字节。
 * 跨 chunk 截断的证伪由 `tests/run/stream-decode.test.ts` 负责——
 * 那里边界由测试自己指定，不依赖 OS 缓冲行为。
 *
 * ## 为什么不在这里证伪「跨 chunk 截断」
 *
 * 早先版本试图在真实子进程里制造「多字节字符被切成两个 chunk」，
 * 先后试过四种手段，全部被实测推翻：
 *
 * - `setTimeout` 拉间隔：父进程一被 GC 或多文件并行占住，多次写就合并。
 * - 子进程忙等 200ms：只是把阈值提高，父进程阻塞 500ms 时照样合并。
 * - 文件 ack 握手：`setInterval` 无条件周期写 ack，与「已处理完当前块」无因果。
 * - 填充 64KB/128KB 撑过读缓冲阈值：本机 pipe 容量实测 135168 字节，
 *   填充量只是「恰好压过临界点」，换环境即可能失效。
 *
 * 根因是用 OS 的缓冲行为去证伪应用层逻辑。真正的证伪放在
 * `tests/run/stream-decode.test.ts`：直接构造字节块序列，结果完全确定。
 *
 * 因此本文件只承担接线职责，**不承担证伪职责**——即使这里的断言全绿，
 * 也不能说明解码是跨 chunk 有状态的；那由单元测试保证。
 */
describe('宿主 stdio 接线', () => {
  it('中文 stdout 完整拼回，不出现替换字符', async () => {
    const text = '暗号:WANXIANG-DONE';
    const run = await runHostedWithReapForTest(
      process.execPath,
      ['-e', `process.stdout.write(${JSON.stringify(text)})`],
      { env: {}, cwd: '/tmp', timeoutMs: 30_000 },
    );

    expect(run.status).toBe(0);
    expect(run.stdout).toBe(text);
    expect(run.stdout).not.toContain('\uFFFD');
  }, 40_000);

  it('中文 stderr 完整拼回，且与 stdout 互不干扰', async () => {
    const out = '正常输出';
    const err = '错误输出';
    const script = [
      `process.stdout.write(${JSON.stringify(out)});`,
      `process.stderr.write(${JSON.stringify(err)});`,
    ].join('\n');

    const run = await runHostedWithReapForTest(process.execPath, ['-e', script], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });

    expect(run.stdout).toBe(out);
    expect(run.stderr).toBe(err);
  }, 40_000);

  it('宿主以半个字符结尾时，残片被 end() 冲出而不是静默丢弃', async () => {
    // '暗' = e6 9a 97。只写前 2 字节就退出，残片留在 decoder 内部。
    // 若 finish 里不调 end()，stdout 会是空串而不是替换字符。
    const script = `process.stdout.write(Buffer.from('暗', 'utf8').subarray(0, 2));`;
    const run = await runHostedWithReapForTest(process.execPath, ['-e', script], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });

    expect(run.stdout).toBe('\uFFFD');
  }, 40_000);

  it('stderr 的残片同样被 end() 冲出（stdout 干净，证明走的是 stderr 通道）', async () => {
    // 只往 stderr 写半个字符，stdout 保持空。
    // 若 stderr 漏调 end()，stderr 会是空串；若误用 stdout 的 decoder，
    // 残片会跑到 stdout 上——两种错误都能被这条断言抓到。
    const script = `process.stderr.write(Buffer.from('暗', 'utf8').subarray(0, 2));`;
    const run = await runHostedWithReapForTest(process.execPath, ['-e', script], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });

    expect(run.stderr).toBe('\uFFFD');
    expect(run.stdout).toBe('');
  }, 40_000);

  it('stderr 同时含完整中文与尾部残片时，两者都被正确结算', async () => {
    // 这条抓「漏调 end()」：尾部残片不冲出来就会少一截。
    // 注意它**抓不到**「stderr 用无状态解码」——两次 write 在父进程读之前
    // 会合并成一个 chunk，无状态解码同样能拿到完整字节。跨 chunk 截断的证伪
    // 由 tests/run/stream-decode.test.ts 负责（那里边界由测试自己指定）。
    const full = '错误';
    const script = [
      `const b = Buffer.from(${JSON.stringify(full)}, 'utf8');`,
      `process.stderr.write(b);`,
      `process.stderr.write(Buffer.from('暗', 'utf8').subarray(0, 2));`,
    ].join('\n');

    const run = await runHostedWithReapForTest(process.execPath, ['-e', script], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });

    // 完整中文必须原样出现；尾部残片必须被冲出成替换字符。
    expect(run.stderr).toBe(`${full}\uFFFD`);
    expect(run.stdout).toBe('');
  }, 40_000);
});

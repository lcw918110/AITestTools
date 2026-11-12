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
 * ## 为什么要按「字节」切
 *
 * 按字符切（如 `['暗', '|', 'DONE']`）时每块本身是完整 UTF-8 序列，
 * 逐块 `toString('utf8')` 也能正确解码——**旧实现同样通过**，用例无法证伪修复。
 * 必须把刀落在多字节字符内部（如把一个汉字的 3 字节切成 1+2）。
 *
 * ## 怎么保证 chunk 边界与机器负载无关
 *
 * 这是本文件最关键的约束。三种朴素做法都**不可靠**，实测均被证伪：
 *
 * - `setTimeout` 拉间隔：父进程被 GC 或多文件并行占住时，多次写合并成一个 chunk，
 *   旧实现同样得到完整字符并通过断言，回归保护静默失效。
 * - 子进程忙等：只是把阈值从 60ms 提到 200ms。实测父进程同步阻塞 500ms 时，
 *   三次写全部落进 pipe 缓冲被一次读走，旧实现照样通过。
 * - 文件 ack 握手（定时器侧无条件周期写 ack）：ack 与「父进程已处理完当前块」
 *   没有因果绑定，父进程 tick 先于子进程 poll 时两块仍会合并。
 *   实测 30 个 CPU 密集进程满载下跑 10 轮，会出现假绿轮次。
 *
 * 这里改用**内核 pipe 背压**：先写满 pipe 缓冲（64KB），再写剩余字节。
 * 填满时内核会挡住写入，剩余字节必须等父进程读走缓冲后才能进入 pipe，
 * 因此必然落在不同的 chunk。这一分离由内核缓冲区的物理容量决定，
 * 与父进程何时被调度**完全无关**。实测 30 进程满载 15 轮 chunk 数恒为 2。
 */
/** pipe 缓冲容量：Linux/macOS 默认 64KB。填满它才能触发背压。 */
const PIPE_CAPACITY = 65536;

/**
 * 生成「先填满 pipe 缓冲，再写剩余字节」的脚本。
 *
 * `text` 的首字符会被切成两段：第一段 1 字节接在填充数据末尾写入，
 * 第二段在其后单独写入。填充数据恰好占满 `PIPE_CAPACITY - 1`，
 * 使第一次写正好填满缓冲、末尾留下半个字符，第二次写必须等父进程读走。
 */
function backpressureWriter(opts: {
  text: string;
  /** 首字符切分点（字节偏移，须落在多字节字符内部）。 */
  cut: number;
  toStderr?: boolean;
}): string {
  const stream = opts.toStderr === true ? 'process.stderr' : 'process.stdout';
  return [
    `const b = Buffer.from(${JSON.stringify(opts.text)}, 'utf8');`,
    `const pad = Buffer.alloc(${PIPE_CAPACITY} - 1, 0x41);`,
    // 第一段：填充 + 首字符前 cut 字节，合计正好填满 pipe 缓冲。
    `const first = Buffer.concat([pad, b.subarray(0, ${opts.cut})]);`,
    `${stream}.write(first);`,
    // 第二段：剩余字节。缓冲已满，必须等父进程读走才能进入 pipe。
    `${stream}.write(b.subarray(${opts.cut}));`,
  ].join('\n');
}

/**
 * 跑一个背压用例。
 *
 * `blockMs` 让父进程在挂好监听后同步阻塞，模拟满载/GC。
 * 背压方案下这不影响 chunk 分离——子进程的第二写被内核挡住，
 * 与父进程何时读无关。
 */
async function runBackpressureCase(opts: {
  text: string;
  cut: number;
  toStderr?: boolean;
  blockMs?: number;
}): Promise<{ stdout: string; stderr: string; status: number | null }> {
  const script = backpressureWriter({
    text: opts.text,
    cut: opts.cut,
    ...(opts.toStderr !== undefined ? { toStderr: opts.toStderr } : {}),
  });

  const pending = runHostedWithReapForTest(process.execPath, ['-e', script], {
    env: {},
    cwd: '/tmp',
    timeoutMs: 30_000,
  });

  const blockMs = opts.blockMs ?? 0;
  if (blockMs > 0) {
    const t = Date.now();
    while (Date.now() - t < blockMs) {
      /* 阻塞事件循环 */
    }
  }

  const run = await pending;
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
}

/** 填充数据会出现在输出里，断言时剥掉前缀只看尾部。 */
function tail(text: string): string {
  return text.slice(PIPE_CAPACITY - 1);
}

describe('宿主 stdio 跨 chunk 的 UTF-8 解码', () => {
  it('汉字被切成 1+2 字节时还原成原字符，不产生替换字符', async () => {
    // '暗' = e6 9a 97，刀落在第 1 字节后：第一段末尾不是合法 UTF-8。
    const run = await runBackpressureCase({ text: '暗|DONE', cut: 1, blockMs: 500 });

    expect(run.status).toBe(0);
    expect(tail(run.stdout)).toBe('暗|DONE');
    expect(run.stdout).not.toContain('\uFFFD');
  }, 40_000);

  it('连续两个汉字逐字节切成三块时也能拼回', async () => {
    // '暗号' = e6 9a 97 e5 8f b7。刀落在第 4 字节：
    // 第一段末尾是 e6 9a 97 e5（尾部半字符），第二段是 8f b7。
    const run = await runBackpressureCase({ text: '暗号', cut: 4, blockMs: 500 });

    expect(tail(run.stdout)).toBe('暗号');
    expect(run.stdout).not.toContain('\uFFFD');
  }, 40_000);

  it('stderr 同样跨 chunk 还原，且与 stdout 互不干扰', async () => {
    // '错' = e9 94 99，刀落在第 2 字节：第一段末尾是 e9 94（半字符）。
    const run = await runBackpressureCase({
      text: '错',
      cut: 2,
      toStderr: true,
      blockMs: 500,
    });

    expect(tail(run.stderr)).toBe('错');
    expect(run.stderr).not.toContain('\uFFFD');
  }, 40_000);

  it('暗号类断言在字节级切分时仍能命中（端到端后果）', async () => {
    const token = 'WANXIANG-DONE';
    const text = `暗号:${token}`;
    // '暗' 的第 1 字节后切开。
    const run = await runBackpressureCase({ text, cut: 1, blockMs: 500 });

    expect(tail(run.stdout)).toBe(text);
    expect(run.stdout).toContain(token);
  }, 40_000);
});

/**
 * 结算前必须 `end()` 冲出尾部残留字节。
 *
 * 与上面四条互补：它们验证「chunk 边界处不产生替换字符」，
 * 这一组验证「流结束时的半字符残片不被吞掉」。
 */
describe('流结束时的半字符残留', () => {
  it('宿主退出时只写出半个字符，残片被 end() 冲出而不是静默丢弃', async () => {
    // '暗' = e6 9a 97。只写前 2 字节就退出：残片留在 decoder 内部，
    // 若 finish 里不调 end()，stdout 末尾凭空少一截。
    // 这条不需要制造 chunk 边界（只有一次写），因此不加填充数据。
    const script = [
      `const b = Buffer.from('暗', 'utf8');`,
      `process.stdout.write(b.subarray(0, 2));`,
    ].join('\n');

    const run = await runHostedWithReapForTest(process.execPath, ['-e', script], {
      env: {},
      cwd: '/tmp',
      timeoutMs: 30_000,
    });

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

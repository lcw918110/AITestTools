import { describe, expect, it } from 'vitest';
import {
  createStreamDecoder,
  decodeChunks,
  sliceByByteOffsets,
} from '../../src/run/stream-decode.ts';

/**
 * 流式 UTF-8 解码的**确定性**回归测试。
 *
 * 解码状态跨 chunk 保留这件事，与「chunk 怎么切」完全无关：只要给定一串字节块，
 * 期望的输出就是确定的。因此这里直接构造字节块序列，不经过子进程、不依赖 pipe
 * 缓冲容量、不依赖调度——任何环境下结果都一样。
 *
 * 早先的集成版用例试图在真实子进程里「制造」chunk 边界，先后试过 setTimeout、
 * 子进程忙等、文件 ack 握手、填充 pipe 缓冲四种手段，全部被实测推翻：
 * 父进程一被阻塞，多次写就合并成一个 chunk，旧实现照样通过（假绿）。
 * 根因是用 OS 缓冲行为去证伪应用层逻辑——错配。把逻辑抽成纯函数后，
 * 边界由测试自己指定，问题从根上消失。
 *
 * 仍保留一组真实子进程用例（见 `hosted-stdio-utf8.test.ts`）验证接线，
 * 但那里只断言「拼回完整文本」，不承担证伪职责。
 */
describe('decodeChunks：任意字节切分都还原原文', () => {
  it('汉字被切成 1+2 字节时还原成原字符，不产生替换字符', () => {
    // '暗' = e6 9a 97，刀落在第 1 字节后：第一块不是合法 UTF-8。
    const chunks = sliceByByteOffsets('暗|DONE', [1]);

    expect(decodeChunks(chunks)).toBe('暗|DONE');
  });

  it('连续两个汉字切成三块时也能拼回', () => {
    // '暗号' = e6 9a 97 e5 8f b7，刀落在第 1 与第 4 字节：
    // 块1 = e6（非法）、块2 = 9a 97 e5（非法，尾部半字符）、块3 = 8f b7。
    const chunks = sliceByByteOffsets('暗号', [1, 4]);

    expect(decodeChunks(chunks)).toBe('暗号');
  });

  it('逐字节切分（最坏情形）仍能拼回', () => {
    const text = '暗号终止';
    const offsets = Array.from({ length: Buffer.byteLength(text, 'utf8') - 1 }, (_, i) => i + 1);
    const chunks = sliceByByteOffsets(text, offsets);

    expect(chunks.length).toBe(Buffer.byteLength(text, 'utf8'));
    expect(decodeChunks(chunks)).toBe(text);
  });

  it('每个中间块都不含替换字符，替换字符只可能出现在未结算的残片', () => {
    const decoder = createStreamDecoder();
    // 逐字节喂入，任何一步都不应产出 U+FFFD（除非该字节本身非法）。
    const text = '暗号';
    const buf = Buffer.from(text, 'utf8');
    let out = '';
    for (const byte of buf) {
      out += decoder.write(Buffer.from([byte]));
    }
    expect(out).toBe(text);
    expect(out).not.toContain('\uFFFD');
    expect(decoder.end()).toBe('');
  });

  it('空块混在序列中不影响结果', () => {
    const chunks = sliceByByteOffsets('暗号', [1, 1, 4]);

    expect(decodeChunks(chunks)).toBe('暗号');
  });

  it('纯 ASCII 与中文混排、多处切分仍还原', () => {
    const text = 'model=暗号|DONE::r1';
    // 刀分别落在中文与 ASCII 边界上。
    const chunks = sliceByByteOffsets(text, [1, 8, 12, 20]);

    expect(decodeChunks(chunks)).toBe(text);
  });
});

describe('decodeChunks：结算时冲出尾部残片', () => {
  it('不足一个完整字符的尾字节被 end() 冲出，而不是静默丢弃', () => {
    // '暗' = e6 9a 97，只给前 2 字节。
    const chunks = [Buffer.from('暗', 'utf8').subarray(0, 2)];

    // 残片被冲出后必然是替换字符：证明数据没丢，只是不完整。
    expect(decodeChunks(chunks)).toBe('\uFFFD');
  });

  it('不调 end() 就会丢掉尾部残片（对照：证明 end() 的必要性）', () => {
    const decoder = createStreamDecoder();
    const chunks = [Buffer.from('暗', 'utf8').subarray(0, 2)];

    let out = '';
    for (const chunk of chunks) out += decoder.write(chunk);
    // 不调 end()：写入阶段解不出东西，残片留在内部。
    expect(out).toBe('');
    // 调 end() 才有内容。
    expect(decoder.end()).toBe('\uFFFD');
  });

  it('尾字节恰好补全时还原成原字符，且无残留', () => {
    const decoder = createStreamDecoder();
    const all = Buffer.from('暗', 'utf8');

    expect(decoder.write(all.subarray(0, 2))).toBe('');
    expect(decoder.write(all.subarray(2))).toBe('暗');
    expect(decoder.end()).toBe('');
  });

  it('end() 重复调用返回空串，不重复吐残片', () => {
    const decoder = createStreamDecoder();
    decoder.write(Buffer.from('暗', 'utf8').subarray(0, 2));

    expect(decoder.end()).toBe('\uFFFD');
    expect(decoder.end()).toBe('');
  });

  it('end() 后再 write 按新流解码，不污染已结算文本', () => {
    const decoder = createStreamDecoder();
    expect(decoder.end()).toBe('');
    // 结算后继续写：能正常解码（Node 的 StringDecoder 允许该用法）。
    expect(decoder.write(Buffer.from('暗', 'utf8'))).toBe('暗');
  });
});

describe('切片工具自身的正确性', () => {
  it('边界含全文长度时不产生多余的空块', () => {
    const chunks = sliceByByteOffsets('暗', [3]);

    expect(chunks.length).toBe(2);
    expect(chunks[1]?.length).toBe(0);
    expect(decodeChunks(chunks)).toBe('暗');
  });

  it('无偏移时返回单个完整块', () => {
    const chunks = sliceByByteOffsets('暗号', []);

    expect(chunks.length).toBe(1);
    expect(decodeChunks(chunks)).toBe('暗号');
  });

  it('切出的块拼起来等于原字节序列', () => {
    const text = '暗号|DONE';
    const chunks = sliceByByteOffsets(text, [1, 4]);

    expect(Buffer.concat(chunks).toString('utf8')).toBe(text);
  });
});

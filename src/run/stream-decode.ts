import { StringDecoder } from 'node:string_decoder';

/**
 * 把子进程 stdout/stderr 的字节流累积成文本。
 *
 * 为什么需要单独一层：`chunk.toString('utf8')` 逐块解码在**多字节字符被切开**时
 * 会产出替换字符（U+FFFD）。一个汉字的 3 个字节若分属两个 chunk，前后两截各自
 * 解码都成 `\uFFFD`。后果不是日志难看——`stdout_assert` 与暗号类 oracle 直接
 * 比对文本，字被截坏会把「确实输出了暗号」判成没输出（假红），也可能让带替换
 * 字符的错误文本意外命中（假绿）。
 *
 * 修法是把解码状态跨 chunk 保留，并在流结束时把尾部残留字节冲出来。
 * 这两件事都与「chunk 怎么切」无关，因此本模块只接受**字节块序列**，
 * 不关心它们来自 pipe、文件还是测试里手写的数组。
 */
export interface StreamDecoder {
  /** 喂入一块字节，返回本次能确定解码出的文本（可能为空串）。 */
  write(chunk: Buffer): string;
  /**
   * 结束输入，返回尾部残留字节解码出的文本。
   *
   * 不足一个完整字符的残片会被解成 `\uFFFD`。不调用本方法会让末尾凭空少一截。
   * 只应调用一次；重复调用返回空串。
   */
  end(): string;
}

/** 创建一个有状态的 UTF-8 流解码器。 */
export function createStreamDecoder(): StreamDecoder {
  const decoder = new StringDecoder('utf8');
  return {
    write(chunk: Buffer): string {
      return decoder.write(chunk);
    },
    end(): string {
      return decoder.end();
    },
  };
}

/**
 * 把一组字节块按顺序解码成完整文本（含结算）。
 *
 * 供测试与需要一次性还原整段输出的调用方使用；生产路径按 chunk 增量调用
 * `createStreamDecoder()`，语义与 `chunks.reduce(...) + end()` 一致。
 */
export function decodeChunks(chunks: readonly Buffer[]): string {
  const decoder = createStreamDecoder();
  let text = '';
  for (const chunk of chunks) text += decoder.write(chunk);
  return text + decoder.end();
}

/**
 * 按给定**字节偏移**切分文本，用于构造「刀落在多字节字符内部」的用例。
 *
 * 偏移必须单调递增且都落在 `[0, byteLength]` 内；落在字符内部时该字符会被
 * 切成两段，正是需要覆盖的情形。
 */
export function sliceByByteOffsets(text: string, offsets: readonly number[]): Buffer[] {
  const buf = Buffer.from(text, 'utf8');
  const bounds = [...offsets, buf.length];
  const chunks: Buffer[] = [];
  let prev = 0;
  for (const bound of bounds) {
    chunks.push(buf.subarray(prev, bound));
    prev = bound;
  }
  return chunks;
}

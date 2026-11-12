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
   *
   * 生产路径由 `settled` 守卫保证只调一次。连续调用两次（中间无 `write`）时
   * 第二次返回空串；但若中间又 `write` 了新的残片，第二次 `end()` 会把新残片
   * 解出来——`end()` 会重置内部状态，不是幂等终结符。
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

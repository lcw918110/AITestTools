/**
 * 空白判定（静态校验与 oracle 运行期共用的唯一口径）。
 *
 * 单独成模块而不是放在 `validate.ts`：`validate.ts` 依赖 loader / schema / digest，
 * oracle 运行期若从它导入会把整套加载链路拉进运行时依赖图（分层倒置）。
 */

/**
 * 「空白」的唯一定义：去掉不可见字符后为空。
 *
 * 不用 `String.prototype.trim()`：它不认全角空格 U+3000、零宽空格 U+200B、
 * 不换行空格 U+00A0、零宽连接符 U+200C/D 与 BOM U+FEFF，这些字符肉眼不可见
 * 却会让断言「看起来声明了、实际匹配不到」。
 * 注意 `\t` / `\n` 是真实字符语义（如「必须用 tab 缩进」），但**单独**声明它们时
 * 同样没有任何可判内容，故一并归入空白；和文字混排（`"a\tb"`）不受影响。
 */
export function isBlankText(value: string): boolean {
  return value.replace(/[\s\u00a0\u200b-\u200d\u3000\ufeff]/g, '') === '';
}

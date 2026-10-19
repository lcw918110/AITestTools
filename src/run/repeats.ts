import type { CaseRevision, EnvironmentProfile } from '../domain/types.ts';

/** repeats 默认值：声明才生效（opt-in），不声明就跑 1 次（行业做法）。 */
export const DEFAULT_REPEATS = 1;

/**
 * 解析同一 run 内对同一 CaseRevision 的 trial 次数（repeats）。
 *
 * 优先级：题级 `execution.repeats` > 环境级 `recipe.adapter.repeats` > 默认 1。
 * 采用 opt-in 语义：不声明就不多次采样，避免无谓成本翻倍；需要稳定性结论时显式声明。
 * 结果钳制到 >= 1。
 */
export function resolveRepeats(revision: CaseRevision, environment: EnvironmentProfile): number {
  const fromItem = revision.execution.repeats;
  const fromEnv = environment.recipe?.adapter?.repeats;

  const resolved = fromItem ?? fromEnv ?? DEFAULT_REPEATS;
  return Math.max(1, Math.trunc(resolved));
}

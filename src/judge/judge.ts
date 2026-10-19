/**
 * 裁判体系核心逻辑（§5.1）。
 * 三类来源：题目对比（确定性 oracle，必现）、模型判断（LLM-as-judge，人为触发）、
 * 人工判断（human，人为触发）。三类都产出 `Score`，与硬门禁 `pass` 分列。
 *
 * 本文只提供纯逻辑：裁判 prompt 模板、严格 JSON 解析、Score 构造与落盘辅助。
 * 模型调用通过注入的 `JudgeCaller` 完成，便于单测（不依赖真实 API）。
 */
import type { RubricSpec, Score } from '../domain/types.ts';

/** 裁判模型一次判定的输入。 */
export interface JudgeInput {
  task_prompt: string;
  /** 最终 workspace / 输出产物文本。 */
  final_output: string;
  rubric: RubricSpec;
}

/** 单个维度的判定结果。 */
export interface DimensionVerdict {
  dimension: string;
  pass: boolean;
  reason: string;
}

/** 裁判模型调用接口（注入，便于测试与真实实现解耦）。 */
export interface JudgeCaller {
  (prompt: string): Promise<string>;
}

/** 内置默认裁判 prompt 模板：要求只输出 JSON。 */
export function buildJudgePrompt(input: JudgeInput, promptVersion?: string): string {
  void promptVersion;
  const dims = input.rubric.dimensions
    .map((d, i) => `${i + 1}. ${d.name}（量表：${d.scale}）`)
    .join('\n');
  return [
    '你是一名评测裁判。请根据任务要求与最终输出，逐维度判定是否达标。',
    '',
    '【任务要求】',
    input.task_prompt,
    '',
    '【最终输出】',
    input.final_output,
    '',
    '【判定维度】',
    dims,
    '',
    '只输出一个 JSON 数组，每项形如：',
    '{"dimension":"<维度名>","pass":true|false,"reason":"<理由>"}',
    '维度名必须与上面列出的完全一致；pass 必须为布尔值；不要输出任何 JSON 以外的内容。',
  ].join('\n');
}

/** 严格解析裁判 JSON 输出；解析失败返回 undefined。 */
export function parseJudgeVerdicts(
  raw: string,
  rubric: RubricSpec,
): DimensionVerdict[] | undefined {
  const text = raw.trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const byName = new Map(rubric.dimensions.map((d) => [d.name, d]));
  const out: DimensionVerdict[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return undefined;
    const o = item as Record<string, unknown>;
    if (typeof o.dimension !== 'string' || typeof o.pass !== 'boolean') return undefined;
    if (!byName.has(o.dimension)) return undefined;
    out.push({
      dimension: o.dimension,
      pass: o.pass,
      reason: typeof o.reason === 'string' ? o.reason : '',
    });
  }
  // 维度必须与 rubric 完全一致（不重不漏）。
  if (out.length !== rubric.dimensions.length) return undefined;
  for (const d of rubric.dimensions) {
    if (!out.some((v) => v.dimension === d.name)) return undefined;
  }
  return out;
}

let seq = 0;
function nextScoreId(): string {
  seq += 1;
  return `score-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** 由维度判定构造 model_judge 类 Score（逐维度一条）。 */
export function verdictsToScores(
  verdicts: DimensionVerdict[],
  rubric: RubricSpec,
  judgeModel?: string,
  promptVersion?: string,
  itemId?: string,
): Score[] {
  return verdicts.map((v) => {
    const dim = rubric.dimensions.find((d) => d.name === v.dimension);
    const score: Score = {
      score_id: nextScoreId(),
      source: 'model_judge',
      dimension: v.dimension,
      reason: v.reason,
    };
    if (dim) {
      score.scale = dim.scale;
      score.weight = dim.weight;
    }
    if (judgeModel) score.judge_model = judgeModel;
    if (promptVersion) score.judge_prompt_version = promptVersion;
    if (itemId) score.item_id = itemId;
    return score;
  });
}

/** 构造人工判断（human）类 Score。 */
export function humanScores(
  rubric: RubricSpec,
  verdicts: DimensionVerdict[],
  reviewer?: string,
  itemId?: string,
): Score[] {
  return verdicts.map((v) => {
    const dim = rubric.dimensions.find((d) => d.name === v.dimension);
    const score: Score = {
      score_id: nextScoreId(),
      source: 'human',
      dimension: v.dimension,
      reason: v.reason,
    };
    if (dim) {
      score.scale = dim.scale;
      score.weight = dim.weight;
    }
    if (reviewer) score.human_reviewer = reviewer;
    if (itemId) score.item_id = itemId;
    return score;
  });
}

/** 裁判失败降级：为每个维度产出一条 judge_error 记录（不进硬门禁）。 */
export function judgeErrorScores(rubric: RubricSpec, error: string, itemId?: string): Score[] {
  return rubric.dimensions.map((d) => {
    const score: Score = {
      score_id: nextScoreId(),
      source: 'model_judge',
      dimension: d.name,
      scale: d.scale,
      weight: d.weight,
      reason: `judge_error: ${error}`,
    };
    if (itemId) score.item_id = itemId;
    return score;
  });
}

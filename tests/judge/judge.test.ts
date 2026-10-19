import { describe, expect, it } from 'vitest';
import {
  buildJudgePrompt,
  humanScores,
  judgeErrorScores,
  mergeScores,
  parseJudgeVerdicts,
  verdictsToScores,
} from '../../src/judge/judge.ts';
import type { RubricSpec, Score } from '../../src/domain/types.ts';

const rubric: RubricSpec = {
  dimensions: [
    { name: '代码可读性', scale: 'pass/fail', weight: 1 },
    { name: '方案合理性', scale: 'pass/fail', weight: 1 },
  ],
};

describe('judge', () => {
  it('buildJudgePrompt 包含任务、输出与维度', () => {
    const p = buildJudgePrompt({
      task_prompt: '写一个排序函数',
      final_output: 'function sort() {}',
      rubric,
    });
    expect(p).toContain('写一个排序函数');
    expect(p).toContain('function sort() {}');
    expect(p).toContain('代码可读性');
    expect(p).toContain('方案合理性');
    expect(p).toContain('JSON');
  });

  it('parseJudgeVerdicts 解析合法 JSON 数组', () => {
    const raw =
      '[{"dimension":"代码可读性","pass":true,"reason":"清晰"},{"dimension":"方案合理性","pass":false,"reason":"不完整"}]';
    const v = parseJudgeVerdicts(raw, rubric);
    expect(v).toHaveLength(2);
    expect(v?.[0]).toEqual({ dimension: '代码可读性', pass: true, reason: '清晰' });
    expect(v?.[1]?.pass).toBe(false);
  });

  it('parseJudgeVerdicts 容忍 JSON 前后杂讯', () => {
    const raw =
      '以下是判定：\n[{"dimension":"代码可读性","pass":true,"reason":"x"},{"dimension":"方案合理性","pass":true,"reason":"y"}]\n完毕';
    expect(parseJudgeVerdicts(raw, rubric)).toHaveLength(2);
  });

  it('parseJudgeVerdicts 对缺维度/多维度/非布尔返回 undefined', () => {
    expect(parseJudgeVerdicts('[{"dimension":"代码可读性","pass":true}]', rubric)).toBeUndefined();
    expect(parseJudgeVerdicts('not json', rubric)).toBeUndefined();
    expect(
      parseJudgeVerdicts(
        '[{"dimension":"代码可读性","pass":"yes"},{"dimension":"方案合理性","pass":true}]',
        rubric,
      ),
    ).toBeUndefined();
    expect(
      parseJudgeVerdicts(
        '[{"dimension":"代码可读性","pass":true},{"dimension":"方案合理性","pass":true},{"dimension":"多余","pass":true}]',
        rubric,
      ),
    ).toBeUndefined();
  });

  it('verdictsToScores 逐维度产出 model_judge Score', () => {
    const scores = verdictsToScores(
      [
        { dimension: '代码可读性', pass: true, reason: '清晰' },
        { dimension: '方案合理性', pass: false, reason: '不完整' },
      ],
      rubric,
      'judge-model',
      'v1',
      'PAIRED-TASK-160',
    );
    expect(scores).toHaveLength(2);
    expect(scores[0]?.source).toBe('model_judge');
    expect(scores[0]?.dimension).toBe('代码可读性');
    expect(scores[0]?.judge_model).toBe('judge-model');
    expect(scores[0]?.judge_prompt_version).toBe('v1');
    expect(scores[0]?.scale).toBe('pass/fail');
    expect(scores[0]?.weight).toBe(1);
    expect(scores[0]?.item_id).toBe('PAIRED-TASK-160');
  });

  it('humanScores 产出 human Score', () => {
    const scores = humanScores(rubric, [{ dimension: '代码可读性', pass: true, reason: 'ok' }]);
    expect(scores[0]?.source).toBe('human');
    expect(scores[0]?.reason).toBe('ok');
  });

  it('judgeErrorScores 逐维度产出 judge_error', () => {
    const scores = judgeErrorScores(rubric, '超时');
    expect(scores).toHaveLength(2);
    expect(scores[0]?.reason).toContain('judge_error');
  });

  it('mergeScores 同 item+source+dimension 覆盖（新判定胜出）', () => {
    const mk = (id: string, source: Score['source'], dimension: string): Score => ({
      score_id: id,
      source,
      dimension,
      scale: 'pass/fail',
      weight: 1,
      reason: id,
    });
    const existing = [mk('old-a', 'model_judge', '代码可读性'), mk('old-b', 'human', '代码可读性')];
    const incoming = [mk('new-a', 'model_judge', '代码可读性')];
    const merged = mergeScores(existing, incoming);
    // 同 item+source+dimension 的旧分被覆盖，不同 source 的保留。
    expect(merged).toHaveLength(2);
    expect(merged.map((s) => s.score_id)).toEqual(['old-b', 'new-a']);
  });

  it('mergeScores 不同维度/来源不互相覆盖', () => {
    const mk = (id: string, source: Score['source'], dimension: string): Score => ({
      score_id: id,
      source,
      dimension,
      scale: 'pass/fail',
      weight: 1,
      reason: id,
    });
    const existing = [mk('a', 'model_judge', '代码可读性')];
    const incoming = [mk('b', 'model_judge', '方案合理性')];
    const merged = mergeScores(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.map((s) => s.score_id)).toEqual(['a', 'b']);
  });
});

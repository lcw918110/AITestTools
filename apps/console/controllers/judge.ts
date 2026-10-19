/**
 * 触发裁判 API（controller）。
 * 人为触发：模型判断（LLM-as-judge）或人工判断（human），产出 `Score` 落盘到 run 目录。
 * 结果写 `judge_scores.json`（结构化 Score[]，逐维度），与硬门禁分列。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpResponse } from '../http.ts';
import { PROJECT } from '../config.ts';
import { safeUnder } from '../bank.ts';
import { loadModelPool, resolveJudgeModel } from '../../../src/model-pool/model-catalog.ts';
import {
  buildJudgePrompt,
  humanScores,
  judgeErrorScores,
  parseJudgeVerdicts,
  verdictsToScores,
} from '../../../src/judge/judge.ts';
import { resolveRubricFromCaseRevision } from '../../../src/judge/resolve-rubric.ts';
import { computeAgreement } from '../../../src/judge/agreement.ts';
import type { RubricSpec, Score } from '../../../src/domain/types.ts';

export interface TriggerJudgeBody {
  runPath?: string;
  itemId?: string;
  kind?: 'model' | 'human';
  /** 人工判断时的逐维度判定。 */
  verdicts?: Array<{ dimension: string; pass: boolean; reason?: string }>;
  reviewer?: string;
  task_prompt?: string;
  final_output?: string;
  rubric?: RubricSpec;
}

function resolveRunDir(runPath: string): string | undefined {
  // 前端传绝对路径（data.dir）；兼容相对 PROJECT 的路径（如 runs/xxx）。
  const candidates = [
    runPath,
    join(PROJECT, runPath),
    join(PROJECT, 'runs', runPath.replace(/^runs[\\/]/, '')),
  ];
  for (const c of candidates) {
    const abs = safeUnder(join(PROJECT, 'runs'), c) ?? safeUnder(PROJECT, c);
    if (abs && existsSync(abs)) return abs;
  }
  return undefined;
}

function loadJudgeScores(runDir: string): Score[] {
  const p = join(runDir, 'judge_scores.json');
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    if (
      typeof raw === 'object' &&
      raw !== null &&
      Array.isArray((raw as { scores?: unknown }).scores)
    ) {
      return (raw as { scores: Score[] }).scores;
    }
    return [];
  } catch {
    return [];
  }
}

function writeJudgeScores(runDir: string, scores: Score[]): void {
  writeFileSync(join(runDir, 'judge_scores.json'), `${JSON.stringify({ scores }, null, 2)}\n`);
}

/** 按模型推断 OpenAI 兼容端点（与 promptfoo.ts 的 resolveLiveProvider 对齐）。 */
function resolveBaseUrl(modelId: string): string {
  const m = modelId.toLowerCase();
  if (m.startsWith('deepseek')) {
    return process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
  }
  return process.env.OPENAI_BASE_URL ?? 'https://api.longcat.chat/openai';
}

/** 真实裁判调用：OpenAI 兼容端点 + api_key_env 引用取密钥。stub 模式走 PROCTOR_JUDGE_STUB。 */
async function callJudge(modelId: string, prompt: string, apiKeyEnv?: string): Promise<string> {
  if (process.env.PROCTOR_JUDGE_STUB === '1') {
    return JSON.stringify([{ dimension: 'stub', pass: true, reason: 'stub' }]);
  }
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
  if (!apiKey) {
    throw new Error(`裁判模型 ${modelId} 需要密钥引用 ${apiKeyEnv ?? '(未配置)'}`);
  }
  const baseUrl = resolveBaseUrl(modelId);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    throw new Error(`裁判模型调用失败 status=${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('裁判模型返回无内容');
  return content;
}

export async function triggerJudge(body: TriggerJudgeBody): Promise<HttpResponse> {
  const runDir = resolveRunDir(body.runPath ?? '');
  if (!runDir) return { status: 400, body: { error: 'run 路径无效' } };
  // 优先用请求体显式 rubric；未带则从题目配置自动读 expect.rubric。
  let rubric = body.rubric;
  if (!rubric && body.itemId) {
    rubric = resolveRubricFromCaseRevision(PROJECT, body.itemId);
  }
  if (!rubric || !Array.isArray(rubric.dimensions) || rubric.dimensions.length === 0) {
    return { status: 400, body: { error: '该题未声明 rubric（expect.rubric）' } };
  }

  if (body.kind === 'human') {
    const verdicts = (body.verdicts ?? []).map((v) => ({
      dimension: v.dimension,
      pass: v.pass,
      reason: v.reason ?? '',
    }));
    const scores = humanScores(rubric, verdicts, body.reviewer, body.itemId);
    const merged = mergeScores(loadJudgeScores(runDir), scores);
    writeJudgeScores(runDir, merged);
    return { status: 200, body: { ok: true, scores } };
  }

  // model 判断
  const pool = loadModelPool(PROJECT);
  const judgeModel = resolveJudgeModel(pool, rubric.judge?.model);
  if (!judgeModel) {
    return { status: 400, body: { error: '未配置裁判模型（category=judge 或 general）' } };
  }
  const entry = pool.entries.find((e) => e.model_id === judgeModel);
  const prompt = buildJudgePrompt(
    {
      task_prompt: body.task_prompt ?? '',
      final_output: body.final_output ?? '',
      rubric,
    },
    rubric.judge?.prompt_version,
  );
  try {
    const raw = await callJudge(judgeModel, prompt, entry?.api_key_env);
    const verdicts = parseJudgeVerdicts(raw, rubric);
    if (!verdicts) {
      const scores = judgeErrorScores(rubric, `解析失败：${raw.slice(0, 200)}`, body.itemId);
      const merged = mergeScores(loadJudgeScores(runDir), scores);
      writeJudgeScores(runDir, merged);
      return { status: 200, body: { ok: true, judge_error: true, scores } };
    }
    const scores = verdictsToScores(
      verdicts,
      rubric,
      judgeModel,
      rubric.judge?.prompt_version,
      body.itemId,
    );
    const merged = mergeScores(loadJudgeScores(runDir), scores);
    writeJudgeScores(runDir, merged);
    return { status: 200, body: { ok: true, judge_model: judgeModel, scores } };
  } catch (e) {
    const scores = judgeErrorScores(rubric, (e as Error).message, body.itemId);
    const merged = mergeScores(loadJudgeScores(runDir), scores);
    writeJudgeScores(runDir, merged);
    return { status: 200, body: { ok: true, judge_error: true, scores } };
  }
}

function mergeScores(existing: Score[], incoming: Score[]): Score[] {
  // 同 item_id + source + dimension 覆盖（同一题同维度只留最新）。
  const keep = existing.filter(
    (e) =>
      !incoming.some(
        (i) => i.item_id === e.item_id && i.source === e.source && i.dimension === e.dimension,
      ),
  );
  return [...keep, ...incoming];
}

/** 人工标注校验基准：读取 run 的 judge_scores.json，计算 model_judge vs human 一致性。 */
export function judgeAgreement(runPath: string): HttpResponse {
  const runDir = resolveRunDir(runPath);
  if (!runDir) return { status: 400, body: { error: 'run 路径无效' } };
  const scores = loadJudgeScores(runDir);
  const report = computeAgreement(scores);
  return { status: 200, body: report };
}

/**
 * 健康检查、预设项与项目摘要（controller）。
 * 原 server.ts handler 迁移：不依赖 HTTP req/res，返回 HttpResponse。
 */
import type { HttpResponse } from '../http.ts';
import { projectSummary } from '../project-reader.ts';

const PRESETS = [
  {
    id: 'model',
    label: '测模型',
    description: '同一 Agent、无插件、同一任务；换模型',
    release: 'paired-off',
    room: 'hosted-plain-v1',
    needsLive: true,
    defaultExamMode: 'off' as const,
    defaultRelease: 'paired-off',
    defaultTestSetId: 'full',
  },
  {
    id: 'plugin',
    label: '测万象术',
    description: '同一 Agent、同一模型、同一批题目；只变有无插件',
    release: 'paired-off + paired-on',
    room: 'plain / plugin',
    needsLive: true,
    paired: true,
    defaultExamMode: 'both' as const,
    defaultRelease: 'paired-off',
    defaultTestSetId: 'full',
  },
  {
    id: 'agent',
    label: '测 Agent',
    description: '同一模型、无插件、同一任务',
    release: 'paired-off',
    room: 'hosted-plain-v1',
    needsLive: true,
    defaultExamMode: 'off' as const,
    defaultRelease: 'paired-off',
    defaultTestSetId: 'full',
  },
] as const;

export async function health(): Promise<HttpResponse> {
  return { status: 200, body: { ok: true, project: 'examples/product-eval' } };
}

export async function presets(): Promise<HttpResponse> {
  return { status: 200, body: { presets: PRESETS } };
}

export async function project(): Promise<HttpResponse> {
  return { status: 200, body: projectSummary() };
}

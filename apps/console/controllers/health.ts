/**
 * 健康检查、预设项与项目摘要（controller）。
 * 原 server.ts handler 迁移：不依赖 HTTP req/res，返回 HttpResponse。
 */
import type { HttpResponse } from '../http.ts';
import { projectSummary } from '../project-reader.ts';
import { validateBank } from '../bank.ts';
import { loadEnvCatalog } from '../env-catalog.ts';
import { listTestSets, testSetDetail } from '../test-sets.ts';
import { collectReproManifest } from '../env-profile.ts';
import { PROJECT, REPO_ROOT } from '../config.ts';

const PRESETS = [
  {
    id: 'model',
    label: '测模型',
    description: '同一 Agent、无插件、同一任务；换模型',
    defaultExamMode: 'off' as const,
    defaultRelease: 'paired-off' as const,
    defaultTestSetId: 'full',
  },
  {
    id: 'plugin',
    label: '测万象术',
    description: '同一 Agent、同一模型、同一批题目；只变有无插件',
    defaultExamMode: 'both' as const,
    defaultRelease: 'paired-off' as const,
    defaultTestSetId: 'full',
  },
  {
    id: 'agent',
    label: '测 Agent',
    description: '同一模型、无插件、同一任务',
    defaultExamMode: 'off' as const,
    defaultRelease: 'paired-off' as const,
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

/** 综合健康检查：服务状态 + 题库校验 + 环境目录 + 数据集完整性 + 复现清单。 */
export async function healthCheck(): Promise<HttpResponse> {
  const summary = projectSummary();
  const catalog = loadEnvCatalog(PROJECT);
  const testSets = listTestSets(PROJECT);
  const datasetIntegrity = testSets.map((ts) => {
    const detail = testSetDetail(PROJECT, ts.id);
    if ('error' in detail) {
      return { id: ts.id, error: detail.error };
    }
    return {
      id: ts.id,
      taskCount: detail.taskIds.length,
      offCount: detail.coverage.offCount,
      onCount: detail.coverage.onCount,
      missing: detail.coverage.missing,
      unreadable: detail.coverage.unreadable,
    };
  });
  const bank = await validateBank(REPO_ROOT);
  const manifest = collectReproManifest();
  const unverifiedModels = catalog.models.filter((m) => !m.verifiedAt).map((m) => m.id);
  const unverifiedAgents = catalog.agents.filter((a) => !a.verifiedAt).map((a) => a.id);
  const datasetErrors = datasetIntegrity.filter(
    (d) => 'error' in d || d.missing.length > 0 || d.unreadable.length > 0,
  );
  const ok = computeHealthOk({
    bankOk: bank.ok,
    projectErrorCount: summary.errors.length,
    unverifiedModelCount: unverifiedModels.length,
    unverifiedAgentCount: unverifiedAgents.length,
    datasetErrorCount: datasetErrors.length,
  });
  return {
    status: 200,
    body: {
      ok,
      service: { ok: true, project: 'examples/product-eval' },
      project: { errors: summary.errors },
      bank: { ok: bank.ok, exitCode: bank.exitCode, summary: bank.summary },
      environment: {
        models: catalog.models.length,
        agents: catalog.agents.length,
        unverifiedModels,
        unverifiedAgents,
      },
      datasets: { total: testSets.length, integrity: datasetIntegrity },
      manifest,
    },
  };
}

/** 综合健康检查「是否健康」的聚合判定（纯函数，供单测覆盖）。 */
export interface HealthOkInput {
  bankOk: boolean;
  projectErrorCount: number;
  unverifiedModelCount: number;
  unverifiedAgentCount: number;
  datasetErrorCount: number;
}

export function computeHealthOk(input: HealthOkInput): boolean {
  return (
    input.bankOk &&
    input.projectErrorCount === 0 &&
    input.unverifiedModelCount === 0 &&
    input.unverifiedAgentCount === 0 &&
    input.datasetErrorCount === 0
  );
}

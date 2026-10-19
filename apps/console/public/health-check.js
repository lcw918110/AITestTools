/** 健康检查 UI（综合健康检查，对齐 docs/03 §5 运维与健康检查）。 */

import { api } from './bank.js';

function setStatus(text, cls) {
  const el = document.getElementById('healthStatus');
  el.textContent = text;
  el.className = `status ${cls || ''}`;
}

function badge(ok) {
  return ok ? '✅' : '❌';
}

function renderResult(data) {
  const host = document.getElementById('healthResult');
  host.hidden = false;
  const lines = [];

  lines.push(`总体：${badge(data.ok)} ${data.ok ? '健康' : '存在异常'}`);

  lines.push('');
  lines.push(`服务：${badge(data.service.ok)} ${data.service.project}`);

  lines.push('');
  lines.push('项目摘要：');
  const projErrors = data.project?.errors ?? [];
  if (projErrors.length === 0) lines.push('  ✅ 无错误');
  else for (const e of projErrors) lines.push(`  ❌ ${e}`);

  lines.push('');
  lines.push('题库校验：');
  const bank = data.bank ?? {};
  lines.push(`  ${badge(bank.ok)} ${bank.summary ?? ''}`);

  lines.push('');
  lines.push('环境目录：');
  const env = data.environment ?? {};
  lines.push(`  模型 ${env.models ?? 0} 个 · Agent ${env.agents ?? 0} 个`);
  if ((env.unverifiedModels ?? []).length)
    lines.push(`  ⚠️ 未验证模型：${env.unverifiedModels.join('、')}`);
  if ((env.unverifiedAgents ?? []).length)
    lines.push(`  ⚠️ 未验证 Agent：${env.unverifiedAgents.join('、')}`);

  lines.push('');
  lines.push('数据集完整性：');
  const ds = data.datasets ?? {};
  lines.push(`  共 ${ds.total ?? 0} 个测试集`);
  for (const it of ds.integrity ?? []) {
    if (it.error) {
      lines.push(`  ❌ ${it.id}：${it.error}`);
      continue;
    }
    const problems = [];
    if ((it.missing ?? []).length) problems.push(`缺分层 ${it.missing.join('、')}`);
    if ((it.unreadable ?? []).length) problems.push(`读取失败 ${it.unreadable.join('、')}`);
    const status = problems.length ? `⚠️ ${problems.join('；')}` : '✅';
    lines.push(`  ${it.id}：${it.taskCount} 题（OFF ${it.offCount} / ON ${it.onCount}）${status}`);
  }

  lines.push('');
  lines.push('复现清单：');
  const m = data.manifest ?? {};
  if (m.gitCommit) lines.push(`  gitCommit：${m.gitCommit}`);
  lines.push(`  worktreeDirty：${m.worktreeDirty ? '是' : '否'}`);
  if (m.nodeVersion) lines.push(`  nodeVersion：${m.nodeVersion}`);
  lines.push(`  os：${m.osPlatform} ${m.osArch}`);
  if (m.lockfileSummary) lines.push(`  lockfile：${m.lockfileSummary}`);

  host.textContent = lines.join('\n');
}

async function run() {
  setStatus('检查中…（题库校验较慢，请稍候）', '');
  try {
    const data = await api('/api/health/check');
    renderResult(data);
    setStatus(data.ok ? '检查完成' : '检查完成（存在异常）', data.ok ? 'ok' : 'err');
  } catch (e) {
    setStatus(String(e.message || e), 'err');
  }
}

function wire() {
  document.getElementById('healthRun').addEventListener('click', () => void run());
}

export function initHealthCheck() {
  wire();
  // 不自动触发完整检查（含耗时的 item validate）；由用户点击「运行完整检查」按需触发。
}

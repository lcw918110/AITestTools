/** 指标趋势 UI（跨 run 指标时间线，对齐 docs/03 §4 持续评测闭环）。 */

import { api } from './bank.js';

function setStatus(text, cls) {
  const el = document.getElementById('trendStatus');
  el.textContent = text;
  el.className = `status ${cls || ''}`;
}

function renderTable(points, metric) {
  const table = document.getElementById('trendTable');
  const body = document.getElementById('trendBody');
  const empty = document.getElementById('trendEmpty');
  body.innerHTML = '';
  if (!points || points.length === 0) {
    table.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  table.hidden = false;
  for (const p of points) {
    const tr = document.createElement('tr');
    const tdStarted = document.createElement('td');
    tdStarted.textContent = p.started_at ?? '-';
    const tdRun = document.createElement('td');
    tdRun.textContent = p.run_id;
    const tdDataset = document.createElement('td');
    tdDataset.textContent = p.dataset ?? '-';
    const tdValue = document.createElement('td');
    const v = p.value;
    tdValue.textContent = v === undefined ? '-' : String(v);
    const tdGates = document.createElement('td');
    tdGates.textContent = p.gates_pass === undefined ? '-' : p.gates_pass ? 'PASS' : 'FAIL';
    if (p.gates_pass === false) tdGates.className = 'err';
    tr.append(tdStarted, tdRun, tdDataset, tdValue, tdGates);
    body.appendChild(tr);
  }
  setStatus(`已加载 ${points.length} 条 · metric=${metric}`, 'ok');
}

async function refresh() {
  const dataset = document.getElementById('trendDatasetFilter').value;
  const metric = document.getElementById('trendMetric').value;
  setStatus('加载中…', '');
  try {
    const qs = new URLSearchParams();
    qs.set('metric', metric);
    if (dataset) qs.set('dataset', dataset);
    qs.set('limit', '50');
    const data = await api(`/api/runs/trend?${qs.toString()}`);
    renderTable(data.points, metric);
  } catch (e) {
    setStatus(String(e.message || e), 'err');
  }
}

async function loadDatasetOptions() {
  const data = await api('/api/test-sets');
  const sel = document.getElementById('trendDatasetFilter');
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = '（全部）';
  sel.appendChild(all);
  for (const ts of data.testSets || []) {
    const opt = document.createElement('option');
    opt.value = ts.id;
    opt.textContent = ts.label;
    sel.appendChild(opt);
  }
}

function wire() {
  document.getElementById('trendRefresh').addEventListener('click', () => void refresh());
  document.getElementById('trendMetric').addEventListener('change', () => void refresh());
  document.getElementById('trendDatasetFilter').addEventListener('change', () => void refresh());
}

export async function initTrends() {
  wire();
  try {
    await loadDatasetOptions();
  } catch {
    // 数据集加载失败不影响趋势页主体。
  }
  await refresh();
}

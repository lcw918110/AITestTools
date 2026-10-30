/** 指标趋势 UI（跨 run 指标时间线，对齐 docs/03 §4 持续评测闭环，支持用途筛选与分桶）。 */

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
    const tdPurpose = document.createElement('td');
    tdPurpose.textContent = p.purpose ?? '未标注';
    if (!p.purpose) tdPurpose.className = 'meta tiny';
    const tdValue = document.createElement('td');
    const v = p.value;
    tdValue.textContent = v === undefined ? '-' : String(v);
    const tdGates = document.createElement('td');
    tdGates.textContent = p.gates_pass === undefined ? '-' : p.gates_pass ? 'PASS' : 'FAIL';
    if (p.gates_pass === false) tdGates.className = 'err';
    tr.append(tdStarted, tdRun, tdDataset, tdPurpose, tdValue, tdGates);
    body.appendChild(tr);
  }
  setStatus(`已加载 ${points.length} 条 · metric=${metric}`, 'ok');
}

function renderBuckets(buckets, metric) {
  const table = document.getElementById('trendTable');
  const body = document.getElementById('trendBody');
  const empty = document.getElementById('trendEmpty');
  body.innerHTML = '';

  const entries = Object.entries(buckets || {});
  let totalCount = 0;
  for (const [, b] of entries) {
    totalCount += b.points?.length || 0;
  }

  if (totalCount === 0) {
    table.hidden = true;
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  table.hidden = false;

  for (const [key, b] of entries) {
    const headerTr = document.createElement('tr');
    headerTr.className = 'bucket-header';
    const tdHeader = document.createElement('td');
    tdHeader.colSpan = 6;
    tdHeader.style.background = '#f0f4f8';
    tdHeader.style.fontWeight = 'bold';
    tdHeader.style.padding = '8px 12px';
    const purposeName = b.purpose ?? '未标注（仅供诊断，不构成有效效果结论）';
    tdHeader.textContent = `[用途分桶: ${purposeName}] 共 ${b.points?.length || 0} 条`;
    headerTr.appendChild(tdHeader);
    body.appendChild(headerTr);

    for (const p of b.points || []) {
      const tr = document.createElement('tr');
      const tdStarted = document.createElement('td');
      tdStarted.textContent = p.started_at ?? '-';
      const tdRun = document.createElement('td');
      tdRun.textContent = p.run_id;
      const tdDataset = document.createElement('td');
      tdDataset.textContent = p.dataset ?? '-';
      const tdPurpose = document.createElement('td');
      tdPurpose.textContent = p.purpose ?? '未标注';
      if (!p.purpose) tdPurpose.className = 'meta tiny';
      const tdValue = document.createElement('td');
      const v = p.value;
      tdValue.textContent = v === undefined ? '-' : String(v);
      const tdGates = document.createElement('td');
      tdGates.textContent = p.gates_pass === undefined ? '-' : p.gates_pass ? 'PASS' : 'FAIL';
      if (p.gates_pass === false) tdGates.className = 'err';
      tr.append(tdStarted, tdRun, tdDataset, tdPurpose, tdValue, tdGates);
      body.appendChild(tr);
    }
  }

  setStatus(
    `已分桶加载 ${totalCount} 条（${entries.length} 个用途分桶，严禁跨用途混算）· metric=${metric}`,
    'ok',
  );
}

async function refresh() {
  const dataset = document.getElementById('trendDatasetFilter').value;
  const metric = document.getElementById('trendMetric').value;
  const purposeFilter = document.getElementById('trendPurposeFilter')?.value || '';
  setStatus('加载中…', '');
  try {
    const qs = new URLSearchParams();
    qs.set('metric', metric);
    if (dataset) qs.set('dataset', dataset);
    qs.set('limit', '50');

    if (purposeFilter === 'bucket') {
      qs.set('bucket', 'true');
    } else if (purposeFilter) {
      qs.set('purpose', purposeFilter);
    }

    const data = await api(`/api/runs/trend?${qs.toString()}`);

    if (data.bucketed && data.buckets) {
      renderBuckets(data.buckets, metric);
      return;
    }

    renderTable(data.points, metric);
    if (data.points?.length) {
      setStatus(
        `已加载 ${data.points.length} 条 · metric=${metric} · 用途：${data.purpose ?? data.notice}`,
        'ok',
      );
    }
  } catch (e) {
    renderTable([], metric);
    const msg = String(e.message || e);
    setStatus(msg, 'err');
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
  document.getElementById('trendPurposeFilter')?.addEventListener('change', () => void refresh());
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

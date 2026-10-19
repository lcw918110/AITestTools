/** 数据集管理 UI（对齐 docs/03 §3 数据集管理）。 */

import { api } from './bank.js';

let datasets = [];
let selectedId = '';

function setStatus(text, cls) {
  const el = document.getElementById('datasetsStatus');
  el.textContent = text;
  el.className = `status ${cls || ''}`;
}

async function refreshDatasets() {
  const data = await api('/api/test-sets');
  datasets = data.testSets || [];
  renderList();
}

function renderList() {
  const list = document.getElementById('datasetList');
  list.innerHTML = '';
  for (const ts of datasets) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${ts.label}\n${ts.taskIds.length} 题`;
    if (ts.id === selectedId) btn.classList.add('selected');
    btn.addEventListener('click', () => void loadDetail(ts.id));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function renderMatrix(matrix) {
  const host = document.getElementById('datasetMatrix');
  host.innerHTML = '';
  const types = Object.keys(matrix).sort();
  if (types.length === 0) {
    host.textContent = '（暂无分层数据）';
    return;
  }
  const diffs = new Set();
  for (const t of types) for (const d of Object.keys(matrix[t])) diffs.add(d);
  const diffList = [...diffs].sort();

  const table = document.createElement('table');
  table.className = 'dataset-matrix-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.textContent = '任务类型 \\ 难度';
  hr.appendChild(th0);
  for (const d of diffList) {
    const th = document.createElement('th');
    th.textContent = d;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const t of types) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.textContent = t;
    tr.appendChild(td0);
    for (const d of diffList) {
      const td = document.createElement('td');
      const n = matrix[t]?.[d] ?? 0;
      td.textContent = n > 0 ? String(n) : '·';
      if (n > 0) td.className = 'covered';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  host.appendChild(table);
}

function renderTasks(tasks) {
  const host = document.getElementById('datasetTasks');
  host.innerHTML = '';
  for (const t of tasks) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'dataset-task-row';
    const id = document.createElement('strong');
    id.textContent = t.taskId;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const bits = [];
    if (t.strata?.task_type) bits.push(`类型 ${t.strata.task_type}`);
    if (t.strata?.difficulty_level) bits.push(`难度 ${t.strata.difficulty_level}`);
    if (t.lifecycle) bits.push(t.lifecycle);
    if (t.tags?.length) bits.push((t.tags || []).join(', '));
    meta.textContent = bits.join(' · ') || '（未分层）';
    row.appendChild(id);
    row.appendChild(meta);
    li.appendChild(row);
    host.appendChild(li);
  }
}

async function loadDetail(id) {
  selectedId = id;
  renderList();
  const d = await api(`/api/test-sets/${encodeURIComponent(id)}`);
  document.getElementById('datasetEmpty').hidden = true;
  document.getElementById('datasetView').hidden = false;
  document.getElementById('datasetTitle').textContent = d.label;
  document.getElementById('datasetMeta').textContent =
    `短名 ${d.id} · 无插件 ${d.offRelease} · 有插件 ${d.onRelease}\n${d.description || ''}`;
  renderMatrix(d.coverage?.matrix ?? {});
  const counts = document.getElementById('datasetCounts');
  counts.textContent = `无插件侧（OFF）${d.coverage?.offCount ?? 0} 题 · 有插件侧（ON）${d.coverage?.onCount ?? 0} 题 · 共 ${d.tasks?.length ?? 0} 题`;
  const missing = d.coverage?.missing ?? [];
  const unreadable = d.coverage?.unreadable ?? [];
  const missingEl = document.getElementById('datasetMissing');
  const parts = [];
  if (missing.length) parts.push(`缺分层：${missing.join('、')}`);
  if (unreadable.length) parts.push(`读取失败：${unreadable.join('、')}`);
  if (parts.length) {
    missingEl.hidden = false;
    missingEl.textContent = `未覆盖 · ${parts.join('；')}`;
  } else {
    missingEl.hidden = true;
  }
  renderTasks(d.tasks ?? []);
  setStatus(`已加载 ${d.label}`, 'ok');
}

function wire() {
  document.getElementById('newTestSetTop').addEventListener('click', () => {
    document.getElementById('newTestSetError').hidden = true;
    document.getElementById('newTestSetName').value = '';
    document.getElementById('newTestSetDesc').value = '';
    document.getElementById('newTestSetDialog').showModal();
  });
  // 新建测试集对话框的提交逻辑在 bank.js；这里只监听创建完成事件刷新面板。
  document.addEventListener('test-sets-changed', async (ev) => {
    await refreshDatasets();
    const id = ev.detail?.id;
    if (id && datasets.some((t) => t.id === id)) await loadDetail(id);
  });
}

export async function initDatasets() {
  wire();
  await refreshDatasets();
  if (datasets.length) await loadDetail(datasets[0].id);
}

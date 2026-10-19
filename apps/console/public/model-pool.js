/** 模型配置页：全局模型配置池（models.json）的增删改查 + 筛选。 */
import { api } from './bank.js';

let entries = [];

function setStatus(text, cls) {
  const el = document.getElementById('modelPoolStatus');
  el.textContent = text;
  el.className = `status ${cls || ''}`;
}

function currentFilter() {
  const category = document.getElementById('modelPoolCategoryFilter').value;
  const tag = document.getElementById('modelPoolTagFilter').value.trim().toLowerCase();
  return { category, tag };
}

function matches(e) {
  const { category, tag } = currentFilter();
  if (category && e.category !== category) return false;
  if (tag && !(e.tags || []).some((t) => t.toLowerCase().includes(tag))) return false;
  return true;
}

function render() {
  const body = document.getElementById('modelPoolBody');
  body.innerHTML = '';
  const rows = entries.filter(matches);
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'bank-empty';
    td.textContent = '（无模型条目）';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  for (const e of rows) {
    const tr = document.createElement('tr');
    const cells = [
      e.model_id,
      e.provider_id,
      e.category || '—',
      (e.tags || []).join(', ') || '—',
      e.api_key_env || '—',
      e.status,
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    const td = document.createElement('td');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => openDialog(e));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost danger';
    del.textContent = '删除';
    del.addEventListener('click', () => void removeEntry(e.model_id));
    td.appendChild(edit);
    td.appendChild(del);
    tr.appendChild(td);
    body.appendChild(tr);
  }
}

async function load() {
  try {
    const data = await api('/api/model-pool');
    entries = data.entries || [];
    render();
  } catch (e) {
    setStatus(String(e.message || e), 'err');
  }
}

function openDialog(existing) {
  const dialog = document.getElementById('modelPoolDialog');
  document.getElementById('modelPoolDialogTitle').textContent = existing ? '编辑模型' : '新增模型';
  document.getElementById('mpModelId').value = existing?.model_id || '';
  document.getElementById('mpModelId').disabled = !!existing;
  document.getElementById('mpProviderId').value = existing?.provider_id || '';
  document.getElementById('mpCategory').value = existing?.category || '';
  document.getElementById('mpTags').value = (existing?.tags || []).join(', ');
  document.getElementById('mpApiKeyEnv').value = existing?.api_key_env || '';
  document.getElementById('mpParams').value = existing?.params
    ? JSON.stringify(existing.params, null, 2)
    : '';
  document.getElementById('mpStatus').value = existing?.status || 'active';
  document.getElementById('modelPoolError').hidden = true;
  dialog.showModal();
}

async function saveEntry() {
  const model_id = document.getElementById('mpModelId').value.trim();
  const provider_id = document.getElementById('mpProviderId').value.trim();
  const category = document.getElementById('mpCategory').value;
  const tags = document
    .getElementById('mpTags')
    .value.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const api_key_env = document.getElementById('mpApiKeyEnv').value.trim();
  const status = document.getElementById('mpStatus').value;
  let params;
  const paramsRaw = document.getElementById('mpParams').value.trim();
  if (paramsRaw) {
    try {
      params = JSON.parse(paramsRaw);
    } catch {
      document.getElementById('modelPoolError').hidden = false;
      document.getElementById('modelPoolError').textContent = 'params 不是合法 JSON';
      return;
    }
  }
  try {
    await api('/api/model-pool', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model_id,
        provider_id,
        ...(category ? { category } : {}),
        ...(tags.length ? { tags } : {}),
        ...(api_key_env ? { api_key_env } : {}),
        ...(params ? { params } : {}),
        status,
      }),
    });
    document.getElementById('modelPoolDialog').close();
    setStatus(`已保存 ${model_id}`, 'ok');
    await load();
  } catch (e) {
    document.getElementById('modelPoolError').hidden = false;
    document.getElementById('modelPoolError').textContent = String(e.message || e);
  }
}

async function removeEntry(modelId) {
  if (!window.confirm(`删除模型 ${modelId}？`)) return;
  try {
    await api(`/api/model-pool/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
    setStatus(`已删除 ${modelId}`, 'ok');
    await load();
  } catch (e) {
    setStatus(String(e.message || e), 'err');
  }
}

export function initModelPool() {
  document.getElementById('modelPoolNew').addEventListener('click', () => openDialog(null));
  document
    .getElementById('modelPoolCancel')
    .addEventListener('click', () => document.getElementById('modelPoolDialog').close());
  document.getElementById('modelPoolForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    void saveEntry();
  });
  document.getElementById('modelPoolCategoryFilter').addEventListener('change', render);
  document.getElementById('modelPoolTagFilter').addEventListener('input', render);
  void load();
}

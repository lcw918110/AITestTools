/** 运行环境页：模型 / Agent 配置与 Hello World 验证 */

import { api } from './bank.js';

export let envCatalog = { models: [], agents: [] };

function setEnvStatus(text, cls) {
  const el = document.getElementById('envStatus');
  el.textContent = text;
  el.className = `status ${cls || ''}`;
}

export function verifiedModels() {
  return envCatalog.models.filter((m) => m.verifiedAt);
}

export function verifiedAgents() {
  return envCatalog.agents.filter((a) => a.verifiedAt);
}

export async function loadEnvCatalog() {
  envCatalog = await api('/api/env/catalog');
  renderEnvLists();
  return envCatalog;
}

function renderKindList(hostId, rows, kind) {
  const host = document.getElementById(hostId);
  host.innerHTML = '';
  for (const row of rows) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const ok = row.verifiedAt ? '已验证' : '未验证';
    btn.textContent = `${row.id}\n${ok}`;
    if (!row.verifiedAt) btn.classList.add('warn');
    btn.addEventListener('click', () => void verifyRow(kind, row.id));
    li.appendChild(btn);
    host.appendChild(li);
  }
}

function renderEnvLists() {
  if (!document.getElementById('modelList')) return;
  renderKindList('modelList', envCatalog.models, 'model');
  renderKindList('agentList', envCatalog.agents, 'agent');
}

async function verifyRow(kind, id) {
  const log = document.getElementById('envLog');
  log.hidden = false;
  log.textContent = `正在用 Hello World 验证 ${id}…`;
  setEnvStatus('验证中…', '');
  try {
    const r = await api('/api/env/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, id }),
    });
    envCatalog = r.catalog || envCatalog;
    renderEnvLists();
    log.textContent = r.log || '';
    setEnvStatus(r.ok ? `${id} 验证通过` : `${id} 验证未通过`, r.ok ? 'ok' : 'err');
    document.dispatchEvent(new Event('env-catalog-changed'));
  } catch (e) {
    setEnvStatus(String(e.message || e), 'err');
    log.textContent = String(e.message || e);
  }
}

let environments = [];
const pendingEnvironmentChanges = new Map();
const environmentTimers = new Map();

function saveEnvironmentField(name, partial) {
  const pending = pendingEnvironmentChanges.get(name) || {};
  if (partial.recipe) {
    pending.recipe = { ...(pending.recipe || {}), ...partial.recipe };
  }
  if ('workspace' in partial) pending.workspace = partial.workspace;
  if ('network' in partial) pending.network = partial.network;
  if ('lifecycle' in partial) pending.lifecycle = partial.lifecycle;
  pendingEnvironmentChanges.set(name, pending);
  clearTimeout(environmentTimers.get(name));
  environmentTimers.set(
    name,
    setTimeout(async () => {
      const toSave = pendingEnvironmentChanges.get(name);
      pendingEnvironmentChanges.delete(name);
      if (!toSave) return;
      try {
        const updated = await api(`/api/env/environments/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(toSave),
        });
        const idx = environments.findIndex((r) => r.name === name);
        if (idx >= 0) environments[idx] = updated;
        setEnvStatus(`${name} 已保存`, 'ok');
      } catch (e) {
        setEnvStatus(`${name}: ${e.message || e}`, 'err');
      }
    }, 600),
  );
}

async function loadEnvironments() {
  try {
    const data = await api('/api/env/environments');
    environments = data.environments || [];
    renderEnvironments();
  } catch (e) {
    environments = [];
    renderEnvironments();
  }
}

function renderEnvironments() {
  const host = document.getElementById('environmentList');
  if (!host) return;
  if (!environments.length) {
    host.innerHTML = '<p class="bank-empty">（没有环境文件）</p>';
    return;
  }
  const vmodels = verifiedModels();
  const vagents = verifiedAgents();
  const modelOptions = document.getElementById('environmentModelOptions');
  if (modelOptions) {
    modelOptions.innerHTML = '';
    for (const m of vmodels) {
      const o = document.createElement('option');
      o.value = m.id;
      modelOptions.appendChild(o);
    }
  }
  const agentOptions = document.getElementById('environmentAgentOptions');
  if (agentOptions) {
    agentOptions.innerHTML = '';
    for (const a of vagents) {
      const o = document.createElement('option');
      o.value = a.id;
      agentOptions.appendChild(o);
    }
  }
  host.innerHTML = '';
  for (const environment of environments) {
    const card = document.createElement('div');
    card.className = 'environment-card';
    const title = document.createElement('h3');
    title.textContent = environment.name;
    card.appendChild(title);

    // recipe.host_model
    const modelLabel = document.createElement('label');
    modelLabel.textContent = '模型';
    const modelInput = document.createElement('input');
    modelInput.type = 'text';
    modelInput.setAttribute('list', 'environmentModelOptions');
    modelInput.value = environment.recipe?.host_model || '';
    modelInput.placeholder = '模型标识';
    modelInput.addEventListener('change', () =>
      saveEnvironmentField(environment.name, { recipe: { host_model: modelInput.value } }),
    );
    modelLabel.appendChild(modelInput);
    card.appendChild(modelLabel);

    // recipe.host_agent
    const agentLabel = document.createElement('label');
    agentLabel.textContent = 'Agent';
    const agentInput = document.createElement('input');
    agentInput.type = 'text';
    agentInput.setAttribute('list', 'environmentAgentOptions');
    agentInput.value = environment.recipe?.host_agent || '';
    agentInput.placeholder = 'Agent 标识';
    agentInput.addEventListener('change', () =>
      saveEnvironmentField(environment.name, { recipe: { host_agent: agentInput.value } }),
    );
    agentLabel.appendChild(agentInput);
    card.appendChild(agentLabel);

    // recipe.host_plugin
    const plugLabel = document.createElement('label');
    plugLabel.textContent = '插件';
    const plugInput = document.createElement('input');
    plugInput.type = 'text';
    plugInput.value = environment.recipe?.host_plugin || '';
    plugInput.placeholder = '插件路径';
    plugInput.addEventListener('change', () =>
      saveEnvironmentField(environment.name, { recipe: { host_plugin: plugInput.value } }),
    );
    plugLabel.appendChild(plugInput);
    card.appendChild(plugLabel);

    // recipe.managed_agents
    const maLabel = document.createElement('label');
    maLabel.textContent = '托管 Agent';
    const maInput = document.createElement('input');
    maInput.type = 'text';
    maInput.value = Array.isArray(environment.recipe?.managed_agents)
      ? environment.recipe.managed_agents.join(', ')
      : '';
    maInput.placeholder = '逗号分隔';
    maInput.addEventListener('change', () => {
      const val = maInput.value.trim();
      const agents = val
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      saveEnvironmentField(environment.name, { recipe: { managed_agents: agents } });
    });
    maLabel.appendChild(maInput);
    card.appendChild(maLabel);

    // workspace
    const wsLabel = document.createElement('label');
    wsLabel.textContent = '工作区';
    const wsSel = document.createElement('select');
    wsSel.innerHTML = '<option value="">—</option>';
    for (const v of ['isolated', 'project']) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      if (environment.workspace === v) o.selected = true;
      wsSel.appendChild(o);
    }
    wsSel.addEventListener('change', () =>
      saveEnvironmentField(environment.name, { workspace: wsSel.value }),
    );
    wsLabel.appendChild(wsSel);
    card.appendChild(wsLabel);

    // network
    const netLabel = document.createElement('label');
    netLabel.className = 'check';
    const netCheck = document.createElement('input');
    netCheck.type = 'checkbox';
    netCheck.checked = environment.network === true || environment.network === 'true';
    netCheck.addEventListener('change', () =>
      saveEnvironmentField(environment.name, { network: netCheck.checked }),
    );
    netLabel.appendChild(netCheck);
    netLabel.appendChild(document.createTextNode(' 网络'));
    card.appendChild(netLabel);

    // lifecycle 展示 + 流转
    const lcLabel = document.createElement('label');
    lcLabel.textContent = '生命周期';
    const lcBadge = document.createElement('span');
    lcBadge.className = `lifecycle-badge lifecycle-${environment.lifecycle || 'draft'}`;
    lcBadge.textContent = environment.lifecycle || 'draft';
    lcLabel.appendChild(lcBadge);
    card.appendChild(lcLabel);

    const lcRow = document.createElement('div');
    lcRow.className = 'lifecycle-actions';
    const lcTargets = ['draft', 'active', 'deprecated'].filter(
      (t) => t !== (environment.lifecycle || 'draft'),
    );
    for (const target of lcTargets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `→ ${target}`;
      btn.addEventListener('click', () => {
        saveEnvironmentField(environment.name, { lifecycle: target });
      });
      lcRow.appendChild(btn);
    }
    card.appendChild(lcRow);

    host.appendChild(card);
  }
}

async function loadReproManifest() {
  const host = document.getElementById('reproManifest');
  if (!host) return;
  try {
    const m = await api('/api/env/manifest');
    const rows = [
      ['Git commit', m.gitCommit ?? '未采集'],
      ['工作树', m.worktreeDirty ? '脏（有未提交改动）' : '干净'],
      ['Node 版本', m.nodeVersion ?? '未采集'],
      ['OS 架构', m.osPlatform && m.osArch ? `${m.osPlatform}/${m.osArch}` : '未采集'],
      ['锁文件摘要', m.lockfileSummary ?? '未采集'],
    ];
    host.innerHTML = '';
    for (const [k, v] of rows) {
      const li = document.createElement('li');
      const key = document.createElement('span');
      key.className = 'manifest-key';
      key.textContent = k;
      const val = document.createElement('span');
      val.className = 'manifest-val';
      val.textContent = v;
      if (v === '未采集') val.classList.add('muted');
      li.appendChild(key);
      li.appendChild(val);
      host.appendChild(li);
    }
  } catch (e) {
    host.innerHTML = `<li class="muted">复现清单采集失败：${String(e.message || e)}</li>`;
  }
}

export async function initEnv() {
  document.getElementById('addModel').addEventListener('click', async () => {
    const id = document.getElementById('newModelId').value.trim();
    try {
      envCatalog = await api('/api/env/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      document.getElementById('newModelId').value = '';
      renderEnvLists();
      setEnvStatus(`已添加模型 ${id}，请点该项做 Hello World 验证`, 'ok');
      document.dispatchEvent(new Event('env-catalog-changed'));
    } catch (e) {
      setEnvStatus(String(e.message || e), 'err');
    }
  });
  document.getElementById('addAgent').addEventListener('click', async () => {
    const id = document.getElementById('newAgentId').value.trim();
    try {
      envCatalog = await api('/api/env/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      document.getElementById('newAgentId').value = '';
      renderEnvLists();
      setEnvStatus(`已添加 Agent ${id}，请点该项做 Hello World 验证`, 'ok');
      document.dispatchEvent(new Event('env-catalog-changed'));
    } catch (e) {
      setEnvStatus(String(e.message || e), 'err');
    }
  });
  await loadEnvCatalog();
  await loadEnvironments();
  await loadReproManifest();
}

document.addEventListener('env-catalog-changed', () => renderEnvironments());

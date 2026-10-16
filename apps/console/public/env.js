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

let rooms = [];
const pendingRoomChanges = new Map();
const roomTimers = new Map();

function saveRoomField(name, partial) {
  const pending = pendingRoomChanges.get(name) || {};
  if (partial.host) {
    pending.host = { ...(pending.host || {}), ...partial.host };
  }
  if ('workspace' in partial) pending.workspace = partial.workspace;
  if ('network' in partial) pending.network = partial.network;
  pendingRoomChanges.set(name, pending);
  clearTimeout(roomTimers.get(name));
  roomTimers.set(
    name,
    setTimeout(async () => {
      const toSave = pendingRoomChanges.get(name);
      pendingRoomChanges.delete(name);
      if (!toSave) return;
      try {
        const updated = await api(`/api/env/rooms/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(toSave),
        });
        const idx = rooms.findIndex((r) => r.name === name);
        if (idx >= 0) rooms[idx] = updated;
        setEnvStatus(`${name} 已保存`, 'ok');
      } catch (e) {
        setEnvStatus(`${name}: ${e.message || e}`, 'err');
      }
    }, 600),
  );
}

async function loadRooms() {
  try {
    const data = await api('/api/env/rooms');
    rooms = data.rooms || [];
    renderRooms();
  } catch (e) {
    rooms = [];
    renderRooms();
  }
}

function renderRooms() {
  const host = document.getElementById('roomList');
  if (!host) return;
  if (!rooms.length) {
    host.innerHTML = '<p class="bank-empty">（没有房间文件）</p>';
    return;
  }
  const vmodels = verifiedModels();
  const vagents = verifiedAgents();
  const modelOptions = document.getElementById('roomModelOptions');
  if (modelOptions) {
    modelOptions.innerHTML = '';
    for (const m of vmodels) {
      const o = document.createElement('option');
      o.value = m.id;
      modelOptions.appendChild(o);
    }
  }
  const agentOptions = document.getElementById('roomAgentOptions');
  if (agentOptions) {
    agentOptions.innerHTML = '';
    for (const a of vagents) {
      const o = document.createElement('option');
      o.value = a.id;
      agentOptions.appendChild(o);
    }
  }
  host.innerHTML = '';
  for (const room of rooms) {
    const card = document.createElement('div');
    card.className = 'room-card';
    const title = document.createElement('h3');
    title.textContent = room.name;
    card.appendChild(title);

    // host.model
    const modelLabel = document.createElement('label');
    modelLabel.textContent = '模型';
    const modelInput = document.createElement('input');
    modelInput.type = 'text';
    modelInput.setAttribute('list', 'roomModelOptions');
    modelInput.value = room.host?.model || '';
    modelInput.placeholder = '模型标识';
    modelInput.addEventListener('change', () =>
      saveRoomField(room.name, { host: { model: modelInput.value } }),
    );
    modelLabel.appendChild(modelInput);
    card.appendChild(modelLabel);

    // host.agent
    const agentLabel = document.createElement('label');
    agentLabel.textContent = 'Agent';
    const agentInput = document.createElement('input');
    agentInput.type = 'text';
    agentInput.setAttribute('list', 'roomAgentOptions');
    agentInput.value = room.host?.agent || '';
    agentInput.placeholder = 'Agent 标识';
    agentInput.addEventListener('change', () =>
      saveRoomField(room.name, { host: { agent: agentInput.value } }),
    );
    agentLabel.appendChild(agentInput);
    card.appendChild(agentLabel);

    // host.plugin
    const plugLabel = document.createElement('label');
    plugLabel.textContent = '插件';
    const plugInput = document.createElement('input');
    plugInput.type = 'text';
    plugInput.value = room.host?.plugin || '';
    plugInput.placeholder = '插件路径';
    plugInput.addEventListener('change', () =>
      saveRoomField(room.name, { host: { plugin: plugInput.value } }),
    );
    plugLabel.appendChild(plugInput);
    card.appendChild(plugLabel);

    // host.managed_agents
    const maLabel = document.createElement('label');
    maLabel.textContent = '托管 Agent';
    const maInput = document.createElement('input');
    maInput.type = 'text';
    maInput.value = Array.isArray(room.host?.managed_agents)
      ? room.host.managed_agents.join(', ')
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
      saveRoomField(room.name, { host: { managed_agents: agents } });
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
      if (room.workspace === v) o.selected = true;
      wsSel.appendChild(o);
    }
    wsSel.addEventListener('change', () => saveRoomField(room.name, { workspace: wsSel.value }));
    wsLabel.appendChild(wsSel);
    card.appendChild(wsLabel);

    // network
    const netLabel = document.createElement('label');
    netLabel.className = 'check';
    const netCheck = document.createElement('input');
    netCheck.type = 'checkbox';
    netCheck.checked = room.network === true || room.network === 'true';
    netCheck.addEventListener('change', () =>
      saveRoomField(room.name, { network: netCheck.checked }),
    );
    netLabel.appendChild(netCheck);
    netLabel.appendChild(document.createTextNode(' 网络'));
    card.appendChild(netLabel);

    host.appendChild(card);
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
  await loadRooms();
}

document.addEventListener('env-catalog-changed', () => renderRooms());

/** 题库工作台 UI（对齐设计 09） */

const LABELS = {
  prompt: '题干',
  passToken: '怎样算对（终态词）',
  changeName: '变更说明',
  save: '保存并升版本',
  create: '录一道题',
  validate: '检查题库',
};

const CREATE_TASK_ID_RE = /^PAIRED-TASK-[0-9]{2,}$/;
const PASS_TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const TEXT_ONLY_PROMPT_RE =
  /text[\s-]*only|do not use tools|do not explore the repo|不要使用工具|不要探索(?:仓库|代码库)/i;

export async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

let selectedTask = '';
let wizardStep = 1;
let nextTaskId = 'PAIRED-TASK-02';
let knownTokens = new Map();
let testSets = [];
let bankFilterId = '';
/** 失败 run 回归沉淀的草稿元数据（证据链），录题时写入 notes/lifecycle。 */
let wizardDraft = {};

function setBankStatus(text, cls) {
  const el = document.getElementById('bankStatus');
  el.textContent = text;
  el.className = `status ${cls || ''}`;
}

function fillTaskTypeList(tasks) {
  const dl = document.getElementById('taskTypeList');
  const seen = new Set();
  const tags = [];
  for (const t of tasks) {
    for (const tag of t.tags || []) {
      if (!seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    }
  }
  tags.sort((a, b) => a.localeCompare(b));
  dl.innerHTML = '';
  for (const tag of tags) {
    const opt = document.createElement('option');
    opt.value = tag;
    dl.appendChild(opt);
  }
}

function showEditEmpty() {
  document.getElementById('editEmpty').hidden = false;
  document.getElementById('editForm').hidden = true;
  selectedTask = '';
}

export async function refreshTestSets() {
  const data = await api('/api/test-sets');
  testSets = data.testSets || [];
  fillTestSetSelect(document.getElementById('bankTestSetFilter'), true);
  fillTestSetSelect(document.getElementById('wizTestSet'), false);
}

function fillTestSetSelect(host, withAll) {
  if (!host) return;
  const cur = host.value;
  host.innerHTML = '';
  if (withAll) {
    const all = document.createElement('option');
    all.value = '';
    all.textContent = '全部';
    host.appendChild(all);
  }
  for (const ts of testSets) {
    const opt = document.createElement('option');
    opt.value = ts.id;
    opt.textContent = ts.label;
    host.appendChild(opt);
  }
  if ([...host.options].some((o) => o.value === cur)) host.value = cur;
}

async function refreshTasks() {
  const data = await api('/api/bank/tasks');
  const { tasks } = data;
  if (data.nextTaskId) nextTaskId = data.nextTaskId;
  knownTokens = new Map(tasks.map((t) => [t.passToken, t.taskId]));
  fillTaskTypeList(tasks);
  const filter = document.getElementById('bankTestSetFilter')?.value || bankFilterId;
  bankFilterId = filter;
  const list = document.getElementById('taskList');
  list.innerHTML = '';
  const shown = filter ? tasks.filter((t) => (t.testSetIds || []).includes(filter)) : tasks;
  for (const t of shown) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const token = t.labelPassToken || t.passToken;
    const ver = t.versionLabel || '';
    const complete = t.completeLabel || (t.complete ? '完整' : '不完整');
    const tags = (t.tags || []).join(', ') || '（无任务类型）';
    btn.textContent = `${t.taskId} · ${token} · ${tags} · ${complete}${ver ? `\n${ver}` : ''}`;
    if (!t.complete) btn.classList.add('warn');
    if (t.taskId === selectedTask) btn.classList.add('selected');
    btn.addEventListener('click', () => void loadTask(t.taskId));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function loadTask(taskId) {
  selectedTask = taskId;
  const d = await api(`/api/bank/tasks/${encodeURIComponent(taskId)}`);
  document.getElementById('editEmpty').hidden = true;
  document.getElementById('editForm').hidden = false;
  document.getElementById('taskTitle').textContent = d.taskId;
  document.getElementById('taskVersion').textContent = d.versionLabel || '';
  document.getElementById('taskPrompt').value = d.prompt || '';
  document.getElementById('taskToken').value = d.passToken || d.hosted_pass_token || '';
  document.getElementById('taskTags').value = (d.tags || []).join(', ');
  document.getElementById('taskNotes').value = d.notes || '';
  document.getElementById('taskContains').value = d.contains || '';
  document.getElementById('taskNotContains').value = d.notContains || '';
  document.getElementById('changeName').value = '';
  // 分层
  document.getElementById('taskStrataType').value = d.strata?.task_type || '';
  document.getElementById('taskStrataDifficulty').value = d.strata?.difficulty_level || '';
  // 准备度
  document.getElementById('taskReadiness').value = d.automationReadiness || 'not_assessed';
  // 生命周期
  document.getElementById('taskLifecycle').textContent = d.lifecycle || 'draft';
  renderLifecycleHistory(d.lifecycleHistory || []);
  // rubric 维度
  renderRubricDims('rubricDims', d.rubric?.dimensions || []);
  const offId = d.offId || d.off?.id || '—';
  const onId = d.onId || d.on?.id || '—';
  document.getElementById('taskIdsReadonly').textContent =
    `无插件条目 ${offId} · 有插件条目 ${onId}`;
  setBankStatus(d.complete ? '已加载' : '不完整', d.complete ? '' : 'err');
  await refreshTasks();
}

function openWizard() {
  void (async () => {
    await refreshTestSets();
    await refreshTasks();
    openWizardWithDraft({ taskId: nextTaskId });
  })();
}

/** 由回归沉淀草稿构造 notes（证据链）。 */
function buildRegressionNotes(draft) {
  const parts = [];
  if (draft.sourceRun) parts.push(`来源 run：${draft.sourceRun}`);
  if (draft.attribution) parts.push(`归因：${draft.attribution}`);
  if (draft.message) parts.push(`失败信息：${draft.message}`);
  const oracles = draft.oracleFailures || [];
  if (oracles.length) {
    parts.push(`oracle 失败：${oracles.map((o) => o.oracle_id || o.message || '?').join('、')}`);
  }
  return parts.length ? `回归沉淀 · ${parts.join(' · ')}` : '';
}

/** 从失败 run 预填录题向导（最小回流）。draft 可带回归沉淀证据（sourceRun/attribution/message/oracleFailures）。 */
export function openWizardWithDraft(draft = {}) {
  wizardStep = 1;
  wizardDraft = draft;
  document.getElementById('wizTaskId').value = draft.taskId || nextTaskId || '';
  document.getElementById('wizPrompt').value = draft.prompt || '';
  document.getElementById('wizToken').value = draft.passToken || '';
  document.getElementById('wizContains').value = draft.contains || '';
  document.getElementById('wizNotContains').value = draft.notContains || '';
  document.getElementById('wizTags').value = draft.tags || '';
  document.getElementById('wizardError').hidden = true;
  renderWizardStep();
  document.getElementById('createWizard').showModal();
}

function renderWizardStep() {
  const labels = ['题号', '题干', '怎样算对', '确认'];
  document.getElementById('wizardStepLabel').textContent =
    `第 ${wizardStep} / 4 步 · ${labels[wizardStep - 1]}`;
  for (const el of document.querySelectorAll('.wizard-step')) {
    el.hidden = Number(el.dataset.step) !== wizardStep;
  }
  document.getElementById('wizBack').hidden = wizardStep === 1;
  document.getElementById('wizNext').hidden = wizardStep === 4;
  document.getElementById('wizSubmit').hidden = wizardStep !== 4;
  if (wizardStep === 4) {
    const id = document.getElementById('wizTaskId').value.trim();
    const token = document.getElementById('wizToken').value.trim();
    const must = document.getElementById('wizContains').value.trim() || token;
    const forbid = document.getElementById('wizNotContains').value.trim();
    const tags = document.getElementById('wizTags').value.trim();
    const tsId = document.getElementById('wizTestSet').value;
    const ts = testSets.find((x) => x.id === tsId);
    const lines = [
      `将创建：`,
      `- bank/materials/${id}/prompt.txt`,
      `- …/EVAL-B-${id}-OFF.item.json`,
      `- …/EVAL-B-${id}-ON.item.json`,
      `将挂入测试集：${ts ? ts.label : '（未选）'}`,
      `（不自动进 156 全量，除非所选即全量）`,
      `任务类型：${tags || '（未填）'}`,
      `判定：退出码 0 + 回复必须出现「${must}」${forbid ? `；禁止出现「${forbid}」` : ''}`,
    ];
    if (wizardDraft.sourceRun) {
      lines.push(
        `回归沉淀：来源 ${wizardDraft.sourceRun}${wizardDraft.attribution ? ` · 归因 ${wizardDraft.attribution}` : ''}`,
      );
      lines.push(`生命周期：candidate（候选回归题）`);
    }
    document.getElementById('wizPreview').textContent = lines.join('\n');
  }
}

function wizardGate() {
  const errEl = document.getElementById('wizardError');
  errEl.hidden = true;
  if (wizardStep === 1) {
    const id = document.getElementById('wizTaskId').value.trim();
    if (!CREATE_TASK_ID_RE.test(id)) {
      errEl.textContent = '题号须为 PAIRED-TASK-NN（至少两位数字）';
      errEl.hidden = false;
      return false;
    }
    if (!document.getElementById('wizTestSet').value) {
      errEl.textContent = '请选择测试集';
      errEl.hidden = false;
      return false;
    }
  }
  if (wizardStep === 2) {
    const prompt = document.getElementById('wizPrompt').value;
    if (!prompt.trim()) {
      errEl.textContent = '请填写题干';
      errEl.hidden = false;
      return false;
    }
    if (TEXT_ONLY_PROMPT_RE.test(prompt)) {
      errEl.textContent = '题干禁止 Text-only / 禁工具 / 禁探索仓库';
      errEl.hidden = false;
      return false;
    }
  }
  if (wizardStep === 3) {
    const token = document.getElementById('wizToken').value.trim();
    const prompt = document.getElementById('wizPrompt').value;
    if (!PASS_TOKEN_RE.test(token) || /\s/.test(token)) {
      errEl.textContent = '终态词格式非法';
      errEl.hidden = false;
      return false;
    }
    if (!prompt.includes(token)) {
      errEl.textContent = '请把终态词写进题干';
      errEl.hidden = false;
      return false;
    }
    const owner = knownTokens.get(token);
    if (owner) {
      errEl.textContent = `终态词已被 ${owner} 占用，请换一个`;
      errEl.hidden = false;
      return false;
    }
  }
  return true;
}

function renderLifecycleHistory(history) {
  const el = document.getElementById('lifecycleHistory');
  if (!history || history.length === 0) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = history
    .map((h) => `${h.from} → ${h.to}（${h.reason}）${h.at ? ` @ ${h.at}` : ''}`)
    .join('\n');
}

/** 渲染 rubric 维度行（name / scale / weight + 删除按钮）。 */
function renderRubricDims(containerId, dims) {
  const host = document.getElementById(containerId);
  host.innerHTML = '';
  for (const d of dims) {
    addRubricDimRow(containerId, d);
  }
}

/** 添加一个 rubric 维度行；d 为空对象时是空行。 */
function addRubricDimRow(containerId, d = {}) {
  const host = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'rubric-dim';
  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'rubric-dim-name';
  name.placeholder = '维度名';
  name.value = d.name || '';
  const scale = document.createElement('input');
  scale.type = 'text';
  scale.className = 'rubric-dim-scale';
  scale.placeholder = '标尺';
  scale.value = d.scale || '';
  const weight = document.createElement('input');
  weight.type = 'number';
  weight.className = 'rubric-dim-weight';
  weight.placeholder = '权重';
  weight.min = '0';
  weight.step = '0.1';
  weight.value = d.weight ?? '';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'ghost danger';
  del.textContent = '×';
  del.addEventListener('click', () => row.remove());
  row.append(name, scale, weight, del);
  host.appendChild(row);
}

/** 收集 rubric 维度；半填返回 null（调用方须报错），无维度返回 undefined。 */
function collectRubricDims(containerId) {
  const host = document.getElementById(containerId);
  const dims = [];
  for (const row of host.querySelectorAll('.rubric-dim')) {
    const name = row.querySelector('.rubric-dim-name').value.trim();
    const scale = row.querySelector('.rubric-dim-scale').value.trim();
    const weightRaw = row.querySelector('.rubric-dim-weight').value.trim();
    if (!name && !scale && !weightRaw) continue;
    if (!name || !scale || !weightRaw) return null; // 半填视为非法
    const weight = Number(weightRaw);
    if (!Number.isFinite(weight)) return null;
    dims.push({ name, scale, weight });
  }
  return dims.length > 0 ? { dimensions: dims } : undefined;
}

function wireBank() {
  document.getElementById('openCreateWizard').addEventListener('click', openWizard);
  document.getElementById('bankTestSetFilter').addEventListener('change', () => {
    bankFilterId = document.getElementById('bankTestSetFilter').value;
    void refreshTasks();
  });
  document.getElementById('wizNewTestSet').addEventListener('click', () => {
    document.getElementById('newTestSetError').hidden = true;
    document.getElementById('newTestSetName').value = '';
    document.getElementById('newTestSetDesc').value = '';
    document.getElementById('newTestSetDialog').showModal();
  });
  document.getElementById('newTestSetCancel').addEventListener('click', () => {
    document.getElementById('newTestSetDialog').close();
  });
  document.getElementById('newTestSetForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('newTestSetError');
    err.hidden = true;
    try {
      const created = await api('/api/test-sets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('newTestSetName').value.trim(),
          description: document.getElementById('newTestSetDesc').value.trim(),
        }),
      });
      await refreshTestSets();
      document.getElementById('wizTestSet').value = created.id;
      document.getElementById('newTestSetDialog').close();
      document.dispatchEvent(
        new CustomEvent('test-sets-changed', { detail: { id: created.id } }),
      );
    } catch (e) {
      err.textContent = String(e.message || e);
      err.hidden = false;
    }
  });
  document.getElementById('wizCancel').addEventListener('click', () => {
    document.getElementById('createWizard').close();
  });
  document.getElementById('wizBack').addEventListener('click', () => {
    if (wizardStep > 1) {
      wizardStep -= 1;
      renderWizardStep();
    }
  });
  document.getElementById('wizNext').addEventListener('click', () => {
    if (!wizardGate()) return;
    if (wizardStep < 4) {
      wizardStep += 1;
      renderWizardStep();
    }
  });
  document.getElementById('wizSubmit').addEventListener('click', async () => {
    if (!wizardGate()) return;
    const errEl = document.getElementById('wizardError');
    try {
      const contains = document.getElementById('wizContains').value.trim();
      const notContains = document.getElementById('wizNotContains').value.trim();
      const tags = document.getElementById('wizTags').value.trim();
      const strataType = document.getElementById('wizStrataType').value.trim();
      const strataDifficulty = document.getElementById('wizStrataDifficulty').value;
      const rubric = collectRubricDims('wizRubricDims');
      if (rubric === null) {
        errEl.textContent = 'Rubric 维度须三项都填（维度名 + 标尺 + 权重）';
        errEl.hidden = false;
        return;
      }
      if ((strataType && !strataDifficulty) || (!strataType && strataDifficulty)) {
        errEl.textContent = '分层须同时填任务类型与难度';
        errEl.hidden = false;
        return;
      }
      const body = {
        taskId: document.getElementById('wizTaskId').value.trim(),
        prompt: document.getElementById('wizPrompt').value,
        passToken: document.getElementById('wizToken').value.trim(),
        ...(contains ? { contains } : {}),
        ...(notContains ? { notContains } : {}),
        ...(tags ? { tags } : {}),
        testSetId: document.getElementById('wizTestSet').value,
        ...(rubric ? { rubric } : {}),
        ...(strataType && strataDifficulty
          ? { strata: { task_type: strataType, difficulty_level: strataDifficulty } }
          : {}),
        // 回归沉淀：写证据链 notes + candidate 生命周期。
        ...(wizardDraft.sourceRun
          ? {
              lifecycle: 'candidate',
              notes: buildRegressionNotes(wizardDraft),
            }
          : {}),
      };
      const d = await api('/api/bank/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      document.getElementById('createWizard').close();
      setBankStatus(`已录入 ${d.taskId}`, 'ok');
      await refreshTasks();
      await loadTask(d.taskId);
    } catch (e) {
      errEl.textContent = String(e.message || e);
      errEl.hidden = false;
    }
  });

  document.getElementById('saveTask').addEventListener('click', async () => {
    if (!selectedTask) {
      setBankStatus('请先选择题目', 'err');
      return;
    }
    try {
      const strataType = document.getElementById('taskStrataType').value.trim();
      const strataDifficulty = document.getElementById('taskStrataDifficulty').value;
      const rubric = collectRubricDims('rubricDims');
      if (rubric === null) {
        setBankStatus('Rubric 维度须三项都填（维度名 + 标尺 + 权重）', 'err');
        return;
      }
      if ((strataType && !strataDifficulty) || (!strataType && strataDifficulty)) {
        setBankStatus('分层须同时填任务类型与难度', 'err');
        return;
      }
      const body = {
        prompt: document.getElementById('taskPrompt').value,
        passToken: document.getElementById('taskToken').value.trim(),
        contains: document.getElementById('taskContains').value.trim(),
        notContains: document.getElementById('taskNotContains').value.trim(),
        tags: document.getElementById('taskTags').value.trim(),
        notes: document.getElementById('taskNotes').value,
        changeName: document.getElementById('changeName').value.trim(),
        automationReadiness: document.getElementById('taskReadiness').value,
        ...(rubric ? { rubric } : {}),
        ...(strataType && strataDifficulty
          ? { strata: { task_type: strataType, difficulty_level: strataDifficulty } }
          : {}),
      };
      await api(`/api/bank/tasks/${encodeURIComponent(selectedTask)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setBankStatus('已保存并升版本', 'ok');
      await loadTask(selectedTask);
    } catch (e) {
      setBankStatus(String(e.message || e), 'err');
    }
  });

  document.getElementById('deleteTask').addEventListener('click', () => {
    if (!selectedTask) {
      setBankStatus('请先选择题目', 'err');
      return;
    }
    document.getElementById('deleteExpected').textContent = selectedTask;
    document.getElementById('deleteConfirmId').value = '';
    document.getElementById('deleteError').hidden = true;
    document.getElementById('deleteDialog').showModal();
  });

  document.getElementById('deleteCancel').addEventListener('click', () => {
    document.getElementById('deleteDialog').close();
  });

  document.getElementById('deleteConfirmBtn').addEventListener('click', async () => {
    const confirmId = document.getElementById('deleteConfirmId').value.trim();
    const errEl = document.getElementById('deleteError');
    if (confirmId !== selectedTask) {
      errEl.textContent = '请原样输入题号';
      errEl.hidden = false;
      return;
    }
    try {
      await api(`/api/bank/tasks/${encodeURIComponent(selectedTask)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmId }),
      });
      document.getElementById('deleteDialog').close();
      setBankStatus(`已删除 ${selectedTask}`, 'ok');
      showEditEmpty();
      await refreshTasks();
      const r = await api('/api/bank/validate', { method: 'POST' });
      const sum = document.getElementById('bankSummary');
      sum.hidden = false;
      sum.textContent = r.summary || (r.ok ? '检查通过' : '检查失败');
      sum.className = `bank-summary ${r.ok ? 'ok' : 'err'}`;
      if (!r.ok) setBankStatus(`删除后校验失败：${r.summary || r.exitCode}`, 'err');
    } catch (e) {
      errEl.textContent = String(e.message || e);
      errEl.hidden = false;
    }
  });

  document.getElementById('validateBank').addEventListener('click', async () => {
    const log = document.getElementById('bankLog');
    const sum = document.getElementById('bankSummary');
    log.hidden = false;
    log.textContent = '检查中…';
    sum.hidden = false;
    sum.textContent = '…';
    try {
      const r = await api('/api/bank/validate', { method: 'POST' });
      sum.textContent = r.summary || (r.ok ? '检查通过' : '检查失败');
      sum.className = `bank-summary ${r.ok ? 'ok' : 'err'}`;
      log.textContent = r.log || '';
      setBankStatus(
        r.ok ? LABELS.validate + '通过' : `检查失败 exit=${r.exitCode}`,
        r.ok ? 'ok' : 'err',
      );
    } catch (e) {
      setBankStatus(String(e.message || e), 'err');
    }
  });

  document.getElementById('addRubricDim').addEventListener('click', () => {
    addRubricDimRow('rubricDims');
  });
  document.getElementById('addWizRubricDim').addEventListener('click', () => {
    addRubricDimRow('wizRubricDims');
  });

  document.getElementById('transitionLifecycle').addEventListener('click', async () => {
    if (!selectedTask) {
      setBankStatus('请先选择题目', 'err');
      return;
    }
    const to = document.getElementById('lifecycleTarget').value;
    const reason = document.getElementById('lifecycleReason').value.trim();
    try {
      await api(`/api/bank/tasks/${encodeURIComponent(selectedTask)}/lifecycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, reason }),
      });
      document.getElementById('lifecycleReason').value = '';
      setBankStatus(`已流转到 ${to}`, 'ok');
      await loadTask(selectedTask);
    } catch (e) {
      setBankStatus(String(e.message || e), 'err');
    }
  });
}

export async function initBank(_testSets) {
  wireBank();
  showEditEmpty();
  await refreshTestSets();
  await refreshTasks();
}

import { api, initBank, openWizardWithDraft } from './bank.js';
import { initEnv, verifiedAgents, verifiedModels } from './env.js';
import { initModelPool } from './model-pool.js';
import { initDatasets } from './datasets.js';

const runBtn = document.getElementById('runBtn');
const jobStatus = document.getElementById('jobStatus');
const logEl = document.getElementById('log');
const testSetFilter = document.getElementById('testSetFilter');
const taskPick = document.getElementById('taskPick');
const pickCount = document.getElementById('pickCount');
const runMeta = document.getElementById('runMeta');
const runView = document.getElementById('runView');
const runMetrics = document.getElementById('runMetrics');
const effectMd = document.getElementById('effectMd');
const resultsNd = document.getElementById('resultsNd');
const attrSummary = document.getElementById('attrSummary');
const effectSummary = document.getElementById('effectSummary');
const infoMetrics = document.getElementById('infoMetrics');
const refScores = document.getElementById('refScores');
const judgeModelBtn = document.getElementById('judgeModelBtn');
const judgeHumanBtn = document.getElementById('judgeHumanBtn');
const judgeStatus = document.getElementById('judgeStatus');
const judgeScores = document.getElementById('judgeScores');
const judgeAgreementEl = document.getElementById('judgeAgreement');
const judgeDialog = document.getElementById('judgeDialog');
const judgeDialogTitle = document.getElementById('judgeDialogTitle');
const judgeItemId = document.getElementById('judgeItemId');
const judgeTaskPrompt = document.getElementById('judgeTaskPrompt');
const judgeFinalOutput = document.getElementById('judgeFinalOutput');
const judgeHumanHint = document.getElementById('judgeHumanHint');
const judgeVerdictsBox = document.getElementById('judgeVerdictsBox');
const judgeReviewerLabel = document.getElementById('judgeReviewerLabel');
const judgeReviewer = document.getElementById('judgeReviewer');
const judgeError = document.getElementById('judgeError');
const judgeForm = document.getElementById('judgeForm');
const judgeCancel = document.getElementById('judgeCancel');
const failDrafts = document.getElementById('failDrafts');
const tokenSummary = document.getElementById('tokenSummary');
const dashConfig = document.getElementById('dashConfig');
const dashHeadline = document.getElementById('dashHeadline');
const dashUsable = document.getElementById('dashUsable');
const dashMatrix = document.getElementById('dashMatrix');
const compareBaseline = document.getElementById('compareBaseline');
const compareStatus = document.getElementById('compareStatus');
const evalTaskList = document.getElementById('evalTaskList');
const evalForm = document.getElementById('evalForm');
const evalEmpty = document.getElementById('evalEmpty');
const evalKindLabel = document.getElementById('evalKindLabel');
const examModeBox = document.getElementById('examMode');
const sutRootField = document.getElementById('sutRootField');
const runHistory = document.getElementById('runHistory');
const resultEmpty = document.getElementById('resultEmpty');

const KIND_LABEL = { model: '测模型', plugin: '测万象术', agent: '测 Agent' };

let selected = 'plugin';
let pollTimer;
let currentRunPath = '';
let currentEvalId = '';
let filling = false;
let saveTimer;
let presets = [];
let testSets = [];
let bankTasks = [];
let evalTasks = [];
let evalTaskErrors = [];
let checkedIds = new Set();

function currentPreset() {
  return presets.find((p) => p.id === selected) || presets[0];
}

function currentEvalTask() {
  return evalTasks.find((t) => t.id === currentEvalId);
}

function setExamMode(mode) {
  for (const el of document.querySelectorAll('#examMode input[name="examMode"]')) {
    el.checked = el.value === mode;
  }
}

function getExamMode() {
  const el = document.querySelector('#examMode input[name="examMode"]:checked');
  return el ? el.value : 'off';
}

function testSetById(id) {
  return testSets.find((t) => t.id === id);
}

function visibleTaskIds() {
  const ts = testSetById(testSetFilter.value);
  return ts && Array.isArray(ts.taskIds) ? ts.taskIds : [];
}

function taskRow(id) {
  return bankTasks.find((t) => t.taskId === id);
}

function syncKindChrome() {
  const plugin = selected === 'plugin';
  examModeBox.hidden = !plugin;
  sutRootField.hidden = !plugin;
}

function renderTestSetOptions(preferId, selectEl) {
  const host = selectEl || testSetFilter;
  const prefer = preferId || currentPreset()?.defaultTestSetId || testSets[0]?.id;
  host.innerHTML = '';
  for (const ts of testSets) {
    const opt = document.createElement('option');
    opt.value = ts.id;
    opt.textContent = ts.label;
    host.appendChild(opt);
  }
  host.value = prefer && testSetById(prefer) ? prefer : testSets[0]?.id || '';
}

function fillVerifiedSelect(selectEl, rows, current) {
  selectEl.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = rows.length ? '请选择已验证项' : '请先到运行环境页验证';
  selectEl.appendChild(ph);
  for (const row of rows) {
    const opt = document.createElement('option');
    opt.value = row.id;
    opt.textContent = row.id;
    selectEl.appendChild(opt);
  }
  if (current && rows.some((r) => r.id === current)) selectEl.value = current;
  else selectEl.value = '';
}

function renderEnvSelects(model, agent) {
  fillVerifiedSelect(document.getElementById('model'), verifiedModels(), model);
  fillVerifiedSelect(document.getElementById('agent'), verifiedAgents(), agent);
}

function resetChecksToVisible() {
  checkedIds = new Set(visibleTaskIds());
}

function renderTaskPick() {
  const ids = visibleTaskIds();
  const mode = selected === 'plugin' ? getExamMode() : 'off';
  taskPick.innerHTML = '';
  for (const id of ids) {
    const t = taskRow(id) || { taskId: id, tags: [], complete: true, notes: '', promptPreview: '' };
    const tags = (t.tags || []).join(', ') || '（无任务类型）';
    const needOn = selected === 'plugin' && (mode === 'on' || mode === 'both');
    const needOff = selected !== 'plugin' || mode === 'off' || mode === 'both';
    const missing = [];
    if (needOff && !t.offId) missing.push('无插件条目');
    if (needOn && !t.onId) missing.push('有插件条目');

    const label = document.createElement('label');
    label.className = 'q-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = id;
    cb.checked = checkedIds.has(id);
    cb.addEventListener('change', (ev) => {
      if (ev.target.checked) checkedIds.add(id);
      else checkedIds.delete(id);
      pickCount.textContent = `已选 ${[...checkedIds].filter((x) => ids.includes(x)).length} / ${ids.length}`;
      scheduleSave();
    });
    const body = document.createElement('span');
    body.className = 'q-body';
    const title = document.createElement('span');
    title.className = 'q-title';
    title.textContent = `${id} · ${tags}`;
    if (missing.length) {
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.textContent = ` 缺 ${missing.join('、')}`;
      title.appendChild(warn);
    }
    const blurb = document.createElement('span');
    blurb.className = 'q-blurb';
    blurb.textContent = t.notes ? t.notes : '（无简介）';
    const prompt = document.createElement('span');
    prompt.className = 'q-prompt';
    prompt.textContent = t.promptPreview || '（无题干）';
    body.appendChild(title);
    body.appendChild(blurb);
    body.appendChild(prompt);
    label.appendChild(cb);
    label.appendChild(body);
    taskPick.appendChild(label);
  }
  const selectedVisible = [...checkedIds].filter((x) => ids.includes(x)).length;
  pickCount.textContent = `已选 ${selectedVisible} / ${ids.length}`;
}

function applyExperimentDefaults() {
  const p = currentPreset();
  if (!p) return;
  setExamMode(p.defaultExamMode || 'off');
  renderTestSetOptions();
  if (p.defaultTestSetId) testSetFilter.value = p.defaultTestSetId;
  resetChecksToVisible();
  syncKindChrome();
  renderTaskPick();
}

function renderPresets(list, host, radioName, onChange) {
  host.innerHTML = '';
  for (const p of list) {
    const label = document.createElement('label');
    label.className = 'preset';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = radioName;
    input.value = p.id;
    if (p.id === selected && radioName === 'exp') input.checked = true;
    if (radioName === 'newKind' && p.id === 'plugin') input.checked = true;
    const div = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = p.label;
    const desc = document.createElement('span');
    desc.textContent = p.description;
    div.appendChild(strong);
    div.appendChild(desc);
    label.appendChild(input);
    label.appendChild(div);
    input.addEventListener('change', () => onChange(p.id));
    host.appendChild(label);
  }
}

function collectBody() {
  const live = !document.getElementById('dryRun').checked;
  const body = {
    name: document.getElementById('evalName').value.trim() || '未命名测试任务',
    kind: selected,
    testSetId: testSetFilter.value,
    taskIds: [...checkedIds].filter((id) => visibleTaskIds().includes(id)),
    live,
    examMode: selected === 'plugin' ? getExamMode() : 'off',
    sutRoot: document.getElementById('sutRoot').value.trim(),
    model: document.getElementById('model').value.trim(),
    agent: document.getElementById('agent').value.trim(),
  };
  return body;
}

async function persistCurrent() {
  if (!currentEvalId || filling) return;
  const body = collectBody();
  delete body.kind;
  const updated = await api(`/api/eval-tasks/${encodeURIComponent(currentEvalId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const i = evalTasks.findIndex((t) => t.id === updated.id);
  if (i >= 0) evalTasks[i] = updated;
  else evalTasks.unshift(updated);
  renderEvalTaskList();
  return updated;
}

function scheduleSave() {
  if (filling || !currentEvalId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persistCurrent().catch((e) => setStatus(String(e.message || e), 'err'));
  }, 400);
}

function renderEvalTaskList() {
  evalTaskList.innerHTML = '';
  for (const t of evalTasks) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${t.name}\n${KIND_LABEL[t.kind] || t.kind}`;
    if (t.id === currentEvalId) btn.classList.add('selected');
    btn.addEventListener('click', () => void selectEvalTask(t.id));
    li.appendChild(btn);
    evalTaskList.appendChild(li);
  }
  for (const e of evalTaskErrors) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.disabled = true;
    btn.classList.add('warn');
    btn.textContent = `损坏任务 ${e.file}\n${e.error}`;
    li.appendChild(btn);
    evalTaskList.appendChild(li);
  }
}

function applyTaskToForm(t) {
  filling = true;
  selected = t.kind;
  document.getElementById('evalName').value = t.name || '';
  evalKindLabel.textContent = `类型：${KIND_LABEL[t.kind] || t.kind}`;
  setExamMode(t.kind === 'plugin' ? t.examMode || 'both' : 'off');
  renderTestSetOptions(t.testSetId);
  if (t.testSetId) testSetFilter.value = t.testSetId;
  checkedIds = new Set(Array.isArray(t.taskIds) ? t.taskIds : []);
  document.getElementById('sutRoot').value = t.sutRoot || '';
  renderEnvSelects(t.model || '', t.agent || '');
  document.getElementById('dryRun').checked = t.live === false;
  syncKindChrome();
  renderTaskPick();
  filling = false;
}

function renderRunHistory(task) {
  const runs = [...(task?.runs || [])].reverse();
  runHistory.innerHTML = '';
  if (!runs.length) {
    resultEmpty.hidden = false;
    runView.hidden = true;
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '（还没有跑次）';
    runHistory.appendChild(opt);
    return;
  }
  resultEmpty.hidden = true;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const opt = document.createElement('option');
    opt.value = r.path;
    const when = (r.startedAt || '').replace('T', ' ').slice(0, 19);
    opt.textContent = i === 0 ? `最近一次 · ${when}` : when || r.path;
    runHistory.appendChild(opt);
  }
  runHistory.value = runs[0].path;
}

async function selectEvalTask(id) {
  if (currentEvalId && currentEvalId !== id) {
    try {
      await persistCurrent();
    } catch {
      /* keep switching */
    }
  }
  const t = evalTasks.find((x) => x.id === id);
  if (!t) return;
  currentEvalId = id;
  evalEmpty.hidden = true;
  evalForm.hidden = false;
  applyTaskToForm(t);
  renderEvalTaskList();
  renderRunHistory(t);
  if (t.runs && t.runs.length) {
    await showRun(t.runs[t.runs.length - 1].path);
  }
}

async function refreshEvalTasks() {
  const data = await api('/api/eval-tasks');
  evalTasks = data.tasks || [];
  evalTaskErrors = data.errors || [];
  renderEvalTaskList();
}

function formatMetrics(raw) {
  if (!raw) return '（无 metrics.json）';
  try {
    const m = JSON.parse(raw);
    const agg = m.aggregates ?? m;
    const pass = agg.a_case_pass_rate ?? m.pass_rate ?? m.passRate;
    const parts = [];
    if (pass !== undefined) parts.push(`通过率 ${Math.round(Number(pass) * 1000) / 10}%`);
    if (agg.a_flaky_rerun_delta !== undefined) {
      parts.push(`flakyΔ ${agg.a_flaky_rerun_delta}`);
    }
    if (agg.a_invariant_violations !== undefined) {
      parts.push(`不变量违规 ${agg.a_invariant_violations}`);
    }
    return parts.length ? parts.join(' · ') : JSON.stringify(m, null, 2).slice(0, 400);
  } catch {
    return raw.slice(0, 400);
  }
}

function pct(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return `${Math.round(n * 1000) / 10}%`;
}

function pill(text, cls) {
  const s = document.createElement('span');
  s.className = `dash-pill${cls ? ` ${cls}` : ''}`;
  s.textContent = text;
  return s;
}

function renderDashboard(d) {
  dashConfig.innerHTML = '';
  dashHeadline.innerHTML = '';
  dashMatrix.innerHTML = '';
  if (!d) {
    dashUsable.textContent = '（无本次分析数据）';
    return;
  }
  const c = d.config ?? {};
  const pills = [];
  if (c.dataset) pills.push(['测试集 ' + c.dataset, '']);
  if (c.plugin === 'on') pills.push(['插件 开', 'on']);
  else if (c.plugin === 'off') pills.push(['插件 关', 'off']);
  if (c.model) pills.push(['模型 ' + c.model, '']);
  if (c.model_source) {
    pills.push(['模型来源 ' + c.model_source, c.model_source === 'environment' ? 'on' : 'warn']);
  }
  if (c.model_matches_freeze === true) pills.push(['与冻结一致', 'on']);
  if (c.model_matches_freeze === false) pills.push(['与冻结不一致', 'warn']);
  if (c.workspace_isolated === true) pills.push(['隔离仓', 'on']);
  if (c.workspace_isolated === false) pills.push(['未隔离', 'warn']);
  if (c.materials_seeded === true) pills.push(['已播种材料', 'on']);
  if (c.materials_seeded === false) pills.push(['未播种', '']);
  if (c.event_store_present === true) {
    pills.push(['EventStore ' + (c.event_store_source || '有'), 'on']);
  } else if (c.plugin === 'on') {
    pills.push(['EventStore 未写', 'warn']);
  }
  for (const [t, cls] of pills) dashConfig.appendChild(pill(t, cls));

  const h = d.headline ?? {};
  const deltaCls = h.usable_delta > 0 ? 'ok' : h.usable_delta < 0 ? 'err' : '';
  const deltaText =
    h.usable_delta === null || h.usable_delta === undefined
      ? '不可用'
      : `${h.usable_delta >= 0 ? '+' : ''}${h.usable_delta.toFixed(3)}`;
  const stats = [
    [
      '本侧通过',
      `${h.pass_total ?? 0}/${h.item_total ?? 0}`,
      h.pass_rate === 1 ? 'ok' : h.pass_rate === 0 && h.item_total ? 'err' : '',
    ],
    ['无插件', pct(h.baseline_pass_rate), ''],
    ['有插件', pct(h.candidate_pass_rate), ''],
    ['效果 Δ（剔除后）', deltaText, deltaCls],
  ];
  for (const [k, v, cls] of stats) {
    const el = document.createElement('div');
    el.className = 'dash-stat';
    const vEl = document.createElement('span');
    vEl.className = `v ${cls}`.trim();
    vEl.textContent = v;
    const kEl = document.createElement('span');
    kEl.className = 'k';
    kEl.textContent = k;
    el.appendChild(kEl);
    el.appendChild(vEl);
    dashHeadline.appendChild(el);
  }
  dashUsable.textContent = h.usable_note || '';

  const head = document.createElement('div');
  head.className = 'dash-row';
  head.innerHTML =
    '<div class="dash-cell head">题</div><div class="dash-cell head">无插件</div><div class="dash-cell head">有插件</div>';
  dashMatrix.appendChild(head);

  const cell = (pass, side) => {
    const el = document.createElement('div');
    const known = pass === true || pass === false;
    el.className = `dash-cell${pass === true ? ' pass' : pass === false ? ' fail' : ''}${side.exclude ? ' skip' : ''}`;
    const mark = !known ? '—' : pass ? '过' : '挂';
    const bits = [];
    if (side.ws === true) bits.push('工作区过');
    if (side.ws === false) bits.push('工作区挂');
    if (side.token === true) bits.push('暗号有');
    if (side.token === false) bits.push('暗号无');
    if (side.to === true) bits.push('超时');
    if (side.attr) bits.push(side.attr);
    if (side.exclude) bits.push(side.reason || '不进 Δ');
    const strong = document.createElement('strong');
    strong.textContent = mark;
    el.appendChild(strong);
    if (bits.length) {
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = bits.join(' · ');
      el.appendChild(sub);
    }
    return el;
  };

  for (const m of d.matrix ?? []) {
    const row = document.createElement('div');
    row.className = 'dash-row';
    const name = document.createElement('div');
    name.className = 'dash-cell';
    name.textContent = m.pair;
    row.appendChild(name);
    row.appendChild(
      cell(m.off_pass, {
        ws: m.off_workspace,
        token: m.off_token,
        to: m.off_timeout,
        attr: m.off_attr,
        exclude: Boolean(m.exclude_from_effect && m.off_timeout),
        reason: m.exclude_reason,
      }),
    );
    row.appendChild(
      cell(m.on_pass, {
        ws: m.on_workspace,
        token: m.on_token,
        to: m.on_timeout,
        attr: m.on_attr,
        exclude: Boolean(m.exclude_from_effect && m.on_timeout),
        reason: m.exclude_reason,
      }),
    );
    dashMatrix.appendChild(row);
  }
}

function renderAttr(summary) {
  if (!summary?.attribution) {
    attrSummary.textContent = '（无结果）';
    return;
  }
  const a = summary.attribution;
  const lines = [`通过 ${a.pass_total} / 失败 ${a.fail_total} / 共 ${a.item_total}`];
  if (a.fail_total === 0) {
    lines.push('失败归因：无（本 run 全过）');
  } else {
    const parts = Object.entries(a.fail_counts)
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .map(([k, n]) => `${k} ${n}`);
    lines.push(`失败归因占比：${parts.join(' · ')}`);
    if (a.primary_fail) lines.push(`失败主因：${a.primary_fail}`);
  }
  const st = summary.stability;
  if (st) {
    lines.push(
      `稳定性：flakyΔ=${st.a_flaky_rerun_delta ?? '—'} · repeats 标记题 ${st.repeat_tagged_items}`,
    );
    lines.push(st.note);
  }
  attrSummary.textContent = lines.join('\n');
}

function renderEffect(data) {
  const lines = [];
  const es = data.effect_structured?.effect;
  if (es) {
    lines.push(
      `对照 Δpass=${Number(es.pass_rate_delta).toFixed(4)}（base ${Number(es.baseline_pass_rate).toFixed(4)} → cand ${Number(es.candidate_pass_rate).toFixed(4)}）`,
    );
    if (es.reference_scores) {
      const r = es.reference_scores;
      const scale = r.scale_max !== undefined ? ` / ${r.scale_max}` : '';
      lines.push(
        `参考分差${scale}：base ${r.baseline_avg ?? '—'} · cand ${r.candidate_avg ?? '—'} · Δ ${r.delta ?? '—'}（不进硬门禁）`,
      );
    }
    if (es.paired_effects?.length) {
      lines.push(`配对效果 ${es.paired_effects.length} 对：`);
      for (const p of es.paired_effects.slice(0, 12)) {
        const d = p.score_delta !== undefined ? ` scoreΔ=${p.score_delta}` : '';
        lines.push(
          `  ${p.pair}: off=${p.baseline_pass ? '过' : '败'} 暗号=${p.baseline_pass_token_present === true ? '有' : p.baseline_pass_token_present === false ? '无' : '—'} / on=${p.candidate_pass ? '过' : '败'} 暗号=${p.candidate_pass_token_present === true ? '有' : p.candidate_pass_token_present === false ? '无' : '—'}${d}`,
        );
      }
      if (es.paired_effects.length > 12) {
        lines.push(`  …另有 ${es.paired_effects.length - 12} 对见原文`);
      }
    }
    const c = data.effect_structured.counts;
    if (c) {
      lines.push(
        `漂移：新失败 ${c.new_failure} / 修复 ${c.fixed} / 升版 ${c.asset_rev_drift} / 不变 ${c.unchanged}`,
      );
    }
  } else if (data.summary?.effect_pairs?.length) {
    lines.push('本 run 配对键（单侧或同卷 OFF/ON）：');
    for (const p of data.summary.effect_pairs.slice(0, 12)) {
      const off = p.off_pass === undefined ? '—' : p.off_pass ? '过' : '败';
      const on = p.on_pass === undefined ? '—' : p.on_pass ? '过' : '败';
      lines.push(`  ${p.pair}: off=${off} / on=${on}`);
    }
    lines.push('（完整 OFF↔ON Δ 请钉 baseline 后「一键对照」）');
  } else {
    lines.push('（无 effect_compare 结构化摘要 — 可钉 baseline 后一键对照）');
  }
  effectSummary.textContent = lines.join('\n');
}

function renderInfo(summary) {
  const vals = summary?.info_metrics?.values ?? {};
  const keys = Object.keys(vals);
  if (!keys.length) {
    infoMetrics.textContent = '（results/metrics 中暂无步数/成本等字段；有则自动展示，不进硬门禁）';
    return;
  }
  infoMetrics.textContent = keys.map((k) => `${k}=${vals[k]}`).join('\n');
}

function renderRef(summary) {
  const r = summary?.reference_scores;
  if (!r) {
    refScores.textContent = '（无 scores.json — 可用 proctor score write 补写；参考分不进硬门禁）';
    return;
  }
  const scale = r.scale_max !== undefined ? ` / ${r.scale_max}` : '';
  refScores.textContent = `平均参考分 ${r.avg?.toFixed?.(2) ?? r.avg}${scale} · n=${r.n}`;
}

function renderJudge(scores) {
  if (!Array.isArray(scores) || scores.length === 0) {
    judgeScores.textContent = '（尚未触发裁判 — 模型判断 / 人工判断需手动触发）';
    return;
  }
  const lines = [];
  for (const s of scores) {
    const src =
      s.source === 'model_judge' ? '模型判断' : s.source === 'human' ? '人工判断' : s.source;
    const item = s.item_id ? ` [${s.item_id}]` : '';
    const mark = s.reason?.startsWith('judge_error') ? '⚠️' : s.pass ? '✅' : '❌';
    lines.push(`${mark} ${src}${item} · ${s.dimension || '—'} · ${s.reason || ''}`);
  }
  judgeScores.textContent = lines.join('\n');
}

async function renderAgreement(runDir) {
  if (!runDir) {
    judgeAgreementEl.textContent = '';
    return;
  }
  try {
    const r = await api(`/api/judge/agreement?runPath=${encodeURIComponent(runDir)}`);
    if (r.insufficientSample) {
      judgeAgreementEl.textContent =
        '人工标注校验基准：样本不足（需同一题同维度同时有模型判断与人工判断，总体配对 ≥2 对才产出 Kappa）';
      return;
    }
    const lines = [];
    const k = r.overallKappa;
    const kappaText = k === undefined ? '—' : k.toFixed(3);
    lines.push(
      `人工标注校验基准：总体 Kappa ${kappaText} · 一致率 ${((r.overallAgreementRate ?? 0) * 100).toFixed(1)}% · 配对 ${r.totalSampleCount}`,
    );
    for (const d of r.dimensions ?? []) {
      const dk = d.kappa === undefined ? '—' : d.kappa.toFixed(3);
      lines.push(
        `  ${d.dimension}: Kappa ${dk} · ${d.agreeCount}/${d.sampleCount} 一致`,
      );
    }
    judgeAgreementEl.textContent = lines.join('\n');
  } catch {
    judgeAgreementEl.textContent = '';
  }
}

function judgeItemIds() {
  // 从当前 run 详情的 pass_tokens / failures 提取 item_id 列表，供用户选择。
  const ids = new Set();
  const summary = window.__runSummary ?? {};
  for (const r of summary.pass_tokens ?? []) ids.add(r.item_id);
  for (const r of summary.failures ?? []) ids.add(r.item_id);
  return [...ids];
}

function openJudgeDialog(kind) {
  judgeDialogTitle.textContent = kind === 'human' ? '人工复核' : '触发模型判断';
  judgeHumanHint.hidden = kind !== 'human';
  judgeVerdictsBox.hidden = kind !== 'human';
  judgeReviewerLabel.hidden = kind !== 'human';
  judgeError.hidden = true;
  judgeItemId.value = '';
  judgeTaskPrompt.value = '';
  judgeFinalOutput.value = '';
  judgeDialog.dataset.kind = kind;
  // 若只有一个 item，预填。
  const ids = judgeItemIds();
  if (ids.length === 1) judgeItemId.value = ids[0];
  judgeDialog.showModal();
}

async function submitJudge() {
  const kind = judgeDialog.dataset.kind;
  const itemId = judgeItemId.value.trim();
  const body = {
    runPath: currentRunPath,
    kind,
    ...(itemId ? { itemId } : {}),
    task_prompt: judgeTaskPrompt.value.trim(),
    final_output: judgeFinalOutput.value.trim(),
  };
  if (kind === 'human') {
    body.reviewer = judgeReviewer.value.trim();
  }
  try {
    const r = await api('/api/judge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    judgeDialog.close();
    judgeStatus.textContent = r.judge_error ? '裁判完成（有降级）' : '裁判完成';
    judgeStatus.className = 'status ok';
    renderJudge(r.scores);
  } catch (e) {
    judgeError.hidden = false;
    judgeError.textContent = String(e.message || e);
  }
}

function initJudge() {
  judgeModelBtn.addEventListener('click', () => openJudgeDialog('model'));
  judgeHumanBtn.addEventListener('click', () => openJudgeDialog('human'));
  judgeCancel.addEventListener('click', () => judgeDialog.close());
  judgeForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void submitJudge();
  });
}

function renderPassTokens(summary) {
  const rows = summary?.pass_tokens ?? [];
  if (!rows.length) {
    tokenSummary.textContent =
      '（本 run 无暗号字段 — 非 hosted 或旧产物。暗号是辅助信号，缺席不单独否决。）';
    return;
  }
  const lines = [
    '暗号为辅助；工作区是效果题主判定。可区分「超时但文件对了」与「超时且文件没动」。',
  ];
  for (const r of rows) {
    const pass = r.pass ? '过' : '挂';
    const ws = r.workspace_label || '—';
    const to = r.timed_out_label || '—';
    lines.push(
      `  ${r.item_id}: ${pass} · 工作区：${ws} · 暗号：${r.label || '—'}（辅助） · 超时：${to}`,
    );
  }
  tokenSummary.textContent = lines.join('\n');
}

function renderFailDrafts(summary) {
  failDrafts.innerHTML = '';
  const fails = summary?.failures ?? [];
  if (!fails.length) {
    failDrafts.textContent = '（无失败题）';
    return;
  }
  for (const f of fails) {
    const row = document.createElement('div');
    row.className = 'fail-row';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${f.item_id}${f.attribution ? ` [${f.attribution}]` : ''}\n${(f.message || '').slice(0, 160)}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost';
    btn.textContent = '沉淀为候选回归题';
    btn.addEventListener('click', () => {
      openWizardWithDraft({
        taskId: f.suggested_task_id || '',
        prompt: f.suggested_prompt || '',
        passToken: f.suggested_token || '',
        sourceRun: f.source_run || '',
        attribution: f.attribution || '',
        message: f.message || '',
        oracleFailures: f.oracle_failures || [],
      });
    });
    row.appendChild(meta);
    row.appendChild(btn);
    failDrafts.appendChild(row);
  }
}

async function showRun(path) {
  if (!path) return;
  const data = await api(`/api/runs/view?path=${encodeURIComponent(path)}`);
  currentRunPath = data.dir;
  resultEmpty.hidden = true;
  runView.hidden = false;
  runMeta.textContent = data.dir;
  window.__runSummary = data.summary;
  renderDashboard(data.dashboard);
  runMetrics.textContent = formatMetrics(data.metrics);
  renderAttr(data.summary);
  renderEffect(data);
  renderInfo(data.summary);
  renderRef(data.summary);
  renderPassTokens(data.summary);
  renderFailDrafts(data.summary);
  renderJudge(parseJudgeScores(data.judge_scores));
  await renderAgreement(data.dir);
  effectMd.textContent =
    data.effect_compare || '（无 effect_compare.md — 单次 run 或尚未 compare）';
  resultsNd.textContent = (data.results_preview || []).join('\n') || '（无 results）';
  await refreshBaselines();
}

function parseJudgeScores(raw) {
  if (!raw) return [];
  try {
    const doc = JSON.parse(raw);
    return Array.isArray(doc?.scores) ? doc.scores : [];
  } catch {
    return [];
  }
}

async function refreshBaselines(preferred) {
  const { baselines } = await api('/api/baselines');
  compareBaseline.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = baselines.length ? '选择 baseline…' : '（尚无 baseline）';
  compareBaseline.appendChild(opt0);
  for (const b of baselines) {
    const opt = document.createElement('option');
    opt.value = b.name;
    opt.textContent = b.name;
    if (preferred && preferred === b.name) opt.selected = true;
    compareBaseline.appendChild(opt);
  }
}

function setStatus(text, cls) {
  jobStatus.textContent = text;
  jobStatus.className = `status ${cls || ''}`;
}

async function pollJob(jobId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const job = await api(`/api/jobs/${jobId}`);
      logEl.textContent = (job.log || []).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
      if (job.status === 'running' || job.status === 'queued') {
        setStatus(`运行中… ${job.id}`);
        return;
      }
      clearInterval(pollTimer);
      if (job.status === 'done') {
        setStatus(`完成 ${job.id}`, 'ok');
      } else {
        setStatus(`失败：${job.error || job.id}`, 'err');
      }
      runBtn.disabled = false;
      await refreshEvalTasks();
      const t = evalTasks.find((x) => x.id === currentEvalId);
      if (t) {
        renderRunHistory(t);
        if (t.runs && t.runs.length) {
          await showRun(t.runs[t.runs.length - 1].path);
        }
      }
    } catch (e) {
      clearInterval(pollTimer);
      setStatus(String(e.message || e), 'err');
      runBtn.disabled = false;
    }
  }, 800);
}

runBtn.addEventListener('click', async () => {
  if (!currentEvalId) {
    setStatus('请先新建或选择一条测试任务', 'err');
    return;
  }
  runBtn.disabled = true;
  logEl.textContent = '';
  setStatus('提交中…');
  try {
    const saved = await persistCurrent();
    const body = collectBody();
    const { jobId } = await api('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        experiment: body.kind,
        live: body.live,
        model: body.model || undefined,
        agent: body.agent || undefined,
        sutRoot: body.sutRoot || undefined,
        examMode: body.examMode,
        testSetId: body.testSetId,
        taskIds: body.taskIds,
        evalTaskId: saved?.id || currentEvalId,
      }),
    });
    setStatus(`已排队 ${jobId}`);
    await pollJob(jobId);
  } catch (e) {
    setStatus(String(e.message || e), 'err');
    runBtn.disabled = false;
  }
});

document.getElementById('pinBaseline').addEventListener('click', async () => {
  compareStatus.textContent = '';
  if (!currentRunPath) {
    compareStatus.textContent = '请先打开一个 run';
    compareStatus.className = 'status err';
    return;
  }
  const name = document.getElementById('pinName').value.trim();
  try {
    const r = await api('/api/baselines/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runPath: currentRunPath, name }),
    });
    compareStatus.textContent = `已钉选 ${r.name}`;
    compareStatus.className = 'status ok';
    await refreshBaselines(r.name);
  } catch (e) {
    compareStatus.textContent = String(e.message || e);
    compareStatus.className = 'status err';
  }
});

document.getElementById('runCompare').addEventListener('click', async () => {
  compareStatus.textContent = '';
  if (!currentRunPath) {
    compareStatus.textContent = '请先打开一个 run';
    compareStatus.className = 'status err';
    return;
  }
  const baseline = compareBaseline.value;
  if (!baseline) {
    compareStatus.textContent = '请选择 baseline';
    compareStatus.className = 'status err';
    return;
  }
  try {
    const r = await api('/api/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseline, candidate: currentRunPath }),
    });
    const d = r.report?.effect?.pass_rate_delta;
    compareStatus.textContent =
      d === undefined ? '对照完成' : `对照完成 Δpass=${Number(d).toFixed(4)}`;
    compareStatus.className = 'status ok';
    await showRun(currentRunPath);
  } catch (e) {
    compareStatus.textContent = String(e.message || e);
    compareStatus.className = 'status err';
  }
});

const { presets: presetList } = await api('/api/presets');
const proj = await api('/api/project');
const bank = await api('/api/bank/tasks');
testSets = proj.testSets || [];
bankTasks = bank.tasks || [];
presets = presetList;
renderPresets(presetList, document.getElementById('newEvalKind'), 'newKind', () => {});
syncKindChrome();
await refreshEvalTasks();
await refreshBaselines();
await initEnv();
await initBank(testSets);
initModelPool();
initDatasets();
initJudge();

if (evalTasks.length) {
  await selectEvalTask(evalTasks[0].id);
} else {
  resultEmpty.hidden = false;
  runView.hidden = true;
}

try {
  const sut = document.getElementById('sutRoot');
  if (proj?.defaults?.sutRoot && !sut.value) sut.value = proj.defaults.sutRoot;
} catch {
  /* ignore */
}

testSetFilter.addEventListener('change', () => {
  resetChecksToVisible();
  renderTaskPick();
  scheduleSave();
});
for (const el of document.querySelectorAll('#examMode input[name="examMode"]')) {
  el.addEventListener('change', () => {
    renderTaskPick();
    scheduleSave();
  });
}
document.getElementById('pickAll').addEventListener('click', () => {
  resetChecksToVisible();
  renderTaskPick();
  scheduleSave();
});
document.getElementById('pickNone').addEventListener('click', () => {
  checkedIds = new Set();
  renderTaskPick();
  scheduleSave();
});
document.getElementById('evalName').addEventListener('change', () => scheduleSave());
document.getElementById('sutRoot').addEventListener('change', () => scheduleSave());
document.getElementById('model').addEventListener('change', () => scheduleSave());
document.getElementById('agent').addEventListener('change', () => scheduleSave());
document.getElementById('dryRun').addEventListener('change', () => scheduleSave());
runHistory.addEventListener('change', () => {
  if (runHistory.value) void showRun(runHistory.value);
});

const newEvalDialog = document.getElementById('newEvalDialog');
document.getElementById('newEvalTask').addEventListener('click', () => {
  document.getElementById('newEvalError').hidden = true;
  const n = document.getElementById('newEvalName');
  n.value = '';
  const plugin = document.querySelector('#newEvalKind input[value="plugin"]');
  if (plugin) plugin.checked = true;
  newEvalDialog.showModal();
  n.focus();
});
document.getElementById('newEvalCancel').addEventListener('click', () => newEvalDialog.close());
document.getElementById('newEvalForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = document.getElementById('newEvalError');
  err.hidden = true;
  const kindEl = document.querySelector('#newEvalKind input[name="newKind"]:checked');
  const kind = kindEl ? kindEl.value : 'plugin';
  const p = presets.find((x) => x.id === kind) || presets[0];
  selected = kind;
  applyExperimentDefaults();
  try {
    const created = await api('/api/eval-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('newEvalName').value.trim() || p.label,
        kind,
        testSetId: p.defaultTestSetId || 'full',
        examMode: p.defaultExamMode,
        taskIds: testSetById(p.defaultTestSetId || 'full')?.taskIds ?? [],
        live: true,
      }),
    });
    evalTasks = [created, ...evalTasks.filter((t) => t.id !== created.id)];
    newEvalDialog.close();
    await selectEvalTask(created.id);
  } catch (e) {
    err.textContent = String(e.message || e);
    err.hidden = false;
  }
});

document.getElementById('deleteEvalTask').addEventListener('click', async () => {
  if (!currentEvalId) return;
  const t = currentEvalTask();
  if (!window.confirm(`删除测试任务「${t?.name || currentEvalId}」？不会删题库或已有跑次文件。`)) {
    return;
  }
  try {
    await api(`/api/eval-tasks/${encodeURIComponent(currentEvalId)}`, { method: 'DELETE' });
    currentEvalId = '';
    await refreshEvalTasks();
    if (evalTasks.length) await selectEvalTask(evalTasks[0].id);
    else {
      evalForm.hidden = true;
      evalEmpty.hidden = false;
      resultEmpty.hidden = false;
      runView.hidden = true;
      renderEvalTaskList();
    }
  } catch (e) {
    setStatus(String(e.message || e), 'err');
  }
});

function applyPage() {
  const hash =
    location.hash === '#bank'
      ? 'bank'
      : location.hash === '#datasets'
        ? 'datasets'
        : location.hash === '#env'
          ? 'env'
          : location.hash === '#models'
            ? 'models'
            : 'test';
  document.getElementById('pageTest').hidden = hash !== 'test';
  document.getElementById('pageBank').hidden = hash !== 'bank';
  document.getElementById('pageDatasets').hidden = hash !== 'datasets';
  document.getElementById('pageEnv').hidden = hash !== 'env';
  document.getElementById('pageModels').hidden = hash !== 'models';
  document.getElementById('navTest').classList.toggle('active', hash === 'test');
  document.getElementById('navBank').classList.toggle('active', hash === 'bank');
  document.getElementById('navDatasets').classList.toggle('active', hash === 'datasets');
  document.getElementById('navEnv').classList.toggle('active', hash === 'env');
  document.getElementById('navModels').classList.toggle('active', hash === 'models');
}

window.addEventListener('hashchange', applyPage);
document.addEventListener('env-catalog-changed', () => {
  const t = currentEvalTask();
  renderEnvSelects(t?.model || '', t?.agent || '');
});
applyPage();

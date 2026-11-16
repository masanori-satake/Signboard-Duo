'use strict';
/* Setup form logic. All values stay in the page until a load or
   save message is posted, so the user can leave VS Code to copy a
   URL or a token and come back to the form exactly as it was. */
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let CFG = null;
let pendingWf = null;
let pendingProject = null;
let pendingPlans = null;

function status(msg, kind) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = kind || '';
}
function conn() {
  return {
    base: $('base').value.trim(),
    authType: $('authType').value,
    user: $('authUser').value.trim(),
    headerName: $('authHeader').value.trim(),
    token: $('token').value,
  };
}
function currentType() { return $('type').value; }
function caps() { return CFG.caps[currentType()] || []; }

function rebuildInterests(checked) {
  const box = $('interests');
  box.innerHTML = '';
  for (const id of CFG.catalog) {
    if (!caps().includes(id)) continue;
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = id;
    cb.checked = checked ? checked.includes(id) : id === 'failed' || id === 'recovered';
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + (CFG.labels.interests[id] || id)));
    box.appendChild(label);
  }
}
function applyPreset() {
  const p = $('preset').value;
  if (p === 'custom') return;
  const wanted = (CFG.presets[p] || []).filter((i) => caps().includes(i));
  rebuildInterests(wanted);
}
function syncType() {
  const t = currentType();
  const gh = t === 'github-actions';
  const rss = t === 'rss';
  $('githubSection').classList.toggle('hidden', !gh);
  $('bambooSection').classList.toggle('hidden', gh || rss);
  $('rssSection').classList.toggle('hidden', !rss);
  $('interestsSection').classList.toggle('hidden', rss);
  $('baseLabel').textContent = rss
    ? (CFG && CFG.ja ? 'フィード URL' : 'Feed URL')
    : (CFG && CFG.ja ? 'API ベース URL' : 'API base URL');
  $('base').placeholder = rss ? 'https://example.com/feed.xml' : 'https://bamboo.example.com/bamboo';
  if (gh && !$('base').value) $('base').value = 'https://api.github.com';
  if (!gh && $('base').value === 'https://api.github.com') $('base').value = '';
  rebuildInterests(null);
  $('preset').value = 'changes';
  applyPreset();
}
function syncAuth() {
  $('authUserRow').classList.toggle('hidden', $('authType').value !== 'basic');
  $('authHeaderRow').classList.toggle('hidden', $('authType').value !== 'header');
  $('tokenRow').classList.toggle('hidden', $('authType').value === 'none');
}
function fillChecks(containerId, items, valueKey) {
  const box = $(containerId);
  box.innerHTML = '';
  for (const it of items) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = it[valueKey];
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + it.label + (it.description ? ` (${it.description})` : '')));
    box.appendChild(label);
  }
}
function checkedValues(containerId) {
  return [...$(containerId).querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
}


function checkPending(containerId, values) {
  if (!values) return;
  const wanted = new Set(values.map(String));
  for (const cb of $(containerId).querySelectorAll('input[type=checkbox]')) {
    cb.checked = wanted.has(cb.value);
  }
}
function applyEdit(e) {
  $('type').value = e.type;
  $('type').classList.add('hidden');
  const fixed = $('typeFixed');
  fixed.textContent = $('type').selectedOptions[0] ? $('type').selectedOptions[0].textContent : e.type;
  fixed.classList.remove('hidden');
  syncType();
  $('base').value = e.url || '';
  $('authType').value = e.authType || 'none';
  syncAuth();
  $('authUser').value = e.authUser || '';
  $('name').value = e.name || '';
  $('maxItems').value = e.maxItems || 10;
  $('keepHours').value = e.keepHours || 24;
  $('enabled').checked = e.enabled !== false;
  $('authHeader').value = e.authHeader || '';
  rebuildInterests(e.interests && e.interests.length ? e.interests : null);
  $('preset').value = 'custom';
  const t = e.target || {};
  if (e.type === 'rss') {
    $('kind').value = e.kind || 'generic';
  } else if (e.type === 'github-actions') {
    $('repo').value = t.repo || '';
    const radio = document.querySelector(`input[name=branchScope][value="${t.branches || 'mainline'}"]`);
    if (radio) radio.checked = true;
    pendingWf = Array.isArray(t.workflows) && t.workflows.length ? t.workflows : null;
    if ($('repo').value) {
      status(CFG.ja ? 'ワークフローを読み込み中…' : 'Loading workflows…');
      vscode.postMessage({ type: 'loadWorkflows', ...conn(), repo: $('repo').value });
    }
  } else {
    pendingProject = t.project || null;
    pendingPlans = Array.isArray(t.plans) && t.plans.length ? t.plans : null;
    status(CFG.ja ? 'プロジェクトを読み込み中…' : 'Loading projects…');
    vscode.postMessage({ type: 'loadProjects', ...conn() });
  }
}

window.addEventListener('message', (ev) => {
  const m = ev.data || {};
  if (m.type === 'init') {
    CFG = m;
    const presetSel = $('preset');
    presetSel.innerHTML = '';
    for (const p of m.presetOrder) {
      const o = document.createElement('option');
      o.value = p;
      o.textContent = m.labels.presets[p];
      presetSel.appendChild(o);
    }
    const oc = document.createElement('option');
    oc.value = 'custom';
    oc.textContent = m.labels.presets.custom;
    presetSel.appendChild(oc);
    presetSel.value = 'changes';
    syncType();
    syncAuth();
    status('');
    if (m.edit) applyEdit(m.edit);
  } else if (m.type === 'projects') {
    const sel = $('project');
    sel.innerHTML = '';
    for (const p of m.items) {
      const o = document.createElement('option');
      o.value = p.key;
      o.textContent = `${p.name} (${p.key})`;
      sel.appendChild(o);
    }
    $('bambooTarget').classList.remove('hidden');
    if (!$('name').value && m.items.length) $('name').value = m.items[0].name;
    if (pendingProject) {
      $('project').value = pendingProject;
      pendingProject = null;
      if (pendingPlans) {
        $('granularity').value = 'plans';
        $('loadPlans').classList.remove('hidden');
        status(CFG.ja ? 'プランを読み込み中…' : 'Loading plans…');
        vscode.postMessage({ type: 'loadPlans', ...conn(), project: $('project').value });
      }
    }
    status(m.items.length ? '' : (CFG.ja ? 'プロジェクトが見つかりませんでした' : 'No projects found'), m.items.length ? '' : 'error');
  } else if (m.type === 'plans') {
    fillChecks('plans', m.items.map((p) => ({ label: p.name, description: p.key, key: p.key })), 'key');
    $('plansRow').classList.remove('hidden');
    checkPending('plans', pendingPlans);
    pendingPlans = null;
    status('');
  } else if (m.type === 'workflows') {
    fillChecks('workflows', m.items.map((w) => ({ label: w.name, id: w.id })), 'label');
    $('workflowsRow').classList.remove('hidden');
    checkPending('workflows', pendingWf);
    pendingWf = null;
    if (!$('name').value) $('name').value = $('repo').value.trim();
    status('');
  } else if (m.type === 'error') {
    status(m.message, 'error');
  } else if (m.type === 'saved') {
    status(CFG.ja ? '保存しました。このタブは閉じて構いません。' : 'Saved. You can close this tab.', 'ok');
    $('save').disabled = true;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  $('type').addEventListener('change', syncType);
  $('authType').addEventListener('change', syncAuth);
  $('preset').addEventListener('change', applyPreset);
  $('interests').addEventListener('change', () => { $('preset').value = 'custom'; });
  $('loadProjects').addEventListener('click', () => {
    status(CFG.ja ? '読み込み中…' : 'Loading…');
    vscode.postMessage({ type: 'loadProjects', ...conn() });
  });
  $('granularity').addEventListener('change', () => {
    const pick = $('granularity').value === 'plans';
    $('loadPlans').classList.toggle('hidden', !pick);
    if (!pick) $('plansRow').classList.add('hidden');
  });
  $('loadPlans').addEventListener('click', () => {
    status(CFG.ja ? '読み込み中…' : 'Loading…');
    vscode.postMessage({ type: 'loadPlans', ...conn(), project: $('project').value });
  });
  $('loadWorkflows').addEventListener('click', () => {
    status(CFG.ja ? '読み込み中…' : 'Loading…');
    vscode.postMessage({ type: 'loadWorkflows', ...conn(), repo: $('repo').value });
  });
  $('save').addEventListener('click', () => {
    const type = currentType();
    const interests = type === 'rss' ? [] : checkedValues('interests');
    if (type !== 'rss' && !interests.length) {
      status(CFG.ja ? 'ニュース項目を1つ以上選んでください' : 'Pick at least one news item', 'error');
      return;
    }
    const data = { ...conn(), type, name: $('name').value.trim(), interests,
      enabled: $('enabled').checked,
      maxItems: Number($('maxItems').value) || 10, keepHours: Number($('keepHours').value) || 24, target: {} };
    if (data.type === 'rss') {
      data.kind = $('kind').value;
    } else if (data.type === 'github-actions') {
      data.target = { repo: $('repo').value, branches: document.querySelector('input[name=branchScope]:checked').value };
      const wf = checkedValues('workflows');
      if (wf.length) data.target.workflows = wf;
    } else {
      data.target = { project: $('project').value };
      if ($('granularity').value === 'plans') {
        const plans = checkedValues('plans');
        if (!plans.length) {
          status(CFG.ja ? 'プランを1つ以上選んでください' : 'Pick at least one plan', 'error');
          return;
        }
        data.target.plans = plans;
      }
    }
    vscode.postMessage({ type: 'save', data });
  });
  const del = $('deleteFeed');
  if (del) del.addEventListener('click', () => vscode.postMessage({ type: 'delete' }));
  vscode.postMessage({ type: 'ready' });
});

'use strict';

/* Bamboo REST adapter (pure module — no vscode dependency).
   Turns Bamboo's REST API into the common row shape the board
   consumes ({ guid, title, link, timeMs, ciFailed }). The engine
   owns transport (auth, proxy, deadlines, error taxonomy); this
   module owns the URLs, the response interpretation and the
   mapping from "what the user wants to know" (interests) to rows.
   Which catalog entries this adapter can serve is declared in
   CAPABILITIES — unsupported interests are never offered for it. */

const CAPABILITIES = ['failed', 'recovered', 'streak', 'running', 'all', 'long'];
const DEFAULT_INTERESTS = ['failed', 'recovered'];

function baseOf(url) { return String(url || '').replace(/\/+$/, ''); }

function projectUrl(base, projectKey) {
  return `${baseOf(base)}/rest/api/latest/project/${encodeURIComponent(projectKey)}.json?expand=plans`;
}

function planResultsUrl(base, planKey, maxResults) {
  const n = Math.max(1, Math.min(25, maxResults || 5));
  return `${baseOf(base)}/rest/api/latest/result/${encodeURIComponent(planKey)}.json?max-results=${n}`;
}

function parseProjectPlans(json) {
  const plans = json && json.plans && Array.isArray(json.plans.plan) ? json.plans.plan : [];
  return plans
    .filter((p) => p && typeof p.key === 'string')
    .map((p) => ({ key: p.key, name: typeof p.name === 'string' ? p.name : p.key }));
}

function parseTime(v) {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

function parsePlanResults(json) {
  const list = json && json.results && Array.isArray(json.results.result) ? json.results.result : [];
  const out = [];
  let planName = '';
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const key = r.buildResultKey || r.key;
    if (typeof key !== 'string' || !key) continue;
    if (!planName && r.plan && typeof r.plan.name === 'string') planName = r.plan.name;
    out.push({
      key,
      number: Number.isFinite(r.buildNumber) ? r.buildNumber : (Number.isFinite(r.number) ? r.number : null),
      state: typeof r.buildState === 'string' ? r.buildState : (typeof r.state === 'string' ? r.state : ''),
      lifeCycle: typeof r.lifeCycleState === 'string' ? r.lifeCycleState : '',
      startedMs: parseTime(r.buildStartedTime || r.startedTime),
      completedMs: parseTime(r.buildCompletedTime || r.completedTime),
      link: r.link && typeof r.link.href === 'string' ? r.link.href : '',
      planKey: r.plan && typeof r.plan.key === 'string' ? r.plan.key : '',
      branchName: (r.branch && typeof r.branch.name === 'string') ? r.branch.name : (typeof r.branchName === 'string' ? r.branchName : ''),
    });
  }
  out.sort((a, b) => (b.number || 0) - (a.number || 0));
  return { planName, results: out };
}

function verdictOf(state) {
  if (/fail/i.test(state)) return true;
  if (/success/i.test(state)) return false;
  return null;
}

/* Build board rows for one plan from its newest results.
   interests: catalog ids (see CAPABILITIES); empty/absent means
   DEFAULT_INTERESTS. labels: { running, long, recovered, streak(n) }
   supplied by the host so this module stays locale-free. */
function buildRows(opts) {
  const { planKey, planName, results, interests, nowMs, longMinutes, labels } = opts || {};
  const wants = new Set(Array.isArray(interests) && interests.length ? interests : DEFAULT_INTERESTS);
  const L = labels || {};
  const name = planName || planKey || '';
  const rows = [];
  if (!Array.isArray(results) || !results.length) return rows;

  const titleOf = (r, suffix) =>
    `${name} #${r.number != null ? r.number : '?'}${r.branchName ? ` (${r.branchName})` : ''}${suffix || ''}`;
  const push = (r, ciFailed, suffix) => rows.push({
    guid: r.key,
    title: titleOf(r, suffix),
    link: r.link || '',
    timeMs: r.completedMs != null ? r.completedMs : (r.startedMs != null ? r.startedMs : nowMs),
    ciFailed,
  });

  if (wants.has('all')) {
    for (const r of results) push(r, verdictOf(r.state));
    return rows;
  }

  const latest = results[0];
  const prev = results[1];
  const latestRunning = latest.lifeCycle === 'InProgress' || latest.lifeCycle === 'Queued';

  if (latestRunning) {
    const overLong = latest.startedMs != null && (nowMs - latest.startedMs) > (longMinutes || 60) * 60000;
    if (wants.has('running') || (wants.has('long') && overLong)) {
      push(latest, false, overLong && L.long ? ` — ${L.long}` : (L.running ? ` — ${L.running}` : ''));
    }
    return rows;
  }

  let failCount = 0;
  for (const r of results) { if (/fail/i.test(r.state)) failCount++; else break; }

  if (/fail/i.test(latest.state)) {
    if (wants.has('failed') || (wants.has('streak') && failCount >= 2)) {
      push(latest, true, failCount >= 2 && wants.has('streak') && L.streak ? ` — ${L.streak(failCount)}` : '');
    }
  } else if (/success/i.test(latest.state) && prev && /fail/i.test(prev.state) && wants.has('recovered')) {
    push(latest, false, L.recovered ? ` — ${L.recovered}` : '');
  }
  return rows;
}

module.exports = { CAPABILITIES, DEFAULT_INTERESTS, projectUrl, planResultsUrl, parseProjectPlans, parsePlanResults, buildRows };

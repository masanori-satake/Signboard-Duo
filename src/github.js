'use strict';

/* GitHub Actions REST adapter (pure module — no vscode dependency).
   Same contract as the Bamboo adapter: the engine owns transport,
   this module owns URLs, response interpretation and the interests
   mapping. One request lists the recent runs of a whole repository;
   runs are grouped per workflow and each workflow contributes its
   latest relevant state — the repo is the "project", a workflow is
   the "plan". Unlike Bamboo, queued runs are visible here, so this
   adapter also serves the 'queued' catalog entry. */

const CAPABILITIES = ['failed', 'recovered', 'streak', 'running', 'queued', 'all', 'long'];
const DEFAULT_INTERESTS = ['failed', 'recovered'];
const HEADERS = { 'X-GitHub-Api-Version': '2022-11-28' };

function baseOf(url) { return String(url || '').replace(/\/+$/, ''); }

/* Repository coordinates are user input that lands inside a URL
   path: each segment is percent-encoded so a stray ?, # or % in
   the value can never reshape the request, and the accepted shape
   is the character set GitHub itself allows in owner/repo names.
   (The Bamboo adapter encodes the same way; keep the two in step.) */
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function repoPath(repo) {
  return String(repo || '').split('/').map(encodeURIComponent).join('/');
}

function repoUrl(base, repo) {
  return `${baseOf(base)}/repos/${repoPath(repo)}`;
}

function workflowsUrl(base, repo) {
  return `${baseOf(base)}/repos/${repoPath(repo)}/actions/workflows?per_page=100`;
}

function parseWorkflows(json) {
  const list = json && Array.isArray(json.workflows) ? json.workflows : [];
  return list
    .filter((w) => w && w.id != null && typeof w.name === 'string')
    .map((w) => ({ id: String(w.id), name: w.name }));
}

function runsUrl(base, repo, perPage) {
  const n = Math.max(1, Math.min(100, perPage || 30));
  return `${baseOf(base)}/repos/${repoPath(repo)}/actions/runs?per_page=${n}`;
}

function parseTime(v) {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

function parseRuns(json) {
  const list = json && Array.isArray(json.workflow_runs) ? json.workflow_runs : [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object' || r.id == null) continue;
    out.push({
      id: String(r.id),
      workflowId: r.workflow_id != null ? String(r.workflow_id) : '',
      workflowName: typeof r.name === 'string' ? r.name : '',
      runNumber: Number.isFinite(r.run_number) ? r.run_number : null,
      status: typeof r.status === 'string' ? r.status : '',
      conclusion: typeof r.conclusion === 'string' ? r.conclusion : '',
      branch: typeof r.head_branch === 'string' ? r.head_branch : '',
      createdMs: parseTime(r.created_at),
      startedMs: parseTime(r.run_started_at || r.created_at),
      updatedMs: parseTime(r.updated_at),
      link: typeof r.html_url === 'string' ? r.html_url : '',
    });
  }
  return out; // the API returns newest first; keep that order
}

function isFailure(run) {
  return run.status === 'completed' && (run.conclusion === 'failure' || run.conclusion === 'timed_out');
}
function isSuccess(run) {
  return run.status === 'completed' && run.conclusion === 'success';
}

/* Rows for one workflow's runs (newest first), mirroring the
   Bamboo adapter's interests semantics. */
function rowsForWorkflow(wfRuns, opts) {
  const { interests, nowMs, longMinutes, labels, defaultBranch } = opts;
  const wants = new Set(Array.isArray(interests) && interests.length ? interests : DEFAULT_INTERESTS);
  const L = labels || {};
  const rows = [];
  if (!wfRuns.length) return rows;
  const name = wfRuns[0].workflowName || 'workflow';
  const titleOf = (r, suffix) =>
    `${name} #${r.runNumber != null ? r.runNumber : '?'}${r.branch && defaultBranch && r.branch !== defaultBranch ? ` (${r.branch})` : ''}${suffix || ''}`;
  const push = (r, ciFailed, suffix) => rows.push({
    guid: `gh-${r.id}`,
    title: titleOf(r, suffix),
    link: r.link || '',
    timeMs: r.updatedMs != null ? r.updatedMs : (r.createdMs != null ? r.createdMs : nowMs),
    ciFailed,
  });

  if (wants.has('all')) {
    for (const r of wfRuns) push(r, isFailure(r) ? true : (isSuccess(r) ? false : null));
    return rows;
  }

  const latest = wfRuns[0];
  if (latest.status === 'queued') {
    if (wants.has('queued')) push(latest, false, L.queued ? ` — ${L.queued}` : '');
    return rows;
  }
  if (latest.status === 'in_progress') {
    const overLong = latest.startedMs != null && (nowMs - latest.startedMs) > (longMinutes || 60) * 60000;
    if (wants.has('running') || (wants.has('long') && overLong)) {
      push(latest, false, overLong && L.long ? ` — ${L.long}` : (L.running ? ` — ${L.running}` : ''));
    }
    return rows;
  }
  if (latest.status !== 'completed') return rows;

  const completed = wfRuns.filter((r) => r.status === 'completed');
  let failCount = 0;
  for (const r of completed) { if (isFailure(r)) failCount++; else break; }

  if (isFailure(latest)) {
    if (wants.has('failed') || (wants.has('streak') && failCount >= 2)) {
      push(latest, true, failCount >= 2 && wants.has('streak') && L.streak ? ` — ${L.streak(failCount)}` : '');
    }
  } else if (isSuccess(latest) && completed[1] && isFailure(completed[1]) && wants.has('recovered')) {
    push(latest, false, L.recovered ? ` — ${L.recovered}` : '');
  }
  return rows;
}

function buildRows(opts) {
  const { runs, interests, nowMs, longMinutes, labels, defaultBranch } = opts || {};
  const byWorkflow = new Map();
  for (const r of runs || []) {
    const key = r.workflowId || r.workflowName;
    if (!byWorkflow.has(key)) byWorkflow.set(key, []);
    byWorkflow.get(key).push(r);
  }
  const rows = [];
  for (const wfRuns of byWorkflow.values()) {
    rows.push(...rowsForWorkflow(wfRuns, { interests, nowMs, longMinutes, labels, defaultBranch }));
  }
  return rows;
}

/* Engine-facing entry. Target: { repo: "owner/name",
   workflows?: [names or ids], branches?: mainline|include|only,
   longMinutes }. The repo's default branch is looked up whenever
   the branch scope is not "include". */
async function collect(fetchJson, rec, ctx) {
  const target = rec.target || {};
  const repo = target.repo;
  const scope = target.branches || 'mainline';
  let defaultBranch = '';
  if (scope !== 'include') {
    const info = await fetchJson(repoUrl(rec.url, repo));
    if (info && typeof info.default_branch === 'string') defaultBranch = info.default_branch;
  }
  /* The widest window the API allows: with the old 30-run window,
     a busy repository could push a quiet workflow's latest run out
     of the listing entirely, and that workflow silently vanished
     from the board. */
  let runs = parseRuns(await fetchJson(runsUrl(rec.url, repo, 100)));
  if (scope === 'mainline' && defaultBranch) runs = runs.filter((r) => r.branch === defaultBranch);
  if (scope === 'only' && defaultBranch) runs = runs.filter((r) => r.branch !== defaultBranch);
  const wf = Array.isArray(target.workflows) ? target.workflows.map(String) : [];
  if (wf.length) runs = runs.filter((r) => wf.includes(r.workflowName) || wf.includes(r.workflowId));
  const items = buildRows({
    runs, interests: rec.interests, nowMs: ctx.nowMs,
    longMinutes: target.longMinutes, labels: ctx.labels, defaultBranch,
  });
  return { items, feedTitle: repo };
}

module.exports = { CAPABILITIES, DEFAULT_INTERESTS, HEADERS, REPO_PATTERN, repoUrl, workflowsUrl, parseWorkflows, runsUrl, parseRuns, buildRows, collect };

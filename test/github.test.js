'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runsUrl, parseRuns, buildRows, collect } = require('../src/github');

const LABELS = {
  running: 'running',
  long: 'long-running',
  recovered: 'recovered',
  queued: 'queued',
  streak: (n) => `${n} failed in a row`,
};

function run(id, wf, n, status, conclusion, extra) {
  return Object.assign({
    id, workflow_id: wf.id, name: wf.name, run_number: n,
    status, conclusion,
    head_branch: 'main',
    created_at: '2026-11-16T01:00:00Z',
    run_started_at: '2026-11-16T01:00:05Z',
    updated_at: '2026-11-16T01:05:00Z',
    html_url: `https://github.com/o/r/actions/runs/${id}`,
  }, extra || {});
}

const CI = { id: 1, name: 'CI' };
const REL = { id: 2, name: 'release' };

test('urls target the repo runs endpoint', () => {
  assert.equal(runsUrl('https://api.github.com/', 'o/r', 30), 'https://api.github.com/repos/o/r/actions/runs?per_page=30');
});

test('parseRuns normalises the workflow_runs list', () => {
  const runs = parseRuns({ total_count: 1, workflow_runs: [run(10, CI, 7, 'completed', 'failure')] });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, '10');
  assert.equal(runs[0].workflowName, 'CI');
  assert.equal(runs[0].runNumber, 7);
  assert.equal(runs[0].branch, 'main');
  assert.deepEqual(parseRuns({}), []);
});

test('rows are grouped per workflow: failure in CI, recovery in release', () => {
  const runs = parseRuns({ workflow_runs: [
    run(12, CI, 8, 'completed', 'failure'),
    run(11, REL, 3, 'completed', 'success'),
    run(10, CI, 7, 'completed', 'success'),
    run(9, REL, 2, 'completed', 'failure'),
  ] });
  const rows = buildRows({ runs, interests: ['failed', 'recovered'], nowMs: 0, labels: LABELS, defaultBranch: 'main' });
  assert.equal(rows.length, 2);
  const ci = rows.find((r) => r.title.startsWith('CI'));
  const rel = rows.find((r) => r.title.startsWith('release'));
  assert.equal(ci.ciFailed, true);
  assert.equal(ci.title, 'CI #8');
  assert.equal(rel.ciFailed, false);
  assert.equal(rel.title, 'release #3 — recovered');
});

test('queued is served by this adapter, running honours the long threshold', () => {
  const nowMs = Date.parse('2026-11-16T03:00:00Z');
  const q = parseRuns({ workflow_runs: [run(12, CI, 8, 'queued', null)] });
  const qRows = buildRows({ runs: q, interests: ['queued'], nowMs, labels: LABELS, defaultBranch: 'main' });
  assert.equal(qRows.length, 1);
  assert.equal(qRows[0].title, 'CI #8 — queued');
  const longRun = parseRuns({ workflow_runs: [run(12, CI, 8, 'in_progress', null)] });
  assert.equal(buildRows({ runs: longRun, interests: ['long'], nowMs, longMinutes: 60, labels: LABELS, defaultBranch: 'main' }).length, 1);
  assert.deepEqual(buildRows({ runs: longRun, interests: ['failed'], nowMs, labels: LABELS, defaultBranch: 'main' }), []);
});

test('branch suffix appears only for non-default branches', () => {
  const runs = parseRuns({ workflow_runs: [
    run(12, CI, 8, 'completed', 'failure', { head_branch: 'feature/x' }),
    run(11, CI, 7, 'completed', 'success'),
  ] });
  const rows = buildRows({ runs, interests: ['failed'], nowMs: 0, labels: LABELS, defaultBranch: 'main' });
  assert.equal(rows[0].title, 'CI #8 (feature/x)');
});

test('collect filters by branch scope and workflow selection', async () => {
  const all = { workflow_runs: [
    run(14, CI, 9, 'completed', 'failure', { head_branch: 'dev' }),
    run(13, CI, 8, 'completed', 'failure'),
    run(12, REL, 4, 'completed', 'failure'),
  ] };
  const fetchJson = async (url) => {
    if (url.includes('/actions/runs')) return all;
    return { default_branch: 'main' };
  };
  const rec = { url: 'https://api.github.com', target: { repo: 'o/r' }, interests: ['failed'] };
  const main = await collect(fetchJson, rec, { nowMs: 0, labels: LABELS });
  assert.deepEqual(main.items.map((r) => r.title), ['CI #8', 'release #4 — recovered'.replace(' — recovered', '')].map((t) => t));
  const onlyWf = await collect(fetchJson, { ...rec, target: { repo: 'o/r', branches: 'include', workflows: ['release'] } }, { nowMs: 0, labels: LABELS });
  assert.equal(onlyWf.items.length, 1);
  assert.ok(onlyWf.items[0].title.startsWith('release'));
  assert.equal(main.feedTitle, 'o/r');
});

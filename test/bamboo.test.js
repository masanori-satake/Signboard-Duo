'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectUrl, planResultsUrl, parseProjectPlans, parsePlanResults, buildRows } = require('../src/bamboo');

const LABELS = {
  running: 'running',
  long: 'long-running',
  recovered: 'recovered',
  streak: (n) => `${n} failed in a row`,
};

function result(n, state, lifeCycle, extra) {
  return Object.assign({
    buildResultKey: `PROJ-PLAN-${n}`,
    buildNumber: n,
    buildState: state,
    lifeCycleState: lifeCycle || 'Finished',
    buildStartedTime: '2026-11-16T01:00:00.000+09:00',
    buildCompletedTime: '2026-11-16T01:05:00.000+09:00',
    link: { href: `https://bamboo.example/browse/PROJ-PLAN-${n}`, rel: 'self' },
    plan: { key: 'PROJ-PLAN', name: 'Plan' },
  }, extra || {});
}

function feedJson(list) {
  return { results: { size: list.length, 'max-result': 5, 'start-index': 0, result: list } };
}

test('urls are built from the base without a trailing slash problem', () => {
  assert.equal(projectUrl('https://h/bamboo/', 'PROJ'), 'https://h/bamboo/rest/api/latest/project/PROJ.json?expand=plans');
  assert.equal(planResultsUrl('https://h/bamboo', 'PROJ-PLAN', 5), 'https://h/bamboo/rest/api/latest/result/PROJ-PLAN.json?max-results=5');
});

test('parseProjectPlans reads the expanded plans list', () => {
  const json = { key: 'PROJ', name: 'Project', plans: { size: 2, plan: [{ key: 'PROJ-A', name: 'A' }, { key: 'PROJ-B' }, { name: 'no key' }] } };
  assert.deepEqual(parseProjectPlans(json), [{ key: 'PROJ-A', name: 'A' }, { key: 'PROJ-B', name: 'PROJ-B' }]);
  assert.deepEqual(parseProjectPlans({}), []);
});

test('parsePlanResults normalises and sorts newest first', () => {
  const { planName, results } = parsePlanResults(feedJson([result(9, 'Successful'), result(11, 'Failed'), result(10, 'Successful')]));
  assert.equal(planName, 'Plan');
  assert.deepEqual(results.map((r) => r.number), [11, 10, 9]);
  assert.equal(results[0].key, 'PROJ-PLAN-11');
  assert.equal(results[0].completedMs, Date.parse('2026-11-16T01:05:00.000+09:00'));
});

test('failed interest: a failed latest build becomes a cancelled row', () => {
  const { results } = parsePlanResults(feedJson([result(11, 'Failed'), result(10, 'Successful')]));
  const rows = buildRows({ planKey: 'PROJ-PLAN', planName: 'Plan', results, interests: ['failed'], nowMs: 0, labels: LABELS });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].guid, 'PROJ-PLAN-11');
  assert.equal(rows[0].ciFailed, true);
  assert.equal(rows[0].title, 'Plan #11');
});

test('default interests cover failure and recovery, not plain success', () => {
  const okLatest = parsePlanResults(feedJson([result(11, 'Successful'), result(10, 'Successful')])).results;
  assert.deepEqual(buildRows({ planKey: 'P', results: okLatest, interests: null, nowMs: 0, labels: LABELS }), []);
  const recovered = parsePlanResults(feedJson([result(11, 'Successful'), result(10, 'Failed')])).results;
  const rows = buildRows({ planKey: 'P', planName: 'Plan', results: recovered, interests: null, nowMs: 0, labels: LABELS });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Plan #11 — recovered');
  assert.equal(rows[0].ciFailed, false);
});

test('streak interest annotates consecutive failures', () => {
  const { results } = parsePlanResults(feedJson([result(13, 'Failed'), result(12, 'Failed'), result(11, 'Failed'), result(10, 'Successful')]));
  const rows = buildRows({ planKey: 'P', planName: 'Plan', results, interests: ['streak'], nowMs: 0, labels: LABELS });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Plan #13 — 3 failed in a row');
  const oneFail = parsePlanResults(feedJson([result(13, 'Failed'), result(12, 'Successful')])).results;
  assert.deepEqual(buildRows({ planKey: 'P', results: oneFail, interests: ['streak'], nowMs: 0, labels: LABELS }), []);
});

test('running and long-running interests read the in-progress build', () => {
  const started = '2026-11-16T01:00:00.000+09:00';
  const nowMs = Date.parse('2026-11-16T03:30:00.000+09:00');
  const { results } = parsePlanResults(feedJson([
    result(11, 'Unknown', 'InProgress', { buildStartedTime: started, buildCompletedTime: undefined }),
    result(10, 'Successful'),
  ]));
  const running = buildRows({ planKey: 'P', planName: 'Plan', results, interests: ['running'], nowMs, labels: LABELS });
  assert.equal(running.length, 1);
  assert.equal(running[0].title, 'Plan #11 — long-running');
  assert.equal(running[0].timeMs, Date.parse(started));
  // "long" alone also catches it once over the threshold...
  assert.equal(buildRows({ planKey: 'P', planName: 'Plan', results, interests: ['long'], nowMs, longMinutes: 60, labels: LABELS }).length, 1);
  // ...but a failures-only watcher hears nothing about it.
  assert.deepEqual(buildRows({ planKey: 'P', results, interests: ['failed'], nowMs, labels: LABELS }), []);
});

test('all interest emits one row per result with per-build verdicts', () => {
  const { results } = parsePlanResults(feedJson([result(11, 'Failed'), result(10, 'Successful'), result(9, 'Failed')]));
  const rows = buildRows({ planKey: 'P', planName: 'Plan', results, interests: ['all'], nowMs: 0, labels: LABELS });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.ciFailed), [true, false, true]);
});

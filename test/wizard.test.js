'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { presetInterests, catalogFor, slugify, uniqueFeedId } = require('../src/wizard');
const bamboo = require('../src/bamboo');
const github = require('../src/github');

test('presets only offer what the adapter can serve', () => {
  // Bamboo cannot serve 'queued', so the operations preset drops it.
  assert.deepEqual(presetInterests('operations', bamboo.CAPABILITIES), ['failed', 'long']);
  assert.deepEqual(presetInterests('operations', github.CAPABILITIES), ['failed', 'long', 'queued']);
  assert.deepEqual(presetInterests('changes', bamboo.CAPABILITIES), ['failed', 'recovered']);
  assert.deepEqual(presetInterests('nope', github.CAPABILITIES), []);
});

test('catalogFor filters the catalog by capability, in catalog order', () => {
  assert.deepEqual(catalogFor(bamboo.CAPABILITIES), ['failed', 'recovered', 'streak', 'running', 'long', 'all']);
  assert.deepEqual(catalogFor(github.CAPABILITIES), ['failed', 'recovered', 'streak', 'running', 'queued', 'long', 'all']);
});

test('slugify and uniqueFeedId produce valid, collision-free ids', () => {
  assert.equal(slugify('Signboard-Duo'), 'signboard-duo');
  assert.equal(slugify('Office LUI / VOS'), 'office-lui-vos');
  assert.equal(slugify(''), 'feed');
  assert.equal(uniqueFeedId('github-x', ['github-y']), 'github-x');
  assert.equal(uniqueFeedId('github-x', ['github-x', 'github-x-2']), 'github-x-3');
});

test('browse helpers parse project and workflow lists', () => {
  assert.deepEqual(
    bamboo.parseProjects({ projects: { size: 1, project: [{ key: 'OFF', name: 'Office' }, { name: 'x' }] } }),
    [{ key: 'OFF', name: 'Office' }]
  );
  assert.equal(bamboo.projectsUrl('https://h/b/'), 'https://h/b/rest/api/latest/project.json');
  assert.deepEqual(
    github.parseWorkflows({ total_count: 1, workflows: [{ id: 42, name: 'CI' }, { id: 43 }] }),
    [{ id: '42', name: 'CI' }]
  );
  assert.equal(github.workflowsUrl('https://api.github.com', 'o/r'), 'https://api.github.com/repos/o/r/actions/workflows?per_page=100');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify, uniqueFeedId, normalizeRepoInput, normalizeBaseUrl, storedTokenApplies, shouldDropStoredToken } = require('../src/wizard');
const bamboo = require('../src/bamboo');
const github = require('../src/github');

test('slugify and uniqueFeedId produce valid, collision-free ids', () => {
  assert.equal(slugify('Signboard-Duo'), 'signboard-duo');
  assert.equal(slugify('Office LUI / VOS'), 'office-lui-vos');
  assert.equal(slugify(''), 'feed');
  assert.equal(uniqueFeedId('github-x', ['github-y']), 'github-x');
  assert.equal(uniqueFeedId('github-x', ['github-x', 'github-x-2']), 'github-x-3');
});

test('pasted browser URLs are normalised', () => {
  assert.equal(normalizeRepoInput('owner/repo'), 'owner/repo');
  assert.equal(normalizeRepoInput('https://github.com/owner/repo'), 'owner/repo');
  assert.equal(normalizeRepoInput('https://github.com/owner/repo/actions/workflows/ci.yml'), 'owner/repo');
  assert.equal(normalizeRepoInput('https://ghe.example.com/owner/repo.git'), 'owner/repo');
  assert.equal(normalizeBaseUrl('https://bamboo.example.com/bamboo/'), 'https://bamboo.example.com/bamboo');
  assert.equal(normalizeBaseUrl('https://bamboo.example.com/bamboo/rest/api/latest/plan/ABC'), 'https://bamboo.example.com/bamboo');
  assert.equal(normalizeBaseUrl('https://api.github.com'), 'https://api.github.com');
});

/* Audit 2026-11-20 F2: the stored token may only be filled in
   while the setup form still points at the server it was saved
   for — never after the form is repointed at another instance. */
test('storedTokenApplies requires the same normalised base', () => {
  assert.equal(storedTokenApplies('https://bamboo.example.com/bamboo', 'https://bamboo.example.com/bamboo'), true);
  assert.equal(storedTokenApplies('https://bamboo.example.com/bamboo/', 'https://bamboo.example.com/bamboo'), true);
  assert.equal(storedTokenApplies('https://bamboo.example.com/bamboo/rest/api/latest/plan/ABC', 'https://bamboo.example.com/bamboo'), true);
  assert.equal(storedTokenApplies('https://api.github.com', 'https://api.github.com'), true);
  assert.equal(storedTokenApplies('https://other.example.com/bamboo', 'https://bamboo.example.com/bamboo'), false);
  assert.equal(storedTokenApplies('http://bamboo.example.com/bamboo', 'https://bamboo.example.com/bamboo'), false);
  assert.equal(storedTokenApplies('https://ghe.example.com/api/v3', 'https://api.github.com'), false);
  assert.equal(storedTokenApplies('', 'https://bamboo.example.com/bamboo'), false);
  assert.equal(storedTokenApplies('https://bamboo.example.com/bamboo', ''), false);
  assert.equal(storedTokenApplies(undefined, undefined), false);
});

/* Regression (PR #1 review): after an edit-save repoints a feed
   from server A to server B, the host compares against the SAVED
   entry's url (setupEditFeed is re-synced on save). With the saved
   url at B, the stored token — already updated to B's — applies
   to B's loads and never to A's. */
test('storedTokenApplies after repointing A to B applies to B only', () => {
  const savedUrlAfterEdit = 'https://b.example.com/bamboo';
  assert.equal(storedTokenApplies('https://b.example.com/bamboo', savedUrlAfterEdit), true);
  assert.equal(storedTokenApplies('https://a.example.com/bamboo', savedUrlAfterEdit), false);
});

/* The other half of the repoint case (PR #1 review, second
   round): when the save itself repoints the feed and the token
   field is empty, the stored token belongs to the OLD server and
   must be dropped instead of carried over to the new one. */
test('shouldDropStoredToken drops only on repoint with empty token field', () => {
  const A = 'https://a.example.com/bamboo';
  const B = 'https://b.example.com/bamboo';
  assert.equal(shouldDropStoredToken(A, B, '', 'bearer'), true);
  assert.equal(shouldDropStoredToken(A, B, '', 'basic'), true);
  assert.equal(shouldDropStoredToken(A, B, '', 'header'), true);
  assert.equal(shouldDropStoredToken(A, A, '', 'bearer'), false);
  assert.equal(shouldDropStoredToken(A, 'https://a.example.com/bamboo/', '', 'bearer'), false);
  assert.equal(shouldDropStoredToken(A, 'https://a.example.com/bamboo/rest/api/latest/plan/ABC', '', 'bearer'), false);
  assert.equal(shouldDropStoredToken(A, B, 'new-token', 'bearer'), false);
  assert.equal(shouldDropStoredToken(A, B, '', 'none'), false);
  assert.equal(shouldDropStoredToken(A, B, '', ''), false);
  assert.equal(shouldDropStoredToken('', B, '', 'bearer'), false);
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

'use strict';

/* Pure helpers for the CI platform setup wizard (design §16):
   the news catalog, its presets, and feed-id generation. The
   wizard itself lives in extension.js; everything testable
   without vscode lives here. */

const CATALOG = ['failed', 'recovered', 'streak', 'running', 'queued', 'long', 'all', 'first'];

const PRESETS = {
  'errors-only': ['failed'],
  changes: ['failed', 'recovered'],
  operations: ['failed', 'long', 'queued'],
  all: ['all'],
};

const PRESET_ORDER = ['errors-only', 'changes', 'operations', 'all'];

/* A preset only ever offers what the adapter can serve. */
function presetInterests(preset, capabilities) {
  const base = PRESETS[preset] || [];
  const caps = new Set(capabilities || []);
  return base.filter((i) => caps.has(i));
}

function catalogFor(capabilities) {
  const caps = new Set(capabilities || []);
  return CATALOG.filter((i) => caps.has(i));
}

function slugify(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'feed';
}

function uniqueFeedId(base, existingIds) {
  const taken = new Set(existingIds || []);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* Accept a pasted browser URL for a repository
   (https://github.com/owner/repo/...) as well as plain owner/name. */
function normalizeRepoInput(value) {
  const v = String(value || '').trim();
  const m = v.match(/^https?:\/\/[^/]+\/([^/\s]+)\/([^/\s#?]+)/);
  if (m) return `${m[1]}/${m[2].replace(/\.git$/, '')}`;
  return v;
}

/* Accept a pasted Bamboo page URL as the API base: a URL that
   reaches into /rest/api/ is cut back to the context root. */
function normalizeBaseUrl(value) {
  let v = String(value || '').trim().replace(/\/+$/, '');
  const idx = v.indexOf('/rest/api/');
  if (idx > 0) v = v.slice(0, idx);
  return v;
}

module.exports = { CATALOG, PRESETS, PRESET_ORDER, presetInterests, catalogFor, slugify, uniqueFeedId, normalizeRepoInput, normalizeBaseUrl };

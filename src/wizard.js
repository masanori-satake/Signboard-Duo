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

module.exports = { CATALOG, PRESETS, PRESET_ORDER, presetInterests, catalogFor, slugify, uniqueFeedId };

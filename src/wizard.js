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

/* Whether the setup form still points at the server a feed's
   stored token was saved for. While an existing feed is edited,
   the form's base URL is a free field: if the user repoints it
   at another instance and loads a project / plan / workflow
   list, the stored token must not ride along to the new server
   — the token field reads empty, so the send would be silent.
   Both sides go through normalizeBaseUrl, the same
   normalisation the save path applies before storing a feed's
   url, so a trailing slash or a pasted /rest/api/ page URL on
   either side still counts as the same server. */
function storedTokenApplies(formBase, savedUrl) {
  const a = normalizeBaseUrl(formBase);
  const b = normalizeBaseUrl(savedUrl);
  return !!a && !!b && a === b;
}

/* Whether an edit-save must drop the feed's stored token instead
   of carrying it over. Tokens are keyed by feed id, not by URL,
   so repointing a feed at another server while leaving the token
   field empty would silently carry the old server's token to the
   new one — and once the edit form is re-synced to the saved
   entry, storedTokenApplies would happily match it there. A token
   typed into the form replaces the stored one on save, and the
   auth-type "none" case is deleted by its own branch, so the
   drop applies only to: destination changed, token field empty,
   auth still in use. */
function shouldDropStoredToken(savedUrl, formBase, tokenField, authType) {
  if (tokenField) return false;
  if (!authType || authType === 'none') return false;
  const a = normalizeBaseUrl(savedUrl);
  const b = normalizeBaseUrl(formBase);
  return !!a && !!b && a !== b;
}

module.exports = { CATALOG, PRESETS, PRESET_ORDER, slugify, uniqueFeedId, normalizeRepoInput, normalizeBaseUrl, storedTokenApplies, shouldDropStoredToken };

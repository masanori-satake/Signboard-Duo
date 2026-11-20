'use strict';

/* Regression tests for the edit-save token-drop flow (src/extension.js):
   repointing a feed at another server with the token field left empty
   drops the stored token before the settings update. If that update is
   rejected, the token must be restored — the settings still point at
   the old server. `vscode` is stubbed via Module._load before the
   extension module is required; the handlers are reached through the
   _test seam exported for this purpose. */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { TokenStore } = require('../src/tokens');

function fakeSecrets() {
  const map = new Map();
  return {
    map,
    failTokenStore: false,
    async get(k) { return map.has(k) ? map.get(k) : undefined; },
    async store(k, v) {
      if (this.failTokenStore && k.startsWith('feed-token:')) throw new Error('secret store failed');
      map.set(k, v);
    },
    async delete(k) { map.delete(k); },
  };
}

/* In-memory user settings: `feeds` is the global value; `update` can
   be made to reject to simulate a settings write failure. */
function makeConfig(initialFeeds) {
  let current = initialFeeds;
  const posted = [];
  const panel = {
    webview: {
      postMessage: async (m) => { posted.push(m); return true; },
      onDidReceiveMessage: () => ({ dispose() {} }),
      asWebviewUri: (u) => u,
      cspSource: 'none',
    },
    onDidDispose: () => ({ dispose() {} }),
    dispose: () => {},
  };
  const cfg = {
    failUpdate: false,
    failFirstUpdate: false,
    blockFirstUpdate: null,
    _firstUpdateDone: false,
    infoMessages: [],
    errorMessages: [],
    posted,
    panel,
    inspect(key) {
      if (key !== 'feeds') return undefined;
      return { globalValue: current };
    },
    get(key) { return key === 'feeds' ? current : undefined; },
    async update(key, value) {
      if (cfg.failUpdate) throw new Error('settings update rejected');
      if (cfg.failFirstUpdate && !cfg._firstUpdateDone) {
        cfg._firstUpdateDone = true;
        if (cfg.blockFirstUpdate) await cfg.blockFirstUpdate;
        throw new Error('settings update rejected');
      }
      if (key === 'feeds') current = value;
    },
  };
  return cfg;
}

const cfgHolder = { current: null };
const fakeVscode = {
  env: { language: 'en' },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ViewColumn: { Active: 1 },
  Uri: { joinPath: (...parts) => parts.join('/') },
  workspace: { getConfiguration: () => cfgHolder.current },
  window: {
    showInformationMessage: async (m) => { cfgHolder.current.infoMessages.push(m); return undefined; },
    showErrorMessage: async (m) => { cfgHolder.current.errorMessages.push(m); return undefined; },
    createWebviewPanel: () => cfgHolder.current.panel,
  },
};

const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, ...args);
};
const { _test: { handleSetupMessage, openSetupPanel } } = require('../src/extension');
Module._load = originalLoad;

const OLD_URL = 'https://a.example.com/feed.xml';
const NEW_URL = 'https://b.example.com/feed.xml';

function editFeed() {
  return {
    id: 'feed-a', type: 'rss', url: OLD_URL,
    auth: { type: 'bearer' }, name: 'Feed A',
    enabled: true, rotate: true, maxItems: 10, keepHours: 24,
  };
}

function saveMessage() {
  return {
    type: 'save',
    data: {
      type: 'rss', base: NEW_URL, authType: 'bearer', token: '',
      name: 'Feed A', position: 1,
    },
  };
}

async function setup() {
  const secrets = fakeSecrets();
  const tokens = new TokenStore(secrets);
  await tokens.set('feed-a', 'old-token');
  const cfg = makeConfig([editFeed()]);
  cfgHolder.current = cfg;
  const engine = { refreshAll: async () => {} };
  const context = { extensionUri: { fsPath: '/fake' } };
  openSetupPanel(engine, tokens, context, editFeed());
  return { secrets, tokens, cfg, engine };
}

test('repoint save with a rejected settings update restores the dropped token', async () => {
  const { tokens, cfg } = await setup();
  cfg.failUpdate = true;
  const panel = cfg.panel;
  await handleSetupMessage(panel, { refreshAll: async () => {} }, tokens, saveMessage());
  // The token is back, the settings still point at the old server,
  // and the form was told the save failed.
  assert.equal(await tokens.get('feed-a'), 'old-token');
  assert.equal(await tokens.has('feed-a'), true);
  assert.deepEqual(cfg.inspect('feeds').globalValue.map((f) => f.url), [OLD_URL]);
  assert.equal(cfg.posted.filter((m) => m.type === 'error').length, 1);
  assert.match(cfg.posted.find((m) => m.type === 'error').message, /settings update rejected/);
  assert.deepEqual(cfg.errorMessages, []);
});

test('repoint save drops the token once the settings update succeeds', async () => {
  const { tokens, cfg } = await setup();
  const panel = cfg.panel;
  await handleSetupMessage(panel, { refreshAll: async () => {} }, tokens, saveMessage());
  assert.equal(await tokens.has('feed-a'), false);
  assert.deepEqual(cfg.inspect('feeds').globalValue.map((f) => f.url), [NEW_URL]);
  assert.equal(cfg.posted.filter((m) => m.type === 'saved').length, 1);
});

test('a failed token restore is notified instead of going silent', async () => {
  const { secrets, tokens, cfg } = await setup();
  cfg.failUpdate = true;
  secrets.failTokenStore = true;
  const panel = cfg.panel;
  await handleSetupMessage(panel, { refreshAll: async () => {} }, tokens, saveMessage());
  // The token could not be put back; the user must be told to re-enter it.
  assert.equal(cfg.errorMessages.length, 1);
  assert.match(cfg.errorMessages[0], /restoring the deleted token failed/);
  assert.equal(cfg.posted.filter((m) => m.type === 'error').length, 1);
  assert.match(cfg.posted.find((m) => m.type === 'error').message, /restoring the deleted token failed/);
});

test('concurrent saves of the same feed are serialized: a failed first save must not restore its token onto the second save destination', async () => {
  const { tokens, cfg } = await setup();
  // The first settings update blocks until the test releases it, so the
  // second save is definitely in flight while the first is pending.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  cfg.failFirstUpdate = true;
  cfg.blockFirstUpdate = gate;
  const panel = cfg.panel;
  const engine = { refreshAll: async () => {} };
  const p1 = handleSetupMessage(panel, engine, tokens, saveMessage());
  const p2 = handleSetupMessage(panel, engine, tokens, saveMessage());
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await Promise.all([p1, p2]);
  // S1 failed and restored the token while the settings still pointed
  // at the old server; S2 then dropped it again when repointing. The
  // old token must not end up stored against the new destination.
  assert.equal(await tokens.has('feed-a'), false);
  assert.deepEqual(cfg.inspect('feeds').globalValue.map((f) => f.url), [NEW_URL]);
  assert.equal(cfg.posted.filter((m) => m.type === 'error').length, 1);
  assert.equal(cfg.posted.filter((m) => m.type === 'saved').length, 1);
});



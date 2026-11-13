'use strict';

/* Signboard-Duo extension host.
   Data layer: polls RSS / Atom feeds the user configured, normalises
   them into platforms (feeds) and rows (topics), and pushes them to the
   flap / LED renderers forked from Signboard-Solo. Read-only polling of
   user-configured URLs only; no telemetry, no other network traffic.
   Feed tokens live in SecretStorage, never in settings. */

const vscode = require('vscode');
const http = require('http');
const https = require('https');
const { parseFeed, parseQuotes } = require('./feedparse');
const { numberPlatforms, mergeFeedRows, platformState } = require('./model');

const CONFIG_NS = 'signboardDuo';
const STATE_KEY = 'signboardDuo.state.v1';
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 1024 * 1024;
const USER_AGENT = 'Signboard-Duo/0.1 (+https://marketplace.visualstudio.com/)';

function autoModeForWidth(width) {
  return Number.isFinite(width) && width >= 520 ? 'led' : 'flap';
}

/* ---------------- fetching ---------------- */

/* The site's own favicon (served from the feed's origin — no third
   party favicon service is involved). */
function faviconOf(url) {
  try { return new URL(url).origin + '/favicon.ico'; } catch (e) { return ''; }
}

function fetchOnce(urlStr, headers, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { reject(e); return; }
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.get(url, { headers, timeout: FETCH_TIMEOUT_MS }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        resolve(fetchOnce(new URL(res.headers.location, url).toString(), headers, redirectsLeft - 1));
        return;
      }
      if (status === 304) { res.resume(); resolve({ status, body: null, headers: res.headers }); return; }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size <= MAX_BODY_BYTES) chunks.push(c);
      });
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('fetch timeout')));
    req.on('error', reject);
  });
}

/* ---------------- feed engine ---------------- */

class FeedEngine {
  constructor(context, onChange) {
    this.context = context;
    this.onChange = onChange;
    this.feeds = [];        // runtime feed records
    this.timer = null;
    this.output = vscode.window.createOutputChannel('Signboard-Duo');
    this.authPrompted = new Set();
    this.restore();
  }

  log(msg) { this.output.appendLine(`[${new Date().toISOString()}] ${msg}`); }

  restore() {
    const saved = this.context.globalState.get(STATE_KEY, {});
    this.saved = saved && saved.feeds ? saved.feeds : {};
  }

  async persist() {
    const feeds = {};
    for (const f of this.feeds) {
      feeds[f.id] = {
        etag: f.etag || null,
        lastModified: f.lastModified || null,
        feedTitle: f.feedTitle || '',
        lastOkAt: f.lastOkAt || null,
        rows: [...f.snapshot.values()].map((r) => ({ ...r, isNew: false, updated: false })),
      };
    }
    await this.context.globalState.update(STATE_KEY, { feeds });
  }

  loadConfig() {
    const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
    const raw = cfg.get('feeds', []) || [];
    const seen = new Set();
    const records = [];
    raw.slice(0, 5).forEach((f, idx) => {
      if (raw.length > 5 && idx === 4) this.log('feeds: more than 5 configured; only the first 5 are used');
      const rec = {
        id: f && f.id, url: f && f.url, name: (f && f.name) || '',
        kind: (f && f.kind) || 'generic',
        enabled: !f || f.enabled !== false,
        maxItems: f && f.maxItems ? f.maxItems : 4,
        keepHours: f && f.keepHours ? f.keepHours : 24,
        auth: (f && f.auth) || { type: 'none' },
        configError: false, lastStatus: null, lastOkAt: null, lastErrorAt: null,
        feedTitle: '', snapshot: new Map(), rows: [],
        etag: null, lastModified: null,
      };
      if (!rec.id || !rec.url || !/^[a-z0-9-]+$/.test(rec.id)) rec.configError = true;
      else if (seen.has(rec.id)) { rec.configError = true; this.log(`feeds: duplicate id "${rec.id}"`); }
      else if (!/^https?:\/\//.test(rec.url)) rec.configError = true;
      seen.add(rec.id);
      const sv = this.saved[rec.id];
      if (sv) {
        rec.etag = sv.etag; rec.lastModified = sv.lastModified;
        rec.feedTitle = sv.feedTitle || ''; rec.lastOkAt = sv.lastOkAt || null;
        rec.snapshot = new Map((sv.rows || []).map((r) => [r.key, r]));
        rec.rows = [...rec.snapshot.values()].sort((a, b) => b.timeMs - a.timeMs).slice(0, rec.maxItems);
      }
      records.push(rec);
    });
    this.feeds = records;
    this.platforms = numberPlatforms(records);
  }

  pollMs() {
    const m = vscode.workspace.getConfiguration(CONFIG_NS).get('pollMinutes', 15);
    return Math.max(5, m) * 60 * 1000;
  }

  start() {
    this.loadConfig();
    this.refreshAll();
    const arm = () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => this.refreshAll(), this.pollMs());
    };
    arm();
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${CONFIG_NS}.feeds`)) { this.loadConfig(); this.refreshAll(); }
        if (e.affectsConfiguration(`${CONFIG_NS}.pollMinutes`)) arm();
      }),
      { dispose: () => { if (this.timer) clearInterval(this.timer); } }
    );
  }

  async authHeaders(rec) {
    const type = rec.auth && rec.auth.type ? rec.auth.type : 'none';
    if (type === 'none') return { headers: {}, missing: false };
    const secret = await this.context.secrets.get(`feed-token:${rec.id}`);
    if (!secret) return { headers: {}, missing: true };
    if (type === 'bearer') return { headers: { Authorization: `Bearer ${secret}` }, missing: false };
    if (type === 'basic') {
      const user = rec.auth.user || '';
      const b64 = Buffer.from(`${user}:${secret}`, 'utf8').toString('base64');
      return { headers: { Authorization: `Basic ${b64}` }, missing: false };
    }
    if (type === 'header') {
      const name = rec.auth.headerName || 'X-API-Key';
      return { headers: { [name]: secret }, missing: false };
    }
    return { headers: {}, missing: false };
  }

  async refreshAll() {
    for (const rec of this.feeds) {
      if (rec.enabled && !rec.configError) await this.refreshOne(rec);
    }
    this.onChange();
  }

  async refreshOne(rec) {
    const now = Date.now();
    try {
      const { headers: authH, missing } = await this.authHeaders(rec);
      if (missing) {
        rec.lastStatus = 401; rec.lastErrorAt = now;
        this.maybePromptToken(rec);
        return;
      }
      const headers = { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', ...authH };
      if (rec.etag) headers['If-None-Match'] = rec.etag;
      if (rec.lastModified) headers['If-Modified-Since'] = rec.lastModified;
      const res = await fetchOnce(rec.url, headers, MAX_REDIRECTS);
      rec.lastStatus = res.status;
      if (res.status === 304) { rec.lastOkAt = now; return; }
      if (res.status === 401 || res.status === 403) {
        rec.lastErrorAt = now;
        this.maybePromptToken(rec);
        return;
      }
      if (res.status !== 200 || res.body == null) {
        rec.lastErrorAt = now;
        this.log(`feed ${rec.id}: HTTP ${res.status}`);
        return;
      }
      const parsed = rec.kind === 'stock' ? parseQuotes(res.body) : parseFeed(res.body);
      rec.feedTitle = parsed.title || rec.feedTitle;
      if (res.headers.etag) rec.etag = res.headers.etag;
      if (res.headers['last-modified']) rec.lastModified = res.headers['last-modified'];
      const merged = mergeFeedRows(rec.id, parsed.items, rec.snapshot, now, {
        maxItems: rec.maxItems, keepHours: rec.keepHours,
      });
      rec.snapshot = merged.snapshot;
      rec.rows = merged.rows.map((r) => ({ ...r, status: this.rowStatus(rec, r) }));
      rec.lastOkAt = now;
      await this.persist();
    } catch (err) {
      rec.lastErrorAt = now;
      rec.lastStatus = rec.lastStatus || 0;
      this.log(`feed ${rec.id}: ${err && err.message ? err.message : err}`);
    }
  }

  /* bamboo kind: success/failure is read from the item title until the
     real workplace feed format is confirmed (post 2026-11-16); anything
     unrecognised falls back to the generic arrival treatment. */
  rowStatus(rec, row) {
    if (rec.kind === 'bamboo' && /\b(failed|failure|error)\b/i.test(row.title)) return 'failed';
    if (row.updated) return 'updated';
    if (row.isNew) return 'arrived';
    return 'ontime';
  }

  maybePromptToken(rec) {
    if (this.authPrompted.has(rec.id)) return;
    if (!rec.auth || !rec.auth.type || rec.auth.type === 'none') return;
    this.authPrompted.add(rec.id);
    vscode.window.showInformationMessage(
      `Signboard-Duo: feed "${rec.id}" needs a token.`,
      'Set Token'
    ).then((pick) => {
      if (pick === 'Set Token') vscode.commands.executeCommand('signboardDuo.setToken', rec.id);
    });
  }

  platformsPayload() {
    const now = Date.now();
    const poll = this.pollMs();
    const list = this.platforms
      .filter((p) => p.no != null)
      .map((p) => {
        const rec = this.feeds.find((f) => f.id === p.id);
        return {
          no: p.no,
          name: p.name || (rec && rec.feedTitle) || p.id,
          kind: p.kind,
          favicon: rec ? faviconOf(rec.url) : '',
          state: rec ? platformState(rec, now, poll) : 'loading',
          lastOkAt: rec && rec.lastOkAt ? rec.lastOkAt : null,
          rows: (rec ? rec.rows : []).map((r) => ({
            key: r.key, title: r.title, timeMs: r.timeMs,
            status: r.status || 'ontime', remark: r.remark || '',
            url: r.link || '', isNew: !!r.isNew,
            price: r.price != null ? r.price : null,
            change: r.change != null ? r.change : null,
            changePct: r.changePct != null ? r.changePct : null,
          })),
        };
      });
    if (!list.length) {
      // No feeds configured: still show a platform so the board can say
      // what is missing instead of sitting blank.
      list.push({ no: 1, name: 'Signboard-Duo', kind: 'generic', state: 'nofeeds', lastOkAt: null, rows: [] });
    }
    return list;
  }

  lastFetchedAt() {
    let latest = null;
    for (const f of this.feeds) {
      if (f.lastOkAt && (!latest || f.lastOkAt > latest)) latest = f.lastOkAt;
    }
    return latest;
  }

  dispose() { if (this.timer) clearInterval(this.timer); }
}

/* ---------------- webview provider (forked from Signboard-Solo) ---------------- */

class BoardProvider {
  constructor(context, engine) {
    this.context = context;
    this.engine = engine;
    this.view = null;
    this.lastSignature = '';
    this.tick = null;
    this.autoRenderer = 'flap';
    this.onRendererChange = null;
    this.pinned = false;
    this.theme = context.globalState.get('duoTheme', 'duo');
  }

  cycleTheme() {
    const order = ['duo', 'lime', 'ice'];
    const labels = { duo: 'Duo Green', lime: 'Lime', ice: 'Ice' };
    const next = order[(order.indexOf(this.theme) + 1) % order.length];
    this.theme = next;
    this.context.globalState.update('duoTheme', next);
    vscode.window.setStatusBarMessage(`Signboard-Duo theme: ${labels[next]}`, 2500);
    this.push(true);
  }

  navPlatform(dir) {
    if (this.view) this.view.webview.postMessage({ type: 'nav', dir });
  }

  setPinned(v) {
    this.pinned = !!v;
    vscode.commands.executeCommand('setContext', 'signboardDuo.pinned', this.pinned);
    if (this.view) this.view.webview.postMessage({ type: 'pin', pinned: this.pinned });
    this.push(true);
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg) => {
      if (!msg) return;
      if (msg.type === 'ready') this.push(true);
      if (msg.type === 'width') this.handleWidth(msg.width);
      if (msg.type === 'open' && msg.url && /^https?:\/\//.test(msg.url)) {
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
    });
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_NS) && this.view) {
        this.autoRenderer = 'flap';
        this.view.webview.html = this.html(this.view.webview);
        this.lastSignature = '';
        this.push(true);
      }
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.push(true); });
    this.tick = setInterval(() => this.push(false), 1000);
    view.onDidDispose(() => { if (this.tick) clearInterval(this.tick); });
    this.push(true);
  }

  configuredMode() {
    return vscode.workspace.getConfiguration(CONFIG_NS).get('mode', 'flap');
  }

  effectiveMode() {
    const mode = this.configuredMode();
    return mode === 'auto' ? this.autoRenderer : mode;
  }

  handleWidth(width) {
    if (!this.view || this.configuredMode() !== 'auto') return;
    const desired = autoModeForWidth(width);
    if (desired === this.autoRenderer) return;
    this.autoRenderer = desired;
    this.view.webview.html = this.html(this.view.webview);
    this.lastSignature = '';
    this.push(true);
  }

  push(force) {
    if (!this.view || !this.view.visible) return;
    const platforms = this.engine.platformsPayload();
    const mode = this.configuredMode();
    const scroll = vscode.workspace.getConfiguration(CONFIG_NS).get('scrollLongText', true);
    const payload = { type: 'state', platforms, lang: vscode.env.language, mode, scroll, fetchedAt: this.engine.lastFetchedAt(), pinned: this.pinned, theme: this.theme };
    const signature = JSON.stringify(payload);
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.view.webview.postMessage(payload);
  }

  notifyEvent(key) {
    if (this.view) this.view.webview.postMessage({ type: 'event', key });
    this.push(true);
  }

  html(webview) {
    const mode = this.configuredMode();
    const effectiveMode = this.effectiveMode();
    const led = effectiveMode === 'led';
    const stock = effectiveMode === 'stock';
    if (this.onRendererChange) this.onRendererChange(effectiveMode);
    const cssFile = led ? 'led.css' : stock ? 'stock.css' : 'board.css';
    const jsFile = led ? 'led.js' : stock ? 'stock.js' : 'board.js';
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', cssFile));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', jsFile));
    const nonce = String(Date.now()) + Math.floor(Math.random() * 1e9);
    const autoScript = mode === 'auto'
      ? `<script nonce="${nonce}">window.__SB_AUTO = true;</script>\n` : '';
    const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
    const ledScript = led
      ? `<script nonce="${nonce}">window.__SB_LED = ${JSON.stringify({
        pitch: cfg.get('ledPitch', 3), hole: cfg.get('ledHole', 38), glow: cfg.get('ledGlow', true),
      })};</script>\n` : '';
    const body = stock
      ? `<div class="board" id="board">
  <div class="board-head">
    <span class="title" id="boardTitle">QUOTES</span>
    <span class="clock" id="clock"></span>
  </div>
  <div class="platform" id="platform"></div>
  <div class="cols"><span class="c-name" id="colName">NAME</span><span class="c-price" id="colPrice">LAST</span><span class="c-chg" id="colChg">CHANGE</span><span class="c-time" id="colTime">TIME</span></div>
  <div id="rows"></div>
  <div class="board-foot"><span id="pageInfo"></span><span id="fetchInfo"></span></div>
</div>`
      : led
      ? `<div class="board" id="board">
  <div class="layer glow" id="glowLayer" aria-hidden="true"></div>
  <div class="layer" id="textLayer"></div>
  <div class="mask"></div>
  <div class="pages" id="pages"></div>
</div>`
      : `<div class="board" id="board">
  <div class="board-head">
    <span class="title">ARRIVALS</span>
    <span class="clock" id="clock"></span>
  </div>
  <div class="platform" id="platform"></div>
  <div class="cols"><span class="c-logo"></span><span class="c-name" id="colName">便名</span><span class="c-meta"><span class="c-time" id="colTime">到着時刻</span><span class="c-rem" id="colRemark">備考</span></span><span class="c-count" id="flightCount"></span></div>
  <div id="rows"></div>
  <div class="board-foot"><span id="pageInfo"></span><span id="fetchInfo"></span></div>
</div>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
</head>
<body>
${body}
${autoScript}${ledScript}<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

/* ---------------- commands ---------------- */

function syncModeContext(effectiveMode) {
  const mode = effectiveMode || vscode.workspace.getConfiguration(CONFIG_NS).get('mode', 'flap');
  vscode.commands.executeCommand('setContext', 'signboardDuo.isLed', mode === 'led');
  vscode.commands.executeCommand('setContext', 'signboardDuo.isFlap', mode === 'flap');
  vscode.commands.executeCommand('setContext', 'signboardDuo.isStock', mode === 'stock');
}

async function setMode(next) {
  const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
  const info = cfg.inspect('mode');
  const target = info && info.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await cfg.update('mode', next, target);
}

async function pickAuthFeed(engine, presetId) {
  if (presetId) return engine.feeds.find((f) => f.id === presetId) || null;
  const candidates = engine.feeds.filter((f) => f.auth && f.auth.type && f.auth.type !== 'none');
  if (!candidates.length) {
    vscode.window.showInformationMessage('Signboard-Duo: no feed has an auth type configured. Set "auth" in the signboardDuo.feeds setting first.');
    return null;
  }
  const pick = await vscode.window.showQuickPick(
    candidates.map((f) => ({ label: f.id, description: f.auth.type })),
    { placeHolder: 'Feed to set a token for' }
  );
  return pick ? candidates.find((f) => f.id === pick.label) : null;
}

function activate(context) {
  let provider;
  const engine = new FeedEngine(context, () => { if (provider) provider.push(true); });
  provider = new BoardProvider(context, engine);
  provider.onRendererChange = syncModeContext;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('signboardDuo.board', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('signboardDuo.showLed', () => setMode('led')),
    vscode.commands.registerCommand('signboardDuo.showFlap', () => setMode('flap')),
    vscode.commands.registerCommand('signboardDuo.showStock', () => setMode('stock')),
    vscode.commands.registerCommand('signboardDuo.refresh', async () => { await engine.refreshAll(); }),
    vscode.commands.registerCommand('signboardDuo.prevPlatform', () => provider.navPlatform(-1)),
    vscode.commands.registerCommand('signboardDuo.nextPlatform', () => provider.navPlatform(1)),
    vscode.commands.registerCommand('signboardDuo.cycleTheme', () => provider.cycleTheme()),
    vscode.commands.registerCommand('signboardDuo.pinPlatform', () => provider.setPinned(true)),
    vscode.commands.registerCommand('signboardDuo.unpinPlatform', () => provider.setPinned(false)),
    vscode.commands.registerCommand('signboardDuo.setToken', async (presetId) => {
      const rec = await pickAuthFeed(engine, presetId);
      if (!rec) return;
      const value = await vscode.window.showInputBox({
        prompt: `Token for feed "${rec.id}" (stored in SecretStorage, never in settings)`,
        password: true, ignoreFocusOut: true,
      });
      if (value) {
        await context.secrets.store(`feed-token:${rec.id}`, value);
        engine.authPrompted.delete(rec.id);
        await engine.refreshOne(rec);
        provider.push(true);
      }
    }),
    vscode.commands.registerCommand('signboardDuo.deleteToken', async () => {
      const rec = await pickAuthFeed(engine, null);
      if (!rec) return;
      await context.secrets.delete(`feed-token:${rec.id}`);
      vscode.window.showInformationMessage(`Signboard-Duo: token for "${rec.id}" deleted.`);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_NS}.mode`)) syncModeContext();
    }),
    { dispose: () => engine.dispose() }
  );
  syncModeContext();
  vscode.commands.executeCommand('setContext', 'signboardDuo.pinned', false);
  engine.start();
}

function deactivate() {}

module.exports = { activate, deactivate };

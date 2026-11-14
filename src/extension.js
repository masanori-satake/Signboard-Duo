'use strict';

/* Signboard-Duo extension host.
   Data layer: polls RSS / Atom feeds the user configured, normalises
   them into platforms (feeds) and rows (topics), and pushes them to the
   flap / LED renderers forked from Signboard-Solo. Read-only polling of
   user-configured URLs only; no telemetry, no other network traffic.
   Feed tokens live in SecretStorage, never in settings. */

const vscode = require('vscode');
const { parseFeed, parseQuotes, ciVerdict } = require('./feedparse');
const { fetchOnce, classifyError, proxyForUrl } = require('./net');
const { numberPlatforms, mergeFeedRows, platformState } = require('./model');

const CONFIG_NS = 'signboardDuo';
const JA = (vscode.env.language || '').toLowerCase().startsWith('ja');
const STATE_KEY = 'signboardDuo.state.v1';
const MAX_REDIRECTS = 5;
const FETCH_DEADLINE_MS = 30000;
let USER_AGENT = 'Signboard-Duo (+https://marketplace.visualstudio.com/)';

function autoModeForWidth(width) {
  return Number.isFinite(width) && width >= 520 ? 'led' : 'flap';
}

/* ---------------- fetching ---------------- */

/* The site's own favicon (served from the feed's origin — no third
   party favicon service is involved). */
const faviconCache = new Map();
function faviconOf(url) {
  if (faviconCache.has(url)) return faviconCache.get(url);
  let out = '';
  try { out = new URL(url).origin + '/favicon.ico'; } catch (e) { /* keep '' */ }
  faviconCache.set(url, out);
  return out;
}

/* ---------------- error diagnosis ----------------
   A failed platform explains itself on the board as a small article —
   what happened and the likely cause — and clicking it opens the
   matching troubleshooting anchor in the README (per language and
   symptom). The strings live here so all three renderers share them. */
const README_URL = 'https://github.com/masanori-satake/Signboard-Duo/blob/main/README.md';
const DIAG = {
  dns: { ja: ['サーバーが見つかりません', '名前解決に失敗しました。URL と DNS を確認してください'], en: ['SERVER NOT FOUND', 'DNS lookup failed. Check the URL and your DNS settings'] },
  connect: { ja: ['サーバーに接続できません', '接続が拒否されました。サーバーの稼働とファイアウォールを確認してください'], en: ['CANNOT CONNECT TO THE SERVER', 'The connection was refused. Check the server and the firewall'] },
  timeout: { ja: ['応答がありません', 'タイムアウトしました。ネットワークとプロキシを確認してください'], en: ['NO RESPONSE', 'The request timed out. Check the network and any proxy'] },
  tls: { ja: ['証明書エラーです', 'サーバーの証明書を検証できませんでした'], en: ['CERTIFICATE ERROR', 'The server certificate could not be verified'] },
  proxy: { ja: ['プロキシに接続できません', 'http.proxy のプロキシへ届きません。設定とプロキシの稼働を確認してください'], en: ['CANNOT REACH THE PROXY', 'The proxy in http.proxy did not answer. Check the setting and the proxy'] },
  'proxy-auth': { ja: ['プロキシ認証が必要です', 'プロキシが認証を要求しました（407）。http.proxy の資格情報を確認してください'], en: ['PROXY AUTHENTICATION REQUIRED', 'The proxy asked for credentials (407). Check http.proxy'] },
  http: { ja: ['サーバーエラーが返りました', 'フィードの URL とサーバーの状態を確認してください'], en: ['THE SERVER REPLIED WITH AN ERROR', 'Check the feed URL and the server'] },
  'feed-auth': { ja: ['認証が必要です', 'フィードが認証を要求しました。トークンの設定を確認してください'], en: ['AUTHENTICATION REQUIRED', 'The feed asked for credentials. Check the feed token'] },
  format: { ja: ['フィードを読めませんでした', 'RSS / Atom / JSON として解釈できませんでした'], en: ['UNREADABLE FEED', 'The response was not a readable RSS / Atom / JSON feed'] },
  config: { ja: ['設定エラーです', 'フィード設定（id と URL）を確認してください'], en: ['SETTINGS ERROR', 'Check the feed entry (id and URL)'] },
};
function diagFor(symptom, detail) {
  const d = DIAG[symptom] || DIAG.connect;
  const pair = JA ? d.ja : d.en;
  return {
    url: README_URL + (JA ? '#troubleshooting-ja-' : '#troubleshooting-') + symptom,
    title: pair[0],
    cause: symptom === 'http' && detail ? 'HTTP ' + detail + ' — ' + pair[1] : pair[1],
  };
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
    this.saved = saved && saved.feeds && typeof saved.feeds === 'object' ? saved.feeds : {};
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
    this.saved = feeds;
    await this.context.globalState.update(STATE_KEY, { feeds });
  }

  loadConfig() {
    const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
    const raw = cfg.get('feeds', []) || [];
    const seen = new Set();
    const records = [];
    raw.slice(0, 20).forEach((f, idx) => {
      if (raw.length > 20 && idx === 19) this.log('feeds: more than 20 configured; only the first 20 are used');
      const rec = {
        id: f && f.id, url: f && f.url, name: (f && f.name) || '',
        kind: f && f.kind === 'bamboo' ? 'ci' : (f && f.kind) || 'generic', // bamboo was absorbed into ci (1.2.0)
        enabled: !f || f.enabled !== false,
        maxItems: f && f.maxItems ? f.maxItems : 4,
        keepHours: f && f.keepHours ? f.keepHours : 24,
        auth: (f && f.auth) || { type: 'none' },
        configError: false, lastStatus: null, lastOkAt: null, lastErrorAt: null, lastError: null,
        feedTitle: '', snapshot: new Map(), rows: [],
        etag: null, lastModified: null,
      };
      if (!rec.id || !rec.url || !/^[a-z0-9-]+$/.test(rec.id)) rec.configError = true;
      else if (seen.has(rec.id)) { rec.configError = true; this.log(`feeds: duplicate id "${rec.id}"`); }
      else if (!/^https?:\/\//.test(rec.url)) rec.configError = true;
      seen.add(rec.id);
      const sv = this.saved[rec.id];
      if (sv && typeof sv === 'object') {
        rec.etag = typeof sv.etag === 'string' ? sv.etag : null;
        rec.lastModified = typeof sv.lastModified === 'string' ? sv.lastModified : null;
        rec.feedTitle = typeof sv.feedTitle === 'string' ? sv.feedTitle : '';
        rec.lastOkAt = Number.isFinite(sv.lastOkAt) ? sv.lastOkAt : null;
        const rows = Array.isArray(sv.rows)
          ? sv.rows.filter((r) => r && typeof r.key === 'string' && Number.isFinite(r.timeMs) && Number.isFinite(r.firstSeenAt))
          : [];
        rec.snapshot = new Map(rows.map((r) => [r.key, r]));
        rec.rows = [...rec.snapshot.values()].sort((a, b) => b.timeMs - a.timeMs).slice(0, rec.maxItems);
      }
      records.push(rec);
    });
    this.feeds = records;
    this.platforms = numberPlatforms(records);
  }

  pollMs() {
    /* The schema range is advisory only — a hand-edited settings.json
       can deliver anything, and NaN would collapse setInterval to ~0. */
    const m = Number(vscode.workspace.getConfiguration(CONFIG_NS).get('pollMinutes', 15));
    const minutes = Number.isFinite(m) ? Math.min(180, Math.max(5, m)) : 15;
    return minutes * 60 * 1000;
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
        if (e.affectsConfiguration('http')) this.refreshAll();
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

  /* The proxy comes from VS Code's own http.* settings — what the
     user already configured for their network — with the process
     environment as a fallback. Duo defines no proxy settings of its
     own and stores nothing: credentials stay inside VS Code's own
     setting. PAC files are not evaluated (see the README's
     troubleshooting section for that case). */
  proxyConfig() {
    const httpCfg = vscode.workspace.getConfiguration('http');
    let proxy = httpCfg.get('proxy', '') || '';
    if (!proxy) {
      proxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
        process.env.HTTP_PROXY || process.env.http_proxy || '';
    }
    const fromVsCode = httpCfg.get('noProxy', []) || [];
    const envList = (process.env.NO_PROXY || process.env.no_proxy || '').split(/[,\s]+/);
    return {
      proxy,
      noProxy: [...(Array.isArray(fromVsCode) ? fromVsCode : []), ...envList.filter(Boolean)],
      authorization: httpCfg.get('proxyAuthorization', null) || null,
      strictSSL: httpCfg.get('proxyStrictSSL', true) !== false,
    };
  }

  async refreshAll() {
    /* Cycles never overlap: a trigger that arrives mid-cycle folds
       into a single follow-up run instead of racing the shared
       records and the persisted snapshot. */
    if (this.refreshing) { this.refreshQueued = true; return; }
    this.refreshing = true;
    try {
      this.pxCfg = this.proxyConfig();
      for (const rec of this.feeds) {
        if (rec.enabled && !rec.configError) await this.refreshOne(rec);
      }
      if (this.dirty) { this.dirty = false; await this.persist(); }
      this.onChange();
    } finally {
      this.refreshing = false;
      if (this.refreshQueued) { this.refreshQueued = false; this.refreshAll(); }
    }
  }

  async refreshOne(rec) {
    const now = Date.now();
    try {
      const { headers: authH, missing } = await this.authHeaders(rec);
      if (missing) {
        rec.lastStatus = 401; rec.lastErrorAt = now;
        rec.lastError = { symptom: 'feed-auth', detail: '' };
        this.maybePromptToken(rec);
        return;
      }
      const headers = { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', ...authH };
      if (rec.etag) headers['If-None-Match'] = rec.etag;
      if (rec.lastModified) headers['If-Modified-Since'] = rec.lastModified;
      let res;
      try {
        res = await fetchOnce(rec.url, headers, Object.keys(authH), MAX_REDIRECTS, Date.now() + FETCH_DEADLINE_MS, this.pxCfg);
      } catch (err) {
        rec.lastErrorAt = now;
        rec.lastError = {
          symptom: classifyError(err, !!proxyForUrl(rec.url, this.pxCfg)),
          detail: err && err.code ? String(err.code) : '',
        };
        this.log(`feed ${rec.id}: ${err && err.message ? err.message : err}`);
        return;
      }
      rec.lastStatus = res.status;
      if (res.status === 304) { rec.lastOkAt = now; rec.lastError = null; return; }
      if (res.status === 401 || res.status === 403) {
        rec.lastErrorAt = now;
        rec.lastError = { symptom: 'feed-auth', detail: String(res.status) };
        this.maybePromptToken(rec);
        return;
      }
      if (res.status !== 200 || res.body == null) {
        rec.lastErrorAt = now;
        rec.lastError = { symptom: 'http', detail: String(res.status) };
        this.log(`feed ${rec.id}: HTTP ${res.status}`);
        return;
      }
      let parsed;
      try {
        parsed = rec.kind === 'stock' ? parseQuotes(res.body) : parseFeed(res.body);
      } catch (err) {
        rec.lastErrorAt = now;
        rec.lastError = { symptom: 'format', detail: '' };
        this.log(`feed ${rec.id}: unparseable response (${err && err.message ? err.message : err})`);
        return;
      }
      if (rec.kind === 'ci') {
        for (const it of parsed.items) {
          const v = ciVerdict(it.title);
          it.title = v.title;
          it.ciFailed = v.failed;
        }
      }
      rec.feedTitle = parsed.title || rec.feedTitle;
      if (res.headers.etag) rec.etag = res.headers.etag;
      if (res.headers['last-modified']) rec.lastModified = res.headers['last-modified'];
      const merged = mergeFeedRows(rec.id, parsed.items, rec.snapshot, now, {
        maxItems: rec.maxItems, keepHours: rec.keepHours,
      });
      rec.snapshot = merged.snapshot;
      rec.rows = merged.rows.map((r) => ({ ...r, status: this.rowStatus(rec, r) }));
      rec.lastOkAt = now;
      rec.lastError = null;
      this.dirty = true;
    } catch (err) {
      rec.lastErrorAt = now;
      rec.lastStatus = rec.lastStatus || 0;
      if (!rec.lastError) rec.lastError = { symptom: classifyError(err, false), detail: '' };
      this.log(`feed ${rec.id}: ${err && err.message ? err.message : err}`);
    }
  }

  /* ci kind: the verdict was read off the title at ingest (see
     ciVerdict in feedparse.js); failed runs show as cancelled. */
  rowStatus(rec, row) {
    if (rec.kind === 'ci' && row.ciFailed) return 'failed';
    if (row.updated) return 'updated';
    if (row.isNew) return 'arrived';
    return 'ontime';
  }

  maybePromptToken(rec) {
    if (this.authPrompted.has(rec.id)) return;
    if (!rec.auth || !rec.auth.type || rec.auth.type === 'none') return;
    this.authPrompted.add(rec.id);
    const setLabel = JA ? 'トークンを設定' : 'Set Token';
    vscode.window.showInformationMessage(
      JA ? `Signboard-Duo: フィード "${rec.id}" にはトークンが必要です。` : `Signboard-Duo: feed "${rec.id}" needs a token.`,
      setLabel
    ).then((pick) => {
      if (pick === setLabel) vscode.commands.executeCommand('signboardDuo.setToken', rec.id);
    });
  }

  platformsPayload() {
    const now = Date.now();
    const poll = this.pollMs();
    const list = this.platforms
      .map((p, i) => ({ p, rec: this.feeds[i] }))
      .filter(({ p }) => p.no != null)
      .map(({ p, rec }) => {
        const state = rec ? platformState(rec, now, poll) : 'loading';
        let diag = null;
        if (rec && (state === 'error' || state === 'stale' || state === 'authError' || state === 'configError')) {
          const symptom = (rec.lastError && rec.lastError.symptom) ||
            (state === 'configError' ? 'config' : state === 'authError' ? 'feed-auth' : 'connect');
          diag = diagFor(symptom, rec.lastError && rec.lastError.detail);
        }
        return {
          no: p.no,
          name: p.name || (rec && rec.feedTitle) || p.id,
          kind: p.kind,
          favicon: rec ? faviconOf(rec.url) : '',
          state,
          diag,
          lastOkAt: rec && rec.lastOkAt ? rec.lastOkAt : null,
          rows: (rec ? rec.rows : []).map((r) => ({
            key: r.key, title: r.title, timeMs: r.timeMs,
            status: r.status || 'ontime', remark: r.remark || '',
            url: r.link || '', isNew: !!r.isNew,
            price: r.price != null ? r.price : null,
            change: r.change != null ? r.change : null,
            changePct: r.changePct != null ? r.changePct : null,
            open: r.open != null ? r.open : null,
            high: r.high != null ? r.high : null,
            low: r.low != null ? r.low : null,
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
    this.currentPlatformNo = 1;
  }

  cycleMode() {
    const order = ['flap', 'led', 'stock'];
    const labels = { flap: 'Split-Flap', led: 'LED', stock: 'Stock Board' };
    const next = order[(order.indexOf(this.effectiveMode()) + 1) % order.length];
    vscode.window.setStatusBarMessage(`Signboard-Duo board: ${labels[next]}`, 2500);
    setMode(next);
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
      if (msg.type === 'platform' && Number.isFinite(msg.no)) this.currentPlatformNo = msg.no;
      if (msg.type === 'width') this.handleWidth(msg.width);
      if (msg.type === 'open' && msg.url && /^https?:\/\//.test(msg.url)) {
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
    });
    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!this.view) return;
      /* Only mode and the LED parameters are baked into the HTML;
         every other setting reaches the board through state pushes,
         so rebuilding the page for them would just reset it. */
      const htmlKeys = ['mode', 'ledPitch', 'ledHole', 'ledGlow'];
      if (!htmlKeys.some((k) => e.affectsConfiguration(`${CONFIG_NS}.${k}`))) return;
      this.autoRenderer = 'flap';
      this.view.webview.html = this.html(this.view.webview);
      this.lastSignature = '';
      this.push(true);
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.push(true); });
    this.tick = setInterval(() => this.push(false), 1000);
    view.onDidDispose(() => { if (this.tick) clearInterval(this.tick); configSub.dispose(); });
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
    const payload = { type: 'state', platforms, lang: vscode.env.language, mode, scroll, fetchedAt: this.engine.lastFetchedAt(), pinned: this.pinned, theme: this.theme, platformNo: this.currentPlatformNo };
    const signature = JSON.stringify(payload);
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.view.webview.postMessage(payload);
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
    <span class="title" id="boardTitle">STOCK BOARD</span>
    <span class="clock" id="clock"></span>
  </div>
  <div class="platform" id="platform"></div>
  <div id="rows"></div>
  <div class="board-foot"><span id="pageInfo"></span><span id="fetchInfo"></span><span id="jokeBadge"></span></div>
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
  <div class="cols"><span class="c-logo"></span><span class="c-name" id="colName">便名</span><span class="c-count" id="flightCount"></span><span class="c-meta"><span class="c-time" id="colTime">到着時刻</span><span class="c-rem" id="colRemark">備考</span></span></div>
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
    vscode.window.showInformationMessage(JA
      ? 'Signboard-Duo: 認証方式が設定されたフィードがありません。先に signboardDuo.feeds 設定で "auth" を設定してください。'
      : 'Signboard-Duo: no feed has an auth type configured. Set "auth" in the signboardDuo.feeds setting first.');
    return null;
  }
  const pick = await vscode.window.showQuickPick(
    candidates.map((f) => ({ label: f.id, description: f.auth.type })),
    { placeHolder: JA ? 'トークンを操作するフィード' : 'Feed to manage the token for' }
  );
  return pick ? candidates.find((f) => f.id === pick.label) : null;
}

function activate(context) {
  USER_AGENT = `Signboard-Duo/${context.extension.packageJSON.version} (+https://marketplace.visualstudio.com/)`;
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
    vscode.commands.registerCommand('signboardDuo.cycleMode', () => provider.cycleMode()),
    vscode.commands.registerCommand('signboardDuo.cycleModeFlap', () => provider.cycleMode()),
    vscode.commands.registerCommand('signboardDuo.cycleModeLed', () => provider.cycleMode()),
    vscode.commands.registerCommand('signboardDuo.cycleModeStock', () => provider.cycleMode()),
    vscode.commands.registerCommand('signboardDuo.pinPlatform', () => provider.setPinned(true)),
    vscode.commands.registerCommand('signboardDuo.unpinPlatform', () => provider.setPinned(false)),
    vscode.commands.registerCommand('signboardDuo.setToken', async (presetId) => {
      const rec = await pickAuthFeed(engine, presetId);
      if (!rec) return;
      const value = await vscode.window.showInputBox({
        prompt: JA
          ? `フィード "${rec.id}" のトークン（SecretStorage に保存され、設定には残りません）`
          : `Token for feed "${rec.id}" (stored in SecretStorage, never in settings)`,
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
      vscode.window.showInformationMessage(JA
        ? `Signboard-Duo: フィード "${rec.id}" のトークンを削除しました。`
        : `Signboard-Duo: token for "${rec.id}" deleted.`);
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

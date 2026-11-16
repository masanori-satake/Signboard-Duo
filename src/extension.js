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
const { TokenStore, orphanIds } = require('./tokens');
const bamboo = require('./bamboo');
const github = require('./github');
const wizard = require('./wizard');

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
    const prevIds = new Set(this.feeds.map((f) => f.id).filter((id) => typeof id === 'string'));
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
        type: (f && f.type) || 'rss',
        target: (f && f.target && typeof f.target === 'object') ? f.target : {},
        interests: (f && Array.isArray(f.interests)) ? f.interests.filter((x) => typeof x === 'string') : null,
        configError: false, lastStatus: null, lastOkAt: null, lastErrorAt: null, lastError: null,
        feedTitle: '', snapshot: new Map(), rows: [],
        etag: null, lastModified: null,
      };
      if (!rec.id || !rec.url || !/^[a-z0-9-]+$/.test(rec.id)) rec.configError = true;
      else if (seen.has(rec.id)) { rec.configError = true; this.log(`feeds: duplicate id "${rec.id}"`); }
      else if (!/^https?:\/\//.test(rec.url)) rec.configError = true;
      else if (rec.type === 'bamboo-rest'
        && !(typeof rec.target.project === 'string' && rec.target.project)
        && !(Array.isArray(rec.target.plans) && rec.target.plans.length)) rec.configError = true;
      else if (rec.type === 'github-actions'
        && !(typeof rec.target.repo === 'string' && /^[^/\s]+\/[^/\s]+$/.test(rec.target.repo))) rec.configError = true;
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
    /* Feeds that left the settings may leave a token behind in
       SecretStorage. Report them so the user can retire the token
       together with the feed (deletion order must not matter). */
    if (this.onFeedsRemoved && prevIds.size) {
      const nowIds = new Set(records.map((r) => r.id));
      const removed = [...prevIds].filter((id) => !nowIds.has(id));
      if (removed.length) this.onFeedsRemoved(removed);
    }
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
      if (rec.type === 'bamboo-rest') { await this.refreshAdapter(rec, authH, now, bamboo); return; }
      if (rec.type === 'github-actions') { await this.refreshAdapter(rec, authH, now, github); return; }
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

  /* REST adapter path (design §14/§16): transport stays here — auth
     headers, proxy, deadlines, the symptom taxonomy — while each
     adapter module owns its URLs and response interpretation and
     returns common rows via collect(fetchJson, rec, ctx). */
  async refreshAdapter(rec, authH, now, adapter) {
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(adapter.HEADERS || {}), ...authH };
    const credNames = Object.keys(authH);
    const fail = (symptom, detail) => { const e = new Error(symptom); e.symptom = symptom; e.detail = detail || ''; return e; };
    const fetchJson = async (url) => {
      const res = await fetchOnce(url, headers, credNames, MAX_REDIRECTS, Date.now() + FETCH_DEADLINE_MS, this.pxCfg);
      rec.lastStatus = res.status;
      if (res.status === 401 || res.status === 403) throw fail('feed-auth', String(res.status));
      if (res.status !== 200 || res.body == null) throw fail('http', String(res.status));
      try { return JSON.parse(res.body); } catch (e) { throw fail('format', ''); }
    };
    const labels = {
      running: JA ? '実行中' : 'running',
      long: JA ? '長時間実行中' : 'long-running',
      recovered: JA ? '回復' : 'recovered',
      queued: JA ? '待機中' : 'queued',
      streak: (n) => (JA ? `${n}回連続失敗` : `${n} failed in a row`),
    };
    try {
      const { items, feedTitle } = await adapter.collect(fetchJson, rec, { nowMs: now, labels });
      if (feedTitle) rec.feedTitle = feedTitle;
      const merged = mergeFeedRows(rec.id, items, rec.snapshot, now, {
        maxItems: rec.maxItems, keepHours: rec.keepHours,
      });
      rec.snapshot = merged.snapshot;
      rec.rows = merged.rows.map((r) => ({ ...r, status: this.rowStatus(rec, r) }));
      rec.lastOkAt = now;
      rec.lastError = null;
      this.dirty = true;
    } catch (err) {
      rec.lastErrorAt = now;
      if (err && err.symptom) {
        rec.lastError = { symptom: err.symptom, detail: err.detail || '' };
        if (err.symptom === 'feed-auth') this.maybePromptToken(rec);
      } else {
        rec.lastError = {
          symptom: classifyError(err, !!proxyForUrl(rec.url, this.pxCfg)),
          detail: err && err.code ? String(err.code) : '',
        };
      }
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

/* ---------------- CI setup wizard (design §16) ----------------
   Click-driven platform setup: the user picks a CI, a target and
   what becomes news; only the resulting entry is written to the
   settings, so no JSON editing is needed and the choice persists
   across restarts. Adapters declare what they can serve, and only
   those catalog entries are ever offered. */

const INTEREST_LABELS = {
  failed: ['失敗', 'Failures'],
  recovered: ['回復', 'Recoveries'],
  streak: ['連続失敗', 'Failure streaks'],
  running: ['実行中', 'Running'],
  queued: ['待機中', 'Queued'],
  long: ['長時間実行', 'Long-running'],
  all: ['全結果', 'All results'],
  first: ['初回', 'First runs'],
};
const PRESET_LABELS = {
  'errors-only': ['エラーだけ（失敗）', 'Errors only (failures)'],
  changes: ['変化だけ（失敗＋回復）', 'Changes only (failures + recoveries)'],
  operations: ['運用寄り（失敗＋長時間＋待機）', 'Operations (failures + long-running + queued)'],
  all: ['全部（全結果）', 'Everything (all results)'],
  custom: ['カスタム（項目を個別に選ぶ）', 'Custom (pick items)'],
};
const ADAPTER_META = {
  'github-actions': { mod: github, label: 'GitHub Actions', defaultUrl: 'https://api.github.com', authTypes: ['bearer', 'none'] },
  'bamboo-rest': { mod: bamboo, label: 'Bamboo (REST)', defaultUrl: '', authTypes: ['bearer', 'basic', 'none'] },
};

async function wizardFetchJson(engine, url, headers) {
  const res = await fetchOnce(url, { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    Object.keys(headers), MAX_REDIRECTS, Date.now() + FETCH_DEADLINE_MS, engine.proxyConfig());
  if (res.status === 401 || res.status === 403) {
    throw new Error(JA ? `認証が必要です（HTTP ${res.status}）。トークンを確認してください` : `Authentication required (HTTP ${res.status}). Check the token`);
  }
  if (res.status !== 200 || res.body == null) throw new Error(`HTTP ${res.status}`);
  try { return JSON.parse(res.body); } catch (e) {
    throw new Error(JA ? '応答を JSON として読めませんでした' : 'The response was not JSON');
  }
}

async function pickInterests(capabilities, current) {
  const presetItems = wizard.PRESET_ORDER.map((p) => ({
    label: (JA ? PRESET_LABELS[p][0] : PRESET_LABELS[p][1]),
    description: wizard.presetInterests(p, capabilities).join(', '),
    preset: p,
  }));
  presetItems.push({ label: JA ? PRESET_LABELS.custom[0] : PRESET_LABELS.custom[1], description: '', preset: 'custom' });
  const pick = await vscode.window.showQuickPick(presetItems, {
    placeHolder: JA ? '何をニュースにしますか' : 'What becomes news',
  });
  if (!pick) return null;
  if (pick.preset !== 'custom') return wizard.presetInterests(pick.preset, capabilities);
  const items = wizard.catalogFor(capabilities).map((id) => ({
    label: JA ? INTEREST_LABELS[id][0] : INTEREST_LABELS[id][1],
    id,
    picked: Array.isArray(current) ? current.includes(id) : id === 'failed' || id === 'recovered',
  }));
  const chosen = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: JA ? 'ニュースにする項目' : 'News items',
  });
  if (!chosen) return null;
  if (!chosen.length) {
    vscode.window.showInformationMessage(JA
      ? 'Signboard-Duo: 項目が選ばれなかったため、「失敗＋回復」を使います。'
      : 'Signboard-Duo: nothing was picked; using failures + recoveries.');
    return wizard.presetInterests('changes', capabilities);
  }
  return chosen.map((c) => c.id);
}

async function runAddCiWizard(engine, tokens) {
  try {
    const typePick = await vscode.window.showQuickPick(
      Object.entries(ADAPTER_META).map(([type, m]) => ({ label: m.label, type })),
      { placeHolder: JA ? '追加する CI の種類' : 'Kind of CI to add' }
    );
    if (!typePick) return;
    const type = typePick.type;
    const meta = ADAPTER_META[type];
    const caps = meta.mod.CAPABILITIES;

    const base = await vscode.window.showInputBox({
      prompt: JA ? 'API のベース URL' : 'API base URL',
      value: meta.defaultUrl,
      placeHolder: type === 'bamboo-rest' ? 'https://bamboo.example.com/bamboo' : 'https://api.github.com',
      validateInput: (v) => (/^https?:\/\//.test(v || '') ? null : (JA ? 'http(s) の URL を入力してください' : 'Enter an http(s) URL')),
    });
    if (!base) return;

    const authPick = await vscode.window.showQuickPick(
      meta.authTypes.map((t) => ({ label: t, type: t })),
      { placeHolder: JA ? '認証方式' : 'Auth type' }
    );
    if (!authPick) return;
    const authType = authPick.type;
    let token = null;
    let authUser = '';
    const authH = {};
    if (authType === 'basic') {
      authUser = await vscode.window.showInputBox({ prompt: JA ? 'ユーザー名' : 'User name' });
      if (authUser == null) return;
    }
    if (authType !== 'none') {
      token = await vscode.window.showInputBox({
        prompt: JA ? 'トークン（この後の確認と、フィードのトークン保存に使います）' : 'Token (used to browse now and stored as the feed token)',
        password: true,
      });
      if (!token) return;
      if (authType === 'bearer') authH.Authorization = `Bearer ${token}`;
      if (authType === 'basic') authH.Authorization = 'Basic ' + Buffer.from(`${authUser}:${token}`, 'utf8').toString('base64');
    }
    const extraH = { ...(meta.mod.HEADERS || {}), ...authH };
    const fetchJ = (url) => wizardFetchJson(engine, url, extraH);

    let target = {};
    let defaultName = '';
    let idBase = type === 'github-actions' ? 'github' : 'bamboo';
    if (type === 'github-actions') {
      const repo = await vscode.window.showInputBox({
        prompt: JA ? 'リポジトリ（owner/name）' : 'Repository (owner/name)',
        validateInput: (v) => (/^[^/\s]+\/[^/\s]+$/.test(v || '') ? null : 'owner/name'),
      });
      if (!repo) return;
      await fetchJ(github.repoUrl(base, repo)); // existence / access check
      const workflows = github.parseWorkflows(await fetchJ(github.workflowsUrl(base, repo)));
      let chosenWf = [];
      if (workflows.length) {
        const picks = await vscode.window.showQuickPick(
          workflows.map((w) => ({ label: w.name, id: w.id })),
          { canPickMany: true, placeHolder: JA ? '監視するワークフロー（未選択なら全部）' : 'Workflows to watch (none = all)' }
        );
        if (!picks) return;
        chosenWf = picks.map((p) => p.label);
      }
      const scopePick = await vscode.window.showQuickPick([
        { label: JA ? '本線のみ（デフォルトブランチ）' : 'Mainline only (default branch)', scope: 'mainline' },
        { label: JA ? 'ブランチも含む' : 'Include branches', scope: 'include' },
        { label: JA ? 'ブランチのみ' : 'Branches only', scope: 'only' },
      ], { placeHolder: JA ? 'ブランチの範囲' : 'Branch scope' });
      if (!scopePick) return;
      target = { repo, branches: scopePick.scope };
      if (chosenWf.length) target.workflows = chosenWf;
      defaultName = repo;
      idBase = 'github-' + wizard.slugify(repo.split('/')[1] || repo);
    } else {
      const projects = bamboo.parseProjects(await fetchJ(bamboo.projectsUrl(base)));
      if (!projects.length) throw new Error(JA ? 'プロジェクトが見つかりませんでした' : 'No projects were found');
      const projPick = await vscode.window.showQuickPick(
        projects.map((p) => ({ label: p.name, description: p.key, key: p.key })),
        { placeHolder: JA ? 'プロジェクト' : 'Project' }
      );
      if (!projPick) return;
      const scopePick = await vscode.window.showQuickPick([
        { label: JA ? 'プロジェクト全体（全プラン）' : 'Whole project (all plans)', plans: null },
        { label: JA ? 'プランを選ぶ' : 'Pick plans', plans: [] },
      ], { placeHolder: JA ? '監視の粒度' : 'Granularity' });
      if (!scopePick) return;
      target = { project: projPick.key };
      if (scopePick.plans) {
        const plans = bamboo.parseProjectPlans(await fetchJ(bamboo.projectUrl(base, projPick.key)));
        const picks = await vscode.window.showQuickPick(
          plans.map((p) => ({ label: p.name, description: p.key, key: p.key })),
          { canPickMany: true, placeHolder: JA ? '監視するプラン' : 'Plans to watch' }
        );
        if (!picks || !picks.length) return;
        target.plans = picks.map((p) => p.key);
      }
      defaultName = projPick.label;
      idBase = 'bamboo-' + wizard.slugify(projPick.key);
    }

    const interests = await pickInterests(caps, null);
    if (!interests) return;

    const name = await vscode.window.showInputBox({
      prompt: JA ? '番線の名前' : 'Platform name',
      value: defaultName,
    });
    if (name == null) return;

    const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
    const feeds = cfg.get('feeds', []) || [];
    const id = wizard.uniqueFeedId(idBase, feeds.map((f) => f && f.id));
    const entry = {
      id, name: name || defaultName, type,
      url: base.replace(/\/+$/, ''), target, interests,
      auth: authType === 'basic' ? { type: 'basic', user: authUser } : { type: authType },
      maxItems: 10, keepHours: 24,
    };
    await cfg.update('feeds', [...feeds, entry], vscode.ConfigurationTarget.Global);
    if (token) await tokens.set(id, token);
    vscode.window.showInformationMessage(JA
      ? `Signboard-Duo: 番線「${entry.name}」を追加しました。`
      : `Signboard-Duo: platform "${entry.name}" added.`);
    await engine.refreshAll();
  } catch (err) {
    vscode.window.showErrorMessage(`Signboard-Duo: ${err && err.message ? err.message : err}`);
  }
}

async function runEditInterests(engine) {
  const candidates = engine.feeds.filter((f) => ADAPTER_META[f.type]);
  if (!candidates.length) {
    vscode.window.showInformationMessage(JA
      ? 'Signboard-Duo: REST アダプタの番線がありません。'
      : 'Signboard-Duo: there are no REST adapter platforms.');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    candidates.map((f) => ({ label: f.name || f.id, description: `${f.type} — ${(f.interests || []).join(', ') || 'default'}`, id: f.id })),
    { placeHolder: JA ? 'ニュース項目を変更する番線' : 'Platform whose news items to change' }
  );
  if (!pick) return;
  const rec = candidates.find((f) => f.id === pick.id);
  const interests = await pickInterests(ADAPTER_META[rec.type].mod.CAPABILITIES, rec.interests);
  if (!interests) return;
  const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
  const feeds = (cfg.get('feeds', []) || []).map((f) => (f && f.id === rec.id ? { ...f, interests } : f));
  await cfg.update('feeds', feeds, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(JA
    ? `Signboard-Duo: 「${rec.name || rec.id}」のニュース項目を更新しました。`
    : `Signboard-Duo: news items for "${rec.name || rec.id}" updated.`);
}

function activate(context) {
  USER_AGENT = `Signboard-Duo/${context.extension.packageJSON.version} (+https://marketplace.visualstudio.com/)`;
  let provider;
  const engine = new FeedEngine(context, () => { if (provider) provider.push(true); });
  const tokens = new TokenStore(context.secrets);
  engine.onFeedsRemoved = async (removedIds) => {
    const withTokens = [];
    for (const id of removedIds) if (await tokens.has(id)) withTokens.push(id);
    if (!withTokens.length) return;
    const delLabel = JA ? 'トークンも削除' : 'Delete the token(s) too';
    const keepLabel = JA ? '残す' : 'Keep';
    const pick = await vscode.window.showInformationMessage(
      JA
        ? `Signboard-Duo: 設定から消えたフィード（${withTokens.join(', ')}）のトークンが残っています。`
        : `Signboard-Duo: token(s) remain for feed(s) no longer in the settings (${withTokens.join(', ')}).`,
      delLabel, keepLabel
    );
    if (pick === delLabel) {
      await tokens.deleteMany(withTokens);
      vscode.window.showInformationMessage(JA
        ? 'Signboard-Duo: トークンを削除しました。'
        : 'Signboard-Duo: token(s) deleted.');
    }
  };
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
        await tokens.set(rec.id, value);
        engine.authPrompted.delete(rec.id);
        await engine.refreshOne(rec);
        provider.push(true);
      }
    }),
    vscode.commands.registerCommand('signboardDuo.deleteToken', async () => {
      const configuredIds = engine.feeds.map((f) => f.id);
      const index = await tokens.adopt(configuredIds);
      const items = [];
      for (const f of engine.feeds.filter((x) => x.auth && x.auth.type && x.auth.type !== 'none')) {
        items.push({
          label: f.id,
          description: (await tokens.has(f.id))
            ? (JA ? 'トークン保存済み' : 'token stored')
            : (JA ? 'トークンなし' : 'no token'),
          id: f.id,
        });
      }
      for (const id of orphanIds(index, configuredIds)) {
        items.push({
          label: id,
          description: JA ? '設定にないフィード（トークンのみ残存）' : 'not in settings (token only)',
          id,
        });
      }
      const manualLabel = JA ? 'ID を直接入力して削除…' : 'Enter a feed ID manually…';
      items.push({ label: manualLabel, description: '', manual: true });
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: JA ? 'トークンを削除するフィード' : 'Feed whose token to delete',
      });
      if (!pick) return;
      let id = pick.id;
      if (pick.manual) {
        id = await vscode.window.showInputBox({ prompt: JA ? 'フィードの ID' : 'Feed ID' });
        if (!id) return;
      }
      await tokens.delete(id);
      vscode.window.showInformationMessage(JA
        ? `Signboard-Duo: フィード "${id}" のトークンを削除しました。`
        : `Signboard-Duo: token for "${id}" deleted.`);
    }),
    vscode.commands.registerCommand('signboardDuo.listTokens', async () => {
      const configuredIds = engine.feeds.map((f) => f.id);
      const index = await tokens.adopt(configuredIds);
      if (!index.length) {
        vscode.window.showInformationMessage(JA
          ? 'Signboard-Duo: 保存されているトークンはありません。'
          : 'Signboard-Duo: no tokens are stored.');
        return;
      }
      const conf = new Set(configuredIds);
      const lines = index.map((id) => (conf.has(id) ? id : (JA ? `${id}（設定にありません）` : `${id} (not in settings)`)));
      vscode.window.showInformationMessage((JA
        ? 'Signboard-Duo: トークン保存済みのフィード: '
        : 'Signboard-Duo: feeds with a stored token: ') + lines.join(', '));
    }),
    vscode.commands.registerCommand('signboardDuo.deleteOrphanTokens', async () => {
      const configuredIds = engine.feeds.map((f) => f.id);
      const index = await tokens.adopt(configuredIds);
      const orphans = orphanIds(index, configuredIds);
      if (!orphans.length) {
        vscode.window.showInformationMessage(JA
          ? 'Signboard-Duo: 紐づいていないトークンはありません。'
          : 'Signboard-Duo: there are no unlinked tokens.');
        return;
      }
      const delLabel = JA ? '削除する' : 'Delete';
      const pick = await vscode.window.showWarningMessage(
        JA
          ? `Signboard-Duo: 設定にないフィードのトークン（${orphans.join(', ')}）を削除しますか？`
          : `Signboard-Duo: delete token(s) for feed(s) no longer in the settings (${orphans.join(', ')})?`,
        { modal: true }, delLabel
      );
      if (pick !== delLabel) return;
      await tokens.deleteMany(orphans);
      vscode.window.showInformationMessage(JA
        ? 'Signboard-Duo: 紐づいていないトークンを削除しました。'
        : 'Signboard-Duo: unlinked token(s) deleted.');
    }),
    vscode.commands.registerCommand('signboardDuo.deleteAllTokens', async () => {
      const index = await tokens.adopt(engine.feeds.map((f) => f.id));
      if (!index.length) {
        vscode.window.showInformationMessage(JA
          ? 'Signboard-Duo: 保存されているトークンはありません。'
          : 'Signboard-Duo: no tokens are stored.');
        return;
      }
      const delLabel = JA ? 'すべて削除する' : 'Delete all';
      const pick = await vscode.window.showWarningMessage(
        JA
          ? `Signboard-Duo: 保存されているすべてのトークン（${index.length} 件）を削除しますか？`
          : `Signboard-Duo: delete all stored tokens (${index.length})?`,
        { modal: true }, delLabel
      );
      if (pick !== delLabel) return;
      await tokens.deleteMany(index);
      vscode.window.showInformationMessage(JA
        ? 'Signboard-Duo: すべてのトークンを削除しました。'
        : 'Signboard-Duo: all tokens deleted.');
    }),
    vscode.commands.registerCommand('signboardDuo.addCiPlatform', () => runAddCiWizard(engine, tokens)),
    vscode.commands.registerCommand('signboardDuo.editInterests', () => runEditInterests(engine)),
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

'use strict';

/* Signboard-Duo extension host.
   Data layer: polls RSS / Atom feeds the user configured, normalises
   them into platforms (feeds) and rows (topics), and pushes them to the
   flap / LED renderers forked from Signboard-Solo. Read-only polling of
   user-configured URLs only; no telemetry, no other network traffic.
   Feed tokens live in SecretStorage, never in settings. */

const vscode = require('vscode');
const crypto = require('crypto');
const { parseFeed, parseQuotes, ciVerdict } = require('./feedparse');
const { fetchOnce, classifyError, proxyForUrl } = require('./net');
const { numberPlatforms, mergeFeedRows, platformState, nextOutage, interestsChanged } = require('./model');
const { TokenStore, orphanIds } = require('./tokens');
const bamboo = require('./bamboo');
const github = require('./github');
const wizard = require('./wizard');

const CONFIG_NS = 'signboardDuo';
const JA = (vscode.env.language || '').toLowerCase().startsWith('ja');
const STATE_KEY = 'signboardDuo.state.v1';
const MAX_REDIRECTS = 5;
const FETCH_DEADLINE_MS = 30000;
const ADAPTER_MAX_BODY_BYTES = 8 * 1024 * 1024; // REST adapter JSON; RSS keeps net.js's 1 MB cap
let USER_AGENT = 'Signboard-Duo (+https://marketplace.visualstudio.com/)';

function autoModeForWidth(width) {
  return Number.isFinite(width) && width >= 520 ? 'led' : 'flap';
}

/* Integer setting with a fallback: non-numbers and non-finite
   values take the fallback, everything else is clamped to range. */
function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/* CSP nonce for the Webviews: the nonce is the last line of the
   CSP, so it comes from a cryptographic source — a timestamp /
   Math.random value would be guessable by anything that manages
   to get markup in front of the renderer. Node's stdlib only, so
   the zero-dependency rule holds. */
function makeNonce() {
  return crypto.randomBytes(16).toString('base64');
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

/* ---------------- which settings the feeds come from ----------------
   Feeds are read from the USER (global) settings only — never from
   a workspace. A workspace's .vscode/settings.json travels with a
   cloned repository, so honouring it would let a project define
   feeds on the user's machine; worse, a workspace feed reusing a
   personal feed's id would be handed that feed's stored token to
   send to a workspace-chosen URL. The setup form already writes
   Global, so personal feeds are unaffected. Workspace-defined
   feeds are ignored, and the ignore is logged (once per distinct
   value) so it is discoverable rather than silent. */
let lastIgnoredWorkspaceFeeds = null;
function userFeeds() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
  const info = cfg.inspect('feeds');
  const global = info && Array.isArray(info.globalValue) ? info.globalValue : [];
  const ws = info ? (info.workspaceFolderValue !== undefined ? info.workspaceFolderValue
    : info.workspaceValue !== undefined ? info.workspaceValue : undefined) : undefined;
  if (ws !== undefined) {
    const sig = JSON.stringify(ws);
    if (sig !== lastIgnoredWorkspaceFeeds) {
      lastIgnoredWorkspaceFeeds = sig;
      const n = Array.isArray(ws) ? ws.length : 0;
      if (n) console.warn(`Signboard-Duo: ignoring ${n} feed(s) defined in workspace settings; feeds are read from user settings only.`);
    }
  }
  return global;
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
        outage: f.outage || { streak: 0, since: null, active: false },
        rows: [...f.snapshot.values()].map((r) => ({ ...r, isNew: false, updated: false })),
      };
    }
    this.saved = feeds;
    await this.context.globalState.update(STATE_KEY, { feeds });
  }

  loadConfig() {
    const prevIds = new Set(this.feeds.map((f) => f.id).filter((id) => typeof id === 'string'));
    const prevInterests = new Map(this.feeds.map((f) => [f.id, f.interests]));
    const raw = userFeeds();
    const seen = new Set();
    const records = [];
    raw.slice(0, 20).forEach((f, idx) => {
      if (raw.length > 20 && idx === 19) this.log('feeds: more than 20 configured; only the first 20 are used');
      const rec = {
        id: f && f.id, url: f && f.url, name: (f && f.name) || '',
        kind: f && f.kind === 'bamboo' ? 'ci' : (f && f.kind) || 'generic', // bamboo was absorbed into ci (1.2.0)
        enabled: !f || f.enabled !== false,
        /* The schema ranges are advisory only, so clamp here: a
           hand-edited settings.json can deliver anything, and an
           unclamped maxItems / keepHours would defeat the snapshot
           bounds the board's lightness rests on. Defaults match the
           setup form's. */
        maxItems: clampInt(f && f.maxItems, 1, 20, 10),
        keepHours: clampInt(f && f.keepHours, 1, 168, 24),
        auth: (f && f.auth) || { type: 'none' },
        type: (f && f.type) || 'rss',
        target: (f && f.target && typeof f.target === 'object') ? f.target : {},
        interests: (f && Array.isArray(f.interests)) ? f.interests.filter((x) => typeof x === 'string') : null,
        rotate: !f || f.rotate !== false,
        outage: { streak: 0, since: null, active: false },
        configError: false, lastStatus: null, lastOkAt: null, lastErrorAt: null, lastError: null,
        feedTitle: '', snapshot: new Map(), rows: [],
        etag: null, lastModified: null,
      };
      if (!rec.id || !rec.url || !/^[a-z0-9-]+$/.test(rec.id)) rec.configError = true;
      /* A custom auth header name becomes a raw HTTP header key;
         outside the token grammar Node throws on every request and
         the feed fails forever, so treat it as a config error the
         board can explain instead. */
      else if (rec.auth && rec.auth.type === 'header'
        && rec.auth.headerName != null
        && !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(String(rec.auth.headerName))) rec.configError = true;
      else if (seen.has(rec.id)) { rec.configError = true; this.log(`feeds: duplicate id "${rec.id}"`); }
      else if (!/^https?:\/\//.test(rec.url)) rec.configError = true;
      /* A configured token would travel in cleartext over plain
         http. Http-only servers in other environments are a
         supported case, but not with credentials attached: surface
         it as a config error the board can explain instead of
         silently sending the secret unencrypted. */
      else if (rec.auth && rec.auth.type && rec.auth.type !== 'none' && /^http:\/\//.test(rec.url)) rec.configError = true;
      else if (rec.type === 'bamboo-rest'
        && !(typeof rec.target.project === 'string' && rec.target.project)
        && !(Array.isArray(rec.target.plans) && rec.target.plans.length)) rec.configError = true;
      else if (rec.type === 'github-actions'
        && !(typeof rec.target.repo === 'string' && github.REPO_PATTERN.test(rec.target.repo))) rec.configError = true;
      seen.add(rec.id);
      /* A changed news-item selection resets the feed's rows
         (design §16 supplement): the rows on the board were produced
         by the old selection, and letting them age out over keepHours
         reads as "the change did not take". The next fetch rebuilds
         the board under the new selection alone. */
      const selectionChanged = prevInterests.has(rec.id)
        && interestsChanged(prevInterests.get(rec.id), rec.interests);
      if (selectionChanged) this.log(`feed ${rec.id}: news items changed; rows reset`);
      const sv = selectionChanged ? null : this.saved[rec.id];
      if (sv && typeof sv === 'object') {
        rec.etag = typeof sv.etag === 'string' ? sv.etag : null;
        rec.lastModified = typeof sv.lastModified === 'string' ? sv.lastModified : null;
        rec.feedTitle = typeof sv.feedTitle === 'string' ? sv.feedTitle : '';
        rec.lastOkAt = Number.isFinite(sv.lastOkAt) ? sv.lastOkAt : null;
        if (sv.outage && typeof sv.outage === 'object') {
          rec.outage = {
            streak: sv.outage.streak | 0,
            since: Number.isFinite(sv.outage.since) ? sv.outage.since : null,
            active: !!sv.outage.active,
          };
        }
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
    /* Feeds are read from user (global) settings only, so a cloned
       workspace cannot choose where a feed's token is sent; the
       proxy is part of that route, so it follows the same rule —
       inspect() globalValue for every http.* value. Above all, a
       workspace-sourced proxyStrictSSL: false must never switch
       off TLS verification on the CONNECT tunnel. The process
       environment fallback stays: it is the user's own shell,
       not the workspace. */
    const globalOf = (key) => {
      const info = httpCfg.inspect(key);
      return info ? info.globalValue : undefined;
    };
    let proxy = globalOf('proxy') || '';
    if (typeof proxy !== 'string') proxy = '';
    if (!proxy) {
      proxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
        process.env.HTTP_PROXY || process.env.http_proxy || '';
    }
    const fromVsCode = globalOf('noProxy') || [];
    const envList = (process.env.NO_PROXY || process.env.no_proxy || '').split(/[,\s]+/);
    return {
      proxy,
      noProxy: [...(Array.isArray(fromVsCode) ? fromVsCode : []), ...envList.filter(Boolean)],
      authorization: globalOf('proxyAuthorization') || null,
      strictSSL: globalOf('proxyStrictSSL') !== false,
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
      /* Bounded parallelism: the old strictly serial cycle let one
         hanging feed (a 30 s deadline each) delay every platform
         behind it — with several dead feeds a cycle could take
         minutes, exactly when the user most needs the board. Four
         workers keep the pressure on any one server low while a
         single hang costs one lane, not the whole cycle. Each
         record is only ever touched by the worker that claimed it. */
      const targets = this.feeds.filter((rec) => rec.enabled && !rec.configError);
      let nextIdx = 0;
      const worker = async () => {
        while (nextIdx < targets.length) {
          const rec = targets[nextIdx++];
          await this.refreshOne(rec);
          this.noteOutcome(rec, Date.now());
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()));
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
      if (res.truncated && !rec.truncatedLogged) {
        rec.truncatedLogged = true;
        this.log(`feed ${rec.id}: response exceeds the size cap; reading the newest part only`);
      } else if (!res.truncated) {
        rec.truncatedLogged = false;
      }
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
    /* One deadline for the whole refresh, not per request: an
       adapter walks a sequence (project, then up to 20 plans), and
       a fresh 30 s per step let a slow-dripping server stretch a
       single feed's refresh to ~10 minutes. */
    const deadline = Date.now() + FETCH_DEADLINE_MS;
    /* Adapter JSON gets a larger body cap than the 1 MB feed cap:
       a GitHub run listing at the API's widest window (100 runs,
       each a sizeable object) legitimately exceeds 1 MB, and the
       strict abort turned that into a permanent "response too
       large" error. The endpoints are the user's own CI servers,
       and the cap still bounds the work. */
    const fetchJson = async (url) => {
      const res = await fetchOnce(url, headers, credNames, MAX_REDIRECTS, deadline, this.pxCfg, ADAPTER_MAX_BODY_BYTES);
      rec.lastStatus = res.status;
      if (res.status === 401 || res.status === 403) throw fail('feed-auth', String(res.status));
      if (res.status !== 200 || res.body == null) throw fail('http', String(res.status));
      /* A truncated JSON body cannot be parsed into anything
         trustworthy — unlike RSS, there is no usable prefix. */
      if (res.truncated) { const e = new Error('response too large'); e.symptom = 'format'; e.detail = ''; throw e; }
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

  /* Outage bookkeeping (design §18): refreshOne leaves the outcome in
     the record — success clears lastError, every failure path sets
     it — so the streak machine is fed from here, once per cycle. */
  noteOutcome(rec, now) {
    const ok = !rec.lastError;
    const { state, recovered } = nextOutage(
      rec.outage, ok,
      ok ? null : rec.lastError.symptom, ok ? null : rec.lastError.detail, now);
    if (JSON.stringify(state) !== JSON.stringify(rec.outage)) {
      rec.outage = state;
      this.dirty = true;
    }
    if (recovered) this.addRecoveryRow(rec, recovered, now);
  }

  /* A blocked line that answers again earns one recovery row, worded
     like news and aged like any other row (design §18). */
  addRecoveryRow(rec, recovered, now) {
    if (!vscode.workspace.getConfiguration(CONFIG_NS).get('showRecoveryRows', true)) return;
    const mins = Math.max(1, Math.round((recovered.downMs || 0) / 60000));
    const h = Math.floor(mins / 60);
    const dur = h >= 1
      ? (JA ? `約${h}時間${mins % 60 ? `${mins % 60}分` : ''}` : `about ${h} h${mins % 60 ? ` ${mins % 60} min` : ''}`)
      : (JA ? `約${mins}分` : `about ${mins} min`);
    const item = {
      guid: `recovered:${recovered.since || now}`,
      title: rec.name || rec.feedTitle || rec.id,
      link: '',
      remark: JA ? `復旧しました（${dur}間不通でした）` : `Back online (the line was blocked for ${dur})`,
      timeMs: now,
      recovered: true,
    };
    const merged = mergeFeedRows(rec.id, [item], rec.snapshot, now, {
      maxItems: rec.maxItems, keepHours: rec.keepHours,
    });
    rec.snapshot = merged.snapshot;
    rec.rows = merged.rows.map((r) => ({ ...r, status: this.rowStatus(rec, r) }));
    this.dirty = true;
  }

  /* Failed CI runs show as cancelled, however they arrived: RSS ci
     feeds carry ciFailed from ciVerdict (feedparse.js), and the
     REST adapters set the same flag in their buildRows. */
  rowStatus(rec, row) {
    if (row.recovered) return 'recovered';
    if (row.ciFailed) return 'failed';
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
    const showRecovery = vscode.workspace.getConfiguration(CONFIG_NS).get('showRecoveryRows', true);
    const list = this.platforms
      .map((p, i) => ({ p, rec: this.feeds[i] }))
      .filter(({ p }) => p.no != null)
      .map(({ p, rec }) => {
        const state = rec ? platformState(rec, now, poll) : 'loading';
        let diag = null;
        if (rec && (state === 'error' || state === 'stale' || state === 'authError' || state === 'configError' || state === 'outage')) {
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
          rotate: rec ? rec.rotate !== false : true,
          downSince: rec && rec.outage && rec.outage.active ? rec.outage.since : null,
          lastOkAt: rec && rec.lastOkAt ? rec.lastOkAt : null,
          rows: (rec ? rec.rows : [])
            .filter((r) => showRecovery || !r.recovered)
            .map((r) => ({
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
    this.rotating = true;
    this.theme = context.globalState.get('duoTheme', 'duo');
    this.currentPlatformNo = 1;
  }

  /* The feed record currently on the board, or null. Platform
     numbers are assigned to enabled feeds in settings order
     (model.js), and engine.platforms stays index-aligned with
     engine.feeds. */
  currentFeed() {
    const idx = this.engine.platforms.findIndex((p) => p.no === this.currentPlatformNo);
    return idx >= 0 ? this.engine.feeds[idx] : null;
  }

  syncCurrentContext() {
    const f = this.currentFeed();
    vscode.commands.executeCommand('setContext', 'signboardDuo.hasCurrentFeed', !!f);
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

  /* Pin and auto-rotation were the same idea wearing two names
     (design §17): one toggle, shown with a rotate glyph. Rotation
     visits only the feeds that opted in (feed.rotate). */
  setRotating(v) {
    this.rotating = !!v;
    vscode.commands.executeCommand('setContext', 'signboardDuo.rotating', this.rotating);
    if (this.view) this.view.webview.postMessage({ type: 'rotate', rotating: this.rotating });
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
      if (msg.type === 'platform' && Number.isFinite(msg.no)) {
        this.currentPlatformNo = msg.no;
        this.syncCurrentContext();
      }
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

  /* Change detection for the 1-second push tick. Stringifying the
     whole payload every second — every platform, every row, every
     URL — was the board's main idle cost. The digest keeps exactly
     the fields a renderer can show (plus the row link, so a changed
     link still re-renders), as compact tuples. */
  signatureOf(payload) {
    const parts = [payload.mode, payload.scroll, payload.theme, payload.rotating, payload.platformNo, payload.fetchedAt];
    for (const p of payload.platforms) {
      parts.push([p.no, p.name, p.kind, p.state, p.downSince || 0, p.lastOkAt || 0, p.diag ? p.diag.title : '']);
      for (const r of p.rows) {
        parts.push([r.key, r.timeMs, r.status, r.isNew ? 1 : 0, r.title, r.remark, r.url,
          r.price, r.change, r.changePct, r.open, r.high, r.low]);
      }
    }
    return JSON.stringify(parts);
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
    const payload = { type: 'state', platforms, lang: vscode.env.language, mode, scroll, fetchedAt: this.engine.lastFetchedAt(), rotating: this.rotating, theme: this.theme, platformNo: this.currentPlatformNo };
    this.syncCurrentContext();
    const signature = this.signatureOf(payload);
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
    const nonce = makeNonce();
    const autoScript = mode === 'auto'
      ? `<script nonce="${nonce}">window.__SB_AUTO = true;</script>\n` : '';
    const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
    const ledScript = led
      ? `<script nonce="${nonce}">window.__SB_LED = ${JSON.stringify({
        /* Schema ranges are advisory; a hand-edited value of 0 or
           10000 would break the LED layout maths, so clamp to the
           schema's own ranges before the renderer sees them. */
        pitch: clampInt(cfg.get('ledPitch', 3), 2, 8, 3), hole: clampInt(cfg.get('ledHole', 38), 10, 70, 38), glow: cfg.get('ledGlow', true),
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

/* Edit entry point: when the board is showing a CI feed, edit
   that feed; otherwise pick one first. Either way the feed opens
   in the setup form, pre-filled. */
async function runEditFeed(engine, tokens, context, provider) {
  const rawOf = (id) => userFeeds().find((f) => f && f.id === id);
  const current = provider.currentFeed();
  if (current) {
    const raw = rawOf(current.id);
    if (raw) { openSetupPanel(engine, tokens, context, raw); return; }
  }
  const candidates = engine.feeds;
  if (!candidates.length) {
    vscode.window.showInformationMessage(JA
      ? 'Signboard-Duo: フィードがありません。'
      : 'Signboard-Duo: there are no feeds.');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    candidates.map((f) => ({ label: f.name || f.id, description: f.type || 'rss', id: f.id })),
    { placeHolder: JA ? '編集するフィード' : 'Feed to edit' }
  );
  if (!pick) return;
  const raw = rawOf(pick.id);
  if (raw) openSetupPanel(engine, tokens, context, raw);
}

let setupPanel = null;
let setupEditFeed = null;

function setupNonce() {
  return makeNonce();
}

function setupHtml(webview, context, editFeed) {
  const editing = !!editFeed;
  const nonce = setupNonce();
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'setup.js'));
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'setup.css'));
  const t = (ja, en) => (JA ? ja : en);
  return `<!DOCTYPE html>
<html lang="${JA ? 'ja' : 'en'}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link href="${cssUri}" rel="stylesheet">
<title>${editing ? t('フィードを編集', 'Edit Feed') : t('フィードを追加', 'Add Feed')}</title>
</head>
<body>
<h1>${editing ? t('フィードを編集', 'Edit Feed') : t('フィードを追加', 'Add Feed')}</h1>
<p class="lead">${t('すべての項目を1画面で設定できます。途中でブラウザなどに切り替えても、入力はそのまま残ります。', 'Everything is set on one screen. Switch away to another app and come back — the form stays as you left it.')}</p>

<section class="card">
<h2>${t('接続', 'Connection')}</h2>
<p class="sec-desc">${t('フィードの取得先と認証を決めます。', 'Where the feed is fetched from, and how it authenticates.')}</p>
<label class="row">${t('フィードの種類', 'Feed type')}</label>
<select id="type">
  <option value="rss">RSS</option>
  <option value="github-actions">GitHub Actions</option>
  <option value="bamboo-rest">Bamboo (REST)</option>
</select>
<span id="typeFixed" class="hidden"></span>
<label class="row" id="baseLabel">${t('API ベース URL', 'API base URL')}</label>
<input type="text" id="base" placeholder="https://bamboo.example.com/bamboo">
<div class="hint">${t('ブラウザのアドレスバーの URL をそのまま貼っても、ベース URL に切り詰めます。', 'A pasted browser URL is trimmed back to the base URL.')}</div>
<label class="row">${t('認証方式', 'Auth type')}</label>
<select id="authType">
  <option value="bearer">${t('Bearer トークン', 'Bearer <redacted>')}</option>
  <option value="basic">${t('Basic 認証', 'Basic auth')}</option>
  <option value="header">${t('カスタムヘッダー', 'Custom header')}</option>
  <option value="none">${t('認証なし', 'None')}</option>
</select>
<div id="authHeaderRow" class="hidden">
  <label class="row">${t('ヘッダ名', 'Header name')}</label>
  <input type="text" id="authHeader" placeholder="X-API-Key">
</div>
<div id="authUserRow" class="hidden">
  <label class="row">${t('ユーザー名', 'User name')}</label>
  <input type="text" id="authUser">
</div>
<div id="tokenRow">
  <label class="row">${t('トークン', 'Token')}</label>
  <input type="password" id="token">
  <button id="deleteToken" class="secondary hidden" type="button">${t('保存されているトークンを削除', 'Delete the stored token')}</button>
  <div class="hint">${t('下の一覧の読み込みに使います。適用すると、このフィードのトークンとして保管されます（設定ファイルには書かれません）。空のままにして、後から入れても構いません。', 'Used to load the lists below. When applied, it is stored as this feed\'s token (never in the settings file). You can leave it empty and set it later.')}</div>
</div>
</section>

<section class="card" id="githubSection">
<h2>GitHub Actions</h2>
<p class="sec-desc">${t('監視するリポジトリとワークフローを決めます。', 'The repository and workflows to watch.')}</p>
<label class="row">${t('リポジトリ', 'Repository')}</label>
<input type="text" id="repo" placeholder="owner/name">
<div class="hint">${t('ブラウザの URL（https://github.com/owner/repo）を貼っても読み替えます。', 'A browser URL (https://github.com/owner/repo) is accepted too.')}</div>
<button id="loadWorkflows" class="secondary" type="button">${t('ワークフローを読み込む', 'Load workflows')}</button>
<div id="workflowsRow" class="hidden">
  <label class="row">${t('ワークフロー（何も選ばなければ全部が対象）', 'Workflows (none checked = all of them)')}</label>
  <div class="checks" id="workflows"></div>
</div>
<label class="row">${t('ブランチの範囲', 'Branch scope')}</label>
<div class="radios">
  <label><input type="radio" name="branchScope" value="mainline" checked> ${t('本線のみ（デフォルトブランチ）', 'Mainline only (default branch)')}</label>
  <label><input type="radio" name="branchScope" value="include"> ${t('ブランチも含む', 'Include branches')}</label>
  <label><input type="radio" name="branchScope" value="only"> ${t('ブランチのみ', 'Branches only')}</label>
</div>
</section>

<section class="card hidden" id="bambooSection">
<h2>Bamboo (REST)</h2>
<p class="sec-desc">${t('監視するプロジェクトとプランを決めます。', 'The project and plans to watch.')}</p>
<button id="loadProjects" class="secondary" type="button">${t('プロジェクトを読み込む', 'Load projects')}</button>
<div id="bambooTarget" class="hidden">
  <label class="row">${t('プロジェクト', 'Project')}</label>
  <select id="project"></select>
  <label class="row">${t('対象の決め方', 'How to choose targets')}</label>
  <select id="granularity">
    <option value="project">${t('プロジェクト全体（すべてのプラン）', 'Whole project (all plans)')}</option>
    <option value="plans">${t('プランを選ぶ', 'Pick plans')}</option>
  </select>
  <button id="loadPlans" class="secondary hidden" type="button">${t('プランを読み込む', 'Load plans')}</button>
  <div id="plansRow" class="hidden">
    <label class="row">${t('監視するプラン', 'Plans to watch')}</label>
    <div class="checks" id="plans"></div>
  </div>
</div>
</section>

<section class="card hidden" id="rssSection">
<h2>${t('RSS フィード', 'RSS feed')}</h2>
<p class="sec-desc">${t('RSS の内容をどう解釈するかを決めます。', 'How the feed contents are read.')}</p>
<label class="row">${t('RSS の解釈', 'Feed kind')}</label>
<select id="kind">
  <option value="generic">generic — ${t('通常', 'plain RSS / Atom')}</option>
  <option value="ci">ci — ${t('CI の結果（タイトルから判定）', 'CI results, verdict read off the title')}</option>
  <option value="status">status — ${t('ステータスページ', 'status page')}</option>
  <option value="jma">jma — ${t('気象庁', 'JMA weather')}</option>
  <option value="stock">stock — ${t('株価 (JSON)', 'stock quotes (JSON)')}</option>
</select>
<div class="hint">${t('フィードの URL は、上の「接続」にある URL 欄に入力します。', 'Enter the feed URL itself in the URL field under Connection above.')}</div>
</section>

<section class="card" id="interestsSection">
<h2>${t('ニュース項目', 'News items')}</h2>
<p class="sec-desc">${t('どの結果を盤面に載せるかを決めます。', 'Which results become rows on the board.')}</p>
<label class="row">${t('プリセット', 'Preset')}</label>
<select id="preset"></select>
<div class="checks" id="interests"></div>
<div class="hint">${t('その CI が扱えない項目は表示されません。チェックを変えると、プリセットは「カスタム」になります。', 'Items the CI cannot serve are not shown. Changing a checkbox switches the preset to Custom.')}</div>
</section>

<section class="card">
<h2>${t('名前と表示', 'Name and display')}</h2>
<p class="sec-desc">${t('盤面での名前と、行の残し方を決めます。', 'The name on the board, and how rows are kept.')}</p>
<label class="row">${t('フィードの名前', 'Feed name')}</label>
<input type="text" id="name">
<span class="inline-num"><label class="row">${t('最大行数', 'Max rows')}</label><input type="number" id="maxItems" value="10" min="1" max="20"></span>
<span class="inline-num"><label class="row">${t('保持時間（時間）', 'Keep hours')}</label><input type="number" id="keepHours" value="24" min="1" max="168"></span>
<label class="row"><input type="checkbox" id="enabled" checked> ${t('このフィードを有効にする', 'Enable this feed')}</label>
<label class="row"><input type="checkbox" id="rotate" checked> ${t('自動巡回の対象にする', 'Include in auto-rotation')}</label>
<label class="row">${t('順番', 'Position')}</label>
<select id="position"></select>
</section>

<div class="form-footer">
<div id="status"></div>
<button id="save" type="button">${editing ? t('設定変更を適用する', 'Apply changes') : t('この内容で追加する', 'Add this feed')}</button>
</div>
${editing ? `<div class="danger-zone">
<div class="hint">${t('このフィードを盤面と設定から取り除きます。保存されているトークンがある場合は、削除後に一緒に消すか尋ねます。', 'Removes this feed from the board and the settings. If a token is stored for it, you will be asked about it after deletion.')}</div>
<button id="deleteFeed" class="danger" type="button">${t('このフィードを削除', 'Delete this feed')}</button>
</div>` : ''}
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

async function setupAuthHeadersFor(engine, adapterType, c) {
  let conn = c;
  /* The stored token is filled in only while the form's base URL
     still names the server it was saved for (storedTokenApplies).
     Repointing the form at another instance must not silently
     send the old server's token there: the load then goes out
     without a token, and a 401 surfaces as an error instead. */
  if (conn && !conn.token && setupEditFeed && setupEditFeed.id
      && wizard.storedTokenApplies(conn.base, setupEditFeed.url)) {
    const stored = await engine.context.secrets.get(`feed-token:${setupEditFeed.id}`);
    if (stored) conn = { ...conn, token: stored };
  }
  return setupAuthHeaders(adapterType, conn);
}

function setupAuthHeaders(adapterType, c) {
  const h = { ...((ADAPTER_META[adapterType] && ADAPTER_META[adapterType].mod.HEADERS) || {}) };
  if (c && c.token) {
    if (c.authType === 'bearer') h.Authorization = `Bearer ${c.token}`;
    if (c.authType === 'basic') h.Authorization = 'Basic ' + Buffer.from(`${c.user || ''}:${c.token}`, 'utf8').toString('base64');
    if (c.authType === 'header' && c.headerName) h[c.headerName] = c.token;
  }
  return h;
}

/* Saves for the same feed must not run concurrently. An edit-save
   drops the stored token before the settings update and restores it
   if that update fails; if a second save repoints the same feed while
   the first is still awaiting its update, the first save's restore
   would put the old server's token back under an id whose settings
   now point at the new server. Chain saves per feed id so each one
   reads the settings the previous save left behind. A new feed gets
   a fresh id, so only edit-saves queue here. */
const saveChains = new Map();

async function handleSetupMessage(panel, engine, tokens, msg) {
  if (msg.type === 'save' && setupEditFeed) {
    const id = setupEditFeed.id;
    const prev = saveChains.get(id) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => handleSetupMessageInner(panel, engine, tokens, msg));
    saveChains.set(id, run);
    try {
      await run;
    } finally {
      if (saveChains.get(id) === run) saveChains.delete(id);
    }
    return;
  }
  await handleSetupMessageInner(panel, engine, tokens, msg);
}

async function handleSetupMessageInner(panel, engine, tokens, msg) {
  const post = (m) => panel.webview.postMessage(m);
  try {
    if (msg.type === 'ready') {
      const pick = (labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, JA ? v[0] : v[1]]));
      const allFeeds = userFeeds();
      const editIdx = setupEditFeed ? allFeeds.findIndex((f) => f && f.id === setupEditFeed.id) : -1;
      post({
        type: 'init', ja: JA,
        hasToken: setupEditFeed ? await tokens.has(setupEditFeed.id) : false,
        feedNames: allFeeds.map((f) => (f && (f.name || f.id)) || ''),
        position: setupEditFeed ? (editIdx >= 0 ? editIdx + 1 : allFeeds.length) : allFeeds.length + 1,
        edit: setupEditFeed ? {
          id: setupEditFeed.id, type: setupEditFeed.type || 'rss',
          url: setupEditFeed.url || '',
          authType: (setupEditFeed.auth && setupEditFeed.auth.type) || 'none',
          authUser: (setupEditFeed.auth && setupEditFeed.auth.user) || '',
          authHeader: (setupEditFeed.auth && setupEditFeed.auth.headerName) || '',
          name: setupEditFeed.name || '',
          maxItems: setupEditFeed.maxItems || 10,
          keepHours: setupEditFeed.keepHours || 24,
          target: setupEditFeed.target || {},
          kind: setupEditFeed.kind || 'generic',
          enabled: setupEditFeed.enabled !== false,
          rotate: setupEditFeed.rotate !== false,
          interests: Array.isArray(setupEditFeed.interests) ? setupEditFeed.interests : null,
        } : null,
        caps: { 'github-actions': github.CAPABILITIES, 'bamboo-rest': bamboo.CAPABILITIES },
        presets: wizard.PRESETS, presetOrder: wizard.PRESET_ORDER, catalog: wizard.CATALOG,
        labels: { interests: pick(INTEREST_LABELS), presets: pick(PRESET_LABELS) },
      });
      return;
    }
    if (msg.type === 'deleteToken') {
      /* In-form token retirement (design §17): delete in place, then
         a new token can be typed and saved without leaving the form —
         a token swap completes on this one screen. */
      if (!setupEditFeed) return;
      await tokens.delete(setupEditFeed.id);
      post({ type: 'tokenDeleted' });
      return;
    }
    if (msg.type === 'loadProjects') {
      const base = wizard.normalizeBaseUrl(msg.base);
      if (!/^https?:\/\//.test(base)) throw new Error(JA ? 'URL が不正です' : 'Invalid URL');
      const items = bamboo.parseProjects(await wizardFetchJson(engine, bamboo.projectsUrl(base), await setupAuthHeadersFor(engine, 'bamboo-rest', msg)));
      post({ type: 'projects', items });
      return;
    }
    if (msg.type === 'loadPlans') {
      const base = wizard.normalizeBaseUrl(msg.base);
      if (!/^https?:\/\//.test(base)) throw new Error(JA ? 'URL が不正です' : 'Invalid URL');
      const items = bamboo.parseProjectPlans(await wizardFetchJson(engine, bamboo.projectUrl(base, msg.project), await setupAuthHeadersFor(engine, 'bamboo-rest', msg)));
      post({ type: 'plans', items });
      return;
    }
    if (msg.type === 'loadWorkflows') {
      const base = wizard.normalizeBaseUrl(msg.base);
      if (!/^https?:\/\//.test(base)) throw new Error(JA ? 'URL が不正です' : 'Invalid URL');
      const repo = wizard.normalizeRepoInput(msg.repo);
      if (!github.REPO_PATTERN.test(repo)) {
        throw new Error(JA ? 'リポジトリは owner/name の形式で入力してください' : 'Enter the repository as owner/name');
      }
      const h = await setupAuthHeadersFor(engine, 'github-actions', msg);
      await wizardFetchJson(engine, github.repoUrl(base, repo), h);
      const items = github.parseWorkflows(await wizardFetchJson(engine, github.workflowsUrl(base, repo), h));
      post({ type: 'workflows', items });
      return;
    }
    if (msg.type === 'save') {
      const d = msg.data || {};
      const isRss = d.type === 'rss';
      const meta = ADAPTER_META[d.type];
      if (!isRss && !meta) throw new Error(JA ? 'フィードの種類が不正です' : 'Unknown feed type');
      const base = wizard.normalizeBaseUrl(d.base);
      if (!/^https?:\/\//.test(base)) throw new Error(JA ? 'URL が不正です' : 'Invalid URL');
      const interests = isRss ? [] : (Array.isArray(d.interests) ? d.interests.filter((i) => meta.mod.CAPABILITIES.includes(i)) : []);
      if (!isRss && !interests.length) throw new Error(JA ? 'ニュース項目を選んでください' : 'Pick at least one news item');
      let target = null;
      let defaultName = '';
      let idBase = d.type === 'github-actions' ? 'github' : (isRss ? 'feed' : 'bamboo');
      if (isRss) {
        try { defaultName = new URL(base).hostname; } catch (e) { defaultName = 'Feed'; }
        idBase = 'feed-' + wizard.slugify(defaultName);
      } else if (d.type === 'github-actions') {
        const repo = wizard.normalizeRepoInput(d.target && d.target.repo);
        if (!github.REPO_PATTERN.test(repo)) throw new Error(JA ? 'リポジトリは owner/name の形式で入力してください' : 'Enter the repository as owner/name');
        target = { repo, branches: ['mainline', 'include', 'only'].includes(d.target.branches) ? d.target.branches : 'mainline' };
        if (Array.isArray(d.target.workflows) && d.target.workflows.length) target.workflows = d.target.workflows;
        defaultName = repo;
        idBase = 'github-' + wizard.slugify(repo.split('/')[1] || repo);
      } else {
        if (!d.target || !d.target.project) throw new Error(JA ? 'プロジェクトを選んでください' : 'Pick a project');
        target = { project: d.target.project };
        if (Array.isArray(d.target.plans) && d.target.plans.length) target.plans = d.target.plans;
        defaultName = d.target.project;
        idBase = 'bamboo-' + wizard.slugify(d.target.project);
      }
      const auth = d.authType === 'basic'
        ? { type: 'basic', user: d.user || '' }
        : d.authType === 'header'
          ? { type: 'header', headerName: /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(String(d.headerName || '')) ? String(d.headerName) : 'X-API-Key' }
          : { type: d.authType || 'none' };
      const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
      const feeds = userFeeds();
      const fields = {
        name: d.name || defaultName, url: base, auth,
        enabled: d.enabled !== false,
        rotate: d.rotate !== false,
        maxItems: Math.min(20, Math.max(1, Number(d.maxItems) || 10)),
        keepHours: Math.min(168, Math.max(1, Number(d.keepHours) || 24)),
        ...(isRss
          ? { kind: ['generic', 'ci', 'status', 'jma', 'stock'].includes(d.kind) ? d.kind : 'generic' }
          : { target, interests }),
      };
      if (setupEditFeed) {
        const id = setupEditFeed.id;
        const oldIdx = feeds.findIndex((f) => f && f.id === id);
        const oldRaw = oldIdx >= 0 ? feeds[oldIdx] : {};
        const entry = { ...oldRaw, ...fields, id, type: oldRaw.type || d.type };
        if ((entry.type || 'rss') === 'rss') { delete entry.target; delete entry.interests; }
        /* Position (design §17): re-insert at the chosen 1-based
           slot; the feeds around it shift. Same slot = no move. */
        const rest = feeds.filter((f) => !(f && f.id === id));
        const pos = Math.min(rest.length + 1, Math.max(1, Number(d.position) || (oldIdx >= 0 ? oldIdx + 1 : rest.length + 1)));
        rest.splice(pos - 1, 0, entry);
        /* Repointing the feed at another server with the token
           field left empty must not carry the old server's token
           over (tokens are keyed by feed id, not URL). Drop it
           BEFORE the settings update; if the drop fails, abort
           the save rather than persist a feed whose stored token
           now belongs to a different server. */
        /* Keep the dropped value until the update succeeds: if the
           update is rejected, the settings still point at the old
           server, so the token must go back — otherwise the old
           feed is left without the authentication it had. */
        let droppedToken = null;
        if (wizard.shouldDropStoredToken(oldRaw.url, entry.url, d.token, entry.auth.type) && (await tokens.has(id))) {
          droppedToken = await tokens.get(id);
          try {
            await tokens.delete(id);
          } catch (e) {
            throw new Error(JA
              ? '保存済みトークンを削除できなかったため、保存を中止しました。'
              : 'Could not delete the stored token, so the save was aborted.');
          }
        }
        try {
          await cfg.update('feeds', rest, vscode.ConfigurationTarget.Global);
        } catch (e) {
          if (droppedToken != null) {
            try {
              await tokens.set(id, droppedToken);
            } catch (restoreErr) {
              const msg = JA
                ? '設定の保存に失敗し、削除したトークンの復元にも失敗しました。トークンを再入力してください。'
                : 'Saving the settings failed, and restoring the deleted token failed too. Please re-enter the token.';
              vscode.window.showErrorMessage(msg);
              throw new Error(msg);
            }
          }
          throw e;
        }
        if (d.token && entry.auth.type !== 'none') await tokens.set(id, d.token);
        else if (entry.auth.type === 'none' && (await tokens.has(id))) await tokens.delete(id);
        /* Keep the form's edit target in sync with what was just
           saved: storedTokenApplies compares against setupEditFeed.url,
           so leaving the pre-edit entry here would keep matching the
           OLD server while the stored token is already the new one. */
        setupEditFeed = entry;
        post({ type: 'saved' });
        vscode.window.showInformationMessage(JA
          ? `Signboard-Duo: フィード「${entry.name}」を更新しました。`
          : `Signboard-Duo: feed "${entry.name}" updated.`);
        await engine.refreshAll();
        return;
      }
      const id = wizard.uniqueFeedId(idBase, feeds.map((f) => f && f.id));
      const entry = { id, type: d.type, ...fields };
      const pos = Math.min(feeds.length + 1, Math.max(1, Number(d.position) || feeds.length + 1));
      const next = [...feeds];
      next.splice(pos - 1, 0, entry);
      await cfg.update('feeds', next, vscode.ConfigurationTarget.Global);
      if (d.token && entry.auth.type !== 'none') await tokens.set(id, d.token);
      /* The panel becomes this feed's edit form (design §17
         supplement): a further apply updates it in place instead
         of adding a duplicate. */
      setupEditFeed = entry;
      post({ type: 'saved', added: true });
      vscode.window.showInformationMessage(JA
        ? `Signboard-Duo: フィード「${entry.name}」を追加しました。`
        : `Signboard-Duo: feed "${entry.name}" added.`);
      await engine.refreshAll();
      return;
    }
    if (msg.type === 'delete') {
      if (!setupEditFeed) return;
      const id = setupEditFeed.id;
      const name = setupEditFeed.name || id;
      const delLabel = JA ? '削除する' : 'Delete';
      const pick = await vscode.window.showWarningMessage(
        JA
          ? `Signboard-Duo: フィード「${name}」を削除しますか？`
          : `Signboard-Duo: delete the feed "${name}"?`,
        { modal: true }, delLabel
      );
      if (pick !== delLabel) return;
      const cfg = vscode.workspace.getConfiguration(CONFIG_NS);
      const feeds = userFeeds();
      await cfg.update('feeds', feeds.filter((f) => !(f && f.id === id)), vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(JA
        ? `Signboard-Duo: フィード「${name}」を削除しました。`
        : `Signboard-Duo: feed "${name}" deleted.`);
      if (setupPanel) setupPanel.dispose();
      await engine.refreshAll();
      return;
    }
  } catch (err) {
    post({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
}

function openSetupPanel(engine, tokens, context, editFeed) {
  if (setupPanel) { setupPanel.dispose(); setupPanel = null; }
  setupEditFeed = editFeed || null;
  const panel = vscode.window.createWebviewPanel(
    'signboardDuoSetup',
    editFeed
      ? (JA ? 'Signboard-Duo: フィードを編集' : 'Signboard-Duo: Edit Feed')
      : (JA ? 'Signboard-Duo: フィードを追加' : 'Signboard-Duo: Add Feed'),
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    }
  );
  setupPanel = panel;
  panel.onDidDispose(() => { setupPanel = null; setupEditFeed = null; });
  panel.webview.html = setupHtml(panel.webview, context, editFeed);
  panel.webview.onDidReceiveMessage((msg) => { handleSetupMessage(panel, engine, tokens, msg); });
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
    vscode.commands.registerCommand('signboardDuo.startRotation', () => provider.setRotating(true)),
    vscode.commands.registerCommand('signboardDuo.stopRotation', () => provider.setRotating(false)),
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
    vscode.commands.registerCommand('signboardDuo.addCiPlatform', () => openSetupPanel(engine, tokens, context)),
    vscode.commands.registerCommand('signboardDuo.editInterests', () => runEditFeed(engine, tokens, context, provider)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_NS}.mode`)) syncModeContext();
    }),
    { dispose: () => engine.dispose() }
  );
  syncModeContext();
  vscode.commands.executeCommand('setContext', 'signboardDuo.rotating', true);
  vscode.commands.executeCommand('setContext', 'signboardDuo.hasCurrentFeed', false);
  engine.start();
}

function deactivate() {}

/* Test seam: the setup-form handlers are exercised by
   test/setup-save.test.js with a stubbed `vscode` module. */
module.exports = { activate, deactivate, _test: { handleSetupMessage, openSetupPanel } };

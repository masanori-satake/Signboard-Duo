'use strict';
/* Signboard-Duo station LED board renderer (webview) — mask method,
   forked from Signboard-Solo's led.js. Differences: pages are
   platforms (feeds) with a platform banner row, rows are feed topics
   with click-through URLs, the type chip comes from the feed kind,
   and a destination longer than the row scrolls under the mask. */
const vscodeApi = acquireVsCodeApi();
const CFG = Object.assign({ pitch: 3, hole: 38, glow: true }, window.__SB_LED || {});

const SET_SWITCH_MS = 8000;

const TYPE_BY_KIND = {
  generic: ['各停', 'ALL-STOPS', 'c-blue'],
  bamboo: ['快速', 'RAPID', 'c-orange'],
  status: ['特急', 'LTD EXP', 'c-red'],
  jma: ['普通', 'LOCAL', 'c-green'],
};
const TYPE_DEFAULT = TYPE_BY_KIND.generic;
let LANG_JA = false;
let SCROLL = true;
let FETCHED_AT = null;
function defaultTicker() {
  const base = LANG_JA
    ? '本日も Signboard-Duo をご利用くださいまして、ありがとうございます。　この案内板は、RSS / Atom フィードの新着を表示しています。'
    : 'Thank you for using Signboard-Duo today. This board shows the latest topics from your RSS / Atom feeds.';
  if (!FETCHED_AT) return base;
  return base + (LANG_JA ? '　最終取得 ' + hhmm(FETCHED_AT) + '。' : ' Last fetched ' + hhmm(FETCHED_AT) + '.');
}

/* The loop ticker speaks for the line on screen: each feed is a line,
   and the greeting / notices carry its name. */
function loopTickerText() {
  const s = setsCache[currentSet];
  const p = s && s.platform;
  if (!p || p.state === 'nofeeds') return defaultTicker();
  const line = p.name + '線';
  let base;
  if (p.state === 'authError') {
    base = LANG_JA
      ? `本日も${line}のご利用ありがとうございます。現在、認証エラーのため運休しています。トークンを設定してください。`
      : `Thank you for using the ${p.name} line. Service is suspended (authentication error) — please set a token.`;
  } else if (p.state === 'configError') {
    base = LANG_JA
      ? `本日も${line}のご利用ありがとうございます。フィード設定を確認してください。`
      : `Thank you for using the ${p.name} line. Please check the feed settings.`;
  } else if (p.state === 'stale' || p.state === 'error') {
    base = LANG_JA
      ? `本日も${line}のご利用ありがとうございます。接続が不安定です。前回の到着情報を表示しています。`
      : `Thank you for using the ${p.name} line. The connection is unstable; showing the previous arrivals.`;
  } else {
    base = LANG_JA
      ? `本日も${line}のご利用ありがとうございます。${p.rows.length}件が到着しています。`
      : `Thank you for using the ${p.name} line today. ${p.rows.length} topics have arrived.`;
  }
  if (FETCHED_AT) base += LANG_JA ? '　最終取得 ' + hhmm(FETCHED_AT) + '。' : ' Last fetched ' + hhmm(FETCHED_AT) + '.';
  return base;
}

function pad2(v) { return String(v).padStart(2, '0'); }
function hhmm(ms) { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function clockNow() { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }

const board = document.getElementById('board');
const textLayer = document.getElementById('textLayer');
const glowLayer = document.getElementById('glowLayer');
const pagesEl = document.getElementById('pages');

function applyParams() {
  const pitch = Math.min(12, Math.max(3, Number(CFG.pitch) || 3));
  const holePct = Math.min(48, Math.max(25, Number(CFG.hole) || 38));
  board.style.setProperty('--pitch', pitch + 'px');
  board.style.setProperty('--hole', (pitch * holePct / 100).toFixed(2) + 'px');
  board.style.setProperty('--feather', Math.max(0.3, pitch * 0.12).toFixed(2) + 'px');
  glowLayer.style.display = CFG.glow ? '' : 'none';
}

let platforms = [];
let PINNED = false;
let SET_NEED_MS = SET_SWITCH_MS;
let rowsBoxEl = null;
let tickerEl = null;
let prevByKey = new Map();
let currentSet = 0;
let lastSetChange = Date.now();
let lastEventAt = 0;
let setSize = 4;
let tickerText = defaultTicker();
let tickerMode = 'loop';
let tickerOffset = 0;

function stateNote(p) {
  if (p.state === 'nofeeds') return LANG_JA ? 'フィード未設定' : 'NO FEEDS';
  if (p.state === 'authError') return LANG_JA ? '運休（認証エラー）' : 'SUSPENDED (AUTH)';
  if (p.state === 'configError') return LANG_JA ? '設定エラー' : 'CONFIG ERROR';
  if (p.state === 'stale') return LANG_JA ? '情報が古い場合があります' : 'STALE';
  if (p.state === 'error') return LANG_JA ? '取得エラー' : 'FETCH ERROR';
  if (p.state === 'loading') return LANG_JA ? '取得中' : 'LOADING';
  return '';
}
function emptyTitle(p) {
  if (p.state === 'nofeeds') return LANG_JA ? '設定にフィードを追加してください' : 'ADD FEEDS IN SETTINGS';
  if (p.state === 'authError') return LANG_JA ? 'トークンが必要です' : 'TOKEN REQUIRED';
  if (p.state === 'configError') return LANG_JA ? 'フィード設定を確認してください' : 'CHECK FEED SETTINGS';
  if (p.state === 'error') return LANG_JA ? 'フィードを取得できません' : 'FEED UNAVAILABLE';
  return LANG_JA ? 'トピックはまだありません' : 'NO TOPICS YET';
}
/* Flatten platforms into screens: one platform per screen, chunked
   again only when its topics exceed the visible rows. Each flattened
   row carries its platform so banners and announcements can name it. */
function buildSets() {
  const out = [];
  for (const p of platforms) {
    const list = p.rows.length ? p.rows : [{
      key: p.no + ':empty', title: emptyTitle(p), timeMs: null,
      status: 'ontime', remark: '', url: '', empty: true,
    }];
    const flat = list.map((r) => ({ ...r, _no: p.no, _pname: p.name, _kind: p.kind, _pstate: p.state }));
    for (let i = 0; i < flat.length; i += setSize) out.push({ platform: p, rows: flat.slice(i, i + setSize) });
  }
  return out;
}
let setsCache = [];
function refreshSets() { setsCache = buildSets(); }
function jumpToKey(key) {
  if (PINNED) return;
  refreshSets();
  const idx = setsCache.findIndex((s) => s.rows.some((r) => r.key === key));
  if (idx < 0 || idx === currentSet) return;
  currentSet = idx;
  lastSetChange = Date.now();
  buildRows();
}
function announce(text) {
  tickerText = text;
  tickerMode = 'once';
  tickerOffset = null;
  renderTickerText();
}
function statusOf(r) {
  if (r.status === 'failed') return [LANG_JA ? '運休' : 'CANCELLED', 'st-delay'];
  if (r.status === 'updated') return [LANG_JA ? '更新' : 'UPDATED', 'st-next'];
  if (r.status === 'arrived' || r.isNew) return [LANG_JA ? '到着' : 'ARRIVED', 'st-arrived'];
  return ['', ''];
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildAll() {
  textLayer.replaceChildren();
  const head = el('div', 'head');
  head.appendChild(el('span', 'ttl', LANG_JA ? '到着案内' : 'ARRIVALS'));
  head.appendChild(el('span', 'clk', clockNow()));
  textLayer.appendChild(head);
  rowsBoxEl = el('div', 'rows');
  textLayer.appendChild(rowsBoxEl);
  tickerEl = el('div', 'ticker');
  tickerEl.appendChild(el('span', 'scroll'));
  textLayer.appendChild(tickerEl);
  tickerEl.appendChild(pagesEl);
  buildRows();
  renderTickerText();
}

let lastPostedPlatform = null;
let focusDone = false;
function buildRows() {
  const rowsBox = rowsBoxEl;
  if (!rowsBox) return;
  refreshSets();
  if (currentSet >= setsCache.length) currentSet = Math.max(0, setsCache.length - 1);
  rowsBox.replaceChildren();
  const set = setsCache[currentSet];
  if (set) {
    if (set.platform.no !== lastPostedPlatform) {
      lastPostedPlatform = set.platform.no;
      vscodeApi.postMessage({ type: 'platform', no: set.platform.no });
    }
    const p = set.platform;
    const note = stateNote(p);
    const banner = el('div', 'platform-row',
      (LANG_JA ? p.no + '番線　' : 'PLATFORM ' + p.no + '  ') + p.name + (note ? '　— ' + note : ''));
    rowsBox.appendChild(banner);
    for (const r of set.rows) {
      const [labelJa, labelEn, cls] = TYPE_BY_KIND[r._kind] || TYPE_DEFAULT;
      const row = el('div', 'row');
      if (r.url) {
        row.dataset.url = r.url;
        row.addEventListener('click', () => vscodeApi.postMessage({ type: 'open', url: r.url }));
      }
      row.appendChild(el('span', 'type ' + cls, LANG_JA ? labelJa : labelEn));
      const dest = el('span', 'dest');
      const destIn = el('span', 'dest-in', String(r.title || '').toUpperCase());
      dest.appendChild(destIn);
      if (r.status === 'failed') dest.style.color = '#777';
      row.appendChild(dest);
      row.appendChild(el('span', 'time', r.timeMs != null ? hhmm(r.timeMs) : ''));
      const [st, stCls] = statusOf(r);
      row.appendChild(el('span', 'st ' + stCls, st));
      rowsBox.appendChild(row);
    }
  }
  pagesEl.replaceChildren();
  if (setsCache.length > 1) {
    for (let s = 0; s < setsCache.length; s++) {
      pagesEl.appendChild(el('i', s === currentSet ? 'on' : ''));
    }
  }
  syncGlow();
  requestAnimationFrame(applyDestScroll);
}

/* Long destinations scroll under the mask: measure the real overflow
   on the text layer (the glow clone follows via the same class), set
   the travel distance, and let the CSS keyframes hold at both ends. */
function applyDestScroll() {
  SET_NEED_MS = SET_SWITCH_MS;
  if (!SCROLL) return;
  textLayer.querySelectorAll('.dest').forEach((dest) => {
    const inner = dest.querySelector('.dest-in');
    if (!inner) return;
    const overflow = inner.scrollWidth - dest.clientWidth;
    if (overflow > 4) {
      dest.style.setProperty('--dx', -(overflow + 10) + 'px');
      const dur = Math.max(6, Math.min(20, overflow / 12));
      inner.style.animationDuration = dur + 's';
      dest.classList.add('scrolling');
      // The screen may not switch away until the longest destination
      // has been read to its end once.
      SET_NEED_MS = Math.max(SET_NEED_MS, dur * 1000);
    } else {
      dest.classList.remove('scrolling');
    }
  });
  syncGlow();
}

function syncGlow() {
  glowLayer.replaceChildren(...[...textLayer.childNodes].map((n) => n.cloneNode(true)));
}

function scrollEls() { return board.querySelectorAll('.ticker .scroll'); }
function renderTickerText() {
  const text = tickerMode === 'loop' ? (tickerText + '　　　').repeat(2) : tickerText + '　　　';
  scrollEls().forEach((s) => { s.textContent = text; });
  if (tickerMode === 'loop') tickerOffset = 0;
}

function measureSetSize() {
  const row = textLayer.querySelector('.row');
  const head = textLayer.querySelector('.head');
  const ticker = textLayer.querySelector('.ticker');
  if (!row || !head || !ticker) return;
  const rowH = row.offsetHeight;
  if (rowH <= 0) return;
  const fontPx = parseFloat(getComputedStyle(board).fontSize) || 40;
  const used = head.offsetHeight + ticker.offsetHeight + fontPx * 1.1;
  const fit = Math.floor((window.innerHeight - 16 - used) / rowH);
  const next = Math.max(1, Math.min(24, fit));
  if (next !== setSize) {
    setSize = next;
    refreshSets();
    if (currentSet >= setsCache.length) currentSet = Math.max(0, setsCache.length - 1);
    buildRows();
  }
}

function tickClock() {
  const t = clockNow();
  board.querySelectorAll('.clk').forEach((c) => { c.textContent = t; });
}

setInterval(() => {
  if (document.hidden) return;
  const now = Date.now();
  refreshSets();
  if (!PINNED && setsCache.length > 1 && now - lastSetChange >= SET_NEED_MS && now - lastEventAt >= SET_SWITCH_MS) {
    currentSet = (currentSet + 1) % setsCache.length;
    lastSetChange = now;
    buildRows();
    if (tickerMode === 'loop') { tickerText = loopTickerText(); renderTickerText(); }
  }
  const els = scrollEls();
  if (els.length) {
    const main = textLayer.querySelector('.ticker .scroll');
    const w = main ? main.scrollWidth : 0;
    const box = tickerEl;
    if (tickerMode === 'loop') {
      const half = w / 2;
      tickerOffset -= 3;
      if (half > 0 && tickerOffset <= -half) tickerOffset += half;
    } else {
      if (tickerOffset === null) tickerOffset = box ? box.clientWidth : 0;
      tickerOffset -= 3;
      if (w > 0 && tickerOffset < -w) {
        tickerText = loopTickerText();
        tickerMode = 'loop';
        renderTickerText();
      }
    }
    els.forEach((s) => { s.style.transform = 'translateX(' + tickerOffset + 'px)'; });
  }
}, 50);
setInterval(() => { if (!document.hidden) tickClock(); }, 250);

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === 'state') {
    LANG_JA = String(msg.lang || '').toLowerCase().startsWith('ja');
    document.body.dataset.theme = msg.theme || 'duo';
    SCROLL = msg.scroll !== false;
    FETCHED_AT = msg.fetchedAt || null;
    if (typeof msg.pinned === 'boolean') PINNED = msg.pinned;
    const before = prevByKey;
    platforms = msg.platforms || [];
    buildAll();
    if (tickerMode === 'loop') { tickerText = loopTickerText(); renderTickerText(); }
    if (!focusDone) {
      focusDone = true;
      const idx = setsCache.findIndex((s) => s.platform.no === msg.platformNo);
      if (idx > 0) { currentSet = idx; lastSetChange = Date.now(); buildRows(); }
    }
    measureSetSize();
    for (const p of platforms) {
      for (const r of p.rows) {
        if (!before.has(r.key) && r.isNew) {
          lastEventAt = Date.now();
          jumpToKey(r.key);
          announce(LANG_JA
            ? r.title + ' が ' + p.no + '番線 ' + p.name + ' に到着しました'
            : r.title + ' has arrived at platform ' + p.no + ' (' + p.name + ')');
        }
      }
    }
    prevByKey = new Map();
    for (const p of platforms) for (const r of p.rows) prevByKey.set(r.key, r);
  } else if (msg.type === 'event' && msg.key) {
    lastEventAt = Date.now();
    jumpToKey(msg.key);
  } else if (msg.type === 'nav') {
    navSet(msg.dir);
  } else if (msg.type === 'pin') {
    PINNED = !!msg.pinned;
    lastSetChange = Date.now();
  }
});

function navSet(dir) {
  refreshSets();
  if (setsCache.length <= 1) return;
  currentSet = (currentSet + dir + setsCache.length) % setsCache.length;
  lastSetChange = Date.now();
  buildRows();
  if (tickerMode === 'loop') { tickerText = loopTickerText(); renderTickerText(); }
}

let wheelAt = 0;
window.addEventListener('wheel', (e) => {
  const now = Date.now();
  if (now - wheelAt < 350) return;
  wheelAt = now;
  navSet(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

function reportWidth() {
  if (window.__SB_AUTO) vscodeApi.postMessage({ type: 'width', width: window.innerWidth });
}
let resizeAt = 0;
window.addEventListener('resize', () => {
  const now = Date.now();
  if (now - resizeAt < 150) return;
  resizeAt = now;
  reportWidth();
  measureSetSize();
});

applyParams();
buildAll();
measureSetSize();
reportWidth();
vscodeApi.postMessage({ type: 'ready' });

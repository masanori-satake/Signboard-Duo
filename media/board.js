'use strict';
/* Signboard-Duo flap board renderer (webview), forked from
   Signboard-Solo's board.js. Differences: pages are platforms (feeds),
   rows are feed topics with a click-through URL, the name field shows
   the topic title (no extension stripping), and a title longer than
   the tile field flips through in segments instead of truncating. */
const vscodeApi = acquireVsCodeApi();

const CONFIG = { pageRotateMs: 18000, nameTilesLatin: 16, nameTilesCjk: 10, nameTilesLatinMini: 10, nameTilesCjkMini: 7, segmentMs: 4000 };

let LANG_JA = true;
let SCROLL = true;
let STATUS_WORDS = {};
function setLocale(lang) {
  LANG_JA = !lang || lang.toLowerCase().startsWith('ja');
  STATUS_WORDS = LANG_JA
    ? { arrived: '到着', updated: '更新', failed: '欠航' }
    : { arrived: 'ARRIVED', updated: 'UPDATED', failed: 'CANCELLED' };
  document.getElementById('colName').textContent = LANG_JA ? '便名' : 'FLIGHT NAME';
  document.getElementById('colTime').textContent = LANG_JA ? '到着時刻' : 'ARRIVAL';
  document.getElementById('colRemark').textContent = LANG_JA ? '備考' : 'REMARKS';
}
setLocale('ja');

/* ---------- name helpers ---------- */
function hasCjk(t) { return /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(t); }
function tilesFor(title, mini) {
  const cjk = hasCjk(title);
  if (mini) return cjk ? CONFIG.nameTilesCjkMini : CONFIG.nameTilesLatinMini;
  return cjk ? CONFIG.nameTilesCjk : CONFIG.nameTilesLatin;
}
let segTick = 0;
/* Display text for the fixed tile field. Short titles pad out; long
   titles are cut into tile-sized segments that flip through in turn
   (segment index advances on a timer) when scrolling is enabled, and
   fall back to Solo's middle truncation when it is not. */
function displayName(title, tiles) {
  const shown = String(title || '').toUpperCase();
  const chars = [...shown];
  if (chars.length <= tiles) return shown.padEnd(tiles, ' ');
  if (!SCROLL) {
    const head = Math.ceil((tiles - 1) * 0.55), tail = Math.floor((tiles - 1) * 0.45);
    return (chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('')).padEnd(tiles, ' ');
  }
  const segs = [];
  for (let i = 0; i < chars.length; i += tiles) segs.push(chars.slice(i, i + tiles).join(''));
  return segs[segTick % segs.length].padEnd(tiles, ' ');
}
function hhmm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

/* ---------- flap engine: one ticker for every tile (from Solo) ---------- */
const SETS = {
  latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-#@',
  cjk: 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん議事録要件定義設計集計仕様会議顧客売上進捗管理表報告書連絡週次作業画面0123456789._-',
  digit: '0123456789',
};
const FLIP_FRAMES = [
  { transform: 'rotateX(0deg)', filter: 'brightness(1)' },
  { transform: 'rotateX(-70deg)', filter: 'brightness(1.7)', offset: 0.45 },
  { transform: 'rotateX(0deg)', filter: 'brightness(1)' },
];
const FLIP_TIMING = { duration: 130, easing: 'ease-in-out' };
const flapJobs = new Map();
let flapTicker = null;
function ensureFlapTicker() {
  if (flapTicker) return;
  flapTicker = setInterval(() => {
    if (document.hidden) return;
    const now = performance.now();
    for (const [cell, job] of flapJobs) {
      if (now < job.startAt) continue;
      job.steps--;
      if (job.steps <= 0) { cell.textContent = job.target; flapJobs.delete(cell); }
      else {
        cell.textContent = job.set[Math.floor(Math.random() * job.set.length)];
        if (cell.animate) cell.animate(FLIP_FRAMES, FLIP_TIMING);
      }
    }
    if (!flapJobs.size) { clearInterval(flapTicker); flapTicker = null; }
  }, 82);
}
function flapCell(cell, target, set, delay) {
  if (target === ' ') { flapJobs.delete(cell); cell.textContent = ' '; return; }
  const same = cell.textContent === target;
  const steps = same ? 3 : 6 + Math.floor(Math.random() * 5);
  flapJobs.set(cell, { target, set, steps, startAt: performance.now() + delay });
  ensureFlapTicker();
}
function setCells(container, text, flapAll, set) {
  const chars = [...text];
  while (container.children.length < chars.length) {
    const c = document.createElement('span');
    c.className = 'cell'; c.textContent = ' ';
    container.appendChild(c);
  }
  while (container.children.length > chars.length) container.removeChild(container.lastChild);
  chars.forEach((ch, i) => {
    const cell = container.children[i];
    if (flapAll || cell.textContent !== ch) flapCell(cell, ch, set, i * 85);
    else cell.textContent = ch;
  });
}
function setTimeCells(container, ms, flapAll) {
  if (ms == null) { container.replaceChildren(); return; }
  const t = hhmm(ms);
  const seq = [t[0], t[1], ':', t[3], t[4]];
  if (!container.children.length) {
    seq.forEach((ch) => {
      const c = document.createElement('span');
      c.className = 'cell' + (ch === ':' ? ' colon' : '');
      c.textContent = ch;
      container.appendChild(c);
    });
  }
  seq.forEach((ch, i) => {
    if (ch === ':') return;
    const cell = container.children[i];
    if (flapAll || cell.textContent !== ch) flapCell(cell, ch, SETS.digit, i * 115);
  });
}
const remarkTimers = new WeakMap();
function setRemark(container, text, flap) {
  let plate = container.querySelector('.remark-plate');
  if (!plate) {
    plate = document.createElement('span');
    plate.className = 'cell remark-plate';
    container.replaceChildren(plate);
    plate.textContent = text; plate.dataset.text = text;
    return;
  }
  const timer = remarkTimers.get(plate);
  if (plate.dataset.text === text) {
    if (!timer) plate.textContent = text;
    return;
  }
  if (timer) { clearInterval(timer); remarkTimers.delete(plate); }
  if (!flap) { plate.textContent = text; plate.dataset.text = text; return; }
  plate.dataset.text = text;
  const words = Object.values(STATUS_WORDS);
  const steps = 4 + Math.floor(Math.random() * 3);
  let s = 0;
  const iv = setInterval(() => {
    s++;
    if (plate.animate) plate.animate(FLIP_FRAMES, FLIP_TIMING);
    if (s >= steps) { plate.textContent = text; clearInterval(iv); remarkTimers.delete(plate); }
    else plate.textContent = words[Math.floor(Math.random() * words.length)] || text;
  }, 165);
  remarkTimers.set(plate, iv);
}

/* ---------- kind chips (replaces Solo's language logos) ---------- */
const CHIPS = { generic: 'RSS', bamboo: 'CI', status: 'STS', jma: 'WX' };
function chipEl(kind) {
  const d = document.createElement('span');
  d.className = 'logo generic';
  d.textContent = CHIPS[kind] || 'RSS';
  return d;
}

/* ---------- board state: pages are platform chunks ---------- */
const rowsEl = document.getElementById('rows');
const boardEl = document.getElementById('board');
const platformEl = document.getElementById('platform');
let platforms = [];
let FETCHED_AT = null;
let PINNED = false;
let PAGE_NEED_MS = CONFIG.pageRotateMs;
let currentPage = 0;
let lastPageChange = Date.now();
let lastEventAt = 0;
let tier = 'wide';
let prevByKey = new Map();

function computeTier() {
  const w = window.innerWidth;
  tier = w >= 540 ? 'wide' : w >= 240 ? 'narrow' : 'mini';
  boardEl.dataset.tier = tier;
}
let measuredRowH = 0;
function rowsPerPage() {
  const rowH = measuredRowH || (tier === 'wide' ? 41 : 74);
  const avail = rowsEl.clientHeight || Math.max(rowH, window.innerHeight - 132);
  return Math.max(1, Math.floor(avail / rowH));
}
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
/* Flatten platforms into pages: one platform per page, chunked again
   only when its topics exceed the visible rows. */
function buildPages() {
  const per = rowsPerPage();
  const out = [];
  for (const p of platforms) {
    const list = p.rows.length ? p.rows : [{
      key: p.no + ':empty', title: emptyTitle(p), timeMs: null,
      status: 'ontime', remark: '', url: '', empty: true,
    }];
    for (let i = 0; i < list.length; i += per) out.push({ platform: p, rows: list.slice(i, i + per) });
  }
  return out;
}
let pagesCache = [];
function refreshPages() { pagesCache = buildPages(); }

function rowElFor(r) {
  let row = rowsEl.querySelector('.row[data-key="' + CSS.escape(r.key) + '"]');
  if (!row) {
    row = document.createElement('div');
    row.className = 'row'; row.dataset.key = r.key;
    const lg = document.createElement('span'); lg.dataset.role = 'logo';
    const name = document.createElement('div'); name.className = 'cells name';
    const meta = document.createElement('div'); meta.className = 'meta';
    const time = document.createElement('div'); time.className = 'cells time';
    const rem = document.createElement('div'); rem.className = 'cells remark';
    meta.append(time, rem);
    row.append(lg, name, meta);
    row._name = name; row._time = time; row._rem = rem; row._logo = lg;
    row.addEventListener('click', () => {
      if (row.dataset.url) vscodeApi.postMessage({ type: 'open', url: row.dataset.url });
    });
  }
  return row;
}

function render(pageChanged) {
  computeTier();
  refreshPages();
  const pg = Math.max(1, pagesCache.length);
  if (currentPage >= pg) currentPage = pg - 1;
  const page = pagesCache[currentPage];
  const slice = page ? page.rows : [];
  const keep = new Set(slice.map((r) => r.key));
  rowsEl.querySelectorAll('.row').forEach((el) => { if (!keep.has(el.dataset.key)) el.remove(); });
  if (page) {
    const p = page.platform;
    const note = stateNote(p);
    platformEl.textContent = (LANG_JA ? p.no + '番滑走路　' : 'RUNWAY ' + p.no + '  ') + p.name + (note ? '　— ' + note : '');
  } else {
    platformEl.textContent = '';
  }
  // How long this page needs before it may rotate away: the longest
  // title on it must get through all of its segments once.
  PAGE_NEED_MS = CONFIG.pageRotateMs;
  if (SCROLL) {
    for (const r of slice) {
      const tiles = tilesFor(r.title, tier === 'mini');
      const len = [...String(r.title || '')].length;
      if (len > tiles) {
        PAGE_NEED_MS = Math.max(PAGE_NEED_MS, Math.ceil(len / tiles) * CONFIG.segmentMs);
      }
    }
  }
  slice.forEach((r) => {
    const row = rowElFor(r);
    rowsEl.appendChild(row);
    row.dataset.url = r.url || '';
    row.title = r.title || '';
    const prev = prevByKey.get(r.key);
    const tiles = tilesFor(r.title, tier === 'mini');
    const disp = displayName(r.title, tiles);
    const flapName = pageChanged || !prev || prev.disp !== disp;
    const flapTime = pageChanged || !prev || prev.timeMs !== r.timeMs;
    const remarkText = STATUS_WORDS[r.status] || (r.remark ? [...r.remark].slice(0, 14).join('') : '');
    const flapRem = pageChanged || !prev || prev.remarkText !== remarkText;
    row.className = 'row st-' + r.status + (r.isNew ? ' is-new' : '');
    row._logo.replaceChildren(chipEl(page.platform.kind));
    const cjk = hasCjk(r.title);
    row._name.classList.toggle('cjk', cjk);
    setCells(row._name, disp, flapName, cjk ? SETS.cjk : SETS.latin);
    setTimeCells(row._time, r.timeMs, flapTime);
    setRemark(row._rem, remarkText, flapRem);
    prevByKey.set(r.key, { disp, timeMs: r.timeMs, remarkText });
  });
  const firstRow = rowsEl.querySelector('.row');
  if (firstRow && firstRow.offsetHeight > 0 && firstRow.offsetHeight !== measuredRowH) {
    measuredRowH = firstRow.offsetHeight;
    const before = pagesCache.length;
    refreshPages();
    if (pagesCache.length !== before) { render(pageChanged); return; }
  }
  document.getElementById('pageInfo').textContent = pg > 1 ? 'PAGE ' + (currentPage + 1) + ' / ' + pg : '';
  document.getElementById('fetchInfo').textContent = FETCHED_AT
    ? (LANG_JA ? '最終取得 ' + hhmm(FETCHED_AT) : 'FETCHED ' + hhmm(FETCHED_AT)) : '';
  const topicCount = platforms.reduce((n, p) => n + p.rows.length, 0);
  document.getElementById('flightCount').textContent = topicCount
    ? (LANG_JA ? topicCount + ' 件' : topicCount + (topicCount === 1 ? ' TOPIC' : ' TOPICS')) : '';
}

function jumpToKey(key) {
  if (PINNED) return;
  refreshPages();
  const idx = pagesCache.findIndex((pg) => pg.rows.some((r) => r.key === key));
  if (idx < 0 || idx === currentPage) return;
  currentPage = idx;
  lastPageChange = Date.now();
  render(true);
}

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === 'state') {
    setLocale(msg.lang);
    SCROLL = msg.scroll !== false;
    FETCHED_AT = msg.fetchedAt || null;
    if (typeof msg.pinned === 'boolean') PINNED = msg.pinned;
    platforms = msg.platforms || [];
    render(false);
    for (const p of platforms) {
      const fresh = p.rows.find((r) => r.isNew);
      if (fresh) { lastEventAt = Date.now(); jumpToKey(fresh.key); break; }
    }
  } else if (msg.type === 'event' && msg.key) {
    lastEventAt = Date.now();
    jumpToKey(msg.key);
  } else if (msg.type === 'nav') {
    refreshPages();
    if (pagesCache.length > 1) {
      currentPage = (currentPage + msg.dir + pagesCache.length) % pagesCache.length;
      lastPageChange = Date.now();
      render(true);
    }
  } else if (msg.type === 'pin') {
    PINNED = !!msg.pinned;
    lastPageChange = Date.now();
  }
});

let wheelAt = 0;
window.addEventListener('wheel', (e) => {
  const now = Date.now();
  refreshPages();
  if (now - wheelAt < 350 || pagesCache.length <= 1) return;
  wheelAt = now;
  currentPage = (currentPage + (e.deltaY > 0 ? 1 : -1) + pagesCache.length) % pagesCache.length;
  lastPageChange = now;
  render(true);
}, { passive: true });

function reportWidth() {
  if (window.__SB_AUTO) vscodeApi.postMessage({ type: 'width', width: window.innerWidth });
}
let resizeAt = 0;
window.addEventListener('resize', () => {
  const now = Date.now();
  if (now - resizeAt < 120) return;
  resizeAt = now;
  reportWidth();
  render(false);
});

setInterval(() => {
  if (document.hidden || PINNED) return;
  refreshPages();
  if (pagesCache.length <= 1) return;
  const now = Date.now();
  if (now - lastPageChange >= PAGE_NEED_MS && now - lastEventAt >= CONFIG.pageRotateMs) {
    currentPage = (currentPage + 1) % pagesCache.length;
    lastPageChange = now;
    render(true);
  }
}, 1000);

/* Long titles advance one segment per interval, but only the visible
   page's name cells re-flip (render diffs against the last display). */
setInterval(() => {
  if (document.hidden || !SCROLL) return;
  segTick++;
  render(false);
}, CONFIG.segmentMs);

/* ---------- header clock: 7-segment, colon blinks (from Solo) ---------- */
const SEG_MAP = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg' };
const clockEl = document.getElementById('clock');
const clockDigits = [];
for (let i = 0; i < 8; i++) {
  if (i === 2 || i === 5) {
    const col = document.createElement('span');
    col.className = 'seg-colon';
    col.innerHTML = '<i class="cdot"></i><i class="cdot"></i>';
    clockEl.appendChild(col);
  } else {
    const dig = document.createElement('span');
    dig.className = 'seg-digit';
    for (const s of 'abcdefg') {
      const seg = document.createElement('i');
      seg.className = 'seg seg-' + s;
      dig.appendChild(seg);
    }
    clockEl.appendChild(dig);
    clockDigits.push(dig);
  }
}
function tickClock() {
  const d = new Date();
  const parts = [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join('');
  [...parts].forEach((ch, i) => {
    const on = SEG_MAP[ch];
    clockDigits[i].querySelectorAll('.seg').forEach((seg) => {
      const name = [...seg.classList].find((c) => c.startsWith('seg-')).slice(4);
      seg.classList.toggle('on', on.includes(name));
    });
  });
  const blink = d.getSeconds() % 2 === 0;
  clockEl.querySelectorAll('.cdot').forEach((c) => c.classList.toggle('on', blink));
}
setInterval(tickClock, 1000);
tickClock();

computeTier();
reportWidth();
vscodeApi.postMessage({ type: 'ready' });

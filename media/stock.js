'use strict';
/* Signboard-Duo — stock board renderer.
   A securities-board layout: every row is zoned — the name zone never
   scrolls, the price zone is big and right-aligned, the change zone
   carries the direction colour (Japanese convention: red up, green
   down), and the time zone stays quiet. Rows from non-stock feeds
   (no price) fall back to name + remark + time. */
const vscodeApi = acquireVsCodeApi();

const PER_PAGE = 8;
const ROTATE_MS = 12000;

let platforms = [];
let FETCHED_AT = null;
let PINNED = false;
let LANG_JA = false;
let currentPage = 0;
let lastPageChange = Date.now();
const prevPrice = new Map();

const boardEl = document.getElementById('board');
const platformEl = document.getElementById('platform');
const rowsEl = document.getElementById('rows');
const pageInfoEl = document.getElementById('pageInfo');
const fetchInfoEl = document.getElementById('fetchInfo');
const clockEl = document.getElementById('clock');

function pad2(v) { return String(v).padStart(2, '0'); }
function hhmm(ms) { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function clockNow() { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function fmtPrice(v) {
  if (v == null) return '';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtSigned(v, digits) {
  if (v == null) return '';
  const s = v > 0 ? '+' : v < 0 ? '-' : '';
  return s + Math.abs(v).toFixed(digits);
}
function dirOf(r) {
  const c = r.changePct != null ? r.changePct : r.change;
  if (c == null || c === 0) return 'flat';
  return c > 0 ? 'up' : 'down';
}

function buildPages() {
  const pages = [];
  for (const p of platforms) {
    const rows = p.rows.length ? p.rows : [{
      key: p.no + ':empty', title: LANG_JA ? 'データがありません' : 'No data', timeMs: null,
      price: null, change: null, changePct: null, remark: '', url: '', empty: true,
    }];
    for (let i = 0; i < rows.length; i += PER_PAGE) {
      pages.push({ platform: p, rows: rows.slice(i, i + PER_PAGE) });
    }
  }
  return pages;
}

function stateNote(p) {
  if (p.state === 'authError') return LANG_JA ? '（認証エラーのため停止中）' : ' (suspended: auth)';
  if (p.state === 'configError') return LANG_JA ? '（設定を確認してください）' : ' (check settings)';
  if (p.state === 'stale' || p.state === 'error') return LANG_JA ? '（接続が不安定です）' : ' (connection unstable)';
  if (p.state === 'nofeeds') return LANG_JA ? '（フィード未設定）' : ' (no feeds configured)';
  return '';
}

function render() {
  const pages = buildPages();
  if (currentPage >= pages.length) currentPage = 0;
  const page = pages[currentPage];
  if (!page) { platformEl.textContent = ''; rowsEl.replaceChildren(); return; }
  const p = page.platform;
  platformEl.textContent = (LANG_JA ? `${p.no}番市場　${p.name}` : `MARKET ${p.no}  ${p.name}`) + stateNote(p);

  const frag = document.createDocumentFragment();
  for (const r of page.rows) {
    const row = document.createElement('div');
    const dir = dirOf(r);
    row.className = 'row dir-' + dir + (r.empty ? ' empty' : '');
    row.title = r.title + (r.remark ? `\n${r.remark}` : '');

    const name = document.createElement('span');
    name.className = 'z-name';
    name.textContent = r.title;
    row.appendChild(name);

    const price = document.createElement('span');
    price.className = 'z-price';
    if (r.price != null) {
      price.textContent = fmtPrice(r.price);
      const before = prevPrice.get(r.key);
      if (before != null && before !== r.price) price.classList.add('flash');
      prevPrice.set(r.key, r.price);
    } else {
      price.textContent = r.remark || '';
      price.classList.add('note');
    }
    row.appendChild(price);

    const chg = document.createElement('span');
    chg.className = 'z-chg';
    if (r.price != null && (r.change != null || r.changePct != null)) {
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '─';
      const pct = r.changePct != null ? ` (${fmtSigned(r.changePct, 2)}%)` : '';
      chg.textContent = `${arrow} ${fmtSigned(r.change, 2)}${pct}`;
    }
    row.appendChild(chg);

    const time = document.createElement('span');
    time.className = 'z-time';
    time.textContent = r.timeMs ? hhmm(r.timeMs) : '';
    row.appendChild(time);

    if (r.url) {
      row.dataset.url = r.url;
      row.addEventListener('click', () => vscodeApi.postMessage({ type: 'open', url: r.url }));
    }
    frag.appendChild(row);
  }
  rowsEl.replaceChildren(frag);
  pageInfoEl.textContent = pages.length > 1 ? `PAGE ${currentPage + 1} / ${pages.length}` : '';
  fetchInfoEl.textContent = FETCHED_AT
    ? (LANG_JA ? '最終取得 ' : 'Fetched ') + hhmm(FETCHED_AT) : '';
}

function gotoPage(idx, pages) {
  currentPage = ((idx % pages.length) + pages.length) % pages.length;
  lastPageChange = Date.now();
  render();
}

setInterval(() => {
  if (document.hidden) return;
  clockEl.textContent = clockNow();
  const pages = buildPages();
  if (!PINNED && pages.length > 1 && Date.now() - lastPageChange >= ROTATE_MS) {
    gotoPage(currentPage + 1, pages);
  }
}, 500);

window.addEventListener('wheel', (e) => {
  const pages = buildPages();
  if (pages.length <= 1) return;
  gotoPage(currentPage + (e.deltaY > 0 ? 1 : -1), pages);
}, { passive: true });

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === 'state') {
    LANG_JA = String(msg.lang || '').toLowerCase().startsWith('ja');
    document.body.dataset.theme = msg.theme || 'duo';
    FETCHED_AT = msg.fetchedAt || null;
    if (typeof msg.pinned === 'boolean') PINNED = msg.pinned;
    platforms = msg.platforms || [];
    document.getElementById('boardTitle').textContent = LANG_JA ? '株価' : 'QUOTES';
    document.getElementById('colName').textContent = LANG_JA ? '銘柄' : 'NAME';
    document.getElementById('colPrice').textContent = LANG_JA ? '現在値' : 'LAST';
    document.getElementById('colChg').textContent = LANG_JA ? '前日比' : 'CHANGE';
    document.getElementById('colTime').textContent = LANG_JA ? '時刻' : 'TIME';
    render();
  } else if (msg.type === 'nav') {
    const pages = buildPages();
    if (pages.length > 1) gotoPage(currentPage + msg.dir, pages);
  } else if (msg.type === 'pin') {
    PINNED = !!msg.pinned;
    lastPageChange = Date.now();
  }
});

function reportWidth() {
  if (window.__SB_AUTO) vscodeApi.postMessage({ type: 'width', width: window.innerWidth });
}
window.addEventListener('resize', reportWidth);
reportWidth();
vscodeApi.postMessage({ type: 'ready' });

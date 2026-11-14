'use strict';
/* Signboard-Duo — stock board renderer.
   Modelled on the blue quote panels of securities firms / bank HQs:
   each instrument is a royal-blue panel — name and symbol in the head,
   the current price big and white, the change zone coloured by
   direction (Japanese convention: red up, green down), and a quiet
   detail strip with Open / High / Low. Rows from non-stock feeds
   (no price) fall back to a slim dark row. */
const vscodeApi = acquireVsCodeApi();

const PER_PAGE = 4;
const ROTATE_MS = 12000;

let platforms = [];
let FETCHED_AT = null;
let PINNED = false;
let LANG_JA = false;
let currentPage = 0;
let lastPageChange = Date.now();
const prevPrice = new Map();

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
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
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

function quotePanel(r) {
  const dir = dirOf(r);
  const panel = el('div', 'panel dir-' + dir);
  panel.title = r.title + (r.remark ? `\n${r.remark}` : '');

  const head = el('div', 'p-head');
  head.appendChild(el('span', 'p-name', r.title));
  if (r.remark) head.appendChild(el('span', 'p-sym', r.remark));
  head.appendChild(el('span', 'p-time', r.timeMs ? hhmm(r.timeMs) : ''));
  panel.appendChild(head);

  const main = el('div', 'p-main');
  const price = el('span', 'p-price', fmtPrice(r.price));
  const before = prevPrice.get(r.key);
  if (before != null && before !== r.price) price.classList.add('flash');
  prevPrice.set(r.key, r.price);
  main.appendChild(price);
  const chg = el('span', 'p-chg');
  if (r.change != null || r.changePct != null) {
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '─';
    chg.appendChild(el('span', 'p-chg-v', `${arrow} ${fmtSigned(r.change, 2)}`));
    if (r.changePct != null) chg.appendChild(el('span', 'p-chg-p', fmtSigned(r.changePct, 2) + '%'));
  }
  main.appendChild(chg);
  panel.appendChild(main);

  if (r.open != null || r.high != null || r.low != null) {
    const det = el('div', 'p-det');
    const cells = [
      [LANG_JA ? '始値' : 'Open', r.open],
      [LANG_JA ? '高値' : 'High', r.high],
      [LANG_JA ? '安値' : 'Low', r.low],
    ];
    for (const [label, v] of cells) {
      const c = el('span', 'p-det-c');
      c.appendChild(el('span', 'p-det-l', label));
      c.appendChild(el('span', 'p-det-v', fmtPrice(v)));
      det.appendChild(c);
    }
    panel.appendChild(det);
  }
  return panel;
}

function plainRow(r) {
  const row = el('div', 'row plain' + (r.empty ? ' empty' : ''));
  row.title = r.title || '';
  row.appendChild(el('span', 'z-name', r.title));
  row.appendChild(el('span', 'z-note', r.remark || ''));
  row.appendChild(el('span', 'z-time', r.timeMs ? hhmm(r.timeMs) : ''));
  if (r.url) {
    row.dataset.url = r.url;
    row.addEventListener('click', () => vscodeApi.postMessage({ type: 'open', url: r.url }));
  }
  return row;
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
    frag.appendChild(r.price != null ? quotePanel(r) : plainRow(r));
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

let wheelAt = 0;
window.addEventListener('wheel', (e) => {
  const now = Date.now();
  if (now - wheelAt < 350) return;
  wheelAt = now;
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

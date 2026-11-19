'use strict';

/* Pure RSS 1.0 (RDF) / RSS 2.0 / Atom parser for Signboard-Duo.
   No dependencies and no vscode import, so it can be unit-tested with
   node --test against real-feed fixtures. Deliberately tiny: it builds a
   shallow element tree and reads only the fields the board needs.
   External entities are never resolved (DOCTYPE bodies are skipped). */

function localName(tag) {
  const i = tag.indexOf(':');
  return i >= 0 ? tag.slice(i + 1) : tag;
}

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      /* Surrogate code points are not characters: decoding one
         would bake a lone surrogate into the stored title. */
      const ok = Number.isFinite(code) && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF);
      return ok ? String.fromCodePoint(code) : m;
    }
    switch (body) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      case 'nbsp': return ' ';
      default: return m;
    }
  });
}

/* Minimal XML tokenizer -> element tree.
   Node: { name (local), attrs {localName: value}, children [], segs [{t, cdata}] } */
function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], segs: [] };
  const stack = [root];
  /* Open elements indexed by name: name -> ascending stack
     positions, mirroring the stack exactly (a close tag removes
     its element and everything above it from both). A close tag
     used to scan the whole stack for its match, so a feed of n
     opens followed by n non-matching closes cost O(n^2) —
     measured 81 s at 273 KB, well inside the 1 MB body cap:
     one hostile or compromised feed could freeze the extension
     host for minutes. With the index the match lookup is O(1),
     and each element leaves the index exactly once (when it is
     popped), so the whole parse stays linear. */
  const openByName = new Map();
  const top = () => stack[stack.length - 1];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { pushText(top(), xml.slice(i)); break; }
    if (lt > i) pushText(top(), xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      const raw = end < 0 ? xml.slice(lt + 9) : xml.slice(lt + 9, end);
      top().segs.push({ t: raw, cdata: true });
      i = end < 0 ? n : end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      i = end < 0 ? n : end + 2;
    } else if (xml.startsWith('<!', lt)) {
      // DOCTYPE and friends: skip to '>' without resolving anything.
      const end = xml.indexOf('>', lt + 2);
      i = end < 0 ? n : end + 1;
    } else if (xml.startsWith('</', lt)) {
      const end = xml.indexOf('>', lt + 2);
      /* The local name is computed once, here — never inside a scan. */
      const closeName = localName(end < 0 ? '' : xml.slice(lt + 2, end).trim());
      /* Close the nearest matching open element (and anything left
         open inside it); a close tag that matches nothing is ignored.
         Popping blindly would let one stray close tag in a hostile
         or sloppy feed evict a legitimate parent and scramble the
         tree. The popped elements leave the name index in the same
         pass: their entries are the topmost of their names' lists,
         because the popped range is a suffix of the stack. */
      const list = openByName.get(closeName);
      if (list && list.length) {
        const target = list[list.length - 1];
        for (let d = stack.length - 1; d >= target; d--) {
          const l = openByName.get(stack[d].name);
          l.pop();
          if (!l.length) openByName.delete(stack[d].name);
        }
        stack.length = target;
      }
      i = end < 0 ? n : end + 1;
    } else {
      const end = xml.indexOf('>', lt + 1);
      if (end < 0) break;
      let inner = xml.slice(lt + 1, end);
      const selfClose = inner.endsWith('/');
      if (selfClose) inner = inner.slice(0, -1);
      const sp = inner.search(/\s/);
      const rawName = sp < 0 ? inner : inner.slice(0, sp);
      const node = { name: localName(rawName), attrs: parseAttrs(sp < 0 ? '' : inner.slice(sp + 1)), children: [], segs: [] };
      top().children.push(node);
      if (!selfClose) {
        const l = openByName.get(node.name);
        if (l) l.push(stack.length); else openByName.set(node.name, [stack.length]);
        stack.push(node);
      }
      i = end + 1;
    }
  }
  return root;
}

function pushText(node, s) {
  if (s) node.segs.push({ t: s, cdata: false });
}

/* Linear attribute scanner. The obvious regex for this
   (name\s*=\s*"value") backtracks quadratically on a tag interior
   that is one long run of word characters with no '=' — measured
   33 s at 160 KB, and a tag interior can approach the 1 MB body
   cap, which would freeze the extension host for minutes on a
   single hostile feed. Scanning by hand keeps it O(n). Only
   quoted values are recognised, exactly as the regex did. */
function parseAttrs(s) {
  const attrs = {};
  const n = s.length;
  const isNameChar = (c) => /[\w:.-]/.test(c);
  let i = 0;
  while (i < n) {
    while (i < n && !isNameChar(s[i])) i++;
    if (i >= n) break;
    const nameStart = i;
    while (i < n && isNameChar(s[i])) i++;
    const name = s.slice(nameStart, i);
    while (i < n && /\s/.test(s[i])) i++;
    if (s[i] !== '=') continue; // valueless attribute: not recognised
    i++;
    while (i < n && /\s/.test(s[i])) i++;
    const q = s[i];
    if (q !== '"' && q !== "'") continue; // unquoted value: not recognised
    i++;
    const valStart = i;
    while (i < n && s[i] !== q) i++;
    attrs[localName(name)] = decodeEntities(s.slice(valStart, i));
    if (i < n) i++; // the closing quote
  }
  return attrs;
}

function child(node, name) {
  return node ? node.children.find((c) => c.name === name) || null : null;
}
function children(node, name) {
  return node ? node.children.filter((c) => c.name === name) : [];
}
function textOf(node) {
  if (!node) return '';
  return node.segs.map((s) => (s.cdata ? s.t : decodeEntities(s.t))).join('').trim();
}
/* Pre-order text collection, iteratively: the recursive version
   threw RangeError on descriptions nested ~20k elements deep
   (well inside the body cap), permanently format-erroring such a
   feed. The explicit stack keeps the same document order. */
function deepText(node) {
  if (!node) return '';
  let out = '';
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    out += cur.segs.map((s) => (s.cdata ? s.t : decodeEntities(s.t))).join('');
    for (let i = cur.children.length - 1; i >= 0; i--) stack.push(cur.children[i]);
  }
  return out;
}

/* Cap by code points, not UTF-16 units — a plain slice can split a
   surrogate pair and bake a lone surrogate into the stored title. */
function capCp(s, n) {
  const a = [...String(s)];
  return a.length > n ? a.slice(0, n).join('') : String(s);
}

function stripMarkup(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normTitle(s) {
  return capCp(String(s || '').replace(/\s+/g, ' ').trim(), 200);
}

/* RFC 822 and ISO 8601 both go through Date.parse; returns ms or null. */
function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(String(s).trim());
  return Number.isFinite(t) ? t : null;
}

function remarkFrom(itemNode, descName) {
  const cat = child(itemNode, 'category');
  const catText = cat ? (cat.attrs.term || textOf(cat)) : '';
  if (catText) return capCp(normTitle(catText), 80);
  const desc = child(itemNode, descName);
  /* deepText decodes, then stripMarkup strips the (now literal) tags
     and decodes once more: publishers escape their HTML, so &lt;p&gt;
     is markup to remove, not text to show. The second decode is what
     makes that work — do not "fix" it away. */
  const text = desc ? stripMarkup(deepText(desc)) : '';
  return capCp(text, 80);
}

function toItem(raw) {
  const title = normTitle(raw.title);
  if (!title) return null;
  return {
    guid: raw.guid || raw.link || `${title}|${raw.timeMs || ''}`,
    title,
    link: raw.link || '',
    timeMs: raw.timeMs != null ? raw.timeMs : null,
    remark: raw.remark || '',
  };
}

/* Parse any supported feed. fetchedAtMs is used only as a display
   fallback upstream; items keep timeMs=null when the feed gives no date.
   Returns { format, title, items } with items newest-first when dated. */
function parseFeed(xml) {
  const doc = parseXml(String(xml));
  const rootEl = doc.children[0];
  if (!rootEl) throw new Error('empty feed document');

  let format = null;
  let title = '';
  let items = [];

  if (rootEl.name === 'feed') {
    format = 'atom';
    title = textOf(child(rootEl, 'title'));
    items = children(rootEl, 'entry').map((e) => toItem({
      guid: textOf(child(e, 'id')),
      title: textOf(child(e, 'title')),
      link: atomLink(e),
      timeMs: parseDate(textOf(child(e, 'published')) || textOf(child(e, 'updated'))),
      remark: remarkFrom(e, 'summary'),
    }));
  } else if (rootEl.name === 'rss') {
    format = 'rss2';
    const ch = child(rootEl, 'channel');
    title = textOf(child(ch, 'title'));
    items = children(ch, 'item').map((it) => toItem({
      guid: textOf(child(it, 'guid')),
      title: textOf(child(it, 'title')),
      link: textOf(child(it, 'link')),
      timeMs: parseDate(textOf(child(it, 'pubDate')) || textOf(child(it, 'date'))),
      remark: remarkFrom(it, 'description'),
    }));
  } else if (rootEl.name === 'RDF') {
    format = 'rss1';
    const ch = child(rootEl, 'channel');
    title = textOf(child(ch, 'title'));
    items = children(rootEl, 'item').map((it) => toItem({
      guid: it.attrs.about || textOf(child(it, 'link')),
      title: textOf(child(it, 'title')),
      link: textOf(child(it, 'link')),
      timeMs: parseDate(textOf(child(it, 'date'))),
      remark: remarkFrom(it, 'description'),
    }));
  } else {
    throw new Error(`unsupported feed root: ${rootEl.name}`);
  }

  items = items.filter(Boolean);
  items.sort((a, b) => (b.timeMs || 0) - (a.timeMs || 0));
  return { format, title: normTitle(title), items };
}

function atomLink(entry) {
  const links = children(entry, 'link');
  const alt = links.find((l) => !l.attrs.rel || l.attrs.rel === 'alternate');
  return alt ? alt.attrs.href || '' : '';
}

/* Stock quotes (kind: "stock"): a JSON endpoint in the CNBC quote
   shape — FormattedQuoteResult.FormattedQuote[] with symbol / last /
   change / change_pct / last_time — or a plain array of objects with
   the same field names. Returned in the same item shape as parseFeed,
   with price / change / changePct attached. Entries the provider marks
   with a non-zero code, and entries without a numeric price, are
   dropped. */
function parseQuotes(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { title: '', items: [] }; }
  let list = [];
  if (data && data.FormattedQuoteResult && Array.isArray(data.FormattedQuoteResult.FormattedQuote)) {
    list = data.FormattedQuoteResult.FormattedQuote;
  } else if (Array.isArray(data)) {
    list = data;
  }
  const num = (v) => {
    const n = parseFloat(String(v == null ? '' : v).replace(/[,%+]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const items = [];
  for (const q of list) {
    if (!q) continue;
    if (q.code != null && Number(q.code) !== 0) continue;
    const symbol = String(q.symbol || '').trim();
    if (!symbol) continue;
    const price = num(q.last);
    if (price == null) continue;
    const t = Date.parse(q.last_time || q.time || '');
    items.push({
      guid: symbol,
      title: normTitle(q.shortName || q.name || symbol),
      link: '',
      remark: symbol,
      timeMs: Number.isFinite(t) ? t : null,
      price,
      change: num(q.change),
      changePct: num(q.change_pct),
      open: num(q.open),
      high: num(q.high),
      low: num(q.low),
    });
  }
  return { title: '', items };
}

/* CI build-result titles are formulaic across servers — a job name,
   a build number, and a result word. Read the verdict off the title
   and hand back the title with the result words removed: the board's
   failed styling carries the result, while the build number stays
   (it is the run's identity). failed is true / false / null (no
   verdict found); the title is only rewritten when a verdict was. */
function ciVerdict(rawTitle) {
  const title = String(rawTitle || '');
  let m;
  // Jenkins: "Job #123 (SUCCESS|FAILURE|UNSTABLE|ABORTED|NOT_BUILT)"
  if ((m = title.match(/^(.*?)\s*\((SUCCESS|FAILURE|UNSTABLE|ABORTED|NOT_BUILT)\)\s*$/i))) {
    return { failed: /FAILURE|UNSTABLE|ABORTED/i.test(m[2]), title: m[1].trim() };
  }
  // Bamboo and friends: "Plan #45 was successful" / "Plan #45 has failed"
  if ((m = title.match(/^(.*?)\s+(?:was|has)\s+(successful|success|failed|failure)\s*$/i))) {
    return { failed: /fail/i.test(m[2]), title: m[1].trim() };
  }
  if ((m = title.match(/^(.*?)\s+(successful|success)\s*$/i))) {
    return { failed: false, title: m[1].trim() };
  }
  /* Real Bamboo feeds (verified 2026-11-16) also carry the phrase
     mid-title, with text on both sides: "Plan #45 was SUCCESSFUL on
     agent-1". The phrase cannot be stripped without mangling the
     title, so the verdict is read and the title is kept whole. */
  if ((m = title.match(/\b(?:was|has)\s+(successful|success|failed|failure)\b/i))) {
    return { failed: /fail/i.test(m[1]), title };
  }
  /* Generic fallback (the old bamboo rule): a failure word anywhere
     marks the run failed; the title stays as it is. */
  if (/\b(failed|failure|error)\b/i.test(title)) return { failed: true, title };
  return { failed: null, title };
}

module.exports = { parseFeed, parseQuotes, parseDate, stripMarkup, decodeEntities, normTitle, ciVerdict };

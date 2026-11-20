'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFeed, parseQuotes, parseDate, decodeEntities, ciVerdict } = require('../src/feedparse');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('CNBC stock quotes fixture parses prices, changes and times', () => {
  const feed = parseQuotes(fixture('cnbc-quotes.json'));
  assert.equal(feed.items.length, 2); // the code:1 entry is dropped
  const nk = feed.items[0];
  assert.equal(nk.guid, '.N225');
  assert.equal(nk.title, 'NIKKEI');
  assert.equal(nk.price, 61142.35);
  assert.equal(nk.change, 322.99);
  assert.equal(nk.changePct, 0.53);
  assert.equal(nk.open, 61223.41);
  assert.ok(nk.timeMs > 0);
  const ix = feed.items[1];
  assert.equal(ix.changePct, -0.91);
});

test('parseQuotes tolerates non-JSON and unknown shapes', () => {
  assert.deepEqual(parseQuotes('<html>nope</html>').items, []);
  assert.deepEqual(parseQuotes('{"other":1}').items, []);
});

test('GitHub releases Atom fixture parses as atom with dated entries', () => {
  const feed = parseFeed(fixture('github-releases.atom.xml'));
  assert.equal(feed.format, 'atom');
  assert.match(feed.title, /vscode/i);
  assert.ok(feed.items.length >= 3);
  const first = feed.items[0];
  assert.ok(first.title.length > 0);
  assert.ok(first.link.startsWith('https://github.com/'));
  assert.ok(Number.isFinite(first.timeMs));
  // newest-first
  assert.ok(feed.items[0].timeMs >= feed.items[1].timeMs);
});

test('JMA extra Atom fixture parses Japanese titles', () => {
  const feed = parseFeed(fixture('jma-extra.atom.xml'));
  assert.equal(feed.format, 'atom');
  assert.ok(feed.items.length >= 5);
  assert.ok(feed.items.every((i) => i.title.length > 0));
  assert.ok(feed.items.some((i) => /[\u3040-\u9fff]/.test(i.title)));
});

test('GitHub blog RSS 2.0 fixture parses with guid and RFC822 dates', () => {
  const feed = parseFeed(fixture('github-blog.rss2.xml'));
  assert.equal(feed.format, 'rss2');
  assert.ok(feed.items.length >= 5);
  assert.ok(feed.items.every((i) => i.guid.length > 0));
  assert.ok(Number.isFinite(feed.items[0].timeMs));
});

test('ITmedia RSS 1.0 (RDF) fixture parses with dc:date', () => {
  const feed = parseFeed(fixture('itmedia.rdf.xml'));
  assert.equal(feed.format, 'rss1');
  assert.ok(feed.items.length >= 5);
  assert.ok(Number.isFinite(feed.items[0].timeMs));
  assert.ok(feed.items[0].link.startsWith('http'));
});

test('entities, CDATA and markup in titles are normalised', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
    <item><title><![CDATA[A & B <速報>]]></title><link>https://example.com/1</link>
    <guid>g1</guid><pubDate>Fri, 13 Nov 2026 10:00:00 GMT</pubDate>
    <description>&lt;p&gt;概要 &amp;amp; 詳細&lt;/p&gt;</description></item>
    <item><title>X &amp; Y &#x30C6;&#x30B9;&#x30C8;</title><link>https://example.com/2</link>
    <guid>g2</guid><pubDate>Fri, 13 Nov 2026 11:00:00 +0900</pubDate></item>
  </channel></rss>`;
  const feed = parseFeed(xml);
  assert.equal(feed.items.length, 2);
  const cdata = feed.items.find((i) => i.guid === 'g1');
  assert.equal(cdata.title, 'A & B <速報>');
  const ent = feed.items.find((i) => i.guid === 'g2');
  assert.equal(ent.title, 'X & Y テスト');
  assert.ok(!cdata.remark.includes('<p>'));
});

test('parseDate handles ISO offsets and RFC 822 zones', () => {
  assert.equal(parseDate('2026-11-13T22:58:15+09:00'), Date.parse('2026-11-13T13:58:15Z'));
  assert.ok(Number.isFinite(parseDate('Fri, 13 Nov 2026 13:58:37 GMT')));
  assert.equal(parseDate('not a date'), null);
  assert.equal(decodeEntities('a &unknown; b'), 'a &unknown; b');
});

test('a stray close tag does not evict a legitimate parent element', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Ch</title>
    <item><title>First</title><link>https://example.com/1</link></bogus><guid>g1</guid></item>
    <item><title>Second</title><guid>g2</guid></item>
  </channel></rss>`;
  const feed = parseFeed(xml);
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items.find((i) => i.guid === 'g1').link, 'https://example.com/1');
  assert.ok(feed.items.some((i) => i.guid === 'g2'));
});

test('numeric entities in the surrogate range are not decoded', () => {
  assert.equal(decodeEntities('a&#xD800;b'), 'a&#xD800;b');
  assert.equal(decodeEntities('a&#55296;b'), 'a&#55296;b');
  assert.equal(decodeEntities('a&#x41;b'), 'aAb');
});

test('a pathological attribute run parses in linear time, not quadratic', () => {
  // One long run of word characters with no '=' froze the old
  // regex-based attribute scanner (33 s at 160 KB). 200 KB of it
  // must now parse as an ordinary (if odd) feed, fast.
  const junk = 'a'.repeat(200 * 1024);
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Ch</title>
    <item ${junk}><title>Kept</title><guid>g1</guid></item>
  </channel></rss>`;
  const started = Date.now();
  const feed = parseFeed(xml);
  assert.ok(Date.now() - started < 5000, 'attribute scanning must stay fast');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].title, 'Kept');
});

test('quoted attribute values still parse (single, double, entities)', () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>F</title>
    <entry><id>e1</id><title>One</title><link rel='alternate' href="https://example.com/?a=1&amp;b=2"/></entry>
  </feed>`;
  const feed = parseFeed(xml);
  assert.equal(feed.items[0].link, 'https://example.com/?a=1&b=2');
});

test('a deeply nested description does not overflow the stack', () => {
  const open = '<b>'.repeat(20000);
  const close = '</b>'.repeat(20000);
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Ch</title>
    <item><title>Deep</title><guid>g1</guid><description>${open}core text${close}</description></item>
  </channel></rss>`;
  const feed = parseFeed(xml);
  assert.equal(feed.items.length, 1);
  assert.ok(feed.items[0].remark.includes('core text'));
});

test('unsupported root throws', () => {
  assert.throws(() => parseFeed('<html><body>x</body></html>'), /unsupported/);
});

/* Audit 2026-11-20 F1: the close-tag match used to scan the whole
   open-element stack, so n opens followed by n non-matching closes
   cost O(n^2) — measured 81 s at 273 KB, inside the 1 MB body cap.
   The name index keeps it linear; this shape must stay fast and
   the tree must come out intact. */
test('a flood of non-matching close tags stays fast', () => {
  const n = 40000;
  const xml = '<rss version="2.0"><channel><title>T</title>'
    + '<a>'.repeat(n) + '</b>'.repeat(n) + '</a>'.repeat(n)
    + '<item><title>hello</title></item></channel></rss>';
  const t0 = Date.now();
  const feed = parseFeed(xml);
  const elapsed = Date.now() - t0;
  assert.equal(feed.title, 'T');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].title, 'hello');
  assert.ok(elapsed < 5000, `parse took ${elapsed} ms`);
});

test('close tags still close the nearest match and ignore strays', () => {
  // </item> implicitly closes the unclosed <description> inside it.
  const implicit = parseFeed('<rss><channel><title>T</title>'
    + '<item><title>one</title><description>d</item>'
    + '<item><title>two</title></item></channel></rss>');
  assert.deepEqual(implicit.items.map((i) => i.title), ['one', 'two']);
  // A close tag for an element that is not open must not evict a
  // legitimate parent, even after positions in the stack are reused.
  const stray = parseFeed('<rss><channel><title>T</title>'
    + '<item><title>one</title></item></description>'
    + '<item><title>two</title></item></channel></rss>');
  assert.deepEqual(stray.items.map((i) => i.title), ['one', 'two']);
});

test('ciVerdict reads Jenkins-style parenthesised results', () => {
  assert.deepEqual(ciVerdict('my-job #123 (SUCCESS)'), { failed: false, title: 'my-job #123' });
  assert.deepEqual(ciVerdict('my-job #124 (FAILURE)'), { failed: true, title: 'my-job #124' });
  assert.deepEqual(ciVerdict('my-job #125 (UNSTABLE)'), { failed: true, title: 'my-job #125' });
  assert.deepEqual(ciVerdict('folder » main #9 (ABORTED)'), { failed: true, title: 'folder » main #9' });
});

test('ciVerdict reads Bamboo-style trailing phrases', () => {
  assert.deepEqual(ciVerdict('PROJ - Plan #45 was successful'), { failed: false, title: 'PROJ - Plan #45' });
  assert.deepEqual(ciVerdict('PROJ - Plan #46 has failed'), { failed: true, title: 'PROJ - Plan #46' });
  assert.deepEqual(ciVerdict('PROJ - Plan #47 successful'), { failed: false, title: 'PROJ - Plan #47' });
});

test('ciVerdict reads Bamboo-style phrases mid-title (real feed shape)', () => {
  assert.deepEqual(ciVerdict('PROJ - Plan #45 was SUCCESSFUL on agent-1'), { failed: false, title: 'PROJ - Plan #45 was SUCCESSFUL on agent-1' });
  assert.deepEqual(ciVerdict('PROJ - Plan #46 has FAILED after 2 tests'), { failed: true, title: 'PROJ - Plan #46 has FAILED after 2 tests' });
});

test('ciVerdict falls back to failure words, else no verdict', () => {
  assert.deepEqual(ciVerdict('Nightly build error on agent-3'), { failed: true, title: 'Nightly build error on agent-3' });
  assert.deepEqual(ciVerdict('Weekly report published'), { failed: null, title: 'Weekly report published' });
});

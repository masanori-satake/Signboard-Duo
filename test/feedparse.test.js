'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFeed, parseDate, decodeEntities } = require('../src/feedparse');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

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

test('unsupported root throws', () => {
  assert.throws(() => parseFeed('<html><body>x</body></html>'), /unsupported/);
});

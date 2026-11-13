'use strict';

/* Pure board logic for Signboard-Duo. No vscode dependency, so it can be
   unit-tested with node --test. Platforms are feeds; rows are topics. */

const CONFIG = {
  pageRotateMs: 18000,      // inherited from Signboard-Solo
  staleAfterPolls: 2,       // platform goes stale after this many missed polls
  maxItemAgeMs: 30 * 24 * 60 * 60 * 1000, // ignore items older than 30 days at ingest
};

function hasCjk(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(text);
}

/* Middle truncation, inherited from Signboard-Solo's model: the head and
   tail carry the identity of a headline. */
function truncMid(text, max) {
  const chars = [...String(text)];
  if (chars.length <= max) return text;
  const head = Math.ceil((max - 1) * 0.55);
  const tail = Math.floor((max - 1) * 0.45);
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('');
}

function hhmm(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function chunkPages(count, perPage) {
  if (count <= 0 || perPage <= 0) return 1;
  return Math.max(1, Math.ceil(count / perPage));
}

/* Assign platform numbers 1..N to enabled feeds only, in settings order.
   Disabled feeds get no number and never reach the board. */
function numberPlatforms(feedConfigs) {
  let no = 0;
  return feedConfigs.map((f) => ({
    id: f.id,
    no: f.enabled === false ? null : ++no,
    name: f.name || '',
    kind: f.kind || 'generic',
  }));
}

/* Merge the latest parsed items of one feed into its snapshot.
   prev: Map key -> row (from the previous merge, possibly restored).
   A row is `isNew` the first time its key is seen, `updated` when the
   same key returns with a different title or timestamp. Rows that left
   the feed stay until firstSeenAt + keepHours, then expire.
   Returns rows newest-first, capped at maxItems, plus the next snapshot. */
function mergeFeedRows(feedId, items, prev, now, opts) {
  const maxItems = opts && opts.maxItems ? opts.maxItems : 4;
  const keepMs = (opts && opts.keepHours ? opts.keepHours : 24) * 60 * 60 * 1000;
  const next = new Map(prev || []);
  const inFeed = new Set();

  for (const it of items) {
    if (it.timeMs != null && now - it.timeMs > CONFIG.maxItemAgeMs) continue;
    const key = `${feedId}:${it.guid}`;
    inFeed.add(key);
    const old = next.get(key);
    if (!old) {
      next.set(key, {
        key, feedId,
        title: it.title, link: it.link, remark: it.remark,
        timeMs: it.timeMs != null ? it.timeMs : now,
        firstSeenAt: now, lastSeenInFeedAt: now,
        isNew: true, updated: false,
      });
    } else {
      const changed = old.title !== it.title || (it.timeMs != null && old.timeMs !== it.timeMs);
      next.set(key, {
        ...old,
        title: it.title, link: it.link, remark: it.remark,
        timeMs: it.timeMs != null ? it.timeMs : old.timeMs,
        lastSeenInFeedAt: now,
        isNew: false, updated: changed,
      });
    }
  }

  for (const [key, row] of next) {
    if (!inFeed.has(key)) {
      row.isNew = false;
      row.updated = false;
      if (now - row.firstSeenAt > keepMs) next.delete(key);
    }
  }

  const rows = [...next.values()].sort((a, b) => b.timeMs - a.timeMs).slice(0, maxItems);
  return { rows, snapshot: next };
}

/* Platform display state: authError and configError dominate; a platform
   with a successful fetch in the past but repeated failures since is
   `stale` (rows remain, shown dimmed) rather than an error. */
function platformState(feed, now, pollMs) {
  if (feed.configError) return 'configError';
  if (feed.lastStatus === 401 || feed.lastStatus === 403) return 'authError';
  if (!feed.lastOkAt) return feed.lastErrorAt ? 'error' : 'loading';
  if (feed.lastErrorAt && feed.lastErrorAt > feed.lastOkAt &&
      now - feed.lastOkAt > CONFIG.staleAfterPolls * pollMs) return 'stale';
  if (feed.lastErrorAt && feed.lastErrorAt > feed.lastOkAt) return 'error';
  return 'ok';
}

module.exports = { CONFIG, hasCjk, truncMid, hhmm, chunkPages, numberPlatforms, mergeFeedRows, platformState };

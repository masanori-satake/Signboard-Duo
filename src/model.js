'use strict';

/* Pure board logic for Signboard-Duo. No vscode dependency, so it can be
   unit-tested with node --test. Platforms are feeds; rows are topics. */

const CONFIG = {
  staleAfterPolls: 2,       // platform goes stale after this many missed polls
  maxItemAgeMs: 30 * 24 * 60 * 60 * 1000, // ignore items older than 30 days at ingest
  snapshotCap: 200,         // history bound per feed; display is capped far below this
};

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
        ciFailed: it.ciFailed != null ? it.ciFailed : null,
        recovered: it.recovered != null ? it.recovered : null,
        price: it.price != null ? it.price : null,
        change: it.change != null ? it.change : null,
        changePct: it.changePct != null ? it.changePct : null,
        open: it.open != null ? it.open : null,
        high: it.high != null ? it.high : null,
        low: it.low != null ? it.low : null,
      });
    } else {
      // Quote rows change by price, not by timestamp (their time moves
      // on every poll while the market is open).
      const changed = old.title !== it.title
        || (it.price != null ? old.price !== it.price : (it.timeMs != null && old.timeMs !== it.timeMs));
      next.set(key, {
        ...old,
        title: it.title, link: it.link, remark: it.remark,
        timeMs: it.timeMs != null ? it.timeMs : old.timeMs,
        lastSeenInFeedAt: now,
        isNew: false, updated: changed,
        ciFailed: it.ciFailed != null ? it.ciFailed : old.ciFailed,
        recovered: it.recovered != null ? it.recovered : old.recovered,
        price: it.price != null ? it.price : old.price,
        change: it.change != null ? it.change : old.change,
        changePct: it.changePct != null ? it.changePct : old.changePct,
        open: it.open != null ? it.open : old.open,
        high: it.high != null ? it.high : old.high,
        low: it.low != null ? it.low : old.low,
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

  /* The snapshot is history, not display — what is shown is capped by
     maxItems — so an unbounded map only serves a pathological feed.
     Bound it, dropping the longest-absent rows first; rows in the
     current feed are never dropped here. */
  if (next.size > CONFIG.snapshotCap) {
    const byAge = [...next.entries()].sort((a, b) => a[1].firstSeenAt - b[1].firstSeenAt);
    for (const [key] of byAge) {
      if (next.size <= CONFIG.snapshotCap) break;
      if (!inFeed.has(key)) next.delete(key);
    }
  }

  const rows = [...next.values()].sort((a, b) => b.timeMs - a.timeMs).slice(0, maxItems);
  return { rows, snapshot: next };
}

/* Choose the rows a platform shows: newest first, capped at
   maxItems. Recovery rows are dropped BEFORE the cap when the
   showRecoveryRows setting is off, so a hidden row never takes a
   display slot from a real one. */
function selectDisplayRows(rows, maxItems, showRecovery) {
  const list = showRecovery ? [...rows] : rows.filter((r) => !r.recovered);
  list.sort((a, b) => b.timeMs - a.timeMs);
  return list.slice(0, maxItems || 4);
}

/* Platform display state: authError and configError dominate; a platform
   with a successful fetch in the past but repeated failures since is
   `stale` (rows remain, shown dimmed) rather than an error. An active
   outage (design §18) outranks error/stale: the line is blocked, and
   that is a topic on the board, not a fetch error. */
function platformState(feed, now, pollMs) {
  if (feed.configError) return 'configError';
  if (feed.lastStatus === 401 || feed.lastStatus === 403) return 'authError';
  if (feed.outage && feed.outage.active) return 'outage';
  if (!feed.lastOkAt) return feed.lastErrorAt ? 'error' : 'loading';
  if (feed.lastErrorAt && feed.lastErrorAt > feed.lastOkAt &&
      now - feed.lastOkAt > CONFIG.staleAfterPolls * pollMs) return 'stale';
  if (feed.lastErrorAt && feed.lastErrorAt > feed.lastOkAt) return 'error';
  return 'ok';
}

/* ---------------- outage (design §18) ---------------- */

/* Only "cannot reach it at all" failures count towards an outage:
   name resolution, connection, timeout and proxy-leg failures, plus
   HTTP 5xx (the server is up but failing as a whole). Auth failures
   are the user's to fix, and format / TLS / other HTTP failures mean
   the server did answer — neither is a blocked line. */
const OUTAGE_SYMPTOMS = new Set(['dns', 'connect', 'timeout', 'proxy']);
const OUTAGE_THRESHOLD = 2; // consecutive failures before the line is declared blocked

function isOutageFailure(symptom, detail) {
  if (OUTAGE_SYMPTOMS.has(symptom)) return true;
  if (symptom === 'http') {
    const n = Number(detail);
    return Number.isFinite(n) && n >= 500 && n <= 599;
  }
  return false;
}

/* Advance the per-feed outage state by one fetch outcome.
   prev: { streak, since, active } (since = first failure of the
   current streak). A success after an active outage reports
   `recovered: { downMs }` exactly once. A failure of a different
   kind ends the streak silently (the board then shows that failure
   instead). */
function nextOutage(prev, ok, symptom, detail, now) {
  const p = prev && typeof prev === 'object'
    ? { streak: prev.streak | 0, since: prev.since || null, active: !!prev.active }
    : { streak: 0, since: null, active: false };
  if (ok) {
    return {
      state: { streak: 0, since: null, active: false },
      recovered: p.active ? { downMs: p.since ? Math.max(0, now - p.since) : 0, since: p.since } : null,
    };
  }
  if (!isOutageFailure(symptom, detail)) {
    return { state: { streak: 0, since: null, active: false }, recovered: null };
  }
  const streak = p.streak + 1;
  const since = p.since || now;
  return { state: { streak, since, active: streak >= OUTAGE_THRESHOLD }, recovered: null };
}

/* News-item selection comparison (design §16 supplement): interests
   decide which fetched runs become rows, so changing the selection
   invalidates the rows the old selection produced. Compared as sets;
   null (an RSS feed, or a REST feed that never had the field) only
   equals null. */
function interestsChanged(prev, next) {
  const key = (v) => (Array.isArray(v) ? [...new Set(v)].sort().join(',') : '');
  return key(prev) !== key(next);
}

module.exports = { CONFIG, numberPlatforms, mergeFeedRows, selectDisplayRows, platformState, isOutageFailure, nextOutage, OUTAGE_THRESHOLD, interestsChanged };

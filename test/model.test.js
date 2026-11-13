'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { numberPlatforms, mergeFeedRows, platformState } = require('../src/model');

const H = 60 * 60 * 1000;

test('platform numbers skip disabled feeds', () => {
  const ps = numberPlatforms([
    { id: 'a' }, { id: 'b', enabled: false }, { id: 'c' }, { id: 'd' },
  ]);
  assert.deepEqual(ps.map((p) => [p.id, p.no]), [['a', 1], ['b', null], ['c', 2], ['d', 3]]);
});

test('first merge marks rows new; second merge clears it', () => {
  const items = [{ guid: 'g1', title: 'One', link: 'https://e/1', timeMs: 1000, remark: '' }];
  const first = mergeFeedRows('f', items, null, 2000, { maxItems: 4, keepHours: 24 });
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].isNew, true);
  const second = mergeFeedRows('f', items, first.snapshot, 3000, { maxItems: 4, keepHours: 24 });
  assert.equal(second.rows[0].isNew, false);
  assert.equal(second.rows[0].updated, false);
});

test('same guid with a changed title is an update, not a new row', () => {
  const base = [{ guid: 'g1', title: 'Investigating', link: 'https://e/1', timeMs: 1000, remark: '' }];
  const first = mergeFeedRows('f', base, null, 2000, {});
  const changed = [{ guid: 'g1', title: 'Resolved', link: 'https://e/1', timeMs: 1000, remark: '' }];
  const second = mergeFeedRows('f', changed, first.snapshot, 3000, {});
  assert.equal(second.rows.length, 1);
  assert.equal(second.rows[0].updated, true);
  assert.equal(second.rows[0].title, 'Resolved');
});

test('rows that leave the feed expire after keepHours from first sight', () => {
  const items = [{ guid: 'g1', title: 'One', link: '', timeMs: 0, remark: '' }];
  const first = mergeFeedRows('f', items, null, 0, { keepHours: 24 });
  const stillThere = mergeFeedRows('f', [], first.snapshot, 12 * H, { keepHours: 24 });
  assert.equal(stillThere.rows.length, 1);
  const gone = mergeFeedRows('f', [], first.snapshot, 25 * H, { keepHours: 24 });
  assert.equal(gone.rows.length, 0);
});

test('maxItems caps rows, newest first; ancient items are ignored', () => {
  const now = 100 * H;
  const items = [1, 2, 3, 4, 5].map((n) => ({
    guid: `g${n}`, title: `T${n}`, link: '', timeMs: now - n * H, remark: '',
  }));
  items.push({ guid: 'old', title: 'Ancient', link: '', timeMs: now - 40 * 24 * H, remark: '' });
  const { rows } = mergeFeedRows('f', items, null, now, { maxItems: 3, keepHours: 24 });
  assert.deepEqual(rows.map((r) => r.title), ['T1', 'T2', 'T3']);
});

test('platformState: auth errors dominate, staleness needs missed polls', () => {
  const poll = 15 * 60 * 1000;
  assert.equal(platformState({ lastStatus: 401, lastOkAt: 100 }, 200, poll), 'authError');
  assert.equal(platformState({ configError: true }, 0, poll), 'configError');
  const t0 = 1_000_000;
  assert.equal(platformState({ lastOkAt: t0, lastErrorAt: t0 + 1 }, t0 + poll, poll), 'error');
  assert.equal(platformState({ lastOkAt: t0, lastErrorAt: t0 + 1 }, t0 + 3 * poll, poll), 'stale');
  assert.equal(platformState({ lastOkAt: 10 }, 20, poll), 'ok');
});

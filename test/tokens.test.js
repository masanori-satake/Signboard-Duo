'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenStore, parseIndex, orphanIds, INDEX_KEY } = require('../src/tokens');

function fakeSecrets() {
  const map = new Map();
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : undefined; },
    async store(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
  };
}

test('parseIndex keeps only well-formed unique ids', () => {
  assert.deepEqual(parseIndex('["a-feed","b-feed","a-feed"]'), ['a-feed', 'b-feed']);
  assert.deepEqual(parseIndex('["ok", 42, "Bad ID", "", null]'), ['ok']);
  assert.deepEqual(parseIndex('not json'), []);
  assert.deepEqual(parseIndex('{"a":1}'), []);
  assert.deepEqual(parseIndex(undefined), []);
});

test('orphanIds returns indexed ids with no configured feed', () => {
  assert.deepEqual(orphanIds(['a', 'b', 'c'], ['b']), ['a', 'c']);
  assert.deepEqual(orphanIds([], ['a']), []);
  assert.deepEqual(orphanIds(['a'], []), ['a']);
});

test('set/has/delete keep the token and the index in step', async () => {
  const store = new TokenStore(fakeSecrets());
  assert.equal(await store.has('bamboo'), false);
  await store.set('bamboo', 'secret-1');
  assert.equal(await store.has('bamboo'), true);
  assert.deepEqual(await store.ids(), ['bamboo']);
  await store.set('github', 'secret-2');
  assert.deepEqual(await store.ids(), ['bamboo', 'github']);
  await store.delete('bamboo');
  assert.equal(await store.has('bamboo'), false);
  assert.deepEqual(await store.ids(), ['github']);
});

test('deleteMany removes tokens and prunes the index once', async () => {
  const store = new TokenStore(fakeSecrets());
  await store.set('a', '1');
  await store.set('b', '2');
  await store.set('c', '3');
  await store.deleteMany(['a', 'c']);
  assert.deepEqual(await store.ids(), ['b']);
  assert.equal(await store.has('a'), false);
  assert.equal(await store.has('b'), true);
});

test('get returns the stored token value', async () => {
  const store = new TokenStore(fakeSecrets());
  assert.equal(await store.get('bamboo'), undefined);
  await store.set('bamboo', 'secret-1');
  assert.equal(await store.get('bamboo'), 'secret-1');
});

test('delete restores the token when the index update fails', async () => {
  const secrets = fakeSecrets();
  const store = new TokenStore(secrets);
  await store.set('bamboo', 'secret-1');
  // From here on, writing the index fails while secret writes work.
  const realStore = secrets.store;
  secrets.store = async (k, v) => {
    if (k === INDEX_KEY) throw new Error('index write failed');
    return realStore(k, v);
  };
  await assert.rejects(store.delete('bamboo'), /index write failed/);
  // The secret was already dropped, so it must be put back.
  assert.equal(await store.get('bamboo'), 'secret-1');
  assert.equal(await store.has('bamboo'), true);
  assert.deepEqual(await store.ids(), ['bamboo']);
});

test('delete leaves the token when the secret itself cannot be deleted', async () => {
  const secrets = fakeSecrets();
  const store = new TokenStore(secrets);
  await store.set('bamboo', 'secret-1');
  secrets.delete = async () => { throw new Error('secret delete failed'); };
  await assert.rejects(store.delete('bamboo'), /secret delete failed/);
  assert.equal(await store.get('bamboo'), 'secret-1');
  assert.deepEqual(await store.ids(), ['bamboo']);
});

test('adopt indexes pre-existing tokens of configured feeds only', async () => {
  const secrets = fakeSecrets();
  // Tokens stored before the index existed (no index key at all).
  await secrets.store('feed-token:legacy', 'x');
  await secrets.store('feed-token:gone', 'y');
  const store = new TokenStore(secrets);
  const ids = await store.adopt(['legacy', 'plain']);
  assert.deepEqual(ids, ['legacy']);
  assert.deepEqual(orphanIds(ids, ['legacy', 'plain']), []);
  assert.deepEqual(orphanIds(ids, []), ['legacy']);
});

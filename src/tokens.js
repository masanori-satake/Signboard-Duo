'use strict';

/* Feed-token bookkeeping.
   SecretStorage cannot enumerate its keys, so Duo keeps a small
   index — feed ids only, never token values — in SecretStorage
   itself. The index makes the token lifecycle manageable per feed:
   what is stored can be listed, a token whose feed has left the
   settings can be found (an unlinked / orphaned token) and deleted,
   and all tokens can be wiped at once. Deleting a feed from the
   settings and deleting its token are independent operations, in
   either order. */

const INDEX_KEY = 'feed-token-index';
const ID_PATTERN = /^[a-z0-9-]+$/;

function parseIndex(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const v of arr) {
    if (typeof v === 'string' && ID_PATTERN.test(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

function orphanIds(index, configuredIds) {
  const conf = new Set(configuredIds || []);
  return (index || []).filter((id) => !conf.has(id));
}

class TokenStore {
  constructor(secrets) { this.secrets = secrets; }

  key(id) { return `feed-token:${id}`; }

  async ids() { return parseIndex(await this.secrets.get(INDEX_KEY)); }

  async writeIds(ids) { await this.secrets.store(INDEX_KEY, JSON.stringify(ids)); }

  async has(id) { return (await this.secrets.get(this.key(id))) != null; }

  async get(id) { return this.secrets.get(this.key(id)); }

  async set(id, value) {
    await this.secrets.store(this.key(id), value);
    const ids = await this.ids();
    if (!ids.includes(id)) { ids.push(id); await this.writeIds(ids); }
  }

  async delete(id) {
    /* Read the secret before dropping it: if the index update below
       fails, the secret must go back — otherwise the caller aborts
       with the token already gone while the settings still point
       at the server it authenticated against. */
    const previous = await this.secrets.get(this.key(id));
    await this.secrets.delete(this.key(id));
    try {
      const ids = await this.ids();
      if (ids.includes(id)) await this.writeIds(ids.filter((x) => x !== id));
    } catch (e) {
      if (previous != null) {
        try { await this.secrets.store(this.key(id), previous); } catch (_) { /* restore failed; the index error still surfaces */ }
      }
      throw e;
    }
  }

  async deleteMany(idsToDelete) {
    for (const id of idsToDelete) await this.secrets.delete(this.key(id));
    const drop = new Set(idsToDelete);
    const ids = await this.ids();
    const next = ids.filter((x) => !drop.has(x));
    if (next.length !== ids.length) await this.writeIds(next);
  }

  /* Adopt tokens stored before the index existed: any configured
     feed that actually holds a token joins the index. Returns the
     (possibly extended) index. */
  async adopt(configuredIds) {
    const ids = await this.ids();
    let changed = false;
    for (const id of configuredIds || []) {
      if (ID_PATTERN.test(id) && !ids.includes(id) && (await this.has(id))) {
        ids.push(id);
        changed = true;
      }
    }
    if (changed) await this.writeIds(ids);
    return ids;
  }
}

module.exports = { TokenStore, parseIndex, orphanIds, INDEX_KEY };

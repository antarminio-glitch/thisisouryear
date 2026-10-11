// Where the site keeps the things it has to remember between visits: paid
// orders, quote requests, fan photos, season updates and campaign sends.
//
// On Netlify this uses Netlify Blobs, which needs no setup and no extra
// account. Tests use the in-memory version below, so they never touch real
// data.
//
// Every store has the same small set of actions:
//   get(key)                 the saved value, or null
//   set(key, value)          save or replace
//   setIfNew(key, value)     save only if nothing is there yet. Returns true if it saved.
//   delete(key)
//   list(prefix)             the keys that start with prefix
//   setBinary / getBinary    the same, for files such as photos

export const STORES = ['orders', 'quotes', 'fans', 'fan-photos', 'season', 'campaigns', 'deliveries', 'suppressions', 'audit'];

export function memoryStorage() {
  const data = new Map(STORES.map((name) => [name, new Map()]));
  const store = (name) => {
    const m = data.get(name);
    if (!m) throw new Error(`Unknown store "${name}"`);
    return {
      async get(key) {
        return m.has(key) ? structuredClone(m.get(key).value) : null;
      },
      async set(key, value) {
        m.set(key, { value: structuredClone(value) });
      },
      async setIfNew(key, value) {
        if (m.has(key)) return false;
        m.set(key, { value: structuredClone(value) });
        return true;
      },
      async delete(key) {
        m.delete(key);
      },
      async list(prefix = '') {
        return [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      },
      async setBinary(key, bytes, metadata = {}) {
        m.set(key, { value: new Uint8Array(bytes).slice(), metadata: structuredClone(metadata), binary: true });
      },
      async getBinary(key) {
        const hit = m.get(key);
        return hit?.binary ? { data: hit.value.slice().buffer, metadata: structuredClone(hit.metadata) } : null;
      },
    };
  };
  return { kind: 'memory', store };
}

// The real thing. Loaded lazily so tests and local page previews don't need it.
export async function blobStorage() {
  const { getStore } = await import('@netlify/blobs');
  const store = (name) => {
    if (!STORES.includes(name)) throw new Error(`Unknown store "${name}"`);
    const s = getStore({ name: `tioy-${name}`, consistency: 'strong' });
    return {
      get: (key) => s.get(key, { type: 'json' }),
      set: async (key, value) => {
        await s.setJSON(key, value);
      },
      setIfNew: async (key, value) => (await s.setJSON(key, value, { onlyIfNew: true })).modified === true,
      delete: (key) => s.delete(key),
      list: async (prefix = '') => (await s.list({ prefix })).blobs.map((b) => b.key).sort(),
      setBinary: async (key, bytes, metadata = {}) => {
        await s.set(key, bytes, { metadata });
      },
      getBinary: async (key) => {
        const hit = await s.getWithMetadata(key, { type: 'arrayBuffer' });
        return hit ? { data: hit.data, metadata: hit.metadata ?? {} } : null;
      },
    };
  };
  return { kind: 'netlify-blobs', store };
}

// Reads every value under a prefix. Fine for the small lists this site keeps.
export async function readAll(store, prefix = '') {
  const keys = await store.list(prefix);
  const values = await Promise.all(keys.map((k) => store.get(k)));
  return values.filter((v) => v !== null);
}

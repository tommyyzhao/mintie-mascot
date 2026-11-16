// Browser-local memory: {name, facts}. DATA only: sent with every /api/react request and replaced by {memory} stream frames.
// ponytail: one JSON blob in localStorage; add per-fact timestamps only if the server starts expiring facts.
const KEY = 'mintie-memory', LEGACY = 'mintie-name';
const EMPTY = () => ({ name: null, facts: [] });
// Same limits as the server (name <=40, <=8 facts of <=120 chars); anything else is dropped, never thrown.
export const clean = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 40) : '';
  const facts = Array.isArray(value.facts) ? value.facts.filter(f => typeof f === 'string' && f.trim()).map(f => f.trim().slice(0, 120)).slice(0, 8) : [];
  return { name: name || null, facts };
};
export function createMemory(storage) {
  let value = EMPTY(); const listeners = new Set();
  const read = key => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const write = () => { try { storage?.setItem(KEY, JSON.stringify(value)); } catch {} };
  try { value = clean(JSON.parse(read(KEY))) ?? value; } catch {}
  // One-time migration of the retired name prompt's storage key.
  const legacy = read(LEGACY);
  if (legacy !== null) {
    if (read(KEY) === null && legacy.length <= 40 && /^[\p{L} '.-]+$/u.test(legacy) && legacy.trim()) { value = { ...value, name: legacy.trim() }; write(); }
    try { storage.removeItem(LEGACY); } catch {}
  }
  const notify = () => listeners.forEach(fn => fn(get()));
  const get = () => ({ name: value.name, facts: [...value.facts] });
  return {
    get,
    set(next) { const c = clean(next); if (!c) return false; value = c; write(); notify(); return true; },
    forget() { value = EMPTY(); try { storage?.removeItem(KEY); } catch {} notify(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

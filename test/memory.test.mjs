import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemory, clean } from '../web/memory.js';

const store = (seed = {}) => { const m = new Map(Object.entries(seed)); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('memory round-trips through storage and clamps to the server limits', () => {
  const s = store(), a = createMemory(s);
  assert.deepEqual(a.get(), { name: null, facts: [] });
  assert.equal(a.set({ name: ' Alex ', facts: ['likes tea', '', 5, 'x'.repeat(200), ...Array(10).fill('f')] }), true);
  const got = createMemory(s).get();
  assert.equal(got.name, 'Alex'); assert.equal(got.facts.length, 8); assert.equal(got.facts[1].length, 120);
  assert.equal(a.set('nope'), false); assert.equal(a.get().name, 'Alex');
});

test('get() is a copy; forget clears storage and notifies', () => {
  const s = store(), m = createMemory(s); let seen;
  m.subscribe(v => { seen = v; }); m.set({ name: 'Bo', facts: ['a'] });
  m.get().facts.push('mutation'); assert.deepEqual(m.get().facts, ['a']);
  m.forget(); assert.deepEqual(seen, { name: null, facts: [] }); assert.equal(s.m.has('mintie-memory'), false);
});

test('legacy mintie-name migrates once and is removed', () => {
  const s = store({ 'mintie-name': 'María' }), m = createMemory(s);
  assert.equal(m.get().name, 'María'); assert.equal(s.m.has('mintie-name'), false);
  assert.equal(JSON.parse(s.m.get('mintie-memory')).name, 'María');
  const t = store({ 'mintie-name': 'Old', 'mintie-memory': '{"name":"New","facts":[]}' }); // existing memory wins
  assert.equal(createMemory(t).get().name, 'New'); assert.equal(t.m.has('mintie-name'), false);
  assert.equal(createMemory(store({ 'mintie-name': '<script>' })).get().name, null);
});

test('corrupt or missing storage never throws', () => {
  assert.deepEqual(createMemory(store({ 'mintie-memory': '{bad' })).get(), { name: null, facts: [] });
  assert.deepEqual(createMemory(undefined).get(), { name: null, facts: [] });
  const throwing = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }, removeItem() { throw Error('denied'); } };
  const m = createMemory(throwing); assert.equal(m.set({ name: 'A', facts: [] }), true); m.forget();
  assert.equal(clean([]), null);
});

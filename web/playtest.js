import { CATALOG, EXCLUDED } from './perform/emoji.js';

// Seeded shuffle keeps both the trials and their answer order reproducible.
export function randomFor(seed) {
  let state = 2166136261;
  for (const c of String(seed)) state = Math.imul(state ^ c.codePointAt(0), 16777619);
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function makeTrials(seed, catalog = CATALOG) {
  const random = randomFor(seed);
  const available = Object.keys(catalog).filter(emoji => !EXCLUDED.includes(emoji));
  if (available.length < 20) throw new Error('Not enough eligible emoji');
  return shuffle(available, random).slice(0, 20).map(emoji => {
    const families = new Set([catalog[emoji].family]);
    const distractors = [];
    for (const candidate of shuffle(available, random)) {
      const family = catalog[candidate].family;
      if (!families.has(family)) { families.add(family); distractors.push(candidate); }
      if (distractors.length === 3) break;
    }
    if (distractors.length !== 3) throw new Error('Not enough distinct families');
    return { emoji, family: catalog[emoji].family, choices: shuffle([emoji, ...distractors], random) };
  });
}

if (typeof document !== 'undefined') {
  const { createCharacter } = await import('./character/index.js');
  const { createPerformer } = await import('./perform/engine.js');
  const $ = id => document.getElementById(id);
  const seed = new URLSearchParams(location.search).get('seed') ?? String(crypto.getRandomValues(new Uint32Array(1))[0]);
  const trials = makeTrials(seed), answers = [];
  $('seed').textContent = seed;
  let character, performer, startedAt, timer, index = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function play() {
    const now = performance.now();
    const performanceInfo = performer.play(trials[index].emoji, { nowMs: now });
    return performanceInfo.durationMs;
  }
  function next() {
    if (index === trials.length) {
      $('trial').hidden = true; $('end').hidden = false;
      const exact = answers.filter(a => a.correct).length * 5, family = answers.filter(a => a.familyCorrect).length * 5;
      $('score').textContent = `Exacto / Exact: ${exact}% · Familia / Family: ${family}%`;
      return;
    }
    $('progress').textContent = `${index + 1} / ${trials.length}`;
    $('choices').replaceChildren();
    const current = trials[index];
    for (const emoji of current.choices) {
      const button = document.createElement('button');
      button.textContent = emoji;
      button.setAttribute('aria-label', CATALOG[emoji].name_es);
      button.addEventListener('click', () => {
        answers.push({ selected: emoji, correct: emoji === current.emoji, familyCorrect: CATALOG[emoji].family === current.family, timeToAnswerMs: Math.round(performance.now() - startedAt) });
        index++; next();
      });
      $('choices').append(button);
    }
    $('choices').hidden = true;
    startedAt = performance.now();
    timer = setTimeout(() => { $('choices').hidden = false; }, play());
  }
  $('start').addEventListener('click', async () => {
    $('start').disabled = true;
    try {
      character = await createCharacter({ canvas: $('character') });
      performer = createPerformer({ seed: randomFor(seed)() * 0xffffffff, now: () => performance.now() });
      $('intro').hidden = true; $('trial').hidden = false; character.resize();
      addEventListener('resize', () => character.resize());
      function frame(now) { character.update(performer.update(now, { reducedMotion: reduced.matches }), {}, now); requestAnimationFrame(frame); }
      requestAnimationFrame(frame); next();
    } catch (error) { $('start').disabled = false; $('intro').insertAdjacentText('beforeend', ' No se pudo iniciar / Unable to start.'); console.error(error); }
  });
  $('replay').addEventListener('click', () => { clearTimeout(timer); const duration = play(); if ($('choices').hidden) timer = setTimeout(() => { $('choices').hidden = false; }, duration); });
  $('download').addEventListener('click', () => {
    const rating = document.querySelector('input[name="rating"]:checked');
    if (!rating) { document.querySelector('input[name="rating"]').focus(); return; }
    const data = { seed, trials, answers, rating: Number(rating.value), note: $('note').value, userAgent: navigator.userAgent, date: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `mintie-playtest-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

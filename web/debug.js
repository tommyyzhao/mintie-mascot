// ?debug overlay: what the System One decider chose this turn, how fast, and what Mintie remembers. A blog screenshot surface.
// Display only; it never touches the request path except through the `mark`/`set` calls a turn record exposes.
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids); return node; };
const pct = p => `${Math.round(p * 100)}%`;
const STEPS = [['commit', 'Input committed'], ['frame', 'React reply'], ['head', 'First words (head)'], ['line', 'Full line'], ['audio', 'First audio']];
const FLAGS = [['react', 'React'], ['stt', 'Speech in'], ['say', 'Voice out']];

export function createDebugPanel({ memory, parent = document.body } = {}) {
  let turn = null, count = 0, queued = false, health = null, resting = null;
  const root = el('aside', { id: 'debug', className: 'debug' });
  root.setAttribute('aria-label', 'System One debug');
  const toggle = el('button', { type: 'button', className: 'debug-toggle' });
  toggle.setAttribute('aria-expanded', 'true'); toggle.setAttribute('aria-controls', 'debug-body');
  const title = el('span', { className: 'debug-title', textContent: 'System One' });
  const decider = el('span', { className: 'chip', textContent: 'decider: waiting' });
  toggle.append(title, decider);
  const body = el('div', { id: 'debug-body', className: 'debug-body' });
  const live = el('p', { className: 'sr-only', role: 'status' });
  const flags = el('ul', { className: 'flags', ariaLabel: 'Health flags' });
  const summary = el('p', { className: 'debug-summary', textContent: 'No turns yet. Talk, poke or pet Mintie.' });
  const timeline = el('ol', { className: 'timeline', ariaLabel: 'Latency timeline' });
  const questions = el('div', { className: 'questions' });
  const mem = el('section', { className: 'memory' });
  mem.setAttribute('aria-labelledby', 'debug-memory-title');
  const memName = el('p', { className: 'mem-name' }), memFacts = el('ul', { className: 'mem-facts' });
  const forget = el('button', { type: 'button', className: 'forget', textContent: 'Forget me' });
  forget.setAttribute('aria-describedby', 'debug-memory-title');
  mem.append(el('h2', { id: 'debug-memory-title', textContent: 'Memory (this browser)' }), memName, memFacts, forget);
  body.append(flags, el('h2', { textContent: 'Latest turn' }), summary, timeline, questions, mem,
    el('p', { className: 'debug-foot' }, el('a', { href: '/playtest.html', textContent: 'Emoji playtest' })));
  root.append(toggle, body, live);
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open)); body.hidden = !open; root.classList.toggle('collapsed', !open);
  });
  forget.addEventListener('click', () => { memory.forget(); live.textContent = 'Memory cleared. Mintie has forgotten you.'; forget.blur?.(); });

  function renderFlags() {
    flags.replaceChildren();
    const add = (label, on, text = on ? 'on' : 'off') => { const li = el('li', { className: `flag ${on ? 'ok' : 'bad'}` }, el('span', { className: 'dot', ariaHidden: 'true' }), `${label}: ${text}`); flags.append(li); };
    if (!health) { flags.append(el('li', { className: 'flag', textContent: 'Waiting for /api/health' })); return; }
    for (const [key, label] of FLAGS) add(label, health[key] === true);
    flags.append(el('li', { className: 'flag' }, el('span', { className: 'dot idle', ariaHidden: 'true' }), `Human check: ${health.turnstile ? 'required' : 'not needed'}`));
    if (resting) add('Voice', false, `resting (${resting})`);
  }
  function renderMemory() {
    const m = memory.get();
    memName.textContent = m.name ? `Name: ${m.name}` : 'Name: not learned yet';
    memFacts.replaceChildren(...(m.facts.length ? m.facts.map(f => el('li', { textContent: f })) : [el('li', { className: 'none', textContent: 'No facts yet' })]));
    forget.disabled = !m.name && !m.facts.length;
  }
  function render() {
    queued = false;
    if (!turn) return;
    const d = turn.debug, marks = turn.marks, t0 = marks.commit ?? turn.startedAt;
    decider.textContent = `decider: ${d?.decider ?? 'pending'}`; decider.dataset.decider = d?.decider ?? '';
    summary.textContent = `Turn ${turn.id} · ${turn.kind}${d ? ` · ${d.decider}${d.model ? ` · ${d.model}` : ''}${Number.isFinite(d.ms) ? ` · ${Math.round(d.ms)} ms decision` : ''}` : ' · waiting for decision'}`;
    const last = Math.max(1, ...STEPS.map(([k]) => (marks[k] ?? t0) - t0));
    timeline.replaceChildren(...STEPS.map(([key, label]) => {
      const at = marks[key], ms = at === undefined ? null : Math.max(0, Math.round(at - t0));
      const name = key === 'commit' ? (turn.kind === 'touch' ? 'Touch' : 'Speech committed') : label;
      return el('li', { className: ms === null ? 'pending' : '' }, el('span', { className: 'step', textContent: name }),
        el('span', { className: 'ms', textContent: ms === null ? '…' : `+${ms} ms` }),
        el('span', { className: 'bar', ariaHidden: 'true' }, el('i', { style: `width:${ms === null ? 0 : Math.max(2, ms / last * 100)}%` })));
    }));
    questions.replaceChildren(...Object.entries(d?.answers ?? {}).map(([q, a]) => {
      const top = Array.isArray(a.top) ? a.top.slice(0, 3) : [];
      return el('section', { className: 'question' },
        el('h3', {}, el('span', { className: 'q', textContent: q }), ' → ', el('b', { textContent: String(a.answer) }), el('span', { className: 'p', textContent: ` p=${Number.isFinite(a.p) ? a.p.toFixed(2) : '?'}` })),
        el('ul', { className: 'top' }, ...top.map(([option, p]) => el('li', { className: option === a.answer ? 'chosen' : '' },
          el('span', { className: 'opt', textContent: String(option) }), el('span', { className: 'bar', ariaHidden: 'true' }, el('i', { style: `width:${Math.max(1, Math.min(1, p) * 100)}%` })), el('span', { className: 'pv', textContent: pct(p) })))));
    }));
  }
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(render); } };
  memory.subscribe(renderMemory); renderMemory(); renderFlags(); parent.append(root);
  return {
    root,
    // A turn record: marks are absolute performance.now() values; the first `commit` mark is the timeline origin.
    begin({ kind, commitAt = null }) {
      const t = turn = { id: ++count, kind, startedAt: performance.now(), marks: commitAt === null ? {} : { commit: commitAt }, debug: null,
        mark: (name, at = performance.now()) => { if (turn === t && t.marks[name] === undefined) { t.marks[name] = at; schedule(); } },
        set: value => { if (turn !== t || !value || typeof value !== 'object') return; t.debug = value; live.textContent = `Turn ${t.id}: ${value.decider}${value.model ? `, ${value.model}` : ''}${Number.isFinite(value.ms) ? `, ${Math.round(value.ms)} milliseconds` : ''}.`; schedule(); } };
      schedule(); return t;
    },
    setHealth(value) { health = value; renderFlags(); },
    setResting(code) { resting = code; renderFlags(); },
  };
}

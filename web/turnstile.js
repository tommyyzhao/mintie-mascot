// Human check for the hosted demo. Local Node's /api/health has no `turnstile` field: ensureSession is then a no-op.
// Otherwise one managed/invisible Turnstile challenge is solved and /api/session turns it into a 30-minute HttpOnly cookie.
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SOLVE_MS = 20000; // a stuck challenge rejects, which clears `pending` so the next call retries
let pending = null, loaded = null;

function loadScript() {
  return loaded ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement('script');
    s.src = SCRIPT; s.async = true; s.onload = resolve; s.onerror = () => reject(Error('turnstile_script'));
    document.head.append(s);
  }).catch(e => { loaded = null; throw e; });
}

async function solve(siteKey) {
  await loadScript();
  const box = Object.assign(document.createElement('div'), { id: 'turnstile-box' });
  box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9'; // only visible if Cloudflare needs an interaction
  document.body.append(box);
  try {
    let timer, widget;
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('turnstile_timeout')), SOLVE_MS);
      widget = window.turnstile.render(box, {
        sitekey: siteKey, size: 'flexible', appearance: 'interaction-only', execution: 'render',
        callback: resolve, 'error-callback': () => reject(Error('turnstile_failed')), 'timeout-callback': () => reject(Error('turnstile_timeout')),
      });
    }).finally(() => { clearTimeout(timer); try { window.turnstile.remove(widget); } catch {} });
  } finally { box.remove(); }
}

// force: skip the "already have a cookie" memory, e.g. after a 403 human_check. Concurrent calls share one challenge.
export function ensureSession({ force = false } = {}) {
  if (pending && !force) return pending;
  const run = (async () => {
    const health = await fetch('/api/health').then(r => r.json()).catch(() => ({}));
    if (!health.turnstile) return; // local Node: no guard
    const token = await solve(health.turnstile);
    const r = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    if (!r.ok) throw Error('human_check');
  })();
  pending = run;
  run.catch(() => { if (pending === run) pending = null; }); // a failed check may be retried
  return run;
}

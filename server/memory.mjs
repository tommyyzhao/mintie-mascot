// Server-side memory: what Mintie learned about this person, kept browser-side (localStorage) and sent back each turn.
// Memory is DATA, never instructions: validated at the trust boundary, learned by plain patterns (no model call, so no latency and no prompt-injection surface),
// and only ever placed in the user-message JSON, never in the system prompt.
// ponytail: regex over ~10 languages; upgrade path is a parallel System One noul/choice over these same candidate spans.
export const MEMORY_LIMITS = { name: 40, facts: 8, fact: 120 };
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
export function validMemory(m) {
  return object(m) && Object.keys(m).every(k => k === 'name' || k === 'facts') &&
    (m.name === null || typeof m.name === 'string' && m.name.length <= MEMORY_LIMITS.name && /^[\p{L} '.-]+$/u.test(m.name) && !!m.name.trim()) &&
    Array.isArray(m.facts) && m.facts.length <= MEMORY_LIMITS.facts &&
    m.facts.every(f => typeof f === 'string' && f.length <= MEMORY_LIMITS.fact && !!f.trim() && !/[\p{Cc}<>\[\]{}]/u.test(f));
}
export const emptyMemory = () => ({ name: null, facts: [] });
const W = "[\\p{L}][\\p{L}'’-]{0,23}";
const NAME = new RegExp(`(?:my name is|my name's|i am called|i'm called|call me|me llamo|mi nombre es|llamame|ich hei(?:ss|ß)e|mein name ist|nenn mich|je m'appelle|je m’appelle|mon nom est|me chamo|meu nome (?:é|e)|mi chiamo|меня зовут|зови меня|我叫|我的名字是|私の名前は|제 이름은)\\s*(${W}(?:\\s+${W})?)`, 'iu');
const FACT = new RegExp(`(?<![\\p{L}])(?:i (?:really |also )?(?:like|love|enjoy|hate|dislike|play|have|own|live in|work as|work at|study)|i am from|i'm from|my favou?rite|me gust[ao]n?|me encanta[n]?|tengo|vivo en|trabajo (?:en|de)|mi (?:color|comida|animal|juego) favorit[oa]|ich mag|ich liebe|ich habe|ich wohne in|j'aime|j’aime|j'adore|j'ai|j'habite|eu gosto|eu tenho|eu moro em|mi piace|ho|я люблю|у меня|я живу|我喜欢|我有|我住在|私は.{1,30}が好き)(?![\\p{L}])[^.!?\\n]{1,160}`, 'iu');
const clean = s => s.replace(/[\p{Cc}<>\[\]{}]/gu, ' ').replace(/\s+/g, ' ').trim();
const title = w => w[0].toUpperCase() + w.slice(1);
// Stop words keep "my name is not important" from naming Mintie's friend "Not".
const STOP = new Set(['not', 'a', 'an', 'the', 'what', 'who', 'is', 'are', 'was', 'no', 'nothing', 'secret', 'none', 'unknown', 'ignore', 'system', 'assistant', 'mintie', 'que', 'el', 'la', 'un', 'una', 'nada', 'der', 'die', 'das', 'ein', 'le', 'les', 'une', 'rien']);
export function learn(memory, text) {
  const mem = validMemory(memory) ? memory : emptyMemory();
  if (typeof text !== 'string' || !text.trim() || text.length > 500) return mem;
  let name = mem.name; const facts = [...mem.facts];
  const n = NAME.exec(text)?.[1];
  if (n) {
    const [first, second] = n.split(/\s+/);
    // A second word counts only when typed capitalised, like a surname.
    const candidate = second && /^\p{Lu}/u.test(second) && !STOP.has(second.toLowerCase()) ? `${title(first)} ${second}` : title(first);
    if (!STOP.has(first.toLowerCase()) && validMemory({ name: candidate, facts: [] })) name = candidate;
  }
  const f = FACT.exec(text)?.[0];
  if (f) {
    const fact = clean(f).slice(0, MEMORY_LIMITS.fact).trim();
    if (fact.length >= 4 && !facts.some(x => x.toLowerCase() === fact.toLowerCase())) { facts.push(fact); if (facts.length > MEMORY_LIMITS.facts) facts.shift(); }
  }
  return name === mem.name && facts.length === mem.facts.length && facts.every((x, i) => x === mem.facts[i]) ? mem : { name, facts };
}

import { LABELS } from './jev.mjs';

// Last-resort decider: deterministic, no network, always a valid {emoji, gaze, hop, voice, filler}.
// ponytail: keyword lists cover common greetings/thanks/commands in ~10 languages; upgrade path is any /v1/systemone model.
const norm = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// Latin/Cyrillic words need letter boundaries; CJK has no spaces, so those match anywhere.
const re = (words, cjk = '') => new RegExp(`(?<![\\p{L}])(?:${words})(?![\\p{L}])${cjk ? `|${cjk}` : ''}`, 'u');
const RULES = [
  // [pattern, {emoji, voice, hop}] - first match wins, explicit move commands first.
  [re('hop|jump|bounce|salta|brinca|saute|spring|salta|прыгай|pula', '跳|ジャンプ|뛰어'), { emoji: '🦘', hop: 'in_place', voice: 'none' }],
  [re('spin|twirl|flip|gira|dreh dich|tourne|вертись|gire', '转圈|回って|돌아'), { emoji: '🤸', voice: 'none' }],
  [re('nod|asiente|hoche|nicke|кивни'), { emoji: '🙂‍↕️', voice: 'none' }],
  [re('shake your head|niega|nein sagen'), { emoji: '🙂‍↔️', voice: 'none' }],
  [re('wave|saluda|winke|salue|помаши|acene', '挥手|手を振'), { emoji: '👋', voice: 'none' }],
  [re('dance|baila|tanze|danse|танцуй|dance', '跳舞|踊'), { emoji: '💃', voice: 'none' }],
  [re('clap|aplaude|klatsch|applaudis|похлопай', '鼓掌|拍手'), { emoji: '👏', voice: 'none' }],
  [re('come closer|ven aca|komm her|viens ici|подойди|venha aqui'), { emoji: '🦘', hop: 'toward_viewer', voice: 'none' }],
  [re('move back|go away|alejate|geh weg|recule|отойди|afaste'), { emoji: null, hop: 'away_from_viewer', voice: 'none' }],
  [re('hello|hi|hey|hola|buenas|hallo|salut|bonjour|ciao|ola|oi|привет|здравствуй|namaste', '你好|こんにちは|안녕|مرحبا'), { emoji: '👋', voice: 'words' }],
  [re('thanks|thank you|thx|gracias|merci|danke|obrigad[oa]|grazie|спасибо|dank', '谢谢|ありがとう|감사|شكرا'), { emoji: '❤️', voice: 'words' }],
  [re('bye|goodbye|adios|chao|tschuss|au revoir|arrivederci|пока|tchau', '再见|さようなら|잘가'), { emoji: '👋', voice: 'words' }],
  [re('love you|te quiero|te amo|ich liebe dich|je t.aime|ti amo|люблю тебя', '爱你|愛してる|사랑해'), { emoji: '❤️', voice: 'words' }],
  [re('haha+|hehe+|jaja+|lol|lmao|rofl|hihi+|kkk+|ахах\\p{L}*', '哈哈|笑'), { emoji: '😂', voice: 'sound' }],
  [re('sad|cry|crying|triste|llorar|traurig|pleure|грустно|plakat|chorando', '难过|哭|悲しい|슬퍼'), { emoji: '😞', voice: 'words' }],
  [re('congrat\\p{L}*|felicidades|felicitaciones|gluckwunsch|bravo|поздравляю|parabens', '恭喜|おめでとう|축하'), { emoji: '🎉', voice: 'words' }],
  [re('sorry|perdon|lo siento|entschuldigung|desole|извини|desculpa', '对不起|ごめん|미안'), { emoji: '🤗', voice: 'words' }],
  [re('good (?:morning|night)|buenos dias|buenas noches|gute nacht|bonne nuit|спокойной ночи|sleepy|sueno', '晚安|おやすみ'), { emoji: '😴', voice: 'words' }],
];
const QUESTION = re('what|why|how|who|when|where|which|que|por que|como|quien|cuando|donde|cual|warum|wie|wer|wann|quoi|pourquoi|comment|quand|perche|dove|что|почему|как|кто|когда|где|quando', '吗|什么|为什么|怎么|谁|哪|何|なぜ|どう|誰|왜|뭐|어떻게');
const TOUCH = {
  poke: { emoji: '😮', voice: 'sound' }, pat: { emoji: '🙂', voice: 'sound' }, pet: { emoji: '😌', voice: 'sound' },
  hold: { emoji: '🙂', voice: 'none' }, lift: { emoji: '😮', voice: 'sound' }, shake: { emoji: '😵‍💫', voice: 'sound' },
  drop: { emoji: '😱', voice: 'sound' }, throw: { emoji: '😱', voice: 'sound' },
};
const SIDE = [[re('left|izquierda|links|gauche|влево|esquerda', '左|왼'), 'left'], [re('right|derecha|rechts|droite|вправо|direita', '右|오른'), 'right']];

export function decideRules(state) {
  const text = norm(typeof state === 'string' ? state : state?.text).trim(), touch = state?.touch;
  let out = { emoji: null, gaze: null, hop: 'none', voice: 'none', filler: 'none' };
  if (text) {
    out.gaze = 'viewer';
    const hit = RULES.find(([pattern]) => pattern.test(text));
    out = { ...out, voice: 'words', ...(hit?.[1] ?? {}) };
    if (!hit && (/[?¿？]/.test(text) || QUESTION.test(text))) out = { ...out, emoji: '🤔', filler: 'thinking' };
    else if (!hit && /[!！]/.test(text)) out.emoji = '🙂';
    // "hop left" style: a side word with a hop command steps sideways instead of bouncing in place.
    if (out.hop === 'in_place') for (const [pattern, side] of SIDE) if (pattern.test(text)) out.hop = side;
  } else if (touch) {
    out.gaze = 'touch';
    const t = TOUCH[touch.kind];
    // Hard landings and big impacts startle; plain contact/hover stays quiet.
    if (touch.kind === 'land') out = { ...out, ...(touch.impact >= 4 || touch.g >= 3 ? { emoji: '😵‍💫', voice: 'sound' } : {}) };
    else if (t) out = { ...out, ...t };
  }
  if (out.emoji !== null && !Object.hasOwn(LABELS, out.emoji)) out.emoji = null; // never emit a label the catalog lacks
  return out;
}

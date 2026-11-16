// Mintie's finite vocabulary. Recipes contain data, never executable choreography.
export const EXCLUDED = Object.freeze(['🖕','🤘','👌','🫰','🫵','✍️','💅','🤳']);
export const FX_KINDS = Object.freeze(['hearts','sparkles','tears','sweat','anger','zzz','question','exclaim','notes','confetti','fire','steam','dizzy','lightbulb','sweatdrops','blushlines']);
export const ACCESSORIES = Object.freeze(['none','sunglasses','halo','horns','partyhat','glasses','cowboy','mask','monocle','crown']);
const face = (openL=1, openR=openL, smileL=0, frown=0, icon='none', blush=0, gaze=[0,0], pupil=1) =>
  ({openL,openR,smileL,smileR:smileL,frown,icon,blush,gaze,pupil});
const mouth = (shape, open=0, smile=0, width=0.5) => ({shape,open,smile,width});
const body = (squash=0, x=0, z=0, y=0, twist=0, puff=0, wobble=0.2, loop='none', hz=2) =>
  ({squash,lean:[x,z],offset:[0,y,0],twist,puff,wobble,loop,hz});
const bud = (side, dir, {height=0.48,reach=0.9,contact='none',bulge=0}={}) =>
  ({side,height,reach,dir,contact,bulge});
const hand = (poses, motion='none', hz=2) => ({poses,motion,hz});
const R = (dir, opts) => bud('R',dir,opts);
const L = (dir, opts) => bud('L',dir,opts);
const pair = (left,right,opts={}) => [L(left,opts),R(right,opts)];
const fx = (...kinds) => kinds.map(kind=>({kind,intensity:1}));
export const PRIMITIVES = {
  face: {
    soft:face(), happy:face(0.72,0.72,0.7,0,'none',0.3), grin:face(0.5,0.5,1),
    squint:face(0.12,0.12,1,0,'none',0.35), wink:face(0.1,0.95,0.4,0,'none',0.25),
    love:face(1.1,1.1,0.4,0,'heart',0.8), star:face(1.2,1.2,0.2,0,'star',0.25),
    shy:face(0.7,0.7,0.3,0,'none',0.9,[0.3,-0.35]), smug:face(0.5,0.8,0.2),
    surprise:face(1.4,1.4,0,0,'none',0,[0,0],0.8), awe:face(1.25,1.25,0.2,0,'none',0.3,[0,0.2],1.3),
    blank:face(0.7), flat:face(0.5), sleepy:face(0.25), closed:face(0.04,0.04,0.2),
    sad:face(0.8,0.8,0,-0.7), plead:face(1.15,1.15,0,-0.8,'none',0.4,[0,0],1.5),
    cry:face(0.65,0.65,0,-1,'tear'), sob:face(0.1,0.1,0,-1,'tear',0.4),
    angry:face(0.7,0.7,0,1), rage:face(0.4,0.4,0,1), worried:face(1.15,1.15,0,-0.5),
    sick:face(0.55,0.65,0,-0.2), dizzy:face(0.9,0.9,0,0,'spiral'), dead:face(0.8,0.8,0,0,'cross'),
    think:face(0.65,0.95,0,0.35,'none',0,[0.5,0.35]), roll:face(0.9,0.9,0,0,'none',0,[0,1]),
    peek:face(0.18,1.15,0.1,0,'none',0.25,[-0.3,0]), money:face(1.1,1.1,0.3,0,'money'),
    suspicious:face(0.55,0.9,0,0.6,'none',0,[0.6,0]), cool:face(0.7,0.7,0.2),
  },
  mouth: {
    hidden:mouth('none'), smile:mouth('smile',0.1,0.7), beam:mouth('smile',0.25,1,0.8),
    laugh:mouth('laugh',0.85,1,0.85), gasp:mouth('o',0.75,0,0.4), tinyO:mouth('o',0.28,0,0.25),
    frown:mouth('frown',0.1,-0.65), sob:mouth('wobble',0.65,-0.9,0.8), pout:mouth('frown',0.15,-1,0.35),
    flat:mouth('flat',0,0,0.6), wobble:mouth('wobble',0.2,-0.3), plead:mouth('wobble',.06,-.5,.25), tongue:mouth('tongue',0.6,0.6,0.65),
    kiss:mouth('kiss',0.25,0.3,0.3), teeth:mouth('teeth',0.35,0.3,0.85), cat:mouth('cat',0.15,0.6),
    zip:mouth('zip',0,0,0.55), yawn:mouth('o',1,0,0.6),
  },
  body: {
    still:body(0,0,0,0,0,0,0.08), perk:body(-0.06,0,0.04), bounce:body(-0.08,0,0,0.09,0,0,0.35,'bounce',2.3),
    giggle:body(0.08,0,0.06,0,0,0,0.5,'bounce',4), laugh:body(0.14,0,0.08,0,0,0.08,0.75,'shake',5),
    roll:body(0.08,-0.35,0,0,0.25,0,0.85,'roll',2.2), hop:body(-0.15,0,0,0.27,0,0,0.6,'bounce',1.8),
    sway:body(0,0.12,0,0,0,0,0.25,'sway',1), shy:body(0.06,-0.1,0.08,0,0,0,0.15),
    kiss:body(-0.03,0,0.2,0,0,0.04), recoil:body(-0.08,0,-0.2,0,0,0,0.45),
    tremble:body(0.06,0,-0.06,0,0,0,0.55,'shake',7), droop:body(0.16,0,0.13,0,0,-0.08,0.15),
    plead:body(.08,0,.13,0,0,-.15,.12),
    sigh:body(0.12,0,0.05,0,0,-0.1), sleep:body(0.12,-0.1,0,0,0,0,0.08,'breathe',0.3),
    nod:body(0.03,0,0.1,0,0,0,0.2,'nod',1.7), no:body(0,0,0,0,0.15,0,0.2,'no',2.8),
    puff:body(-0.02,0,-0.06,0,0,0.3,0.25), stomp:body(0.17,0,0.08,0,0,0.18,0.6,'stomp',2.4),
    wilt:body(0.22,0.12,0.18,0,0,-0.15,0.25), spin:body(-0.04,0.08,0,0,0.4,0,0.6,'spin',1.1),
    bow:body(0.08,0,0.42), shrug:body(-0.06,0.08,0,0,0,0.08), flex:body(-0.05,-0.14,0,0,0,0.16,0.35),
    melt:body(0.35,0,0.08,0,0,-0.2,0.35), float:body(-0.06,0,0,0.12,0,0,0.2,'float',0.7),
    startle:body(-0.12,0,-0.10,0.04,0,0.05,0.45), shiver:body(0.02,0,0,0,0,0,0.45,'shake',10), sneak:body(0.15,-0.15,-0.05,0,-0.15),
  },
  buds: {
    none:hand([]), wave:hand([R([0.5,0.9,0.1])],'wave',2.8),
    back:hand([R([0.6,0.65,0])]), five:hand([R([0.5,0.75,0.2])]),
    stop:hand([R([0.2,0.5,0.85])]), vulcan:hand([R([0.5,0.75,0.2])]),
    right:hand([R([1,0.1,0])]), left:hand([L([-1,0.1,0])]),
    down:hand([R([0.65,-0.5,0.3])]), offer:hand([R([0.5,0.1,0.75])]),
    pushL:hand([L([-0.7,0.25,0.5])],'push',2.4), pushR:hand([R([0.7,0.25,0.5])],'push',2.4),
    pinch:hand([R([0.45,0.4,0.6],{reach:.5})],'pinch',2),
    tiny:hand([R([0.45,0.35,0.65],{reach:.4})]),
    peace:hand([R([0.5,0.9,0.15])]), crossed:hand([R([-.5,.7,.5],{contact:'chest',height:.42,reach:.65})]),
    love:hand([R([0.6,0.65,0.1])]), call:hand([R([0.4,0.7,0.3],{contact:'ear',height:.30,reach:.65})]),
    pointL:hand([L([-1,0.1,0.1])]), pointR:hand([R([1,0.1,0.1])]),
    pointUp:hand([R([0.4,0.9,0.1])]), pointDown:hand([R([0.4,-0.8,0.1])]),
    lesson:hand([R([0.15,0.95,0.2])],'wag',1.6),
    thumbsUp:hand([R([0.25,1,0.15])]), thumbsDown:hand([R([0.25,-1,0.15])]),
    thumbL:hand([L([-0.9,0.15,0.2])]), thumbR:hand([R([0.9,0.15,0.2])]),
    fist:hand([R([0.5,0.75,0.1])]), punch:hand([R([0.1,0.1,1])],'push',2),
    fistL:hand([L([-0.9,0.2,0.25])]), fistR:hand([R([0.9,0.2,0.25])]),
    clap:hand(pair([0.28,0.35,0.85],[-0.28,0.35,0.85],{contact:'chest',reach:.65,height:.32}),'clap',3),
    celebrate:hand(pair([-0.6,0.85,0.05],[0.6,0.85,0.05]),'raise',2),
    heart:hand(pair([0.38,0.9,0.7],[-0.38,0.9,0.7],{contact:'chest',height:.36,reach:.65})),
    welcome:hand(pair([-0.8,0.25,0.55],[0.8,0.25,0.55])),
    cup:hand(pair([0.4,0.1,0.85],[-0.4,0.1,0.85],{height:.20,reach:.65,contact:'chest'})),
    shake:hand(pair([-0.4,0.05,0.35],[0,0.15,1],{contact:'other'}),'handshake',2.6),
    pray:hand(pair([0.4,0.65,0.6],[-0.4,0.65,0.6],{contact:'chest',height:.24,reach:.65})),
    flex:hand([R([0.45,0.9,0.05],{bulge:1})],'flex',1.2),
    hug:hand(pair([-.85,.35,.35],[.85,.35,.35],{height:.52,reach:.9}),'hug',0.9),
    mouth:hand([R([-0.35,0.3,0.9],{contact:'mouth',reach:.65,height:.32})]),
    peek:hand([R([-0.15,0.8,0.65],{contact:'eye',reach:.7})],'peek',1.2),
    shush:hand([R([-0.3,0.4,0.9],{contact:'mouth',reach:.65})]),
    chin:hand([R([-0.25,0,0.9],{contact:'chin',reach:.7})]),
    salute:hand([R([-0.15,0.8,0.6],{contact:'brow',reach:.7})]),
    facepalm:hand([R([-0.3,0.65,0.75],{contact:'eye',reach:.65})]),
    shrug:hand(pair([-0.8,0.45,0.3],[0.8,0.45,0.3]),'raise',0.8),
    raise:hand([R([0.2,1,0])],'raise',1.2), circle:hand(pair([-.45,1,0],[.45,1,0],{height:.75,reach:1})),
    cross:hand(pair([0.9,0.45,0.45],[-0.9,0.45,0.45],{height:.22,reach:.65,contact:'other'})),
    present:hand([R([0.9,0.2,0.4])]), ear:hand([R([0.3,0.7,0.4],{contact:'ear'})]),
    eyes:hand(pair([0.3,0.75,0.65],[-0.3,0.75,0.65],{height:.47,contact:'eye',reach:.65})),
    ears:hand(pair([-0.5,0.75,0.1],[0.5,0.75,0.1],{contact:'ear',reach:.65})),
  },
  fx: {
    none:[], hearts:fx('hearts'), sparkle:fx('sparkles'), tears:fx('tears'), sweat:fx('sweat'),
    angry:fx('anger'), sleep:fx('zzz'), question:fx('question'), exclaim:fx('exclaim'),
    music:fx('notes'), party:fx('confetti','sparkles'), fire:fx('fire'), steam:fx('steam'),
    dizzy:fx('dizzy'), idea:fx('lightbulb','sparkles'), drops:fx('sweatdrops'), blush:fx('blushlines'),
    love:fx('hearts','sparkles'), laugh:fx('tears','sparkles'), shock:fx('exclaim','sweat'),
    rain:fx('tears','sweatdrops'), magic:fx('sparkles','dizzy'), broken:fx('hearts','tears'),
  },
  tint: Object.fromEntries(['none','red','blue','pale','pink','gold'].map(kind=>[kind,{kind,amount:kind==='none'?0:0.65}])),
  accessory:Object.fromEntries(ACCESSORIES.map(kind=>[kind,kind])),
};
const BASE = {face:'soft',mouth:'hidden',body:'perk',buds:'none',fx:'none',tint:'none',accessory:'none',anticipationMs:180,durationMs:1500,loop:'none'};
export const FAMILY_DEFAULTS = {
  smiling:{...BASE,face:'happy',mouth:'smile'},
  affection:{...BASE,face:'love',mouth:'smile',body:'sway',fx:'hearts'},
  tongue:{...BASE,face:'grin',mouth:'tongue',body:'sway'},
  handface:{...BASE,face:'shy',mouth:'smile',body:'shy'},
  neutral:{...BASE,face:'blank',mouth:'flat',body:'still'},
  sleepy:{...BASE,face:'sleepy',body:'sleep'},
  unwell:{...BASE,face:'sick',mouth:'wobble',body:'droop'},
  hat:{...BASE,face:'happy',mouth:'smile'},
  glasses:{...BASE,face:'cool',mouth:'smile',body:'sway'},
  concerned:{...BASE,face:'worried',mouth:'frown',body:'recoil'},
  negative:{...BASE,face:'angry',mouth:'pout',body:'puff'},
  costume:{...BASE,face:'grin',mouth:'cat',body:'sway'},
  cat:{...BASE,face:'happy',mouth:'cat',body:'sway'},
  monkey:{...BASE,face:'shy',mouth:'tinyO',body:'shy'},
  emotion:{...BASE,face:'happy',mouth:'smile',body:'sway'},
  hand:{...BASE,face:'happy',mouth:'smile',body:'perk',durationMs:1700},
  person:{...BASE,face:'happy',mouth:'smile',body:'perk',durationMs:1700},
  symbol:{...BASE,face:'awe',mouth:'tinyO',body:'perk'},
};
export const CATALOG = {};
function add(family, emoji, name_es, name_en, overrides={}) {
  const recipe={...FAMILY_DEFAULTS[family],...overrides};
  recipe.loop=overrides.loop ?? PRIMITIVES.body[recipe.body].loop;
  CATALOG[emoji]={name_es,name_en,family,recipe};
}
// One selectable label per readable intent; spelling/style variants live only in ALIASES.
const s=(e,es,en,r)=>add('smiling',e,es,en,r);
s('😅','qué nervios','nervous laugh',{face:'grin',mouth:'laugh',body:'recoil',fx:'sweat'});
s('😂','lágrimas de risa','tears of joy',{face:'squint',mouth:'laugh',body:'laugh',fx:'tears',durationMs:1800});
s('🙂','sonrisa suave','slightly smiling',{mouth:'hidden',body:'still'});
s('😉','guiño','wink',{mouth:'hidden',face:'wink',body:'shy'});
const a=(e,es,en,r)=>add('affection',e,es,en,r);
a('😘','besito volador','blowing a kiss',{face:'wink',mouth:'kiss',body:'kiss'});
const t=(e,es,en,r)=>add('tongue',e,es,en,r);
t('😋','qué rico','savoring food',{face:'closed',body:'sway'});
t('😜','lengüita con guiño','winking tongue',{face:'wink',body:'bounce'});
t('🤑','ojitos de dinero','money mouth',{face:'money',mouth:'tongue',body:'puff',fx:'sparkle'});
const h=(e,es,en,r)=>add('handface',e,es,en,r);
h('🤗','abrazo de gomita','hugging',{face:'happy',mouth:'beam',body:'sway',buds:'hug'});
h('🤫','shhh','shushing',{face:'soft',mouth:'tinyO',buds:'shush',body:'still'});
h('🤔','a ver déjame pensar','thinking',{face:'think',mouth:'pout',buds:'chin',body:'still',fx:'question'});
h('🫡','a la orden','saluting',{mouth:'hidden',face:'happy',buds:'salute',body:'perk'});
const n=(e,es,en,r)=>add('neutral',e,es,en,r);
n('😐','cara de nada','deadpan neutral face',{mouth:'hidden'});
n('🤨','ceja levantada','raised eyebrow',{face:'suspicious',body:'shrug',mouth:'hidden',fx:'question'});
n('😏','sonrisita picarona','smirking',{face:'smug',mouth:'smile',body:'sneak'});
n('🙄','ay por favor','eye roll',{face:'roll',mouth:'hidden',body:'sigh'});
const z=(e,es,en,r)=>add('sleepy',e,es,en,r);
z('😌','qué paz','relieved',{face:'closed',mouth:'hidden',body:'sigh'});
z('😴','dormidita','sleeping',{face:'closed',mouth:'hidden',fx:'sleep',durationMs:1900});
const u=(e,es,en,r)=>add('unwell',e,es,en,r);
u('😷','con cubrebocas','medical mask',{accessory:'mask',mouth:'hidden',body:'shiver'});
u('🤢','me da cosita','nauseated',{mouth:'wobble',body:'sway',fx:'sweat'});
u('🤧','achú','sneezing',{face:'squint',mouth:'gasp',buds:'mouth',body:'nod',fx:'drops'});
u('🥵','mucho calor','hot',{face:'worried',mouth:'tongue',body:'droop',tint:'red',fx:'drops'});
u('🥶','qué frío','cold',{face:'worried',mouth:'teeth',body:'shiver',tint:'blue',fx:'sweat'});
u('😵‍💫','todo da vueltas','spiral eyes',{face:'dizzy',mouth:'gasp',body:'spin',fx:'dizzy'});
const g=(e,es,en,r)=>add('glasses',e,es,en,r);
g('😎','con toda la onda','cool',{mouth:'hidden',accessory:'sunglasses',body:'sway'});
const c=(e,es,en,r)=>add('concerned',e,es,en,r);
c('😟','preocupadita','worried',{mouth:'hidden',face:'worried',body:'tremble'});
c('😮','oh','open mouth',{face:'surprise',mouth:'gasp',body:'startle'});
c('😳','tierra trágame','flushed',{face:'surprise',mouth:'hidden',body:'shy',tint:'pink',fx:'blush'});
c('🥺','porfiii','pleading',{face:'plead',mouth:'hidden',body:'plead',buds:'none'});
c('😭','llanto de drama','loudly crying',{face:'sob',mouth:'sob',body:'laugh',fx:'tears',durationMs:1900});
c('😱','grito de susto','screaming',{face:'surprise',mouth:'yawn',body:'hop',fx:'shock',tint:'blue'});
c('😞','triste','sad',{face:'sad',mouth:'hidden',body:'droop'});
c('😫','agotadísima','tired',{face:'sleepy',mouth:'sob',body:'melt'});
const neg=(e,es,en,r)=>add('negative',e,es,en,r);
neg('😠','enojada','angry',{mouth:'hidden',face:'angry',body:'puff',fx:'angry'});
const m=(e,es,en,r)=>add('monkey',e,es,en,r);
m('🙈','no veo','see no evil',{face:'closed',mouth:'hidden',buds:'eyes',body:'shy'});
m('🙉','no escucho','hear no evil',{mouth:'hidden',face:'squint',buds:'ears',body:'no'});
const em=(e,es,en,r)=>add('emotion',e,es,en,r);
em('❤️','te quiero','love',{mouth:'hidden',face:'love',body:'puff',buds:'heart',fx:'hearts'});
em('💔','corazón roto','broken heart',{face:'cry',mouth:'hidden',body:'wilt',fx:'broken'});
const hd=(e,es,en,r)=>add('hand',e,es,en,r);
hd('👋','holaaa','waving',{mouth:'hidden',buds:'wave',body:'sway',durationMs:1900});
hd('🤏','poquitito','pinching hand',{mouth:'hidden',buds:'tiny',face:'squint',body:'shy'});
hd('✌️','¡lo logré!','victory proud',{mouth:'hidden',buds:'peace',face:'smug',body:'puff',fx:'sparkle'});
hd('🤞','cruzo deditos','crossed fingers',{mouth:'hidden',buds:'crossed',face:'plead',body:'shy'});
hd('🤙','me llamas','call me',{mouth:'hidden',buds:'call',face:'happy',body:'sway'});
hd('👉','mira por acá','pointing',{mouth:'hidden',buds:'pointR',body:'sway'});
hd('👍','súper bien','thumbs up',{mouth:'hidden',buds:'thumbsUp',face:'grin',body:'nod'});
hd('👎','no me late','thumbs down',{buds:'thumbsDown',face:'sad',mouth:'hidden',body:'sigh'});
hd('👏','bravooo','clapping',{mouth:'hidden',buds:'clap',face:'grin',body:'giggle',fx:'sparkle',durationMs:1900});
hd('🤝','mucho gusto','handshake',{mouth:'hidden',buds:'shake',body:'nod',durationMs:1900});
hd('🙏','porfi gracias','folded hands',{mouth:'hidden',buds:'pray',face:'plead',body:'perk'});
hd('💪','gomita fuerte','flexed biceps',{mouth:'hidden',buds:'flex',face:'smug',body:'flex',fx:'sparkle'});
const p=(e,es,en,r)=>add('person',e,es,en,r);
p('🙅','no gracias','gesturing no',{mouth:'hidden',buds:'cross',face:'worried',body:'no'});
p('🤷','quién sabe','shrugging',{buds:'shrug',face:'think',mouth:'hidden',body:'shrug',fx:'question'});
p('🤦','ay no puede ser','facepalm',{buds:'facepalm',face:'closed',mouth:'hidden',body:'droop'});
p('🧏','te presto mi oído','deaf person',{mouth:'hidden',buds:'ear',face:'awe',body:'bow'});
const sy=(e,es,en,r)=>add('symbol',e,es,en,r);
sy('✨','brillitos','sparkles',{face:'star',body:'float',fx:'sparkle'});
sy('🎉','fiestaaa','party popper',{face:'grin',mouth:'laugh',buds:'celebrate',body:'hop',fx:'party'});
sy('🔥','está que arde','fire',{face:'smug',mouth:'hidden',body:'puff',fx:'fire',tint:'red'});
sy('👀','ojito al dato','eyes',{face:'surprise',mouth:'hidden',body:'sneak'});
sy('💡','se me prendió el foco','light bulb',{face:'surprise',mouth:'hidden',buds:'lesson',body:'perk',fx:'idea'});
p('💃','a bailar','dancing',{mouth:'hidden',face:'grin',body:'spin',buds:'celebrate',fx:'music'});
p('🙂‍↕️','sí, sí','nod yes',{face:'soft',mouth:'hidden',body:'still',buds:'none',loop:'yes'});
p('🙂‍↔️','no, no','shake head no',{face:'soft',mouth:'hidden',body:'still',buds:'none',loop:'headshake'});
p('🦘','¡salto!','hop',{face:'soft',mouth:'hidden',body:'still',buds:'none',loop:'jump',anticipationMs:140});
p('🤸','¡vueltita!','spin',{face:'soft',mouth:'hidden',body:'still',buds:'none',loop:'turn'});
// Every removed catalog spelling stays addressable, never selectable. Non-expressions do nothing.
const ALIASES = Object.fromEntries([
  ['🙂','😀 😃 😄 😁 😊 😇 ☺️ 😺 😸'],
  ['😂','😆 🤣 🤭 😹 💀 ☠️'],
  ['😅','😬 🤥 💩 💦'],
  ['😜','😛 🤪 😝 🤡 👻 👾'],
  ['😏','🙃 😈 😼 🥸 🌚'],
  ['💔','🥀'],
  ['❤️','🥰 😍 😻 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 🩶 ❤️‍🔥 ❤️‍🩹 💕 💖 💗 💘 💝 💞 💓 💟 ❣️ 💌 🤟 🫶 ♥ ♥️'],
  ['😘','😗 😚 😙 😽 💋'],
  ['✨','🤩 ⭐ 🌟'],
  ['😋','🤤'],
  ['🤗','👐 🫂'],
  ['🤫','🤐 🙊'],
  ['🤔','🤓 🧐 💭'],
  ['🤨','😒 👺'],
  ['😌','😮‍💨 😥'],
  ['😞','😔 🙁 ☹️ 😖 😣 🙍 🤕'],
  ['😴','😪 🥱 💤'],
  ['😫','🫩 😓 😩'],
  ['😷','🤒'],
  ['🤢','🤮'],
  ['😵‍💫','🥴 😵 💫'],
  ['😎','🤠 👑'],
  ['😮','🫢 😯 😲 🤯 💥 ❗ ‼️ ⚡'],
  ['😳','🫠 🫥'],
  ['😟','😦 😧 😰'],
  ['😭','🥲 🥹 😢 😿'],
  ['😱','😨 🫨 🙀'],
  ['😠','😤 😡 🤬 👿 👹 😾 💢 🙎'],
  ['🙈','🫣'],
  ['👋','🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🙋'],
  ['👉','👈 👆 👇 ☝️ 💁'],
  ['👍','🫹 🫺 🙆 💯 ✅ ☑️ ✔️ 🆗'],
  ['👎','❌ ❎'],
  ['🤝','👊 🤛 🤜 🫱‍🫲'],
  ['🙏','🤲 🫴 🙇'],
  ['💪','🦾 ✊'],
  ['🙅','🫷 🫸 ⛔ 🚫'],
  ['🤷','😕 🫤 😶‍🌫️ ❓ ⁉️'],
  ['🧏','💬 👂 🦻'],
  ['✌️','🏆 🥇'],
  ['😐','😑 😶'],
  ['🎉','🥳 🎊 🙌 🥂 🍻'],
  ['👀','👁️ 👁'],
  ['💃','🕺 🩰 🎵 🎶'],
  // No performance for no-op, literal animals, objects, food, weather or flags.
  [null,'👽 🤖 🤌 🌻 🌸 🎂 🍿 ☕ 🍀 🌈 ☀️ 🌧️ ❄️ 🎁 🫧 🏃 🎈 💰 💸 🦋 🐰 🌙 🔴 💨 🌹 🌺 🌷 💐 🌞 🍎 🍕 🍔 🍰 🧁 🧋 🍵 🏳️ 🏴 🏳️‍🌈 🏳️‍⚧️ 🇲🇽 🇪🇸 🇺🇸 🇧🇷'],
].flatMap(([label,list])=>list.split(' ').filter(Boolean).map(e=>[e.replace(/️/g,''),label])));
const UNQUALIFIED = Object.fromEntries(Object.keys(CATALOG).map(e=>[e.replace(/️/g,''),e]));
export function canonical(emoji) {
  if (typeof emoji!=='string') return null;
  const stripped=emoji.replace(/[\u{1f3fb}-\u{1f3ff}]/gu,'').replace(/‍[♀♂]️?/gu,'');
  const plain=stripped.replace(/️/g,'');
  if (EXCLUDED.some(e=>e.replace(/️/g,'')===plain)) return null;
  if (Object.hasOwn(CATALOG,stripped)) return stripped;
  return Object.hasOwn(UNQUALIFIED,plain) ? UNQUALIFIED[plain] : Object.hasOwn(ALIASES,plain) ? ALIASES[plain] : null;
}
// Deep-freeze shared data: browser and server consumers cannot mutate the vocabulary.
function freeze(value) {
  if (value && typeof value==='object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
freeze(PRIMITIVES); freeze(FAMILY_DEFAULTS); freeze(CATALOG); freeze(ALIASES);
// Validate untrusted/custom recipes before they can preempt an owned performance.
export function resolveRecipe(value) {
  if (typeof value==='string') {
    const key=canonical(value);
    if (key===null) throw new RangeError('Unknown emoji');
    return CATALOG[key].recipe;
  }
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError('Invalid recipe');
  if (Object.keys(value).some(key=>!Object.hasOwn(BASE,key))) throw new RangeError('Unknown recipe field');
  const result={...BASE,...value};
  for (const key of ['face','mouth','body','buds','fx','tint','accessory']) {
    if (typeof result[key]!=='string' || !Object.hasOwn(PRIMITIVES[key],result[key])) throw new RangeError(`Unknown ${key} primitive`);
  }
  if (!Number.isFinite(result.anticipationMs) || result.anticipationMs<80 || result.anticipationMs>350 ||
      !Number.isFinite(result.durationMs) || result.durationMs<result.anticipationMs+700 || result.durationMs>6000) throw new RangeError('Invalid timing');
  result.loop=value.loop ?? PRIMITIVES.body[result.body].loop;
  if (!['none','bounce','shake','roll','sway','breathe','nod','no','stomp','spin','float','jump','turn','yes','headshake'].includes(result.loop)) throw new RangeError('Unknown loop');
  return freeze(result);
}

const DT = 1 / 60, GRAVITY = 7.5;
const HEAD = new Set(['crown', 'forehead', 'flower', 'eyeL', 'eyeR']);
const floorPoint = p => [p[0], p[2]].map(v => round(clamp(v, -100, 100)));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));
const vec = v => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(Number.isFinite) ? v.slice(0, 3) : null;
const round = v => Number((Number.isFinite(v) ? v : 0).toFixed(2));
const spring = (s, target, hz, damping) => {
  const w = 2 * Math.PI * hz;
  s.v += ((target - s.x) * w * w - 2 * damping * w * s.v) * DT;
  s.x += s.v * DT;
};
const mode = () => ({ x: 0, v: 0 });
const bound = (s, limit) => { if (Math.abs(s.x) > limit) { s.x = Math.sign(s.x) * limit; s.v *= -0.15; } };
const copy = d => ({ ...d, com: [...d.com], shear: [...d.shear], tilt: [...d.tilt], grab: d.grab && [...d.grab], dents: d.dents.map(v => ({ ...v, p: [...v.p], n: [...v.n] })), flower: { swing: [...d.flower.swing] } });
const partOf = hit => {
  if (hit.region === 'flower') return 'flower';
  const p = vec(hit.worldPoint) || hit.point;
  let nearest = Infinity, part;
  for (const [key, radius] of Object.entries({ eyeL: .09, eyeR: .09, mouth: .10, cheekL: .12, cheekR: .12, flower: .13, crown: .13 })) {
    const a = vec(hit.anchors?.[key]?.position);
    if (!a) continue;
    const distance = Math.hypot(...p.map((x, i) => x - a[i]));
    if (distance <= radius && distance < nearest) { nearest = distance; part = key; }
  }
  if (part) return part;
  const [x, y, z] = hit.point;
  return y < .14 ? 'base' : z < -.08 ? 'back' : Math.abs(x) > .38 ? x < 0 ? 'sideL' : 'sideR' : y > .66 ? 'forehead' : 'belly';
};

export function createTouch() {
  // ponytail: reduced rigid-body modes, not mesh collision; upgrade only for body/body contacts.
  let hopping = null, lastHop = null, hover = null;
  const yaw = mode();
  let state = 'idle', press = null, grab = null, last = null, clock = 0, accumulator = 0, reduced = false;
  let lastPet = -Infinity, lastFlower = -Infinity, lastShake = -Infinity, shakeEnergy = 0, landing = null;
  let queue = [], recent = [], dents = [], target = [0, 0, 0], com = [0, 0, 0], velocity = [0, 0, 0];
  const squash = mode(), shear = [mode(), mode()], tilt = [mode(), mode()], flower = [mode(), mode()], stretch = mode();
  let previous, current;
  const emit = (kind, at, intensity = 1, source = press, impact = 0) => {
    recent = recent.filter(e => at - e.at < 4000);
    recent.push({ kind, at });
    queue.push({ kind, at: round(at), intensity: round(clamp(intensity, 0, 4)), part: source?.part || 'base',
      durationMs: round(kind === 'land' ? 0 : Math.max(0, at - (source?.at ?? at))), path: round(source?.path), speed: round(source?.peak),
      height: round(Math.max(0, com[1] + .32)), impact: round(kind === 'land' ? impact : 0),
      spin: round(kind === 'throw' || kind === 'land' ? Math.hypot(...tilt.map(s => s.v)) : 0), repeat: recent.filter(e => e.kind === kind).length,
      accel: round(clamp(source?.accel, 0, 1000)), jerk: round(clamp(source?.jerk, 0, 100000)),
      ...(['lift', 'drop', 'throw'].includes(kind) ? { release: round(clamp(source?.release, 0, 50)) } : {}),
      ...(['lift', 'drop', 'throw', 'land'].includes(kind) ? { from: [...(source?.from || floorPoint(com))], to: floorPoint(com) } : {}),
      ...(kind === 'land' ? { g: round(clamp(impact * (impact > .65 ? 1 + (reduced ? .08 : .33) : 1) / DT / GRAVITY, 0, 50)) } : {}) });
  };
  const dent = (p, n, depth, radius, at = -Infinity) => {
    const d = { p: [...p], n: [...n], radius, at, s: { x: depth, v: 0 } };
    dents.push(d); if (dents.length > 4) dents.shift(); return d;
  };
  const snapshot = () => {
    const scale = reduced ? 0.4 : 1;
    return { com: [...com], squash: clamp(squash.x * scale, -0.5, 0.5), shear: shear.map(s => clamp(s.x * scale, -0.5, 0.5)),
      tilt: tilt.map(s => reduced ? clamp(s.x, -.1, .1) : s.x), stretch: clamp(stretch.x * scale, 0, 1), grab: grab && [...grab],
      dents: dents.map(d => ({ p: [...d.p], n: [...d.n], depth: clamp(d.s.x * scale, 0, 0.1), radius: d.radius })),
      flower: { swing: flower.map(s => clamp(s.x * scale, -.6, .6)) }, state,
      hopping: !!hopping, twist: yaw.x, facing: hopping?.direction ? (hopping.landedAt == null ? 1 : Math.exp(-(clock - hopping.landedAt) / 220)) : 0 };
  };
  function hop({ to = null, height = .5 } = {}) {
    if (reduced || press || hopping || state !== 'idle' || com[1] > .001 || Math.hypot(...velocity) > .1) return false;
    if (!Number.isFinite(height) || height <= 0 || to !== null && (!Array.isArray(to) || to.length !== 2 || !to.every(Number.isFinite))) return false;
    const from = [com[0], com[2]], end = to ? [...to] : [...from];
    // ponytail: 4H soft home boundary, 1.5H hop, .12–1.1H height; tune from observed floor/framing limits.
    const radius = Math.hypot(...end);
    if (to && radius > 4) end.forEach((v, i) => end[i] = v * 4 / radius);
    const delta = end.map((v, i) => v - from[i]), length = Math.hypot(...delta), gain = Math.min(1, 1.5 / (length || 1));
    delta.forEach((v, i) => end[i] = from[i] + v * gain);
    const frames = Math.max(2, Math.round(2 * Math.sqrt(2 * clamp(height, .12, 1.1) / GRAVITY) / DT));
    hopping = { from, to: end, at: clock, frames, launched: false, direction: length > .01 ? Math.atan2(delta[0], delta[1]) : null };
    lastHop = { from: [...from], to: [...end], at: round(clock) };
    return true;
  }
  const emitHover = at => {
    if (hover && at - hover.at >= 250 && (hover.emittedAt === null || at - hover.emittedAt >= 1500)) {
      queue.push({ kind: 'hover', part: hover.part, durationMs: round(at - hover.at), path: round(hover.path), speed: round(hover.peak), at: round(at) });
      hover.emittedAt = at;
    }
  };
  const advance = () => {
    const oldVelocity = velocity.slice();
    if (hopping && !hopping.launched && clock - hopping.at >= 140) {
      hopping.launched = true; state = 'falling';
      velocity = [(hopping.to[0] - com[0]) / (hopping.frames * DT), GRAVITY * DT * (hopping.frames + 1) / 2, (hopping.to[1] - com[2]) / (hopping.frames * DT)];
      squash.v -= 5.4; flower[0].v += .8;
    }
    if (hopping?.landedAt != null && clock - hopping.landedAt > 900 && state === 'idle') { hopping = null; }
    spring(yaw, hopping?.landedAt == null && hopping?.direction != null ? hopping.direction : 0, 2.8, .85);
    emitHover(clock);
    if (press && !press.held && !press.stroked && !press.hold && clock - press.at >= 700) { press.hold = true; emit('hold', clock); }
    if (state === 'held') {
      for (let i = 0; i < 3; i++) {
        velocity[i] += ((target[i] - com[i]) * 320 - velocity[i] * 30) * DT;
        com[i] += velocity[i] * DT;
      }
    } else {
      if (state === 'falling') velocity[1] -= GRAVITY * DT;
      for (let i = 0; i < 3; i++) com[i] += velocity[i] * DT;
      if (com[1] <= 0) {
        const impact = Math.max(0, -velocity[1]);
        com[1] = 0;
        if (state === 'falling' && impact > 0) {
          if (hopping && hopping.landedAt == null) {
            com[0] = hopping.to[0]; com[2] = hopping.to[1]; velocity[0] = velocity[2] = 0;
            hopping.landedAt = clock;
          }
          if (landing) {
            emit('land', clock, clamp(impact / 2, .2, 4), landing, impact); landing = null;
            for (const s of tilt) s.x = Math.atan2(Math.sin(s.x), Math.cos(s.x));
          }
          squash.v += clamp(impact * (hopping ? 3.4 : 2.4), 0, hopping ? 10 : 8);
          for (let i = 0; i < 2; i++) { shear[i].v += tilt[i].x * 2; tilt[i].v *= .7; }
          velocity[1] = impact > .65 ? impact * (reduced ? .08 : hopping ? .24 : .33) : 0;
          if (!velocity[1]) state = 'idle';
        }
        for (const i of [0, 2]) velocity[i] *= Math.exp(-5 * DT);
      }
      if (state !== 'falling') velocity[1] = 0;
    }
    for (let i = 0; i < 3; i++) {
      const lo = i === 1 ? 0 : -6, hi = i === 1 ? 4 : 6;
      if (com[i] < lo || com[i] > hi) { com[i] = clamp(com[i], lo, hi); velocity[i] *= -.15; }
    }
    const petting = state === 'pet' && press?.stroked;
    spring(squash, hopping && !hopping.launched ? .24 : state === 'pat' ? .07 : petting ? .035 : 0, 3.4, .38);
    for (let i = 0; i < 2; i++) {
      const axis = i === 0 ? 0 : 2, acceleration = clamp((velocity[axis] - oldVelocity[axis]) / DT, -60, 60);
      const offset = petting ? press.lastPoint[axis] - press.anchor[axis] : 0;
      const stroke = petting ? clamp(offset * .18 + (clock - press.lastAt <= 100 ? press.velocity[axis] * .10 : 0), -.14, .14) : 0;
      spring(shear[i], stroke, 3.2, .35);
      if (state === 'held') tilt[i].v -= acceleration * 1.3 * DT;
      if (state === 'falling') { tilt[i].x += tilt[i].v * DT; tilt[i].v *= Math.exp(-.25 * DT); }
      else {
        const hang = state === 'held' ? clamp((grab?.[axis] ?? 0) * 1.8, -.75, .75) : petting ? clamp(offset * .3, -.07, .07) * clamp((clock - press.at - 500) / 1000, 0, 1) : 0;
        spring(tilt[i], hang, state === 'held' ? .8 : 2.2, state === 'held' ? .22 : .72);
      }
      if (reduced || state === 'held') bound(tilt[i], reduced ? .1 : 1.2);
      flower[i].v -= acceleration * .18 * DT;
      spring(flower[i], petting && press.nearFlower ? (i === 1 ? -shear[0].x : shear[1].x) * .8 : 0, 1.45, .3); bound(flower[i], .58);
    }
    const tension = state === 'held' ? clamp(.25 + com[1] * .12 + Math.hypot(...velocity) * .03, 0, .85) : 0;
    spring(stretch, tension, state === 'falling' ? 4 : 3, .72);
    for (const d of dents) spring(d.s, press?.dent === d && petting ? .035 : press?.dent === d && state === 'poke' || clock - d.at < 100 ? .08 : 0, 3.1, .4);
    dents = dents.filter(d => Math.abs(d.s.x) > .0003 || Math.abs(d.s.v) > .003);
    shakeEnergy *= .95;
    if (!press && ['poke', 'pat', 'pet'].includes(state)) state = 'idle';
    if (state === 'idle' && stretch.x < .001 && tilt.every(s => Math.abs(s.x) < .002)) grab = null;
  };
  current = snapshot(); previous = copy(current);
  const validHit = hit => hit && ['body', 'head', 'flower'].includes(hit.region) && vec(hit.point) && vec(hit.normal) && Math.hypot(...hit.normal) > 1e-6;
  const pointOnPlane = (point, normal, ray) => {
    const origin = vec(ray?.origin), dir = vec(ray?.dir);
    if (!origin || !dir) return null;
    const dot = dir.reduce((s, x, i) => s + x * normal[i], 0);
    if (Math.abs(dot) < 1e-6) return null;
    const t = point.reduce((s, x, i) => s + (x - origin[i]) * normal[i], 0) / dot;
    return t >= 0 && Number.isFinite(t) ? vec(origin.map((x, i) => x + t * dir[i])) : null;
  };
  return {
    pointerDown(hit, nowMs, ray) {
      if (!validHit(hit) || !Number.isFinite(nowMs) || press) return;
      const point = vec(hit.point), normal = vec(hit.normal), length = Math.hypot(...normal);
      normal.forEach((v, i) => normal[i] = v / length);
      const world = vec(hit.worldPoint) || point.map((x, i) => x + com[i]), planeNormal = vec(ray?.normal) || vec(ray?.dir) || [0, 0, -1];
      const anchor = pointOnPlane(world, planeNormal, ray);
      emitHover(nowMs); hover = null; hopping = null;
      press = { region: hit.region, part: partOf(hit), point, normal, world, planeNormal, anchor, startCom: world.map((x, i) => x - point[i]), lastPoint: anchor || world.slice(),
        from: floorPoint(com), accel: 0, jerk: 0, acceleration: [0, 0, 0], release: 0,
        at: nowMs, lastAt: nowMs, path: 0, peak: 0, movement: 0, velocity: [0, 0, 0], dent: null, held: false, stroked: false, hold: false };
      landing = null; velocity = [0, 0, 0];
      emit('contact', nowMs);
      if (hit.region === 'flower') {
        state = 'pet'; flower[0].x = clamp(flower[0].x + .015, -.58, .58); flower[1].x = clamp(flower[1].x - .04, -.58, .58);
        flower[0].v += 1; flower[1].v -= 2.8;
        current = snapshot(); previous = copy(current);
      }
      else if (hit.region === 'head') { state = 'pat'; squash.v += 3.4; }
      else { state = 'poke'; press.dent = dent(point, normal, .09, .23, nowMs); shear[0].v -= normal[0] * 1.1; shear[1].v -= normal[2] * .9; }
    },
    pointerMove(hit, ray, nowMs) {
      if (!press || !Number.isFinite(nowMs) || nowMs < press.lastAt) return;
      const p = pointOnPlane(press.world, press.planeNormal, ray);
      if (!p) return;
      if (!press.anchor) { press.anchor = p; press.lastPoint = p; press.lastAt = nowMs; return; }
      const elapsed = Math.max(DT, (nowMs - press.lastAt) / 1000), delta = p.map((x, i) => x - press.lastPoint[i]);
      const v = delta.map(x => clamp(x / elapsed, -20, 20)), accel = v.map((x, i) => clamp((x - press.velocity[i]) / elapsed, -200, 200));
      const displacement = p.map((x, i) => x - press.anchor[i]);
      press.path += Math.hypot(...delta); press.peak = Math.max(press.peak, Math.hypot(...v));
      press.accel = Math.max(press.accel, Math.hypot(...accel));
      press.jerk = Math.max(press.jerk, Math.hypot(...accel.map((x, i) => (x - press.acceleration[i]) / elapsed)));
      press.acceleration = accel; press.release = Math.hypot(...v);
      press.movement = Math.max(press.movement, Math.hypot(...displacement));
      const horizontal = Math.hypot(displacement[0], displacement[2]);
      if (!press.held && !press.stroked && !press.hold && nowMs - press.at >= 700) { press.hold = true; emit('hold', nowMs); }
      // ponytail: world-up pull, not geodesics; allow brief pick gaps as the soft dent passes under the ray.
      const onSurface = validHit(hit) && ['head', 'flower'].includes(hit.region);
      if (onSurface) { press.surfacePoint = p; press.outsideAt = null; }
      else press.outsideAt ??= nowMs;
      const surface = onSurface || !hit && press.stroked && nowMs - press.outsideAt < 100 && Math.hypot(...p.map((x, i) => x - (press.surfacePoint || press.anchor)[i])) < .06;
      const upward = displacement[1] > .06 && displacement[1] > horizontal * 1.25;
      const pettable = ['head', 'flower'].includes(press.region);
      const stroke = !press.held && !press.hold && pettable && surface && !upward && (press.stroked || displacement[1] <= 0 || horizontal > displacement[1] * 1.25);
      if (stroke && press.path > .035) {
        if (!press.stroked) squash.v *= .2;
        state = 'pet'; press.stroked = true;
        const isFlower = press.region === 'flower' || hit?.region === 'flower', previousPet = isFlower ? lastFlower : lastPet;
        if (nowMs - previousPet >= 1500) { emit(isFlower ? 'pet_flower' : 'pet', nowMs, .35, {...press, part: isFlower ? 'flower' : press.part}); if (isFlower) lastFlower = nowMs; else lastPet = nowMs; }
        if (hit?.region === 'head') {
          if (!press.dent) press.dent = dent(hit.point, hit.normal, .025, .24);
          press.dent.p = vec(hit.point); press.dent.n = vec(hit.normal);
        }
      } else if (press.held || (press.movement > .035 && (!pettable || !surface || press.hold || upward))) {
        if (!press.held) { state = 'held'; press.held = true; grab = press.point.slice(); press.dent = null; emit('lift', nowMs); }
        target = displacement.map((x, i) => clamp(press.startCom[i] + x, i === 1 ? 0 : -6, i === 1 ? 4 : 6));
        const speed = Math.hypot(...v), reversal = v.reduce((s, x, i) => s + x * press.velocity[i], 0) < -.2;
        if (speed > 1.2 && reversal) shakeEnergy += speed;
        if (shakeEnergy > 4 && nowMs - lastShake >= 700) {
          emit('shake', nowMs, clamp(shakeEnergy / 4, 1, 4)); lastShake = nowMs; shakeEnergy = 0;
          shear[0].v += clamp(accel[0] * .018, -1.5, 1.5); shear[1].v += clamp(accel[2] * .018, -1.5, 1.5);
        }
      }
      const flowerPoint = vec(hit?.anchors?.flower?.position), worldPoint = vec(hit?.worldPoint);
      const nearFlower = press.region === 'flower' || hit?.region === 'flower' || flowerPoint && worldPoint && Math.hypot(...worldPoint.map((x, i) => x - flowerPoint[i])) < .3;
      press.nearFlower = nearFlower;
      if (nearFlower) { flower[1].v -= clamp(v[0] * .55, -1.6, 1.6); flower[0].v += clamp(v[1] * .22, -.7, .7); }
      press.lastPoint = p; press.lastAt = nowMs; press.velocity = v;
    },
    pointerUp(nowMs) {
      if (!press || !Number.isFinite(nowMs) || nowMs < press.lastAt) return;
      if (!press.held && !press.stroked && !press.hold && nowMs - press.at >= 700) { press.hold = true; emit('hold', nowMs); }
      if (press.held) {
        const fresh = nowMs - press.lastAt <= 100;
        velocity = fresh ? press.velocity.map(x => clamp(x, -12, 12)) : [0, 0, 0];
        press.release = Math.hypot(...velocity);
        state = 'falling'; landing = { ...press };
        emit(Math.hypot(...velocity) >= 2 ? 'throw' : 'drop', nowMs);
      } else if (!press.stroked && !press.hold) {
        const kind = press.region === 'head' ? 'pat' : press.region === 'flower' ? 'pet_flower' : 'poke';
        if (kind !== 'pet_flower' || nowMs - lastFlower >= 1500) { emit(kind, nowMs); if (kind === 'pet_flower') lastFlower = nowMs; }
      }
      if (!press.held && com[1] > 0) { state = 'falling'; landing = { ...press }; }
      press = null;
    },
    pointerHover(hit, nowMs) {
      if (!Number.isFinite(nowMs) || press || hover && nowMs < hover.lastAt) return;
      const part = validHit(hit) ? partOf(hit) : null;
      if (!HEAD.has(part)) { emitHover(nowMs); hover = null; return; }
      const point = vec(hit.worldPoint) || hit.point.map((x, i) => x + com[i]);
      if (!hover) hover = { part, at: nowMs, lastAt: nowMs, point, path: 0, peak: 0, emittedAt: null };
      else {
        const distance = Math.hypot(...point.map((x, i) => x - hover.point[i]));
        hover.path += distance; hover.peak = Math.max(hover.peak, distance / Math.max(DT, (nowMs - hover.lastAt) / 1000));
        hover.part = part; hover.point = point; hover.lastAt = nowMs;
      } emitHover(nowMs);
    },
    hop,
    cancelHop() {
      if (!hopping) return false;
      hopping = null; velocity = [0, 0, 0]; com[1] = 0; state = 'idle';
      yaw.x = yaw.v = 0;
      current = snapshot(); previous = copy(current);
      return true;
    },
    get lastHop() { return lastHop && { ...lastHop, from: [...lastHop.from], to: [...lastHop.to] }; },
    step(nowMs) {
      if (!Number.isFinite(nowMs)) return copy(current);
      if (last === null) { last = nowMs; clock = nowMs; }
      const elapsed = clamp((nowMs - last) / 1000, 0, 4 * DT); last = Math.max(last, nowMs);
      accumulator = Math.min(accumulator + elapsed, 4 * DT);
      clock = last - accumulator * 1000;
      while (accumulator >= DT - 1e-10) { clock += DT * 1000; previous = current; advance(); current = snapshot(); accumulator = Math.max(0, accumulator - DT); }
      const a = accumulator / DT, out = copy(current);
      for (const key of ['com', 'shear', 'tilt']) out[key] = out[key].map((v, i) => previous[key][i] + (v - previous[key][i]) * a);
      for (const key of ['squash', 'stretch', 'twist', 'facing']) out[key] = previous[key] + (current[key] - previous[key]) * a;
      out.flower.swing = out.flower.swing.map((v, i) => previous.flower.swing[i] + (v - previous.flower.swing[i]) * a);
      return out;
    },
    events() { const result = queue; queue = []; return result; },
    setReducedMotion(value) { reduced = !!value; current = snapshot(); previous = copy(current); }
  };
}

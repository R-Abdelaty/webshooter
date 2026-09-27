(function (root) {
  'use strict';
  // The villains' attacks (docs/PLAYER_PLAN.md, Session P4). No Three.js:
  // fight.js runs them and world-game.js / attack-view.js show them.
  //
  // THE FRAMEWORK every villain uses. An attack goes
  //   wait -> telegraph -> active -> recover -> wait ...
  //   telegraph  the wind-up, Difficulty's `telegraph` long (0.9 s): a clip,
  //              a sound and - when he is off the screen - a red chevron at
  //              its edge. Nothing ever lands without one.
  //   active     it lands: a bomb leaves his hand, the guns fire. What it
  //              hurts is tested against the player's body at the moment it
  //              gets there, so moving out of the way dodges it.
  //   recover    a window where he's open.
  // One starts every `cadence` seconds (3-5, from the start of the last),
  // never during his entrance (fight.js only runs this once it's over), and
  // never two in a row from off the screen: if the last one began with him
  // out of view, the next waits until you can see him.
  //
  //   var a = Attacks.create(kind, difficulty, seed)
  //   var events = Attacks.step(a, dt, { onScreen, state, rand })
  //     events: { type: 'telegraph', move, off } | { type: 'strike', move } |
  //             { type: 'recover', move } | { type: 'ready' }
  //
  // THE GOBLIN'S MOVES.
  //   bomb  a pumpkin bomb thrown in an arc at where you'll be. It goes off
  //         on contact (with you or the city) or when its fuse runs out: a
  //         blast that hurts by distance. A web at one in flight shoots it
  //         down (aimBomb has its own small cone).
  //   guns  a red laser from the glider's guns follows you through the
  //         wind-up, then locks, and a short burst of tracers goes down that
  //         line - at where you were. Move or swing out of it.
  //
  // x east, z south, y up, metres, seconds.

  function need(name, file) { return root[name] || (typeof require === 'function' ? require(file) : null); }
  var CityRef = need('City', './city.js');
  var DiffRef = need('Difficulty', './difficulty.js');

  var K = {
    // Pumpkin bombs.
    BOMB_R: .2,             // its radius (the model is 20 cm across... and a bit)
    BOMB_T: [1.05, 1.7],    // seconds in the air, near to far...
    BOMB_T_PER_M: .03,      // ...growing this much a metre
    GRAVITY: 9.8,
    LEAD: .8,               // it's aimed where you'll be: this share of your velocity times the flight...
    LEAD_MAX: 9,            // ...at most this far ahead of you (level)
    FUSE: 2.6,              // seconds after the throw it goes off wherever it is
    TOUCH: .25,             // it goes off this close to your body
    BLAST_R: 5,             // metres the blast reaches
    BLAST_INNER: 1.2,       // full damage within this
    PUSH: 8,                // m/s it throws you at full damage
    BOMB_CONE: 3,           // degrees: a web aimed this close to one in flight shoots it down
    BOMB_ACTIVE: .45,       // the throw's follow-through
    DIRECT: 1,              // a bomb that hits you does this share of the damage range (the most)
    // The glider's guns.
    GUN_TRACK: 2.5,         // the laser follows you this fast through the wind-up (1/s, eased)
    GUN_ROUNDS: 6,
    GUN_EVERY: .065,        // seconds between rounds (they alternate guns)
    GUN_SPEED: 120,         // m/s
    GUN_RANGE: 70,          // metres a round flies
    GUN_R: .22,             // how close to your body a round has to pass to hit
    GUN_SPREAD: .006,       // radians of scatter per round
    GUN_SHARE: .35,         // a burst does this share of the damage range (once: then you're invulnerable)
    // Which move: on a line or in the air he prefers the guns, on your feet
    // the bombs, and never the same one three times running.
    PREFER: { air: { guns: .7, bomb: .3 }, ground: { guns: .35, bomb: .65 } }
  };
  var MOVES = { glider: ['bomb', 'guns'], charge: [], leap: [] };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function len(a) { return Math.hypot(a.x, a.y, a.z); }
  function unit(a) { var l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }
  function copy(p) { return p ? { x: p.x, y: p.y, z: p.z } : null; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

  // --- the framework ---------------------------------------------------------------
  function create(kind, diff, seed) {
    var d = diff || DiffRef.get('HARD');
    return { kind: kind, d: d, moves: (MOVES[kind] || []).slice(), phase: 'wait', t: 0, wait: d.firstAttack,
      move: null, last: null, twice: false, n: 0, off: false, offLast: false, held: 0, aim: null, seed: (seed || 1) >>> 0 };
  }
  function rnd(a) { a.seed = (a.seed * 1103515245 + 12345) & 0x7fffffff; return a.seed / 0x7fffffff; }
  function activeFor(move) { return move === 'guns' ? K.GUN_ROUNDS * K.GUN_EVERY + .1 : K.BOMB_ACTIVE; }

  // Which move, for what you're doing: 'swing' / 'fly' / 'zip' are in the air.
  function pick(a, state, u) {
    if (!a.moves.length) return null;
    if (a.moves.length === 1) return a.moves[0];
    var P = K.PREFER[state === 'swing' || state === 'fly' || state === 'zip' ? 'air' : 'ground'], w = a.moves.map(function (m) { return P[m] || 1; });
    // Not three of the same in a row.
    if (a.twice) w = w.map(function (x, i) { return a.moves[i] === a.last ? 0 : x; });
    var sum = w.reduce(function (s, x) { return s + x; }, 0), k = u * sum;
    for (var i = 0; i < w.length; i++) { k -= w[i]; if (k < 0 && w[i] > 0) return a.moves[i]; }
    return a.moves[w.lastIndexOf(Math.max.apply(null, w))];
  }

  // ctx: { onScreen: is he in view, state: yours ('ground', 'perch',
  // 'swing', 'fly', 'zip'), rand: optional random source }.
  function step(a, dt, ctx) {
    var ev = [], c = ctx || {}, u = c.rand || function () { return rnd(a); };
    dt = dt > 0 ? dt : 0;
    if (!a.moves.length) return ev;
    a.wait -= dt;
    if (a.phase === 'wait') {
      if (a.wait > 0) return ev;
      // Fairness: never two in a row from off the screen.
      if (!c.onScreen && a.offLast) { a.held += dt; return ev; }
      var m = pick(a, c.state, u());
      a.twice = m === a.last; a.last = m;
      a.phase = 'telegraph'; a.t = 0; a.move = m; a.n++; a.held = 0;
      a.off = !c.onScreen; a.offLast = a.off;
      a.wait = DiffRef.span(a.d.cadence, u());
      ev.push({ type: 'telegraph', move: m, off: a.off });
      return ev;
    }
    a.t += dt;
    if (a.phase === 'telegraph' && a.t >= a.d.telegraph) {
      a.t -= a.d.telegraph; a.phase = 'active'; ev.push({ type: 'strike', move: a.move });
    }
    if (a.phase === 'active' && a.t >= activeFor(a.move)) {
      a.t -= activeFor(a.move); a.phase = 'recover'; ev.push({ type: 'recover', move: a.move });
    }
    if (a.phase === 'recover' && a.t >= a.d.recover) {
      a.t = 0; a.phase = 'wait'; ev.push({ type: 'ready' });
    }
    return ev;
  }
  // Called off (a stagger, the end of the fight): straight to recovering.
  function cancel(a) { if (a.phase === 'telegraph' || a.phase === 'active') { a.phase = 'recover'; a.t = 0; } }
  function winding(a) { return !!a && a.phase === 'telegraph'; }

  // --- geometry ---------------------------------------------------------------------
  // The nearest point of segment a-b to p, and how far along (0..1).
  function onSeg(p, a, b) {
    var ab = sub(b, a), l2 = dot(ab, ab), t = l2 > 1e-12 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
    return { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t, t: t };
  }
  // The gap between two segments p1-q1 and p2-q2 (closest points).
  function segSeg(p1, q1, p2, q2) {
    var d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
    var a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), s, t;
    if (a <= 1e-12 && e <= 1e-12) return dist(p1, p2);
    if (a <= 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
    else {
      var c = dot(d1, r);
      if (e <= 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
      else {
        var b = dot(d1, d2), den = a * e - b * b;
        s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
      }
    }
    var c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s }, c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
    return dist(c1, c2);
  }
  // How far p is from the surface of a body (a list of capsules { a, b, r }):
  // 0 inside it.
  function gap(p, caps) {
    var best = Infinity;
    (caps || []).forEach(function (c) { best = Math.min(best, dist(p, onSeg(p, c.a, c.b)) - c.r); });
    return Math.max(0, best);
  }
  function centre(caps) {
    var c = { x: 0, y: 0, z: 0 }, n = 0;
    (caps || []).forEach(function (k) { c.x += k.a.x + k.b.x; c.y += k.a.y + k.b.y; c.z += k.a.z + k.b.z; n += 2; });
    return n ? { x: c.x / n, y: c.y / n, z: c.z / n } : null;
  }
  // A body for someone at p when no model says better: one upright capsule,
  // lower when crouched on a perch.
  function standIn(p, crouch) {
    var top = crouch ? 1.2 : 1.6;
    return [{ a: { x: p.x, y: p.y + .35, z: p.z }, b: { x: p.x, y: p.y + top, z: p.z }, r: .3, bones: ['stand-in', 'stand-in'] }];
  }
  // Where the segment a-b first meets the city (a collision box, or the
  // street at y 0): how far along it (0..1) and the point, or null.
  function hitCity(city, a, b) {
    var best = null, d = sub(b, a);
    if (b.y <= 0 && a.y > 0) best = a.y / (a.y - b.y);
    else if (a.y <= 0) best = 0;
    if (city && CityRef) {
      var list = CityRef.query(city, Math.min(a.x, b.x) - .1, Math.min(a.z, b.z) - .1, Math.max(a.x, b.x) + .1, Math.max(a.z, b.z) + .1);
      for (var i = 0; i < list.length; i++) {
        var c = list[i], t0 = 0, t1 = 1, ok = true, ax = ['x', 'y', 'z'];
        for (var k = 0; k < 3 && ok; k++) {
          var n = ax[k], lo = c[n + '0'], hi = c[n + '1'];
          if (Math.abs(d[n]) < 1e-12) { if (a[n] < lo || a[n] > hi) ok = false; continue; }
          var u = (lo - a[n]) / d[n], v = (hi - a[n]) / d[n];
          if (u > v) { var s = u; u = v; v = s; }
          t0 = Math.max(t0, u); t1 = Math.min(t1, v);
          if (t0 > t1) ok = false;
        }
        if (ok && (best === null || t0 < best)) best = t0;
      }
    }
    if (best === null) return null;
    return { t: best, point: { x: a.x + d.x * best, y: a.y + d.y * best, z: a.z + d.z * best } };
  }

  // --- pumpkin bombs -----------------------------------------------------------------
  // A bomb thrown from `from` to land on `target`, which is moving at `vel`
  // (it leads you, level, up to LEAD_MAX). Its flight is longer the further
  // it goes. { id, x, y, z, vx, vy, vz, t, T, to, popAt }
  function throwBomb(from, target, vel, id) {
    var d = dist(from, target), T = clamp(K.BOMB_T[0] + d * K.BOMB_T_PER_M, K.BOMB_T[0], K.BOMB_T[1]);
    var lx = (vel ? vel.x : 0) * T * K.LEAD, lz = (vel ? vel.z : 0) * T * K.LEAD, ll = Math.hypot(lx, lz);
    if (ll > K.LEAD_MAX) { lx *= K.LEAD_MAX / ll; lz *= K.LEAD_MAX / ll; }
    var to = { x: target.x + lx, y: target.y, z: target.z + lz };
    return { id: id, x: from.x, y: from.y, z: from.z, from: copy(from), to: to, T: T, t: 0, popAt: null,
      vx: (to.x - from.x) / T, vy: (to.y - from.y) / T + .5 * K.GRAVITY * T, vz: (to.z - from.z) / T };
  }
  // Where a bomb is `t` seconds into its flight (nothing in its way).
  function bombAt(b, t) {
    return { x: b.from.x + b.vx * t, y: b.from.y + (b.vy - .5 * K.GRAVITY * t) * t, z: b.from.z + b.vz * t };
  }
  // Move a bomb on by dt. `now` is the fight's time (for a web on its way to
  // it: popAt). Returns null while it flies, or { at, why } when it goes off:
  // 'shot' (a web reached it), 'body' (it hit you), 'city' (it hit a wall, a
  // roof or the street) or 'fuse'.
  function stepBomb(b, dt, now, city, caps) {
    if (!(dt > 0)) return null;
    var n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (var i = 0; i < n; i++) {
      var p0 = { x: b.x, y: b.y, z: b.z };
      b.t += h; var p1 = bombAt(b, b.t);
      b.x = p1.x; b.y = p1.y; b.z = p1.z;
      if (b.popAt !== null && now - dt + h * (i + 1) >= b.popAt) return { at: p1, why: 'shot' };
      if (caps && caps.length) {
        for (var k = 0; k < caps.length; k++) {
          var c = caps[k];
          if (segSeg(p0, p1, c.a, c.b) <= c.r + K.BOMB_R + K.TOUCH) return { at: p1, why: 'body' };
        }
      }
      var w = hitCity(city, p0, p1);
      if (w) { b.x = w.point.x; b.y = w.point.y; b.z = w.point.z; return { at: w.point, why: 'city' }; }
      if (b.t >= K.FUSE) return { at: p1, why: 'fuse' };
    }
    return null;
  }
  // What a blast at `at` does to a body: the whole damage range's top
  // within BLAST_INNER, falling to its bottom at BLAST_R, and nothing beyond.
  // A bomb that went off against you ('body') does DIRECT of it.
  function blastDamage(at, caps, diff, why) {
    var d = diff || DiffRef.HARD, g = gap(at, caps);
    if (why === 'body') return Math.round(DiffRef.span(d.damage, K.DIRECT));
    if (g >= K.BLAST_R) return 0;
    var u = g <= K.BLAST_INNER ? 1 : 1 - (g - K.BLAST_INNER) / (K.BLAST_R - K.BLAST_INNER);
    return Math.round(DiffRef.span(d.damage, u));
  }
  // Which way (and how hard, m/s) a blast throws a body: away from it, and
  // up a little, by how much it hurt.
  function push(at, caps, damage, diff) {
    var d = diff || DiffRef.HARD, c = centre(caps) || at, v = sub(c, at);
    v.y = Math.max(v.y, 0) + len(v) * .35;
    var k = K.PUSH * clamp(damage / d.damage[1], 0, 1);
    v = unit(v);
    return { x: v.x * k, y: v.y * k, z: v.z * k };
  }
  // A web shot (origin, unit dir) at the bombs in flight: the one it passes
  // closest to, within BOMB_CONE degrees of it, in front and nearer than
  // `blocked`. Its index in `bombs` ([{ x, y, z }]), or -1.
  function aimBomb(origin, dir, bombs, deg, blocked) {
    var tol = (Number.isFinite(deg) ? deg : K.BOMB_CONE) * Math.PI / 180, best = -1, bestA = Infinity;
    (bombs || []).forEach(function (b, i) {
      var v = sub(b, origin), d = len(v);
      if (d < 1e-6 || d - K.BOMB_R > (Number.isFinite(blocked) ? blocked : Infinity) + .05) return;
      var cos = clamp(dot(v, dir) / d, -1, 1);
      if (cos <= 0) return;
      var off = Math.max(0, Math.acos(cos) - Math.asin(Math.min(1, K.BOMB_R / d)));
      if (off <= tol && off < bestA) { bestA = off; best = i; }
    });
    return best;
  }

  // --- the glider's guns ------------------------------------------------------------
  // The laser through the wind-up: from `aim` (null the first frame) toward
  // `target`, eased, so moving fast makes it trail you.
  function track(aim, target, dt) {
    if (!aim) return copy(target);
    var k = 1 - Math.exp(-K.GUN_TRACK * (dt > 0 ? dt : 0));
    return { x: aim.x + (target.x - aim.x) * k, y: aim.y + (target.y - aim.y) * k, z: aim.z + (target.z - aim.z) * k };
  }
  // A burst at the locked aim: rounds from `muzzles` (one or two points,
  // alternating), fired one every GUN_EVERY from `now`, each with a little
  // scatter from `u` (a random source). [{ at (fire time), from, dir, gun }]
  function burst(muzzles, aim, now, u) {
    var out = [], m = muzzles && muzzles.length ? muzzles : [aim];
    for (var i = 0; i < K.GUN_ROUNDS; i++) {
      var from = m[i % m.length], d = unit(sub(aim, from)), s = K.GUN_SPREAD;
      var jx = ((u ? u() : .5) - .5) * 2 * s, jy = ((u ? u() : .5) - .5) * 2 * s;
      // Scatter square to the line.
      var side = unit({ x: -d.z, y: 0, z: d.x }), up = { x: d.y * side.z - d.z * side.y, y: d.z * side.x - d.x * side.z, z: d.x * side.y - d.y * side.x };
      out.push({ at: now + i * K.GUN_EVERY, from: copy(from), dir: unit({ x: d.x + side.x * jx + up.x * jy, y: d.y + side.y * jx + up.y * jy, z: d.z + side.z * jx + up.z * jy }),
        gun: i % m.length, s: 0, live: true, fired: false });
    }
    return out;
  }
  // Move a round on to the fight's time `now`. Null while it flies (or waits
  // to be fired); 'body' if it went through you, 'city' if it hit something,
  // 'spent' at the end of its range. r.fired says it has left the gun.
  function stepRound(r, now, city, caps) {
    if (now < r.at) return null;
    r.fired = true;
    var s0 = r.s, s1 = Math.min(K.GUN_RANGE, (now - r.at) * K.GUN_SPEED);
    if (s1 <= s0) return null;
    var a = { x: r.from.x + r.dir.x * s0, y: r.from.y + r.dir.y * s0, z: r.from.z + r.dir.z * s0 };
    var b = { x: r.from.x + r.dir.x * s1, y: r.from.y + r.dir.y * s1, z: r.from.z + r.dir.z * s1 };
    r.s = s1;
    var w = hitCity(city, a, b), end = w ? w.point : b;
    for (var k = 0; caps && k < caps.length; k++) {
      var c = caps[k];
      if (segSeg(a, end, c.a, c.b) <= c.r + K.GUN_R) {
        var mid = { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2, z: (c.a.z + c.b.z) / 2 };
        r.s = s0 + onSeg(mid, a, end).t * dist(a, end);
        return 'body';
      }
    }
    if (w) { r.s = s0 + dist(a, w.point); return 'city'; }
    return s1 >= K.GUN_RANGE ? 'spent' : null;
  }
  // Does the line from `from` through `aim` (on past it to GUN_RANGE) pass
  // within GUN_R of a body? What the tracers will hit if you stay put.
  function onLine(from, aim, caps) {
    var d = unit(sub(aim, from)), end = { x: from.x + d.x * K.GUN_RANGE, y: from.y + d.y * K.GUN_RANGE, z: from.z + d.z * K.GUN_RANGE };
    return (caps || []).some(function (c) { return segSeg(from, end, c.a, c.b) <= c.r + K.GUN_R; });
  }
  function gunDamage(diff) { return Math.round(DiffRef.span((diff || DiffRef.HARD).damage, K.GUN_SHARE)); }

  var api = { create: create, step: step, cancel: cancel, winding: winding, pick: pick, MOVES: MOVES,
    onSeg: onSeg, segSeg: segSeg, gap: gap, centre: centre, standIn: standIn, hitCity: hitCity,
    throwBomb: throwBomb, bombAt: bombAt, stepBomb: stepBomb, blastDamage: blastDamage, push: push, aimBomb: aimBomb,
    track: track, burst: burst, stepRound: stepRound, onLine: onLine, gunDamage: gunDamage, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Attacks = api;
})(typeof window === 'undefined' ? globalThis : window);

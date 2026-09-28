(function (root) {
  'use strict';
  // The villains' attacks (docs/PLAYER_PLAN.md, Session P4). No Three.js:
  // fight.js runs them and world-game.js / attack-view.js show them.
  //
  // THE FRAMEWORK every villain uses. An attack goes
  //   wait -> telegraph -> active -> recover -> wait ...
  //   telegraph  the wind-up, Difficulty's `telegraph` long (0.65 s): a clip,
  //              a sound and - when he is off the screen - a red chevron at
  //              its edge. Nothing ever lands without one.
  //   active     it lands: a bomb leaves his hand, the guns fire. What it
  //              hurts is tested against the player's body at the moment it
  //              gets there, so moving out of the way dodges it.
  //   recover    a window where he's open.
  // One starts every `cadence` seconds (from the start of the last), never
  // during his entrance (fight.js only runs this once it's over). From off
  // the screen he still attacks, but its wind-up is Difficulty's `offScreen`
  // longer (the red chevron and the sound give it away), and a second one
  // from out there waits until the first has landed - nothing of his still
  // on its way to you (ctx.inFlight). A long move (a charge down the avenue,
  // a dazed Rhino) is followed by at least Difficulty's `breather`. And a
  // director: once `director` seconds go by with no attack and nothing in
  // flight, the next one starts at once. Which moves he can use depends on
  // how far you are and what you're doing, so fight.js passes them in
  // (`allow`); with none he waits.
  //
  //   var a = Attacks.create(kind, difficulty, seed)
  //   var events = Attacks.step(a, dt, { onScreen, state, rand, allow })
  //     events: { type: 'telegraph', move, off } | { type: 'strike', move } |
  //             { type: 'recover', move } | { type: 'ready' }
  //   Attacks.finish(a, rest)   a move whose strike lasts as long as it lasts
  //                             (a charge, a pounce, a combo) is over: recover,
  //                             for `rest` seconds if given
  //   Attacks.cancel(a)         called off (a stagger): straight to recovering
  //
  // THE GOBLIN'S MOVES.
  //   bomb  a pumpkin bomb thrown in an arc at where you'll be. It goes off
  //         on contact (with you or the city) or when its fuse runs out: a
  //         blast that hurts by distance. A web at one in flight shoots it
  //         down (aimBomb has its own small cone).
  //   guns  a red laser from the glider's guns follows you through the
  //         wind-up - your eye in first person, so you see it come at the
  //         lens - fast, and a little ahead of where you're going. In the
  //         wind-up's last GUN_LOCK seconds it locks, and a short burst of
  //         tracers goes down that line. Change direction or swing out of it
  //         once it locks.
  //   volley (P7) bombs and guns at once: he throws 2-3 bombs, one after
  //         another, while the guns charge (the laser is on from the wind-up),
  //         then the burst goes down the locked line. Keep moving.
  //   dive  (P7) close in, he swoops at you on the glider: straight at where
  //         you are (a little ahead) and on past, levelling out. Being in
  //         the way is heavy and knocks you off a line. Step or swing aside.
  //   Standing still on a roof (STILL_T seconds), he punishes it: the next
  //   attack comes at once, and it's bombs (fight.js).
  //
  // THE RHINO'S MOVES (P5). fight.js runs him; these are the sums.
  //   charge  you're down on the street: he winds up (a snort), then runs
  //           straight at where you are and skids on past. Being hit is
  //           heavy and throws you. Swing, zip or step out of the way.
  //   ram     you're up high - on a roof, or on a line anchored to one near
  //           his street: he charges the building under you. When he hits
  //           it, a quake: it hurts if you're still on that building within
  //           QUAKE_R of where he hit (or still hanging from it).
  //   After a ram, or running into a wall, he's dazed (fight.js).
  //
  // VENOM'S MOVES (P5).
  //   pounce  a leap aimed at you that lands next to you (a red ring shows
  //           where); being there when he lands is heavy.
  //   combo   close in: three swipes, one after another.
  //   lash    mid range: a tentacle whips out along a line that follows you
  //           through the wind-up; it knocks you off a swing line.
  //
  // x east, z south, y up, metres, seconds.

  function need(name, file) { return root[name] || (typeof require === 'function' ? require(file) : null); }
  var CityRef = need('City', './city.js');
  var DiffRef = need('Difficulty', './difficulty.js');
  var EncRef = need('Encounters', './encounters.js');

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
    GUN_TRACK: 14,          // the laser follows you this fast through the wind-up (1/s, eased)...
    GUN_LOCK: .15,          // ...and locks this long before the burst
    GUN_LEAD: 1,            // it leads you by this share of your velocity times the time until the rounds get to you...
    GUN_LEAD_MAX: 4,        // ...at most this far
    GUN_ROUNDS: 6,
    GUN_EVERY: .065,        // seconds between rounds (they alternate guns)
    GUN_SPEED: 120,         // m/s
    GUN_RANGE: 70,          // metres a round flies
    GUN_R: .22,             // how close to your body a round has to pass to hit
    GUN_SPREAD: .006,       // radians of scatter per round
    GUN_SHARE: .35,         // a burst does this share of the damage range (once: then you're invulnerable)
    // The volley (P7): bombs thrown this many at a time, this far apart, and
    // the guns' charge before the burst (from the strike; the laser is on
    // from the wind-up).
    VOLLEY_N: [2, 3], VOLLEY_EVERY: .3, VOLLEY_CHARGE: .9,
    // The dive (P7): he dives from within DIVE_RANGE metres of your chest, at
    // DIVE_V m/s, at where you'll be DIVE_LEAD s on, and on DIVE_PAST metres
    // past you, levelling out DIVE_LIFT above that point. His body hits
    // yours within DIVE_R; it does DIVE_SHARE of the damage range and throws
    // you DIVE_PUSH m/s along his line.
    DIVE_RANGE: 14, DIVE_V: 24, DIVE_LEAD: .2, DIVE_PAST: 9, DIVE_LIFT: 1.5, DIVE_R: .8, DIVE_SHARE: .85, DIVE_PUSH: 9,
    // Standing still (P7): within STILL_R metres of one spot on a roof for
    // STILL_T seconds, and the Goblin's next attack is bombs, at once.
    STILL_R: 1.5, STILL_T: 2,
    // The Rhino (P5).
    HIGH: 2.5,              // metres over his street at which you're up high (a ram, not a charge)
    CHARGE_RANGE: 45,       // metres (level) from him you can be for a charge...
    RAM_RANGE: 45,          // ...and the building's wall for a ram
    CHARGE_V: 12,           // m/s his charge reaches...
    CHARGE_ACCEL: 16,       // ...speeding up this hard
    BRAKE: 16,              // how hard he stops for a wind-up (m/s/s)
    CHARGE_MAX: 70,         // metres a charge goes, at most, before he skids
    RHINO_R: 1,             // his footprint: this close to a wall he's run into it
    RAM_R: .75,             // his body, for running you over: a capsule this thick...
    RAM_LOW: .6, RAM_TOP: 1.9, RAM_FRONT: .8,   // ...from his hips to his shoulders, reaching ahead of him
    CHARGE_SHARE: 1,        // being run over does this share of the damage range
    KNOCK_V: 11, KNOCK_UP: 5,   // and throws you this fast ahead of him, and up
    QUAKE_R: 16,            // a ram hurts you on that building within this of where he hit...
    QUAKE_INNER: 6,         // ...the most within this, the least at QUAKE_R
    // Venom (P5).
    MELEE: 3.2,             // metres (chest to chest) for a combo
    COMBO_N: 3, COMBO_GAP: .65, COMBO_END: .4,  // swipes, seconds apart, and the follow-through after the last
    SWIPE_REACH: 1.4, SWIPE_R: 1,              // a swipe reaches this far ahead of his chest (a lunge), and hits this close to it
    SWIPE_SHARE: .35,
    LASH_REACH: 13, LASH_MIN: 3.25,            // metres a tentacle reaches (and the least: nearer, it is claws)
    LASH_SPEED: 70, LASH_BACK: 45, LASH_R: .35, LASH_T: .5, LASH_TRACK: 3.5,
    LASH_SHARE: .6, LASH_PULL: 7,              // and it pulls you towards him this hard
    POUNCE_MIN: 4, POUNCE_MAX: 27,             // metres he pounces from
    POUNCE_GAP: 2.5,                           // he lands this far from you (closer, he fills the view: 56 fps on MED)
    POUNCE_HIT: 2.4,                           // ...and hurts you if you're this close to his chest when he does
    POUNCE_T: [.7, 1.15], POUNCE_T_PER_M: .025,
    POUNCE_SHARE: .85, POUNCE_PUSH: 7,
    HOME: 12,               // he never pounces further than this past his beams
    // Which move, for what you're doing ('air': on a line, flying or zipping;
    // 'ground': on your feet or perched), and never the same one three times
    // running (unless it's the only one there is). On a line or in the air
    // the Goblin prefers the guns, on your feet the bombs.
    // The Goblin's dive only comes up when you're close, and then he likes it.
    PREFER: {
      glider: { air: { guns: .45, volley: .3, bomb: .15, dive: .5 }, ground: { guns: .25, volley: .4, bomb: .35, dive: .5 } },
      leap: { air: { lash: 1 }, ground: { combo: 1, lash: .45, pounce: .55 } }
    }
  };
  var MOVES = { glider: ['bomb', 'guns', 'volley', 'dive'], charge: ['charge', 'ram'], leap: ['combo', 'lash', 'pounce'] };

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
    return { kind: kind, d: d, moves: (MOVES[kind] || []).slice(), phase: 'wait', t: 0, clock: 0, wait: d.firstAttack, quiet: 0, tele: d.telegraph,
      move: null, last: null, twice: false, n: 0, off: false, offLast: false, held: 0, aim: null, rest: null, seed: (seed || 1) >>> 0 };
  }
  function rnd(a) { a.seed = (a.seed * 1103515245 + 12345) & 0x7fffffff; return a.seed / 0x7fffffff; }
  // How long a move's strike lasts; null: until fight.js says it's over (finish).
  function activeFor(move) {
    if (move === 'guns') return K.GUN_ROUNDS * K.GUN_EVERY + .1;
    if (move === 'bomb') return K.BOMB_ACTIVE;
    if (move === 'lash') return K.LASH_T;
    return null;
  }
  function airborne(state) { return state === 'swing' || state === 'fly' || state === 'zip'; }

  // Which move, for what you're doing, from those allowed (all of his when
  // `allow` is left out).
  function pick(a, state, u, allow) {
    var list = allow ? a.moves.filter(function (m) { return allow.indexOf(m) >= 0; }) : a.moves;
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    var P = (K.PREFER[a.kind] || {})[airborne(state) ? 'air' : 'ground'] || {}, w = list.map(function (m) { return P[m] === undefined ? 1 : P[m]; });
    // Not three of the same in a row.
    if (a.twice) w = w.map(function (x, i) { return list[i] === a.last ? 0 : x; });
    var sum = w.reduce(function (s, x) { return s + x; }, 0), k = u * sum;
    for (var i = 0; i < w.length; i++) { k -= w[i]; if (k < 0 && w[i] > 0) return list[i]; }
    for (i = w.length - 1; i >= 0; i--) if (w[i] > 0) return list[i];
    return list[0];
  }

  // ctx: { onScreen: is he in view, state: yours ('ground', 'perch',
  // 'swing', 'fly', 'zip'), rand: optional random source, allow: the moves
  // he can use now (all when left out), inFlight: something of his is still
  // on its way to you (a bomb, rounds, the tentacle) }.
  function step(a, dt, ctx) {
    var ev = [], c = ctx || {}, u = c.rand || function () { return rnd(a); };
    dt = dt > 0 ? dt : 0;
    if (!a.moves.length) return ev;
    a.wait -= dt;
    quiet(a, dt, c);
    if (a.phase === 'wait') {
      if (a.wait > 0) return ev;
      // Fairness: a second one from off the screen waits for the first to land.
      if (!c.onScreen && a.offLast && c.inFlight) { a.held += dt; return ev; }
      var m = pick(a, c.state, u(), c.allow);
      // Nothing he can do from where he is: he waits for you.
      if (!m) { a.held += dt; return ev; }
      a.twice = m === a.last; a.last = m;
      a.phase = 'telegraph'; a.t = 0; a.clock = 0; a.move = m; a.n++; a.held = 0; a.quiet = 0;
      a.off = !c.onScreen; a.offLast = a.off;
      a.tele = a.d.telegraph + (a.off ? a.d.offScreen || 0 : 0);
      a.wait = DiffRef.span(a.d.cadence, u());
      ev.push({ type: 'telegraph', move: m, off: a.off, tele: a.tele });
      return ev;
    }
    a.t += dt; a.clock += dt;
    if (a.phase === 'telegraph' && a.t >= windup(a)) {
      a.t -= windup(a); a.phase = 'active'; ev.push({ type: 'strike', move: a.move });
    }
    var len = activeFor(a.move);
    if (a.phase === 'active' && len !== null && a.t >= len) {
      a.t -= len; a.phase = 'recover'; ev.push({ type: 'recover', move: a.move });
    }
    if (a.phase === 'recover' && a.t >= (a.rest !== null ? a.rest : a.d.recover)) {
      a.t = 0; a.phase = 'wait'; a.rest = null;
      a.wait = Math.max(a.wait, a.d.breather || 0);
      ev.push({ type: 'ready' });
    }
    return ev;
  }
  // The director: seconds with no attack of his going and nothing of his in
  // flight; at Difficulty's `director` the next one is due now. fight.js
  // also counts it while he's closing in from out of range.
  function quiet(a, dt, c) {
    if (a.phase !== 'wait' || (c && c.inFlight)) { a.quiet = 0; return; }
    a.quiet = (a.quiet || 0) + dt;
    if (a.d.director && a.quiet >= a.d.director) a.wait = Math.min(a.wait, 0);
  }
  // A strike that lasts as long as it lasts is over: recover (for `rest`
  // seconds, or Difficulty's `recover`).
  function finish(a, rest) {
    if (a.phase !== 'active') return false;
    a.phase = 'recover'; a.t = 0; a.rest = Number.isFinite(rest) ? rest : null;
    return true;
  }
  // Called off (a stagger, the end of the fight): straight to recovering.
  function cancel(a) { if (a.phase === 'telegraph' || a.phase === 'active') { a.phase = 'recover'; a.t = 0; a.rest = null; } }
  function winding(a) { return !!a && a.phase === 'telegraph'; }
  // How long this attack's wind-up is.
  function windup(a) { return (a && (a.tele || (a.d && a.d.telegraph))) || .9; }
  function busy(a) { return !!a && (a.phase === 'telegraph' || a.phase === 'active'); }

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
  // Where the guns aim to meet you: `target` (your eye, or your head or
  // chest) moved on by your velocity `vel` for as long as the rounds will
  // take - `wait` seconds until they fire, then their flight from `from` -
  // times GUN_LEAD, at most GUN_LEAD_MAX. Keep going the same way and they
  // meet you; change direction after the lock and they miss.
  function lead(target, vel, from, wait) {
    var t = Math.max(0, wait || 0) + (from ? dist(from, target) / K.GUN_SPEED : 0);
    var v = vel || {}, l = { x: (v.x || 0) * t * K.GUN_LEAD, y: (v.y || 0) * t * K.GUN_LEAD, z: (v.z || 0) * t * K.GUN_LEAD }, n = len(l);
    if (n > K.GUN_LEAD_MAX) { l.x *= K.GUN_LEAD_MAX / n; l.y *= K.GUN_LEAD_MAX / n; l.z *= K.GUN_LEAD_MAX / n; }
    return { x: target.x + l.x, y: target.y + l.y, z: target.z + l.z };
  }
  // The laser through the wind-up: from `aim` (null the first frame) toward
  // `target`, eased (at `rate`, GUN_TRACK by default): quick, but a sudden
  // change of direction still pulls it off you for a moment.
  function track(aim, target, dt, rate) {
    if (!aim) return copy(target);
    var k = 1 - Math.exp(-(rate || K.GUN_TRACK) * (dt > 0 ? dt : 0));
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
  // How close the guns' line (from `from` through `aim`, on to GUN_RANGE)
  // passes to `p` (an eye): { d (metres), s (metres along the line), point }.
  function passes(from, aim, p) {
    var d = unit(sub(aim, from)), end = { x: from.x + d.x * K.GUN_RANGE, y: from.y + d.y * K.GUN_RANGE, z: from.z + d.z * K.GUN_RANGE };
    var q = onSeg(p, from, end);
    return { d: dist(p, q), s: q.t * K.GUN_RANGE, point: { x: q.x, y: q.y, z: q.z }, dir: d };
  }
  function gunDamage(diff) { return Math.round(DiffRef.span((diff || DiffRef.HARD).damage, K.GUN_SHARE)); }
  // What a move does, as a share of the damage range (15-30 on HARD).
  function damage(share, diff) { return Math.round(DiffRef.span((diff || DiffRef.HARD).damage, share)); }

  // --- the rhino ----------------------------------------------------------------------
  function near(c, x, z, pad) { return x >= c.x0 - pad && x <= c.x1 + pad && z >= c.z0 - pad && z <= c.z1 + pad; }
  // The building someone standing at p is on: the box of it that stands on
  // the street (a roof's parapet or plant is on top of that), or null if
  // they're not up on one - on the street, or in the air.
  function under(city, p) {
    if (!city || !CityRef) return null;
    var list = CityRef.query(city, p.x - .4, p.z - .4, p.x + .4, p.z + .4), top = null;
    list.forEach(function (c) { if (near(c, p.x, p.z, .4) && c.y1 <= p.y + .3 && c.y1 >= p.y - .6 && (!top || c.y1 > top.y1)) top = c; });
    if (!top || top.y1 < K.HIGH) return null;
    return baseAt(list, p) || top;
  }
  function baseAt(list, p) {
    var base = null;
    list.forEach(function (c) {
      if (c.y0 > .5 || c.y1 < K.HIGH || !near(c, p.x, p.z, .4)) return;
      if (!base || (c.x1 - c.x0) * (c.z1 - c.z0) > (base.x1 - base.x0) * (base.z1 - base.z0)) base = c;
    });
    return base;
  }
  // The building a line is anchored to (the anchor is on one of its walls).
  function anchored(city, p) {
    if (!city || !CityRef || !p) return null;
    return baseAt(CityRef.query(city, p.x - .5, p.z - .5, p.x + .5, p.z + .5), { x: p.x, z: p.z });
  }
  // Where on a building's wall a charge from `from` meets it: the nearest
  // point of its footprint, and where his middle stops (RHINO_R out from it).
  function wallPoint(box, from) {
    var x = clamp(from.x, box.x0, box.x1), z = clamp(from.z, box.z0, box.z1), dx = from.x - x, dz = from.z - z, l = Math.hypot(dx, dz);
    if (l < 1e-6) return null;
    return { x: x, z: z, stop: { x: x + dx / l * K.RHINO_R, z: z + dz / l * K.RHINO_R }, d: l };
  }
  // What a Rhino standing at (x, z) on the street at height y runs into: a
  // box taller than a kerb in his way, the edge of the walkable city
  // ({ edge: true }), or null.
  function blocked(city, x, z, y) {
    if (!city || !CityRef) return null;
    var w = city.walk, r = K.RHINO_R, hit = null;
    if (w && (x < w.x0 + r || x > w.x1 - r || z < w.z0 + r || z > w.z1 - r)) return { edge: true };
    CityRef.query(city, x - r, z - r, x + r, z + r).forEach(function (c) {
      if (hit || c.y1 <= (y || 0) + 1 || c.y0 >= (y || 0) + 2) return;
      var cx = clamp(x, c.x0, c.x1), cz = clamp(z, c.z0, c.z1);
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r) hit = c;
    });
    return hit;
  }
  // A clear run along the street from a to b (level points at height y):
  // nothing in the way but, at the end, `box` itself.
  function clearRun(city, a, b, y, box) {
    var d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / .5));
    for (var i = 1; i <= n; i++) {
      var h = blocked(city, a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n, y);
      if (h && h !== box) return false;
    }
    return true;
  }
  // His body, running (for running you over): a capsule from his hips to
  // his shoulders, reaching ahead of him along `dir` (level, unit).
  function rhinoBody(at, dir) {
    return { a: { x: at.x - dir.x * .5, y: at.y + K.RAM_LOW, z: at.z - dir.z * .5 },
      b: { x: at.x + dir.x * K.RAM_FRONT, y: at.y + K.RAM_TOP, z: at.z + dir.z * K.RAM_FRONT }, r: K.RAM_R };
  }
  // Does a capsule { a, b, r } touch a body (a list of capsules)?
  function touches(cap, caps) {
    return (caps || []).some(function (c) { return segSeg(cap.a, cap.b, c.a, c.b) <= cap.r + c.r; });
  }
  // A ram's quake, for someone `d` metres (level) from where he hit.
  function quakeDamage(d, diff) {
    if (!(d <= K.QUAKE_R)) return 0;
    return damage(d <= K.QUAKE_INNER ? 1 : 1 - (d - K.QUAKE_INNER) / (K.QUAKE_R - K.QUAKE_INNER), diff);
  }

  // --- venom -------------------------------------------------------------------------
  // Is there room for someone at (x, y, z): nothing taller than a step
  // within r of it, up to head height?
  function room(city, x, y, z, r) {
    if (!city || !CityRef) return true;
    return !CityRef.query(city, x - r, z - r, x + r, z + r).some(function (c) {
      if (c.y1 <= y + .45 || c.y0 >= y + 2.2) return false;
      var cx = clamp(x, c.x0, c.x1), cz = clamp(z, c.z0, c.z1);
      return (x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r;
    });
  }
  function floorAt(city, x, z, below) { return EncRef ? EncRef.groundAt(city, x, z, below) : 0; }
  // Where a pounce from `from` lands next to you (standing at `you`):
  // POUNCE_GAP from you, on what you stand on (within a step or so of it),
  // with room, on his side of you first. Null if there's nowhere.
  function landing(city, you, from) {
    var a0 = Math.atan2(from.z - you.z, from.x - you.x);
    for (var k = 0; k < 8; k++) {
      var a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 4;
      var x = you.x + Math.cos(a) * K.POUNCE_GAP, z = you.z + Math.sin(a) * K.POUNCE_GAP, y = floorAt(city, x, z, you.y + .6);
      if (Math.abs(y - you.y) > 1.2 || !room(city, x, y, z, .45)) continue;
      return { x: x, y: y, z: z };
    }
    return null;
  }
  // The arc of a leap from a to b (feet), as fight.js flies it: clear of the
  // city? (His chest, along the chord and over the top of the arc.)
  function arcClear(city, a, b) {
    var d = Math.hypot(b.x - a.x, b.z - a.z), top = d * .25 + 1.5;
    var c0 = { x: a.x, y: a.y + 1.3, z: a.z }, c2 = { x: b.x, y: b.y + 1.3, z: b.z };
    var c1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 1.3 + top, z: (a.z + b.z) / 2 };
    return !trimHit(city, c0, c1) && !trimHit(city, c1, c2);
  }
  // A segment meeting the city, ignoring its first and last 0.6 m (the
  // beam he stands on, the roof he lands on).
  function trimHit(city, a, b) {
    var d = dist(a, b);
    if (d < 1.3) return false;
    var k = .6 / d, p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
    var q = { x: b.x - (b.x - a.x) * k, y: b.y - (b.y - a.y) * k, z: b.z - (b.z - a.z) * k };
    return !!hitCity(city, p, q);
  }
  // Which way (of the four along the city's grid) he can dash from a spot on
  // the ground, and how far: [{ x, z, len }], like a perch's beams.
  function sidesteps(city, p, len) {
    var out = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var x = p.x + d[0] * len, z = p.z + d[1] * len, y = floorAt(city, x, z, p.y + .5);
      if (Math.abs(y - p.y) < .3 && room(city, x, p.y, z, .45) && room(city, (p.x + x) / 2, p.y, (p.z + z) / 2, .45)) out.push({ x: d[0], z: d[1], len: len + .3 });
    });
    return out;
  }
  // A swipe: his claw, SWIPE_REACH ahead of his chest along `face`. Does it
  // reach your body?
  function claw(at, face) { return { x: at.x + Math.sin(face) * K.SWIPE_REACH, y: at.y + 1.2, z: at.z + Math.cos(face) * K.SWIPE_REACH }; }
  function swipeHits(at, face, caps) { return gap(claw(at, face), caps) <= K.SWIPE_R; }
  // The tentacle: out from `from` along `dir` at LASH_SPEED to `reach` (or
  // the city), then back. Moves it on by dt; returns 'body' when it first
  // meets you, else null. l: { from, dir, s, reach, out, hit }.
  function stepLash(l, dt, caps) {
    if (!(dt > 0)) return null;
    var s0 = l.s;
    if (l.out) { l.s = Math.min(l.reach, l.s + K.LASH_SPEED * dt); if (l.s >= l.reach) l.out = false; }
    else { l.s = Math.max(0, l.s - K.LASH_BACK * dt); return null; }
    if (l.hit || !caps) return null;
    var a = { x: l.from.x + l.dir.x * s0, y: l.from.y + l.dir.y * s0, z: l.from.z + l.dir.z * s0 };
    var b = { x: l.from.x + l.dir.x * l.s, y: l.from.y + l.dir.y * l.s, z: l.from.z + l.dir.z * l.s };
    for (var k = 0; k < caps.length; k++) if (segSeg(a, b, caps[k].a, caps[k].b) <= caps[k].r + K.LASH_R) { l.hit = true; return 'body'; }
    return null;
  }
  // How far a tentacle from `from` along `dir` can reach: LASH_REACH, or
  // less where the city is in the way. Its first 0.6 m don't count: on a
  // beam he stands at a node, inside its column.
  function lashReach(city, from, dir) {
    var s0 = .6, a = { x: from.x + dir.x * s0, y: from.y + dir.y * s0, z: from.z + dir.z * s0 };
    var end = { x: from.x + dir.x * K.LASH_REACH, y: from.y + dir.y * K.LASH_REACH, z: from.z + dir.z * K.LASH_REACH };
    var w = hitCity(city, a, end);
    return w ? s0 + (K.LASH_REACH - s0) * w.t : K.LASH_REACH;
  }

  var api = { create: create, step: step, finish: finish, cancel: cancel, winding: winding, windup: windup, quiet: quiet, busy: busy, pick: pick, MOVES: MOVES,
    activeFor: activeFor, airborne: airborne, damage: damage,
    onSeg: onSeg, segSeg: segSeg, gap: gap, centre: centre, standIn: standIn, hitCity: hitCity,
    throwBomb: throwBomb, bombAt: bombAt, stepBomb: stepBomb, blastDamage: blastDamage, push: push, aimBomb: aimBomb,
    lead: lead, track: track, burst: burst, stepRound: stepRound, onLine: onLine, passes: passes, gunDamage: gunDamage,
    under: under, anchored: anchored, wallPoint: wallPoint, blocked: blocked, clearRun: clearRun, rhinoBody: rhinoBody,
    touches: touches, quakeDamage: quakeDamage,
    room: room, landing: landing, arcClear: arcClear, sidesteps: sidesteps, claw: claw, swipeHits: swipeHits,
    stepLash: stepLash, lashReach: lashReach, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Attacks = api;
})(typeof window === 'undefined' ? globalThis : window);

(function (root) {
  'use strict';
  // The rules of a fight in the 3D city. The state IS a Combat state (health,
  // 20 damage a hit, the cooldown, the 30 second clock, the modes the cards
  // follow - intro, playing, paused, lost, won), with the 3D parts added:
  // where the villain is in the world and how it moves, where its weak spots
  // are, and for Venom the wave of thugs that comes first.
  //
  // The villain is a flat sprite that turns to face you, standing at `at`
  // (its feet). Its weak spots are the ones in villains.js, placed on the
  // sprite, as spheres. A shot is a ray; it hits a sphere if it passes within
  // the aim-assist cone of it (aim-assist.js).
  //
  // No Three.js: world-game.js draws what this says.

  var CombatRef = root.Combat || (typeof require === 'function' ? require('../combat.js') : null);
  var Aim = root.AimAssist || (typeof require === 'function' ? require('./aim-assist.js') : null);

  var K = {
    WEAK_R: .11,            // weak spot radius, as a fraction of the villain's height
    THUG_CHEST: 1.2, THUG_R: .5,   // a thug is one sphere, from his knees to his head
    THUG_PATROL: 1, THUG_SPEED: .6, // metres each way he paces, and how fast
    GLIDE_EASE: .35,        // the goblin changes radius and height at this share of his speed
    CHARGE_TURN: .6,        // seconds the rhino takes to turn round at the end of a charge
    LANE_EASE: .5,          // and how fast he swerves, as a share of his speed
    PERCH_MIN: .8, PERCH_MAX: 1.8,  // seconds venom crouches on a beam between leaps
    RUSH_REST: .15,         // ...and how briefly after being shot at
    ENTRY: 1.1, ENTRY_DROP: 14      // his drop in from above once the thugs are down
  };

  function num(v) { return Number.isFinite(v) ? Math.max(0, v) : 0; }
  function rand(s) { s.seed = (s.seed * 1103515245 + 12345) & 0x7fffffff; return s.seed / 0x7fffffff; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function copy(p) { return p ? { x: p.x, y: p.y, z: p.z } : null; }

  // --- starting ---------------------------------------------------------------
  // enc is one of Encounters.build(city).fights.
  function start(enc, levels) {
    var s = CombatRef.start(enc.level, levels), p = enc.path;
    s.encounter = enc.index; s.kind = enc.kind; s.villain = enc.villain; s.path = p;
    s.time = 0; s.thugHits = 0;
    s.thugs = (enc.thugs || []).map(function (t) {
      return { bx: t.x, bz: t.z, x: t.x, y: t.y, z: t.z, hp: t.hp, maxHp: t.hp, phase: t.phase || 0, down: false, downAt: 0, hitAt: -1 };
    });
    s.phase = s.thugs.length ? 'thugs' : 'villain';
    s.at = null;
    if (s.kind === 'glider') {
      s.m = { ang: p.start || 0, dir: 1, r: (p.r0 + p.r1) / 2, h: (p.h0 + p.h1) / 2, rWant: 0, hWant: 0 };
      wantGlide(s);
    } else if (s.kind === 'charge') {
      s.m = { u: .5, dir: 1, lane: 0, laneWant: 0, rest: 0 };
      s.m.laneWant = rand(s) * 2 - 1;
    } else s.m = { from: null, to: 0, t: 0, dur: 0, rest: 0, rush: false, flying: false };
    if (s.phase === 'villain') arrive(s);
    place(s);
    return s;
  }
  function play(s) { return CombatRef.play(s); }
  function pause(s) { return CombatRef.pause(s); }

  // --- how each villain moves ---------------------------------------------------
  function speed(s) { return (s.dodgeRemaining > 0 ? s.dodgeSpeed : s.moveSpeed) * (s.path.scale || 1); }

  function wantGlide(s) {
    var p = s.path, m = s.m;
    // Somewhere noticeably different: the other half of the range.
    m.rWant = m.r < (p.r0 + p.r1) / 2 ? lerp((p.r0 + p.r1) / 2, p.r1, rand(s)) : lerp(p.r0, (p.r0 + p.r1) / 2, rand(s));
    m.hWant = m.h < (p.h0 + p.h1) / 2 ? lerp((p.h0 + p.h1) / 2, p.h1, rand(s)) : lerp(p.h0, (p.h0 + p.h1) / 2, rand(s));
  }
  function toward(v, want, step) { return Math.abs(want - v) <= step ? want : v + (want > v ? step : -step); }

  function moveGlider(s, dt) {
    var m = s.m, v = speed(s);
    m.ang += m.dir * v / Math.max(1, m.r) * dt;
    m.ang = Math.atan2(Math.sin(m.ang), Math.cos(m.ang));
    m.r = toward(m.r, m.rWant, v * K.GLIDE_EASE * dt);
    m.h = toward(m.h, m.hWant, v * K.GLIDE_EASE * .7 * dt);
    if (m.r === m.rWant && m.h === m.hWant) wantGlide(s);
  }
  function moveCharge(s, dt) {
    var m = s.m, p = s.path, v = speed(s), len = Math.max(1, p.z1 - p.z0);
    m.lane = toward(m.lane, m.laneWant, v * K.LANE_EASE / Math.max(1, p.lane) * dt);
    if (m.rest > 0) { m.rest = Math.max(0, m.rest - dt); return; }
    m.u += m.dir * v * dt / len;
    if (m.u >= 1 || m.u <= 0) {                   // the end of the run: turn round
      m.u = m.u >= 1 ? 1 : 0; m.dir = -m.dir; m.rest = K.CHARGE_TURN;
      m.laneWant = rand(s) * 2 - 1;
    }
  }
  function hop(s, from) {
    var P = s.path.perches, p = P[from], ok = [], i;
    for (i = 0; i < P.length; i++) {
      if (i === from) continue;
      var d = Math.hypot(P[i].x - p.x, P[i].y - p.y, P[i].z - p.z);
      if (d >= s.path.hopMin && d <= s.path.hopMax) ok.push(i);
    }
    if (!ok.length) for (i = 0; i < P.length; i++) if (i !== from) ok.push(i);
    return ok.length ? ok[Math.floor(rand(s) * ok.length) % ok.length] : from;
  }
  function leap(s, fromPoint, to, dur) {
    var m = s.m;
    m.from = copy(fromPoint); m.to = to; m.t = 0; m.flying = true;
    var q = s.path.perches[to], d = Math.hypot(q.x - m.from.x, q.y - m.from.y, q.z - m.from.z);
    m.dur = dur || Math.max(.5, d / Math.max(.1, speed(s)));
  }
  function moveLeap(s, dt) {
    var m = s.m, P = s.path.perches;
    if (!P.length) return;
    if (m.flying) {
      m.t += dt;
      if (m.t >= m.dur) {                          // landed
        m.flying = false; m.at = m.to;
        m.rest = m.rush ? K.RUSH_REST : lerp(K.PERCH_MIN, K.PERCH_MAX, rand(s));
        m.rush = false;
      }
      return;
    }
    m.rest -= dt;
    if (m.rest <= 0) leap(s, P[m.at], hop(s, m.at));
  }

  // Venom's entrance, once the thugs are down: he drops in from above a beam.
  function arrive(s) {
    s.phase = 'villain';
    if (s.kind !== 'leap' || !s.path.perches.length) return;
    var P = s.path.perches, first = Math.floor(rand(s) * P.length) % P.length, q = P[first];
    s.m.at = first;
    leap(s, { x: q.x, y: q.y + K.ENTRY_DROP, z: q.z }, first, K.ENTRY);
  }

  // Where the villain's feet are now.
  function place(s) {
    var m = s.m, p = s.path;
    if (s.phase !== 'villain') { s.at = null; return; }
    if (s.kind === 'glider') s.at = { x: p.cx + Math.cos(m.ang) * m.r, y: p.y + m.h, z: p.cz + Math.sin(m.ang) * m.r };
    else if (s.kind === 'charge') s.at = { x: p.x + m.lane * p.lane, y: p.y, z: lerp(p.z0, p.z1, m.u) };
    else if (m.flying) {
      var q = p.perches[m.to], u = Math.min(1, m.t / m.dur), d = Math.hypot(q.x - m.from.x, q.z - m.from.z);
      var arc = (d * .25 + 1.5) * 4 * u * (1 - u);
      s.at = { x: lerp(m.from.x, q.x, u), y: lerp(m.from.y, q.y, u) + arc, z: lerp(m.from.z, q.z, u) };
    } else s.at = copy(p.perches[m.at]);
  }

  // Shot at, hit or not: it breaks for somewhere else, as in the 2D game.
  function dodge(s) {
    var m = s.m;
    if (s.kind === 'glider') { if (rand(s) < .5) m.dir = -m.dir; wantGlide(s); }
    else if (s.kind === 'charge') {
      m.rest = 0;
      m.laneWant = (m.lane > 0 ? -1 : 1) * (.5 + .5 * rand(s));
    } else if (m.flying) m.rush = true;
    else m.rest = 0;
  }

  function moveThugs(s) {
    s.thugs.forEach(function (t) {
      if (t.down) return;
      t.z = t.bz + Math.sin(s.time * K.THUG_SPEED / K.THUG_PATROL + t.phase) * K.THUG_PATROL;
    });
  }
  function standing(s) { return s.thugs.filter(function (t) { return !t.down; }).length; }

  // --- the clock ----------------------------------------------------------------
  // Nothing moves and no time passes unless the fight is being played: the
  // INTRO card, PAUSED, and the end cards all hold it exactly as it is. The
  // 30 seconds only start once the villain is there - the thug wave is untimed.
  function tick(s, dt) {
    if (s.mode !== 'playing') return s;
    dt = num(dt);
    s.time += dt;
    moveThugs(s);
    if (s.phase === 'thugs') {
      s.cooldownRemaining = Math.max(0, s.cooldownRemaining - dt);
      return s;
    }
    CombatRef.clock(s, dt);
    if (s.mode !== 'playing') return s;
    s.dodgeRemaining = Math.max(0, s.dodgeRemaining - dt);
    if (s.kind === 'glider') moveGlider(s, dt);
    else if (s.kind === 'charge') moveCharge(s, dt);
    else moveLeap(s, dt);
    place(s);
    return s;
  }

  // --- where things are, for drawing and for shots ---------------------------------
  // The sprite, standing at `at` and turned about the vertical to face `eye`.
  function billboard(s, villains, eye, at) {
    at = at || s.at;
    if (!at) return null;
    var v = villains[s.villain], h = v.height, w = h * v.aspect;
    var dx = eye.x - at.x, dz = eye.z - at.z, d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
    return { at: copy(at), w: w, h: h, normal: { x: nx, y: 0, z: nz }, right: { x: nz, y: 0, z: -nx },
      centre: { x: at.x, y: at.y + h / 2, z: at.z } };
  }
  // A point on the sprite, u and v from its top left as in villains.js.
  function onSprite(bb, u, v) {
    var ox = (u - .5) * bb.w, oy = (1 - v) * bb.h;
    return { x: bb.at.x + bb.right.x * ox, y: bb.at.y + oy, z: bb.at.z + bb.right.z * ox };
  }
  // Every weak spot, with the one to hit now marked current.
  function weakSpots(s, villains, eye, at) {
    var bb = billboard(s, villains, eye, at);
    if (!bb) return [];
    var list = villains[s.villain].targets, cur = s.targetIndex % list.length;
    return list.map(function (t, i) {
      var p = onSprite(bb, t.x, t.y);
      return { name: t.name, x: p.x, y: p.y, z: p.z, r: K.WEAK_R * bb.h, current: i === cur };
    });
  }
  // Where a ray meets the sprite's rectangle (not its outline), or null.
  function bodyHit(bb, origin, dir) {
    if (!bb) return null;
    var n = bb.normal, den = dir.x * n.x + dir.z * n.z;
    if (Math.abs(den) < 1e-6) return null;
    var t = ((bb.at.x - origin.x) * n.x + (bb.at.z - origin.z) * n.z) / den;
    if (t <= 0) return null;
    var p = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
    var side = (p.x - bb.at.x) * bb.right.x + (p.z - bb.at.z) * bb.right.z, up = p.y - bb.at.y;
    if (Math.abs(side) > bb.w / 2 || up < 0 || up > bb.h) return null;
    p.distance = t; p.u = side / bb.w + .5; p.v = 1 - up / bb.h;
    return p;
  }
  function thugSphere(t) { return { x: t.x, y: t.y + K.THUG_CHEST, z: t.z, r: K.THUG_R }; }

  // What was on screen at a moment, so a shot can be judged against what the
  // player saw when they aimed rather than where things have moved on to since
  // (world-game.js keeps one of these with each frame's camera).
  function snapshot(s) {
    return { villain: copy(s.at), thugs: s.thugs.map(function (t) { return { x: t.x, y: t.y, z: t.z }; }) };
  }

  // --- a shot ---------------------------------------------------------------------
  // shot: { origin, dir (unit), blocked: how far the city is along the ray }
  // seen: a snapshot from when the player aimed, or nothing to use the present.
  // Returns { accepted, hit, kind: 'thug' | 'villain', ... }.
  function fire(s, villains, shot, seen) {
    if (s.mode !== 'playing' || s.cooldownRemaining > 0) return { accepted: false };
    var opts = { blocked: shot.blocked };
    if (s.phase === 'thugs') {
      s.cooldownRemaining = CombatRef.COOLDOWN; s.shots++;
      var idx = [], spheres = [];
      s.thugs.forEach(function (t, i) {
        if (t.down) return;
        var was = seen && seen.thugs && seen.thugs[i];
        idx.push(i); spheres.push(thugSphere(was || t));
      });
      var p = Aim.pick(shot.origin, shot.dir, spheres, opts);
      if (!p) return { accepted: true, hit: false, kind: 'thug' };
      var t = s.thugs[idx[p.index]];
      t.hp--; t.hitAt = s.time; s.thugHits++;
      if (t.hp <= 0) { t.hp = 0; t.down = true; t.downAt = s.time; }
      var down = t.down;
      if (!standing(s)) { arrive(s); place(s); }
      return { accepted: true, hit: true, kind: 'thug', thug: idx[p.index], down: down,
        point: Aim.closest(shot.origin, shot.dir, p.target) };
    }
    var at = (seen && seen.villain) || s.at;
    var spot = weakSpots(s, villains, shot.origin, at).filter(function (w) { return w.current; })[0];
    var hit = spot ? Aim.pick(shot.origin, shot.dir, [spot], opts) : null;
    var r = CombatRef.judge(s, !!hit);
    if (!r.accepted) return r;
    if (s.mode === 'playing') dodge(s);
    r.kind = 'villain'; r.spot = spot;
    if (hit) r.point = Aim.closest(shot.origin, shot.dir, spot);
    return r;
  }

  var api = { start: start, play: play, pause: pause, tick: tick, fire: fire, snapshot: snapshot,
    billboard: billboard, weakSpots: weakSpots, bodyHit: bodyHit, thugSphere: thugSphere, standing: standing,
    constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Fight = api;
})(typeof window === 'undefined' ? globalThis : window);

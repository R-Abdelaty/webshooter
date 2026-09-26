(function (root) {
  'use strict';
  // The rules of a fight in the 3D city. The state IS a Combat state (health,
  // 20 damage a hit, the cooldown, the 30 second clock, the modes the cards
  // follow - intro, playing, paused, lost, won), with the 3D parts added:
  // where the villain is in the world, which way it faces and how it moves,
  // what of him a shot can hit, and the wave of thugs that can come first.
  //
  // A fight goes: (thugs) -> arrive -> villain. There is a thug wave only if
  // the encounter has thugs: Venom's, when Encounters.constants.THUGS.ENABLED
  // is on (it is off for now, so every fight starts at `arrive`). The arrival is the
  // villain's entrance - the Goblin's taunt, the Rhino dropping onto the
  // avenue and flexing, Venom dropping onto a beam and roaring - and, like
  // the thug wave, it is untimed and he can't be hurt in it. The 30 seconds
  // start when it ends.
  //
  // There are no targets on him: a shot that hits him anywhere does the 20
  // damage. The villain is an animated model (world/villain-view.js draws
  // it); each frame the render side samples its bones into plain data - body
  // capsules that follow the limbs - and puts it in `s.body`. Shots are
  // judged against that, or against the one in a snapshot from when the
  // player aimed. Without a model (the logged fallback) he is a flat sprite
  // that turns to face you, and a shot hits its rectangle. Either way a shot
  // is a ray, and it counts if it passes within the aim-assist cone
  // (aim-assist.js) of him, since a wrist is less steady than a mouse.
  //
  // No Three.js: world-game.js and villain-view.js draw what this says.
  // x east, z south, y up; `face` is the yaw the villain faces, with 0 facing
  // +z and positive turning to its left (towards +x), as a model's root turns.

  function need(name, file) { return root[name] || (typeof require === 'function' ? require(file) : null); }
  var CombatRef = need('Combat', '../combat.js');
  var Aim = need('AimAssist', './aim-assist.js');
  var RigRef = need('Rig', './rig.js');

  var K = {
    THUG_CHEST: 1.2, THUG_R: .5,   // a thug is one sphere, from his knees to his head
    THUG_PATROL: 1, THUG_SPEED: .6, // metres each way he paces, and how fast
    CENTRE: 1.2,            // metres above a villain's feet that count as his middle
    CONE_STEPS: 4,          // a shot that misses him is retried with the aim-assist cone opened in this many steps
    // How long each entrance lasts: the length of the clips it plays (the
    // goblin's roar; the rhino's drop-in and flex; venom's drop, landing and roar).
    ARRIVE: { glider: 1.7, charge: 3.3, leap: 3.4 },
    // How fast each turns to face where it is going, in radians a second.
    TURN: { glider: 3, charge: 4, leap: 9 },
    GLIDE_EASE: .35,        // the goblin changes radius and height at this share of his speed
    // The rhino: the charge wind-up before his first run, turning round at
    // each end of the avenue (his turn clip), and how hard he speeds up and
    // brakes into the skid at the end (m/s/s).
    WINDUP: 1.36, CHARGE_TURN: .9, ACCEL: 12, DECEL: 11, MIN_V: 1.2,
    LANE_EASE: .5,          // and how fast he swerves, as a share of his speed
    // Venom: seconds he crouches on a beam between leaps, and how briefly
    // after being shot at; the crouch before take-off (leap_start's, slowed);
    // how far and how fast he dashes along a beam to dodge.
    // From LAND_TURN of the way through a leap he turns to face the beam after.
    PERCH_MIN: .8, PERCH_MAX: 1.8, RUSH_REST: .15, CROUCH: .23, DASH: 1.8, DASH_T: .6, LAND_TURN: .55,
    ENTRY: 1.1, ENTRY_DROP: 14      // his drop onto a beam, from this high, once the thugs are down
  };

  function num(v) { return Number.isFinite(v) ? Math.max(0, v) : 0; }
  function rand(s) { s.seed = (s.seed * 1103515245 + 12345) & 0x7fffffff; return s.seed / 0x7fffffff; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function copy(p) { return p ? { x: p.x, y: p.y, z: p.z } : null; }
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function yawTo(from, to) { return Math.atan2(to.x - from.x, to.z - from.z); }
  function left(face) { return { x: Math.cos(face), z: -Math.sin(face) }; }

  // --- starting ---------------------------------------------------------------
  // enc is one of Encounters.build(city).fights.
  function start(enc, levels) {
    var s = CombatRef.start(enc.level, levels), p = enc.path, v = enc.vantage;
    s.encounter = enc.index; s.kind = enc.kind; s.villain = enc.villain; s.path = p;
    s.time = 0; s.thugHits = 0; s.arriveT = 0;
    s.eye = { x: v.x, y: v.y + 1.7, z: v.z };
    s.thugs = (enc.thugs || []).map(function (t) {
      return { bx: t.x, bz: t.z, x: t.x, y: t.y, z: t.z, hp: t.hp, maxHp: t.hp, phase: t.phase || 0, down: false, downAt: 0, hitAt: -1 };
    });
    s.phase = s.thugs.length ? 'thugs' : 'arrive';
    s.at = null; s.face = 0; s.turnRate = 0; s.vel = { x: 0, y: 0, z: 0 };
    s.body = null;                      // the model's bones, sampled by the render side
    s.dodge = { n: 0, side: null };     // the last dodge, for the render side's clips
    if (s.kind === 'glider') {
      s.m = { ang: p.start || 0, dir: 1, r: (p.r0 + p.r1) / 2, h: (p.h0 + p.h1) / 2, rWant: 0, hWant: 0 };
      wantGlide(s);
    } else if (s.kind === 'charge') {
      s.m = { u: .5, dir: 1, lane: 0, laneWant: 0, rest: 0, v: 0, state: 'turn', next: 'windup', turn: 1 };
      s.m.laneWant = rand(s) * 2 - 1;
    } else s.m = { at: 0, next: 0, from: null, to: 0, t: 0, dur: 0, rest: 0, rush: false, flying: false, crouch: 0, dash: null, off: { x: 0, z: 0 } };
    if (s.phase === 'arrive') arrive(s);
    place(s);
    s.face = faceWanted(s, s.face);
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

  // The rhino: turn to face down the avenue -> (the first time) wind up ->
  // run, speeding up -> brake into a skid so he stops at the end -> turn
  // round -> run back. `state` says which, for the clips.
  function moveCharge(s, dt) {
    var m = s.m, p = s.path, vmax = speed(s), len = Math.max(1, p.z1 - p.z0);
    if (m.state === 'turn' || m.state === 'windup') {
      m.rest -= dt;
      if (m.rest > 0) return;
      if (m.state === 'turn' && m.next === 'windup') { m.state = 'windup'; m.next = 'run'; m.rest += K.WINDUP; return; }
      m.state = 'run'; m.v = 0; m.rest = 0;
    }
    // He swerves across the lanes only while he is moving.
    m.lane = toward(m.lane, m.laneWant, Math.max(m.v, 2) * K.LANE_EASE / Math.max(1, p.lane) * dt);
    var rem = (m.dir > 0 ? 1 - m.u : m.u) * len;
    // The fastest he can go and still stop at the end.
    var want = Math.min(vmax, Math.max(K.MIN_V, Math.sqrt(2 * K.DECEL * rem)));
    if (want < m.v - 1e-9) { m.v = Math.max(want, m.v - K.DECEL * dt); if (m.state === 'run' && vmax - want > .5) m.state = 'skid'; }
    else m.v = Math.min(want, m.v + K.ACCEL * dt);
    if (rem <= m.v * dt + 1e-6) {                  // the end of the run: turn round
      m.u = m.dir > 0 ? 1 : 0; m.dir = -m.dir; m.v = 0;
      m.state = 'turn'; m.next = 'run'; m.rest = K.CHARGE_TURN;
      m.laneWant = rand(s) * 2 - 1;
      m.turn = turnSide(s, runYaw(s));
      return;
    }
    m.u += m.dir * m.v * dt / len;
  }
  function runYaw(s) { return s.m.dir > 0 ? 0 : Math.PI; }
  // Which way to turn to face `want`: the short way, or - turning right round
  // - the way that sweeps past you, so you see him turn rather than his back.
  function turnSide(s, want) {
    var d = wrap(want - s.face);
    if (Math.abs(d) < Math.PI - .35) return d >= 0 ? 1 : -1;
    var toEye = yawTo(s.at || s.eye, s.eye);
    return wrap(toEye - s.face) >= 0 ? 1 : -1;
  }

  // Venom: perch -> crouch -> leap (an arc to the next beam) -> land facing the
  // beam after that -> perch ...
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
    m.from = copy(fromPoint); m.to = to; m.t = 0; m.flying = true; m.crouch = 0;
    m.after = hop(s, to);                          // where he goes next, to land facing it
    var q = s.path.perches[to], d = Math.hypot(q.x - m.from.x, q.y - m.from.y, q.z - m.from.z);
    m.dur = dur || Math.max(.5, d / Math.max(.1, speed(s)));
  }
  function land(s) {
    var m = s.m;
    m.flying = false; m.at = m.to; m.off = { x: 0, z: 0 };
    m.next = m.after;
    m.rest = m.rush ? K.RUSH_REST : lerp(K.PERCH_MIN, K.PERCH_MAX, rand(s));
    m.rush = false;
  }
  function moveLeap(s, dt) {
    var m = s.m, P = s.path.perches;
    if (!P.length) return;
    if (m.flying) { m.t += dt; if (m.t >= m.dur) land(s); return; }
    if (m.dash) {
      m.dash.t += dt;
      if (m.dash.t >= m.dash.dur) { m.off = { x: m.dash.x, z: m.dash.z }; m.dash = null; m.rest = K.RUSH_REST; }
      return;
    }
    if (m.crouch > 0) { m.crouch -= dt; if (m.crouch <= 0) leap(s, s.at, m.next); return; }
    m.rest -= dt;
    if (m.rest <= 0) m.crouch = K.CROUCH;
  }

  // The entrance, at the start (or once the thugs are down).
  function arrive(s) {
    s.phase = 'arrive'; s.arriveT = 0;
    if (s.kind !== 'leap' || !s.path.perches.length) return;
    // Venom drops onto a beam from high above it.
    var P = s.path.perches, first = Math.floor(rand(s) * P.length) % P.length;
    s.m.at = first; s.m.to = first; s.m.flying = false;
  }
  // The entrance is over: the fight proper, and its clock, start.
  function begin(s) {
    s.phase = 'villain';
    if (s.kind === 'charge') { s.m.state = 'turn'; s.m.next = 'windup'; s.m.rest = K.CHARGE_TURN; s.m.turn = turnSide(s, runYaw(s)); }
    else if (s.kind === 'leap') { s.m.next = hop(s, s.m.at); s.m.rest = K.RUSH_REST; }
  }

  // Where the villain's feet are now.
  function place(s) {
    var m = s.m, p = s.path;
    if (s.phase === 'thugs') { s.at = null; return; }
    if (s.kind === 'glider') s.at = { x: p.cx + Math.cos(m.ang) * m.r, y: p.y + m.h, z: p.cz + Math.sin(m.ang) * m.r };
    else if (s.kind === 'charge') s.at = { x: p.x + m.lane * p.lane, y: p.y, z: lerp(p.z0, p.z1, m.u) };
    else if (!p.perches.length) s.at = null;
    else if (s.phase === 'arrive') {
      var q0 = p.perches[m.at], k = Math.min(1, s.arriveT / K.ENTRY);
      s.at = { x: q0.x, y: q0.y + K.ENTRY_DROP * (1 - k * k), z: q0.z };
    } else if (m.flying) {
      var q = p.perches[m.to], u = Math.min(1, m.t / m.dur), d = Math.hypot(q.x - m.from.x, q.z - m.from.z);
      var arc = (d * .25 + 1.5) * 4 * u * (1 - u);
      s.at = { x: lerp(m.from.x, q.x, u), y: lerp(m.from.y, q.y, u) + arc, z: lerp(m.from.z, q.z, u) };
    } else {
      var b = p.perches[m.at], off = m.off;
      if (m.dash) { var e = Math.min(1, m.dash.t / m.dash.dur), ee = e * e * (3 - 2 * e); off = { x: lerp(m.dash.fx, m.dash.x, ee), z: lerp(m.dash.fz, m.dash.z, ee) }; }
      s.at = { x: b.x + off.x, y: b.y, z: b.z + off.z };
    }
  }

  // --- which way it faces -------------------------------------------------------
  // Where it wants to face: you during its entrance; otherwise where it is
  // going - down the avenue, round the circuit, to the next beam.
  function faceWanted(s, cur) {
    var m = s.m, at = s.at;
    if (!at) return cur;
    if (s.phase === 'arrive') return yawTo(at, s.eye);
    if (s.kind === 'charge') {
      if (m.state === 'turn' || m.state === 'windup') return runYaw(s);
      if (Math.hypot(s.vel.x, s.vel.z) > .3) return Math.atan2(s.vel.x, s.vel.z);
      return runYaw(s);
    }
    if (s.kind === 'glider') return Math.hypot(s.vel.x, s.vel.z) > .3 ? Math.atan2(s.vel.x, s.vel.z) : cur;
    // Venom: at the beam he is leaping to, and over the last part of the leap
    // round to the one after it, so that he lands facing it.
    var P = s.path.perches, q = P[m.flying ? m.to : m.next];
    if (m.flying && m.t / m.dur > K.LAND_TURN && P[m.after]) { at = P[m.to]; q = P[m.after]; }
    if (!q || Math.hypot(q.x - at.x, q.z - at.z) < .5) return cur;
    return yawTo(at, q);
  }
  function turnFace(s, dt) {
    var want = faceWanted(s, s.face), d = wrap(want - s.face), rate = K.TURN[s.kind] || 4, step;
    if (s.kind === 'charge' && s.m.state === 'turn') {
      // Turning round at the end of the avenue: the side chosen, all the way
      // round within his turn clip.
      rate = Math.max(rate, Math.PI / K.CHARGE_TURN * 1.15);
      if (Math.abs(d) > Math.PI - .35 && s.m.turn * d < 0) d += s.m.turn * 2 * Math.PI;
    }
    step = Math.min(Math.abs(d), rate * dt) * (d < 0 ? -1 : 1);
    s.face = wrap(s.face + step);
    s.turnRate = dt > 0 ? step / dt : 0;
  }

  // Shot at, hit or not: it breaks for somewhere else, as in the 2D game.
  // `away` is the way (level) from the shot's line to the villain: the side it
  // ducks towards. s.dodge says which of its sides that was, for the clips -
  // null when the dodge doesn't show (Venom already in the air).
  function dodge(s, away) {
    var m = s.m, L = left(s.face), side = away && (away.x * L.x + away.z * L.z) >= 0 ? 'l' : 'r';
    if (s.kind === 'glider') { if (rand(s) < .5) m.dir = -m.dir; wantGlide(s); }
    else if (s.kind === 'charge') {
      m.rest = 0; m.next = 'run';                  // no wind-up: he just goes
      m.laneWant = (m.lane > 0 ? -1 : 1) * (.5 + .5 * rand(s));
      var sx = m.laneWant > m.lane ? 1 : -1;
      side = sx * L.x >= 0 ? 'l' : 'r';
    } else if (m.flying) { m.rush = true; side = null; }
    else if (m.crouch > 0 || m.dash) side = null;
    else {
      var d = dashDir(s, away, L);
      if (d) {
        m.dash = { fx: m.off.x, fz: m.off.z, x: m.off.x + d.x * K.DASH, z: m.off.z + d.z * K.DASH, t: 0, dur: K.DASH_T };
        side = d.x * L.x + d.z * L.z >= 0 ? 'l' : 'r';
      } else { m.rest = 0; side = null; }
    }
    s.dodge = { n: s.dodge.n + 1, side: side };
  }
  // A beam off Venom's perch to dash along: across his view rather than
  // along it, towards `away` if there is one that way. Only from the node.
  function dashDir(s, away, L) {
    var m = s.m, beams = (s.path.perches[m.at] || {}).beams || [], best = null, score = -Infinity;
    if (m.off.x || m.off.z) return null;
    beams.forEach(function (b) {
      var across = Math.abs(b.x * L.x + b.z * L.z);
      if (across < .5 || b.len < K.DASH + .3) return;
      var sc = across + (away ? 2 * (b.x * away.x + b.z * away.z) : 0);
      if (sc > score) { score = sc; best = b; }
    });
    return best;
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
  // 30 seconds only start once the villain has made his entrance - the thug
  // wave and the entrance are untimed.
  function tick(s, dt) {
    if (s.mode !== 'playing') return s;
    dt = num(dt);
    s.time += dt;
    moveThugs(s);
    if (s.phase === 'thugs') {
      s.cooldownRemaining = Math.max(0, s.cooldownRemaining - dt);
      return s;
    }
    var old = s.at;
    if (s.phase === 'arrive') {
      s.cooldownRemaining = Math.max(0, s.cooldownRemaining - dt);
      s.arriveT += dt;
      if (s.arriveT >= (K.ARRIVE[s.kind] || 0)) begin(s);
    } else {
      CombatRef.clock(s, dt);
      if (s.mode !== 'playing') return s;
      s.dodgeRemaining = Math.max(0, s.dodgeRemaining - dt);
      if (s.kind === 'glider') moveGlider(s, dt);
      else if (s.kind === 'charge') moveCharge(s, dt);
      else moveLeap(s, dt);
    }
    place(s);
    if (old && s.at && dt > 0) s.vel = { x: (s.at.x - old.x) / dt, y: (s.at.y - old.y) / dt, z: (s.at.z - old.z) / dt };
    turnFace(s, dt);
    return s;
  }

  // --- where things are, for drawing and for shots ---------------------------------
  // The fallback sprite, standing at `at` and turned to face `eye` square on:
  // about the vertical, and tipped back about its feet by how far above it
  // you are (from a roof, a sprite left upright is squashed flat). normal
  // points at you, right and up run along the sprite.
  function billboard(s, villains, eye, at) {
    at = at || s.at;
    if (!at) return null;
    var v = villains[s.villain], h = v.height, w = h * v.aspect;
    var dx = eye.x - at.x, dz = eye.z - at.z, d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
    var el = Math.atan2(eye.y - (at.y + h / 2), d), c = Math.cos(el), sn = Math.sin(el);
    var up = { x: -nx * sn, y: c, z: -nz * sn };
    return { at: copy(at), w: w, h: h, tilt: el, normal: { x: nx * c, y: sn, z: nz * c }, right: { x: nz, y: 0, z: -nx }, up: up,
      centre: { x: at.x + up.x * h / 2, y: at.y + up.y * h / 2, z: at.z + up.z * h / 2 } };
  }
  // A point on the sprite, u and v from its top left as in villains.js.
  function onSprite(bb, u, v) {
    var ox = (u - .5) * bb.w, oy = (1 - v) * bb.h;
    return { x: bb.at.x + bb.right.x * ox + bb.up.x * oy, y: bb.at.y + oy * bb.up.y, z: bb.at.z + bb.right.z * ox + bb.up.z * oy };
  }
  // Where a ray meets the sprite's rectangle (not its outline), or null.
  function bodyHit(bb, origin, dir) {
    if (!bb) return null;
    var n = bb.normal, den = dir.x * n.x + dir.y * n.y + dir.z * n.z;
    if (Math.abs(den) < 1e-6) return null;
    var t = ((bb.at.x - origin.x) * n.x + (bb.at.y - origin.y) * n.y + (bb.at.z - origin.z) * n.z) / den;
    if (t <= 0) return null;
    var p = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
    var rx = p.x - bb.at.x, ry = p.y - bb.at.y, rz = p.z - bb.at.z;
    var side = rx * bb.right.x + rz * bb.right.z, up = rx * bb.up.x + ry * bb.up.y + rz * bb.up.z;
    if (Math.abs(side) > bb.w / 2 || up < 0 || up > bb.h) return null;
    p.distance = t; p.u = side / bb.w + .5; p.v = 1 - up / bb.h;
    return p;
  }
  // Where a shot meets the villain, if it does: { capsule, t (along it),
  // point, distance } on the model's body capsules, or { u, v, point,
  // distance } on the sprite. Each is widened by the aim-assist cone at its
  // distance, so a shot just past his edge still counts. Null if it misses
  // him or the city is in the way.
  function onBody(s, villains, shot, seen) {
    var at = seen ? seen.villain : s.at, body = seen ? seen.body : s.body, h = null;
    var o = shot.origin, cone = Math.tan(Aim.TOLERANCE_DEG * Math.PI / 180);
    if (!at || s.phase === 'thugs') return null;
    if (body && body.capsules && body.capsules.length) {
      // Straight through him first; failing that, the cone opened in steps,
      // so the part of him nearest the line of the shot is the one it hits.
      var dist = body.capsules.map(function (c) {
        return Math.hypot((c.a.x + c.b.x) / 2 - o.x, (c.a.y + c.b.y) / 2 - o.y, (c.a.z + c.b.z) / 2 - o.z);
      }), b = null;
      for (var k = 0; k <= K.CONE_STEPS && !b; k++) {
        b = RigRef.rayBody(o, shot.dir, body.capsules.map(function (c, i) { return { a: c.a, b: c.b, r: c.r + dist[i] * cone * k / K.CONE_STEPS }; }));
      }
      if (b) h = { capsule: b.index, t: b.t, point: b.point, distance: b.distance };
    } else {
      var bb = billboard(s, villains, o, at);
      if (bb) {
        var m = Math.hypot(bb.centre.x - o.x, bb.centre.y - o.y, bb.centre.z - o.z) * cone * 2;
        var big = Object.assign({}, bb, { w: bb.w + m, h: bb.h + m, at: { x: bb.at.x - bb.up.x * m / 2, y: bb.at.y - bb.up.y * m / 2, z: bb.at.z - bb.up.z * m / 2 } });
        var p = bodyHit(big, o, shot.dir);
        if (p) {
          var u = Math.max(0, Math.min(1, (p.u - .5) * big.w / bb.w + .5)), v = Math.max(0, Math.min(1, 1 - ((1 - p.v) * big.h - m / 2) / bb.h));
          h = { u: u, v: v, point: { x: p.x, y: p.y, z: p.z }, distance: p.distance };
        }
      }
    }
    return h && h.distance < (Number.isFinite(shot.blocked) ? shot.blocked : Infinity) ? h : null;
  }
  // The floor under the villain, for a contact shadow: the avenue under the
  // rhino, the beam under venom (between two in mid-leap, where it fades out
  // with the height anyway). Null when he has none - the goblin flies.
  function ground(s) {
    if (!s.at || s.phase === 'thugs' || s.kind === 'glider') return null;
    if (s.kind === 'charge') return s.path.y;
    var m = s.m, P = s.path.perches;
    if (s.phase !== 'arrive' && m.flying && m.from && P[m.to]) return lerp(m.from.y, P[m.to].y, Math.min(1, m.t / m.dur));
    return P[m.at] ? P[m.at].y : s.at.y;
  }
  function thugSphere(t) { return { x: t.x, y: t.y + K.THUG_CHEST, z: t.z, r: K.THUG_R }; }

  // What was on screen at a moment, so a shot can be judged against what the
  // player saw when they aimed rather than where things have moved on to since
  // (world-game.js keeps one of these with each frame's camera). The body is
  // a fresh sample each frame, so keeping it by reference is safe.
  function snapshot(s) {
    return { villain: copy(s.at), body: s.body || null, thugs: s.thugs.map(function (t) { return { x: t.x, y: t.y, z: t.z }; }) };
  }

  // The level way from a shot's line to the villain's middle.
  function awayFrom(s, shot, at) {
    var c = { x: at.x, y: at.y + K.CENTRE, z: at.z }, q = Aim.closest(shot.origin, shot.dir, c);
    var x = c.x - q.x, z = c.z - q.z, l = Math.hypot(x, z);
    if (l > 1e-3) return { x: x / l, z: z / l };
    l = Math.hypot(shot.dir.x, shot.dir.z) || 1;             // dead on: either side
    var sg = rand(s) < .5 ? 1 : -1;
    return { x: -shot.dir.z / l * sg, z: shot.dir.x / l * sg };
  }

  // --- a shot ---------------------------------------------------------------------
  // shot: { origin, dir (unit), blocked: how far the city is along the ray }
  // seen: a snapshot from when the player aimed, or nothing to use the present.
  // Returns { accepted, hit, kind: 'thug' | 'villain', ... }; a shot that met
  // the villain says where, as `body` (and `point`).
  function fire(s, villains, shot, seen) {
    if (s.mode !== 'playing' || s.cooldownRemaining > 0) return { accepted: false };
    if (s.phase === 'thugs') {
      s.cooldownRemaining = CombatRef.COOLDOWN; s.shots++;
      var idx = [], spheres = [];
      s.thugs.forEach(function (t, i) {
        if (t.down) return;
        var was = seen && seen.thugs && seen.thugs[i];
        idx.push(i); spheres.push(thugSphere(was || t));
      });
      var p = Aim.pick(shot.origin, shot.dir, spheres, { blocked: shot.blocked });
      if (!p) return { accepted: true, hit: false, kind: 'thug' };
      var t = s.thugs[idx[p.index]];
      t.hp--; t.hitAt = s.time; s.thugHits++;
      if (t.hp <= 0) { t.hp = 0; t.down = true; t.downAt = s.time; }
      var down = t.down;
      if (!standing(s)) { arrive(s); place(s); s.face = faceWanted(s, s.face); }
      return { accepted: true, hit: true, kind: 'thug', thug: idx[p.index], down: down,
        point: Aim.closest(shot.origin, shot.dir, p.target) };
    }
    if (s.phase === 'arrive') {
      // Still making his entrance: nothing to hit yet, but the web sticks to him.
      s.cooldownRemaining = CombatRef.COOLDOWN;
      return { accepted: true, hit: false, kind: 'villain', early: true, body: onBody(s, villains, shot, seen) };
    }
    var at = (seen && seen.villain) || s.at, body = onBody(s, villains, shot, seen);
    var r = CombatRef.judge(s, !!body);
    if (!r.accepted) return r;
    if (s.mode === 'playing') dodge(s, at && awayFrom(s, shot, at));
    r.kind = 'villain'; r.body = body;
    if (body) r.point = body.point;
    return r;
  }

  var api = { start: start, play: play, pause: pause, tick: tick, fire: fire, snapshot: snapshot,
    billboard: billboard, onSprite: onSprite, bodyHit: bodyHit, onBody: onBody, ground: ground,
    thugSphere: thugSphere, standing: standing, left: left, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Fight = api;
})(typeof window === 'undefined' ? globalThis : window);

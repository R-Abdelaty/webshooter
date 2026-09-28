(function (root) {
  'use strict';
  // The rules of a fight in the 3D city. The state IS a Combat state (the
  // villain's health, 20 damage a hit, the cooldown, the modes the cards
  // follow - intro, playing, paused, lost, won), with the 3D parts added:
  // where the villain is in the world, which way it faces and how it moves,
  // what of him a shot can hit, the wave of thugs that can come first - and
  // (docs/PLAYER_PLAN.md, P4) the 3D game's own rules on top of Combat's,
  // which CLASSIC never sees:
  //
  //  - one level, Difficulty.HARD, for all three: his health (300, fifteen
  //    of your hits), yours (100, in `s.you`), how often he attacks and how
  //    hard;
  //  - NO CLOCK: it ends when he reaches 0 (won) or you do (lost). Combat's
  //    30 seconds are CLASSIC's; its clock is never run here;
  //  - he fights back (attacks.js): a telegraphed attack every few seconds,
  //    tested against your body where it lands, and a moment after each hit
  //    on you (`invulnerable`) when nothing else can hurt you;
  //  - the Goblin hunts you: his circuit follows you round the roofs at a
  //    stand-off, rather than circling the roof the fight started on.
  //
  // And (P5) the Rhino and Venom fight back too, each picking his attack by
  // how far you are and what you're doing (attacks.js has the sums):
  //
  //  - the Rhino, down on his avenue: you on the street, he CHARGEs - a
  //    wind-up, then straight at you and skidding on past; you up on a roof,
  //    or on a line anchored to one, he RAMs the building - a quake that
  //    hurts if you're still on it. A ram, or running into a wall, leaves him
  //    dazed: he's stunned, and your hits do double (Difficulty's dazed and
  //    dazedDamage). Then he trots back to his avenue.
  //  - Venom, on his beams: within reach he POUNCEs - a leap that lands next
  //    to you; close in, a COMBO of three swipes; at mid range a tentacle
  //    LASH that follows you through the wind-up and pulls you off a line.
  //    After a pounce he stays down there facing you a while, then leaps back
  //    up to his beams. Out of reach, he keeps to his beams.
  //  - Both: enough hits during a wind-up (Difficulty's stagger) stagger him
  //    and call the attack off, and while he's committed to an attack he
  //    doesn't dodge.
  //
  // A fight goes: (thugs) -> arrive -> villain. There is a thug wave only if
  // the encounter has thugs: Venom's, when Encounters.constants.THUGS.ENABLED
  // is on (it is off for now, so every fight starts at `arrive`). The arrival is the
  // villain's entrance - the Goblin's taunt, the Rhino dropping onto the
  // avenue and flexing, Venom dropping onto a beam and roaring - and, like
  // the thug wave, he can't be hurt in it and doesn't attack.
  //
  // tick(s, dt, ctx) is told about you: ctx = { you: { x, y, z, vx, vy, vz }
  // (your feet), body: your capsules (the model's, or Attacks.standIn),
  // state: 'ground' | 'perch' | 'swing' | 'fly' | 'zip', onScreen: whether he
  // is in your view, city, target: where the Goblin's guns aim - your eye
  // in first person (your chest when left out) }. Without it (older tests) he neither hunts nor
  // attacks. What happens goes on s.events - telegraph, throw, round, blast,
  // hurt - for the render side to show and empty.
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
  var DiffRef = need('Difficulty', './difficulty.js');
  var AttacksRef = need('Attacks', './attacks.js');
  var CityRef = need('City', './city.js');

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
    ENTRY: 1.1, ENTRY_DROP: 14,     // his drop onto a beam, from this high, once the thugs are down
    // The Goblin hunting you: his circuit's centre follows you at up to
    // HUNT_SPEED m/s (easing at HUNT_EASE a second) and its height your feet
    // at up to HUNT_CLIMB m/s; he keeps CLEAR over any roof under him, or
    // under where he'll be LOOK_AHEAD seconds on, rising at up to LIFT_RATE.
    HUNT_SPEED: 22, HUNT_EASE: 1.2, HUNT_CLIMB: 20, CLEAR: 1.5, LOOK_AHEAD: .5, LIFT_RATE: 16, LIFT_EASE: 1.5,
    CHEST: 1.1,                     // metres over your feet his attacks aim at
    ATTACK_RANGE: 40,               // further from you than this he's closing in, not attacking (the level's range comes first)...
    RANGES: { charge: 60 },         // ...or this, for the Rhino, who can charge a building from his avenue
    SPOT_STAY: 3,                   // seconds Venom stays down by you after a pounce before leaping back up
    RETURN_EASE: 11                 // how hard the Rhino slows arriving back on his avenue (m/s/s)
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
  // diff: a Difficulty level (HARD when left out). His speeds are still his
  // own (levels.js); his health, yours and his attacks are the level's.
  function start(enc, levels, diff) {
    var s = CombatRef.start(enc.level, levels), p = enc.path, v = enc.vantage, D = diff || DiffRef.get('HARD');
    // The 3D rules: the level's health for every villain, yours, no clock.
    s.rules = D; s.health = s.maxHealth = D.villainHp; s.timeLimit = null; s.elapsed = 0;
    s.you = { hp: D.playerHp, maxHp: D.playerHp, safeUntil: 0, hits: 0, big: false, hitAt: -1e9, last: null };
    s.attack = AttacksRef.create(enc.kind, D, (enc.index + 1) * 104729);
    s.bombs = []; s.rounds = []; s.events = []; s.nextId = 1; s.foe = null;
    s.dazedUntil = -1; s.staggers = 0; s.still = 0; s.stillAt = null;
    s.hunt = enc.kind === 'glider' ? { cx: p.cx, cz: p.cz, y: p.y } : null;
    // Venom's beams: their middle, and how far past them he'll pounce.
    if (enc.kind === 'leap' && p.perches.length) {
      var c = { x: 0, y: 0, z: 0 }, n = p.perches.length;
      p.perches.forEach(function (q) { c.x += q.x / n; c.y += q.y / n; c.z += q.z / n; });
      c.r = Math.max.apply(null, p.perches.map(function (q) { return Math.hypot(q.x - c.x, q.z - c.z); })) + AttacksRef.constants.HOME;
      s.home = c;
    }
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
      s.m = { ang: p.start || 0, dir: 1, r: (p.r0 + p.r1) / 2, h: (p.h0 + p.h1) / 2, rWant: 0, hWant: 0, lift: 0 };
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
  // The rhino off his patrol (P5): he's `free`, at (m.x, m.z) on the
  // street, going m.v along (m.hx, m.hz). `state` says which, for the clips:
  //   brace    the wind-up: he pulls up, facing what he'll charge
  //   charge   running at it, speeding up; he runs over you if you're there
  //   overrun  past you: skidding to a stop
  //   stun     he ran into the building (a ram) or a wall: dazed
  //   rest     stood, open, after an attack
  //   return   trotting back to his avenue, where he takes up his patrol
  function freeRhino(s) {
    var m = s.m;
    if (m.free) return;
    var v = Math.hypot(s.vel.x, s.vel.z);
    m.free = true; m.x = s.at.x; m.z = s.at.z;
    m.v = m.state === 'run' || m.state === 'skid' ? v : 0;
    m.hx = v > .1 ? s.vel.x / v : Math.sin(s.face); m.hz = v > .1 ? s.vel.z / v : Math.cos(s.face);
  }
  // Move him on along his heading, a short hop at a time; the box (or the
  // city's edge) he runs into, if he does - he stops against it.
  function runOn(s, dt, city) {
    var m = s.m, d = m.v * dt, n = Math.max(1, Math.ceil(d / .25));
    for (var i = 0; i < n; i++) {
      var x = m.x + m.hx * d / n, z = m.z + m.hz * d / n, b = AttacksRef.blocked(city, x, z, s.path.y);
      if (b) { m.v = 0; return b; }
      m.x = x; m.z = z; m.gone = (m.gone || 0) + d / n;
    }
    return null;
  }
  function moveRhino(s, dt, ctx) {
    var m = s.m, a = s.attack, A = AttacksRef.constants, city = ctx && ctx.city, hit;
    if (m.state === 'brace') { m.v = Math.max(0, m.v - A.BRAKE * dt); runOn(s, dt, city); return; }
    if (m.state === 'charge' || m.state === 'overrun') {
      if (m.state === 'charge') m.v = Math.min(A.CHARGE_V, m.v + A.CHARGE_ACCEL * dt);
      else m.v = Math.max(0, m.v - K.DECEL * dt);
      hit = runOn(s, dt, city);
      trample(s, ctx);
      if (hit) return crash(s, hit, ctx);
      if (m.state === 'charge') {
        // Past where you were (or as far as a charge goes): he skids on past.
        var past = m.ram ? m.gone > m.reach + 3 : (m.goal.x - m.x) * m.hx + (m.goal.z - m.z) * m.hz <= 0;
        if (past || m.gone > A.CHARGE_MAX) m.state = 'overrun';
      } else if (m.v <= 0) {
        m.state = 'rest'; m.rest = s.rules.recover;
        if (a) AttacksRef.finish(a);
      }
      return;
    }
    if (m.state === 'stun' || m.state === 'rest') { m.rest -= dt; if (m.rest <= 0) m.state = 'return'; return; }
    if (m.state === 'return') {
      // Back to the nearest point of his stretch of avenue.
      var p = s.path, lane = clamp((m.x - p.x) / Math.max(1, p.lane), -1, 1), z = clamp(m.z, p.z0, p.z1);
      var tx = p.x + lane * p.lane, dx = tx - m.x, dz = z - m.z, d = Math.hypot(dx, dz);
      if (d < .3) return rejoin(s, lane);
      m.hx = dx / d; m.hz = dz / d;
      var want = Math.min(speed(s), Math.sqrt(2 * K.RETURN_EASE * d));
      m.v = want < m.v ? want : Math.min(want, m.v + K.ACCEL * dt);
      if (m.v * dt >= d) { m.x = tx; m.z = z; return rejoin(s, lane); }
      hit = runOn(s, dt, city);
      if (hit) { m.state = 'rest'; m.rest = .5; }       // something's in the way: stand a moment, then try again
    }
  }
  // Back on his avenue: the patrol takes over from where he stands.
  function rejoin(s, lane) {
    var m = s.m, p = s.path, len = Math.max(1, p.z1 - p.z0);
    m.free = false; m.v = 0; m.u = clamp((m.z - p.z0) / len, 0, 1); m.lane = m.laneWant = lane;
    m.dir = m.u > .5 ? -1 : 1; m.state = 'turn'; m.next = 'run'; m.rest = K.CHARGE_TURN;
    m.turn = turnSide(s, runYaw(s));
  }
  // He ran into something: a ram's building (the quake), or any wall. Either
  // way he's dazed.
  function crash(s, box, ctx) {
    var m = s.m, a = s.attack, D = s.rules, at = { x: m.x, y: s.path.y, z: m.z };
    m.state = 'stun'; m.v = 0; m.rest = D.dazed; s.dazedUntil = s.time + D.dazed;
    if (m.ram && a && box === a.box) quake(s, ctx);
    else s.events.push({ type: 'crash', at: at, edge: !!box.edge });
    if (a) { AttacksRef.finish(a, D.dazed); a.zone = null; }
    m.ram = false;
  }
  // The quake of a ram: who's on that building, near where he hit, is hurt;
  // someone hanging from it is shaken off their line.
  function quake(s, ctx) {
    var a = s.attack, w = a.wall, A = AttacksRef.constants, hurtBy = 0, on = false;
    s.events.push({ type: 'quake', at: { x: w.x, y: s.path.y, z: w.z }, r: A.QUAKE_R, top: a.box.y1 });
    if (!ctx || !ctx.you) return;
    var you = ctx.you, st = ctx.state;
    if ((st === 'ground' || st === 'perch') && AttacksRef.under(ctx.city, you) === a.box) { on = true; hurtBy = Math.hypot(you.x - w.x, you.z - w.z); }
    else if (st === 'swing' && ctx.anchor && AttacksRef.anchored(ctx.city, ctx.anchor) === a.box) { on = true; hurtBy = Math.hypot(ctx.anchor.x - w.x, ctx.anchor.z - w.z); }
    var dmg = on ? AttacksRef.quakeDamage(hurtBy, s.rules) : 0;
    if (dmg > 0) hurt(s, dmg, { kind: 'quake', from: { x: w.x, y: s.path.y, z: w.z }, knock: st === 'swing' });
  }
  // Running you over, once a charge.
  function trample(s, ctx) {
    var m = s.m, A = AttacksRef.constants;
    if (m.hit || m.v < 3 || !ctx || !ctx.body) return;
    var at = { x: m.x, y: s.path.y, z: m.z }, dir = { x: m.hx, z: m.hz };
    if (!AttacksRef.touches(AttacksRef.rhinoBody(at, dir), ctx.body)) return;
    m.hit = true;
    hurt(s, AttacksRef.damage(A.CHARGE_SHARE, s.rules), { kind: 'charge', from: at, knock: true,
      push: { x: m.hx * A.KNOCK_V, y: A.KNOCK_UP, z: m.hz * A.KNOCK_V } });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
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
    m.from = copy(fromPoint); m.to = to; m.t = 0; m.flying = true; m.crouch = 0; m.spot = null; m.dest = null; m.pounce = false;
    m.after = hop(s, to);                          // where he goes next, to land facing it
    var q = s.path.perches[to], d = Math.hypot(q.x - m.from.x, q.y - m.from.y, q.z - m.from.z);
    m.dur = dur || Math.max(.5, d / Math.max(.1, speed(s)));
  }
  // A pounce (P5): a leap to a point by you, not to a beam.
  function pounce(s, dest) {
    var m = s.m, A = AttacksRef.constants, d = Math.hypot(dest.x - s.at.x, dest.y - s.at.y, dest.z - s.at.z);
    m.from = copy(s.at); m.dest = copy(dest); m.t = 0; m.flying = true; m.crouch = 0; m.dash = null; m.off = { x: 0, z: 0 };
    m.spot = null; m.pounce = true; m.rush = false;
    m.dur = clamp(A.POUNCE_T[0] + d * A.POUNCE_T_PER_M, A.POUNCE_T[0], A.POUNCE_T[1]);
  }
  function land(s, ctx) {
    var m = s.m;
    m.flying = false; m.off = { x: 0, z: 0 };
    if (m.dest) {
      // Down by you: he stays a while, facing you, then leaps back up to the
      // nearest beam.
      m.spot = m.dest; m.dest = null; m.next = nearestPerch(s, m.spot); m.rest = K.SPOT_STAY;
      m.room = ctx && ctx.city ? AttacksRef.sidesteps(ctx.city, m.spot, K.DASH) : [];
      if (m.pounce) { m.pounce = false; slam(s, ctx); }
      return;
    }
    m.at = m.to;
    m.next = m.after;
    m.rest = m.rush ? K.RUSH_REST : lerp(K.PERCH_MIN, K.PERCH_MAX, rand(s));
    m.rush = false;
  }
  function nearestPerch(s, p) {
    var P = s.path.perches, best = 0, bd = Infinity;
    P.forEach(function (q, i) { var d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  // A pounce lands: you're hurt (and thrown off) if you're still where he came down.
  function slam(s, ctx) {
    var m = s.m, A = AttacksRef.constants, a = s.attack, at = copy(m.spot);
    s.events.push({ type: 'slam', at: at });
    if (a) { AttacksRef.finish(a); a.zone = null; }
    if (!ctx || !ctx.body) return;
    var c = { x: at.x, y: at.y + 1.2, z: at.z };
    if (AttacksRef.gap(c, ctx.body) > A.POUNCE_HIT) return;
    var y = ctx.you, dx = y.x - at.x, dz = y.z - at.z, l = Math.hypot(dx, dz) || 1;
    hurt(s, AttacksRef.damage(A.POUNCE_SHARE, s.rules), { kind: 'pounce', from: c, knock: true,
      push: { x: dx / l * A.POUNCE_PUSH, y: 3, z: dz / l * A.POUNCE_PUSH } });
  }
  function moveLeap(s, dt, ctx) {
    var m = s.m, P = s.path.perches;
    if (!P.length) return;
    if (m.flying) { m.t += dt; if (m.t >= m.dur) land(s, ctx); return; }
    // Winding up an attack, or in the middle of one: he holds his ground.
    if (AttacksRef.busy(s.attack) && s.phase === 'villain') return;
    if (m.dash) {
      m.dash.t += dt;
      // Off a beam he leaps on soon after; down by you, he stays.
      if (m.dash.t >= m.dash.dur) { m.off = { x: m.dash.x, z: m.dash.z }; m.dash = null; if (!m.spot) m.rest = K.RUSH_REST; }
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
    if (s.kind === 'glider' && m.dive) s.at = diveAt(m.dive);
    else if (s.kind === 'glider') { var c = s.hunt || p; s.at = { x: c.cx + Math.cos(m.ang) * m.r, y: c.y + m.h + (m.lift || 0), z: c.cz + Math.sin(m.ang) * m.r }; }
    else if (s.kind === 'charge') s.at = m.free ? { x: m.x, y: p.y, z: m.z } : { x: p.x + m.lane * p.lane, y: p.y, z: lerp(p.z0, p.z1, m.u) };
    else if (!p.perches.length) s.at = null;
    else if (s.phase === 'arrive') {
      var q0 = p.perches[m.at], k = Math.min(1, s.arriveT / K.ENTRY);
      s.at = { x: q0.x, y: q0.y + K.ENTRY_DROP * (1 - k * k), z: q0.z };
    } else if (m.flying) {
      var q = m.dest || p.perches[m.to], u = Math.min(1, m.t / m.dur), d = Math.hypot(q.x - m.from.x, q.z - m.from.z);
      var arc = (d * .25 + 1.5) * 4 * u * (1 - u);
      s.at = { x: lerp(m.from.x, q.x, u), y: lerp(m.from.y, q.y, u) + arc, z: lerp(m.from.z, q.z, u) };
    } else {
      var b = m.spot || p.perches[m.at], off = m.off;
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
    if (s.phase === 'arrive') return yawTo(at, s.foe || s.eye);
    // The rhino off his patrol: at what he's about to charge while he winds
    // up, along his run while he runs, at you while he stands.
    if (s.kind === 'charge' && m.free) {
      if (m.state === 'brace') { var g = s.attack && s.attack.goal; return g && Math.hypot(g.x - at.x, g.z - at.z) > .3 ? yawTo(at, g) : cur; }
      if (m.v > .3) return Math.atan2(m.hx, m.hz);
      return m.state === 'rest' && s.foe ? yawTo(at, s.foe) : cur;
    }
    // Winding up an attack, and throwing it: at you.
    if (s.foe && s.attack && (s.attack.phase === 'telegraph' || s.attack.phase === 'active')) {
      return Math.hypot(s.foe.x - at.x, s.foe.z - at.z) > .3 ? yawTo(at, s.foe) : cur;
    }
    // Venom, down by you after a pounce: at you.
    if (s.kind === 'leap' && m.spot && !m.flying) return s.foe ? yawTo(at, s.foe) : cur;
    if (s.kind === 'charge') {
      if (m.state === 'turn' || m.state === 'windup') return runYaw(s);
      if (Math.hypot(s.vel.x, s.vel.z) > .3) return Math.atan2(s.vel.x, s.vel.z);
      return runYaw(s);
    }
    if (s.kind === 'glider') return Math.hypot(s.vel.x, s.vel.z) > .3 ? Math.atan2(s.vel.x, s.vel.z) : cur;
    // Venom: at the beam he is leaping to, and over the last part of the leap
    // round to the one after it, so that he lands facing it.
    var P = s.path.perches, q = m.flying && m.dest ? m.dest : P[m.flying ? m.to : m.next];
    if (m.flying && !m.dest && m.t / m.dur > K.LAND_TURN && P[m.after]) { at = P[m.to]; q = P[m.after]; }
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
    var m = s.m, beams = m.spot ? m.room || [] : (s.path.perches[m.at] || {}).beams || [], best = null, score = -Infinity;
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

  // --- the Goblin hunting you -----------------------------------------------------
  // His circuit's centre follows you, eased and at most HUNT_SPEED; he flies
  // his 3-9 m over your feet, but never lower than CLEAR over a roof he is
  // over or about to be over.
  function hunt(s, dt, ctx) {
    var h = s.hunt, m = s.m;
    if (!h || !(dt > 0)) return;
    if (ctx && ctx.you) {
      var y = ctx.you, dx = y.x - h.cx, dz = y.z - h.cz, d = Math.hypot(dx, dz), k = 1 - Math.exp(-K.HUNT_EASE * dt);
      var mv = Math.min(d * k, K.HUNT_SPEED * dt);
      if (d > 1e-6) { h.cx += dx / d * mv; h.cz += dz / d * mv; }
      var dy = (y.y - h.y) * k;
      h.y += Math.max(-K.HUNT_CLIMB * dt, Math.min(K.HUNT_CLIMB * dt, dy));
    }
    var city = ctx && ctx.city;
    if (!city || !CityRef || !s.at) return;
    var base = h.y + m.h, want = 0;
    [0, K.LOOK_AHEAD].forEach(function (ahead) {
      var x = s.at.x + (s.vel.x || 0) * ahead, z = s.at.z + (s.vel.z || 0) * ahead, R = 1.6;
      CityRef.query(city, x - R, z - R, x + R, z + R).forEach(function (c) {
        if (c.x1 < x - R || c.x0 > x + R || c.z1 < z - R || c.z0 > z + R) return;
        want = Math.max(want, c.y1 + K.CLEAR - base);
      });
    });
    // Up at once if he is into something, otherwise eased; down eased.
    var cur = m.lift || 0, floor = 0;
    CityRef.query(city, s.at.x - .5, s.at.z - .5, s.at.x + .5, s.at.z + .5).forEach(function (c) {
      if (s.at.x >= c.x0 - .5 && s.at.x <= c.x1 + .5 && s.at.z >= c.z0 - .5 && s.at.z <= c.z1 + .5) floor = Math.max(floor, c.y1 + .3 - base);
    });
    if (want > cur) cur = Math.min(want, cur + K.LIFT_RATE * dt);
    else cur += (want - cur) * (1 - Math.exp(-K.LIFT_EASE * dt));
    m.lift = Math.max(0, cur, floor);
  }

  // --- he fights back ---------------------------------------------------------------
  function chest(y) { return { x: y.x, y: y.y + K.CHEST, z: y.z }; }
  // How near you must be for him to attack rather than close in: the level's
  // range (HARD's), or for a level without one, the constants'.
  function range(s) { var r = s.rules && s.rules.range; return (r && r[s.kind]) || K.RANGES[s.kind] || K.ATTACK_RANGE; }
  // A point on the model the render side sampled (villain-view.js puts the
  // manifest's attack bones in body.points), or `or`.
  function point(s, name, or) { var p = s.body && s.body.points && s.body.points[name]; return p || or; }
  // The glider's two guns (the model's, or either side of him).
  function guns(s) {
    var L = left(s.face);
    return point(s, 'guns', null) || [{ x: s.at.x + L.x * .4, y: s.at.y + .1, z: s.at.z + L.z * .4 }, { x: s.at.x - L.x * .4, y: s.at.y + .1, z: s.at.z - L.z * .4 }];
  }
  function between(list) {
    var c = { x: 0, y: 0, z: 0 };
    list.forEach(function (p) { c.x += p.x / list.length; c.y += p.y / list.length; c.z += p.z / list.length; });
    return c;
  }
  // What the guns aim at: ctx.target (world-game.js: your eye in first
  // person, your head - or chest, if that's what's on screen - in third),
  // else your chest; led for how long until the rounds get there.
  function gunAim(s, ctx, wait) {
    var y = ctx.you, t = ctx.target || chest(y);
    return AttacksRef.lead(t, { x: y.vx || 0, y: 0, z: y.vz || 0 }, between(guns(s)), wait);
  }
  // The laser (attack-view.js draws a.laser): through the guns' wind-up it
  // follows you fast, a little ahead, and in its last GUN_LOCK seconds it
  // holds still - the line the burst goes down.
  // The volley's guns charge on through its strike, while the bombs go.
  function laser(s, dt, ctx) {
    var a = s.attack, A = AttacksRef.constants, tele = AttacksRef.windup(a), total = tele, left = -1;
    if (a.move === 'guns' && a.phase === 'telegraph') left = tele - a.t;
    else if (a.move === 'volley') {
      total = tele + A.VOLLEY_CHARGE;
      if (a.phase === 'telegraph') left = total - a.t;
      else if (a.phase === 'active' && a.volley && !a.volley.fired) left = A.VOLLEY_CHARGE - a.t;
    }
    if (left < 0) { a.laser = null; return; }
    if (left > A.GUN_LOCK) a.aim = AttacksRef.track(a.aim, gunAim(s, ctx, left), dt);
    else a.locked = true;
    a.laser = { aim: copy(a.aim), k: Math.min(1, Math.max(0, 1 - left / total)), locked: !!a.locked };
  }
  // Standing still on a roof (or perched): how long you've been within
  // STILL_R of one spot - the Goblin punishes it.
  function stillness(s, dt, ctx) {
    var y = ctx.you, A = AttacksRef.constants, st = ctx.state, at = s.stillAt;
    if ((st === 'ground' || st === 'perch') && at && Math.hypot(y.x - at.x, y.z - at.z) < A.STILL_R && Math.abs(y.y - at.y) < 1) s.still += dt;
    else { s.stillAt = copy(y); s.still = 0; }
  }
  function punishing(s) { return s.kind === 'glider' && s.still >= AttacksRef.constants.STILL_T; }
  function attacking(s, dt, ctx) {
    var a = s.attack, you = ctx.you, A = AttacksRef.constants;
    if (!a) return;
    var inFlight = s.bombs.length > 0 || s.rounds.length > 0 || !!a.lash;
    if (s.kind === 'glider') stillness(s, dt, ctx);
    // Standing still: his next attack comes now.
    if (a.phase === 'wait' && punishing(s)) a.wait = Math.min(a.wait, 0);
    // Still closing in on you (you swung off): no wind-ups until he's near -
    // though the quiet counts, so he starts one as soon as he is.
    if (a.phase === 'wait' && Math.hypot(s.at.x - you.x, s.at.y - you.y, s.at.z - you.z) > range(s)) { AttacksRef.quiet(a, dt, { inFlight: inFlight }); return; }
    // Which moves he has from here (only worked out when one is due).
    var allow = a.phase === 'wait' && (a.wait <= dt || a.quiet + dt >= (s.rules.director || Infinity)) ? allowed(s, ctx) : null;
    var ev = AttacksRef.step(a, dt, { onScreen: ctx.onScreen !== false, state: ctx.state, rand: function () { return rand(s); }, allow: allow || undefined, inFlight: inFlight });
    // Laid into during a wind-up: enough hits stagger him and call it off.
    if (a.phase === 'telegraph' && s.kind !== 'glider' && s.hits - a.hits0 >= s.rules.stagger) stagger(s);
    // What follows you through a wind-up: the guns' laser, the tentacle's
    // aim, the charge's target, the ring where he'll land.
    if (a.move === 'guns' || a.move === 'volley') laser(s, dt, ctx); else a.laser = null;
    if (a.phase === 'telegraph') {
      if (a.move === 'guns' || a.move === 'volley') { /* the laser, above */ }
      else if (a.move === 'lash') a.aim = AttacksRef.track(a.aim, chest(you), dt, A.LASH_TRACK);
      else if (a.move === 'charge') a.goal = { x: you.x, y: s.path.y, z: you.z };
      else if (a.move === 'pounce') { var L = AttacksRef.landing(ctx.city, you, s.at); if (L) a.zone = { x: L.x, y: L.y, z: L.z, r: A.POUNCE_HIT }; }
    }
    ev.forEach(function (e) {
      if (e.type === 'telegraph') windUp(s, e, ctx);
      else if (e.type === 'strike') strike(s, e.move, ctx);
    });
    // What's still going on in a strike: the combo's next swipes, the
    // volley's bombs and burst, the tentacle. (The dive is diving().)
    if (a.phase === 'active' && a.move === 'combo') combo(s, ctx);
    if (a.phase === 'active' && a.move === 'volley') volley(s, ctx);
    if (a.move === 'volley' || a.move === 'guns') { if (a.phase === 'active' || a.phase === 'telegraph') laser(s, 0, ctx); else a.laser = null; }
    if (a.lash) {
      var r = AttacksRef.stepLash(a.lash, dt, ctx.body);
      if (r === 'body') {
        var d = { x: s.at.x - you.x, z: s.at.z - you.z }, l = Math.hypot(d.x, d.z) || 1;
        hurt(s, AttacksRef.damage(A.LASH_SHARE, s.rules), { kind: 'lash', from: copy(a.lash.from), knock: true,
          push: { x: d.x / l * A.LASH_PULL, y: 2, z: d.z / l * A.LASH_PULL } });
      }
      if (a.phase !== 'active' || (!a.lash.out && a.lash.s <= 0)) a.lash = null;
    }
  }
  // The moves open to him now, from how far you are and what you're doing
  // (null: all of them - the Goblin's aren't limited).
  function allowed(s, ctx) {
    if (s.kind === 'glider') {
      // Standing still: bombs on where you stand.
      if (punishing(s)) return ['volley', 'bomb'];
      var list = ['bomb', 'guns', 'volley'], c = chest(ctx.you), me = { x: s.at.x, y: s.at.y + .9, z: s.at.z };
      if (Math.hypot(c.x - me.x, c.y - me.y, c.z - me.z) <= AttacksRef.constants.DIVE_RANGE && !AttacksRef.hitCity(ctx.city, me, c)) list.push('dive');
      return list;
    }
    var you = ctx.you, m = s.m, A = AttacksRef.constants, st = ctx.state, stands = st === 'ground' || st === 'perch';
    if (s.kind === 'charge') {
      if (m.free && m.state !== 'return' && m.state !== 'rest') return [];
      var level = Math.hypot(you.x - s.at.x, you.z - s.at.z);
      if (you.y - s.path.y <= A.HIGH) return (st === 'ground' || st === 'fly') && level <= A.CHARGE_RANGE ? ['charge'] : [];
      // Up high: the building under you, or the one your line hangs from.
      var box = st === 'swing' ? AttacksRef.anchored(ctx.city, ctx.anchor) : stands ? AttacksRef.under(ctx.city, you) : null;
      var w = box && AttacksRef.wallPoint(box, s.at);
      if (!w || w.d > A.RAM_RANGE || !AttacksRef.clearRun(ctx.city, s.at, w.stop, s.path.y, box)) return [];
      s.plan = { box: box, wall: w };
      return ['ram'];
    }
    // Venom: not in the middle of a leap or a dash.
    if (m.flying || m.crouch > 0 || m.dash) return [];
    var me = { x: s.at.x, y: s.at.y + 1.2, z: s.at.z }, c = chest(you), d = Math.hypot(c.x - me.x, c.y - me.y, c.z - me.z), out = [];
    if (d <= A.MELEE && stands) out.push('combo');
    // (Not counting the column of the node he's on, which his chest is inside.)
    if (d >= A.LASH_MIN && d <= A.LASH_REACH - .5 && AttacksRef.lashReach(ctx.city, me, { x: (c.x - me.x) / d, y: (c.y - me.y) / d, z: (c.z - me.z) / d }) >= d - .3) out.push('lash');
    if (stands && d >= A.POUNCE_MIN && d <= A.POUNCE_MAX) {
      var L = AttacksRef.landing(ctx.city, you, s.at);
      if (L && (!s.home || Math.hypot(L.x - s.home.x, L.z - s.home.z) <= s.home.r) && AttacksRef.arcClear(ctx.city, s.at, L)) out.push('pounce');
    }
    return out;
  }
  // The start of a wind-up.
  function windUp(s, e, ctx) {
    var a = s.attack, you = ctx.you, m = s.m;
    a.aim = e.move === 'guns' ? gunAim(s, ctx, AttacksRef.windup(a)) : e.move === 'lash' ? chest(you) : null;
    a.locked = false; a.laser = null; a.volley = null; a.dive = null;
    if (e.move === 'volley') a.aim = gunAim(s, ctx, AttacksRef.windup(a) + AttacksRef.constants.VOLLEY_CHARGE);
    if (s.kind === 'glider') { s.still = 0; s.stillAt = copy(you); }
    a.hits0 = s.hits; a.goal = null; a.zone = null; a.box = null; a.wall = null; a.combo = null; a.lash = null;
    if (s.kind === 'charge') {
      freeRhino(s); m.state = 'brace'; m.hit = false; m.ram = false;
      if (e.move === 'ram' && s.plan) {
        a.box = s.plan.box; a.wall = s.plan.wall; a.goal = { x: a.wall.x, y: s.path.y, z: a.wall.z };
        // The ring on the roof: where the quake will hurt.
        // (On the roof - or, up on a higher tier of it, where you stand.)
        var ry = you.y - a.box.y1 > 1.5 && ctx.state !== 'swing' ? you.y : a.box.y1;
        a.zone = { x: a.wall.x, y: ry, z: a.wall.z, r: AttacksRef.constants.QUAKE_R,
          clip: { x0: a.box.x0, z0: a.box.z0, x1: a.box.x1, z1: a.box.z1 } };
      } else a.goal = { x: you.x, y: s.path.y, z: you.z };
    } else if (s.kind === 'leap') m.crouch = 0;
    s.events.push({ type: 'telegraph', move: e.move, off: e.off, tele: AttacksRef.windup(a), at: copy(s.at) });
  }
  // Hit enough during a wind-up: he staggers, and the attack is off.
  function stagger(s) {
    var a = s.attack;
    AttacksRef.cancel(a);
    a.zone = null; a.goal = null;
    s.staggers++;
    if (s.kind === 'charge' && s.m.free) { s.m.state = 'rest'; s.m.rest = s.rules.recover; }
    s.events.push({ type: 'stagger', move: a.move, at: copy(s.at) });
  }
  // The combo's swipes: the first at the strike, the rest COMBO_GAP apart;
  // it ends early if you get out of reach.
  function combo(s, ctx) {
    var a = s.attack, A = AttacksRef.constants, c = a.combo;
    if (!c) return;
    while (c.i < c.n && a.t >= c.i * A.COMBO_GAP) {
      var me = { x: s.at.x, y: s.at.y + 1.2, z: s.at.z }, y = chest(ctx.you);
      if (c.i > 0 && Math.hypot(y.x - me.x, y.y - me.y, y.z - me.z) > A.MELEE + 1) { c.n = c.i; break; }
      swipe(s, ctx, c.i);
      c.i++;
    }
    if (c.i >= c.n && a.t >= (c.n - 1) * A.COMBO_GAP + A.COMBO_END) AttacksRef.finish(a);
  }
  function swipe(s, ctx, i) {
    var A = AttacksRef.constants, at = AttacksRef.claw(s.at, s.face);
    s.events.push({ type: 'swipe', at: at, i: i });
    if (!ctx.body || !AttacksRef.swipeHits(s.at, s.face, ctx.body)) return;
    hurt(s, AttacksRef.damage(A.SWIPE_SHARE, s.rules), { kind: 'swipe', from: at,
      push: { x: Math.sin(s.face) * 4, y: 1.5, z: Math.cos(s.face) * 4 } });
  }
  function strike(s, move, ctx) {
    var a = s.attack, you = ctx.you, up = { x: s.at.x, y: s.at.y + 1.3, z: s.at.z }, m = s.m, A = AttacksRef.constants;
    if (move === 'charge' || move === 'ram') {
      // Off he goes: at where you are now (a charge), or at the building.
      var g = move === 'ram' && a.wall ? a.wall.stop : { x: you.x, z: you.z }, dx = g.x - m.x, dz = g.z - m.z, l = Math.hypot(dx, dz);
      if (l < .5) { dx = Math.sin(s.face); dz = Math.cos(s.face); l = 1; }
      m.hx = dx / l; m.hz = dz / l; m.goal = { x: g.x, z: g.z }; m.gone = 0; m.hit = false;
      m.ram = move === 'ram'; m.reach = l; m.state = 'charge';
      a.goal = null;
      s.events.push({ type: 'charge', move: move, at: copy(s.at) });
    } else if (move === 'pounce') {
      var L = AttacksRef.landing(ctx.city, you, s.at);
      if (!L) { AttacksRef.finish(a); a.zone = null; return; }    // you got somewhere he can't come down
      pounce(s, L);
      a.zone = { x: L.x, y: L.y, z: L.z, r: A.POUNCE_HIT };
      s.events.push({ type: 'pounce', at: copy(s.at), to: copy(L) });
    } else if (move === 'combo') {
      a.combo = { i: 0, n: A.COMBO_N };
      combo(s, ctx);
    } else if (move === 'lash') {
      var from = { x: s.at.x + Math.sin(s.face) * .4, y: s.at.y + 1.35, z: s.at.z + Math.cos(s.face) * .4 };
      var aim = a.aim || chest(you), dir = { x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z }, dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
      dir = { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl };
      a.lash = { from: from, dir: dir, s: 0, reach: AttacksRef.lashReach(ctx.city, from, dir), out: true, hit: false };
      s.events.push({ type: 'lash', at: copy(from), dir: copy(dir) });
    } else if (move === 'bomb') {
      throwAt(s, you);
    } else if (move === 'volley') {
      a.volley = { n: A.VOLLEY_N[0] + Math.floor(rand(s) * (A.VOLLEY_N[1] - A.VOLLEY_N[0] + 1)), thrown: 0, fired: false, done: 0 };
      volley(s, ctx);
    } else if (move === 'dive') {
      dive(s, ctx);
    } else if (move === 'guns') {
      a.laser = null;
      s.rounds = s.rounds.concat(AttacksRef.burst(guns(s), a.aim || gunAim(s, ctx, 0), s.time, function () { return rand(s); }));
    }
  }
  // A pumpkin bomb from his hand, at where you'll be.
  function throwAt(s, you) {
    var from = point(s, 'hand', { x: s.at.x, y: s.at.y + 1.3, z: s.at.z }), b = AttacksRef.throwBomb(from, chest(you), { x: you.vx || 0, z: you.vz || 0 }, s.nextId++);
    s.bombs.push(b);
    s.events.push({ type: 'throw', from: copy(from), id: b.id });
  }
  // The volley: its bombs VOLLEY_EVERY apart from the strike, and at
  // VOLLEY_CHARGE the burst down the locked laser; over once the rounds are out.
  function volley(s, ctx) {
    var a = s.attack, A = AttacksRef.constants, v = a.volley;
    if (!v) return;
    while (v.thrown < v.n && a.t >= v.thrown * A.VOLLEY_EVERY) { throwAt(s, ctx.you); v.thrown++; }
    if (!v.fired && a.t >= A.VOLLEY_CHARGE) {
      v.fired = true; a.laser = null; v.done = a.t + A.GUN_ROUNDS * A.GUN_EVERY + .1;
      s.rounds = s.rounds.concat(AttacksRef.burst(guns(s), a.aim || gunAim(s, ctx, 0), s.time, function () { return rand(s); }));
    }
    if (v.fired && v.thrown >= v.n && a.t >= v.done) AttacksRef.finish(a);
  }
  // The dive: from where he is, straight at where you'll be (DIVE_LEAD on),
  // then on DIVE_PAST level, a little up - cut short of anything in the way.
  // m.dive: { pts: [3 points], lens, s, len, hit, dir }.
  function dive(s, ctx) {
    var a = s.attack, A = AttacksRef.constants, y = ctx.you, m = s.m, c = chest(y);
    var to = { x: c.x + (y.vx || 0) * A.DIVE_LEAD, y: c.y, z: c.z + (y.vz || 0) * A.DIVE_LEAD }, from = copy(s.at);
    from.y += .9; to.y = Math.max(to.y, y.y + .9);
    var h = { x: to.x - from.x, z: to.z - from.z }, hl = Math.hypot(h.x, h.z) || 1;
    var past = { x: to.x + h.x / hl * A.DIVE_PAST, y: to.y + A.DIVE_LIFT, z: to.z + h.z / hl * A.DIVE_PAST };
    var pts = [from, to, past], lens = [Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z), Math.hypot(past.x - to.x, past.y - to.y, past.z - to.z)], len = lens[0] + lens[1];
    // Anything in the way of either leg: he pulls out a metre and a half short of it.
    for (var i = 0; i < 2; i++) {
      var w = AttacksRef.hitCity(ctx.city, pts[i], pts[i + 1]);
      if (w) { len = Math.max(.5, (i ? lens[0] : 0) + lens[i] * w.t - 1.5); break; }
    }
    m.dive = { pts: pts, lens: lens, s: 0, len: len, hit: false, dir: { x: h.x / hl, z: h.z / hl } };
    a.dive = true;
    s.events.push({ type: 'dive', at: copy(s.at), to: copy(to) });
  }
  // A point `d` metres along the dive (his feet: the path is his middle).
  function diveAt(D) {
    var k = Math.min(D.s, D.len), i = k <= D.lens[0] ? 0 : 1, u = i ? (k - D.lens[0]) / (D.lens[1] || 1) : k / (D.lens[0] || 1);
    var p0 = D.pts[i], p1 = D.pts[i + 1];
    return { x: lerp(p0.x, p1.x, u), y: lerp(p0.y, p1.y, u) - .9, z: lerp(p0.z, p1.z, u) };
  }
  // Each frame of the dive: on along it, hitting you once if his body meets
  // yours; at its end he takes up his circuit again from where he is.
  function diving(s, dt, ctx) {
    var m = s.m, D = m.dive, A = AttacksRef.constants, a = s.attack;
    var p0 = diveAt(D);
    D.s += A.DIVE_V * dt;
    var p1 = diveAt(D), caps = ctx && ctx.body;
    if (!D.hit && caps && caps.length && s.mode === 'playing') {
      var q0 = { x: p0.x, y: p0.y + .9, z: p0.z }, q1 = { x: p1.x, y: p1.y + .9, z: p1.z };
      if (caps.some(function (c) { return AttacksRef.segSeg(q0, q1, c.a, c.b) <= c.r + A.DIVE_R; })) {
        D.hit = true;
        hurt(s, AttacksRef.damage(A.DIVE_SHARE, s.rules), { kind: 'dive', from: q1, knock: true,
          push: { x: D.dir.x * A.DIVE_PUSH, y: 3, z: D.dir.z * A.DIVE_PUSH } });
      }
    }
    if (D.s < D.len) return;
    // Back on his circuit round you, from here, easing out to it.
    var h = s.hunt || s.path, e = p1;
    m.ang = Math.atan2(e.z - h.cz, e.x - h.cx); m.r = Math.hypot(e.x - h.cx, e.z - h.cz);
    m.h = e.y - h.y - (m.lift || 0);
    m.dive = null; wantGlide(s);
    if (a && a.move === 'dive') { a.dive = false; AttacksRef.finish(a); }
  }
  // Bombs in flight and rounds on their way: what they hit, when they get there.
  function flying(s, dt, ctx) {
    var caps = ctx && ctx.body, city = ctx && ctx.city;
    s.bombs = s.bombs.filter(function (b) {
      var r = AttacksRef.stepBomb(b, dt, s.time, city, caps);
      if (!r) return true;
      var dmg = caps && caps.length ? AttacksRef.blastDamage(r.at, caps, s.rules, r.why) : 0;
      s.events.push({ type: 'blast', at: copy(r.at), why: r.why, id: b.id, damage: dmg });
      if (dmg > 0) hurt(s, dmg, { kind: 'bomb', from: r.at, push: AttacksRef.push(r.at, caps, dmg, s.rules) });
      return false;
    });
    s.rounds = s.rounds.filter(function (r) {
      var was = r.fired, out = AttacksRef.stepRound(r, s.time, city, caps);
      if (r.fired && !was) s.events.push({ type: 'round', from: copy(r.from), dir: copy(r.dir), gun: r.gun });
      if (out === 'body') { hurt(s, AttacksRef.gunDamage(s.rules), { kind: 'guns', from: r.from }); return false; }
      return !out;
    });
    // Gone down to one of them: stopAttacks emptied the lists, but the
    // filters above put back what was left in them.
    if (s.mode !== 'playing') { s.bombs = []; s.rounds = []; }
  }
  // You're hit for `dmg`: unless you were hit a moment ago (invulnerable),
  // it comes off your health, and at 0 the fight is lost. o: { kind, from,
  // push, knock (off a swing line whatever the damage) }. Returns the 'hurt'
  // event (also on s.events), or { hit: false }.
  function hurt(s, dmg, o) {
    var y = s.you, D = s.rules;
    o = o || {};
    if (!y || s.mode !== 'playing' || y.hp <= 0 || !(dmg > 0)) return { hit: false };
    if (s.time < y.safeUntil) return { hit: false, safe: true };
    dmg = Math.round(dmg);
    y.hp = Math.max(0, y.hp - dmg); y.safeUntil = s.time + D.invulnerable; y.hits++; y.big = dmg >= D.big; y.hitAt = s.time;
    var e = { type: 'hurt', hit: true, damage: dmg, big: y.big, knock: dmg >= D.knockOff || !!o.knock, kind: o.kind || null,
      from: copy(o.from), push: o.push || null, dead: y.hp === 0, hp: y.hp };
    y.last = e;
    s.events.push(e);
    if (y.hp === 0) { s.mode = 'lost'; stopAttacks(s); }
    return e;
  }
  function stopAttacks(s) {
    s.bombs = []; s.rounds = [];
    if (s.attack) { AttacksRef.cancel(s.attack); s.attack.lash = null; s.attack.laser = null; s.attack.volley = null; s.attack.zone = null; s.attack.goal = null; }
  }

  // --- the fight's time -------------------------------------------------------------
  // Nothing moves and no time passes unless the fight is being played: the
  // INTRO card, PAUSED, and the end cards all hold it exactly as it is.
  // There is no clock: `elapsed` only counts how long the fight proper has
  // gone on. The thug wave and the entrance come before it.
  function tick(s, dt, ctx) {
    if (s.mode !== 'playing') return s;
    dt = num(dt);
    s.time += dt;
    if (ctx && ctx.you) s.foe = copy(ctx.you);
    moveThugs(s);
    if (s.phase === 'thugs') {
      s.cooldownRemaining = Math.max(0, s.cooldownRemaining - dt);
      return s;
    }
    var old = s.at;
    s.cooldownRemaining = Math.max(0, s.cooldownRemaining - dt);
    if (s.phase === 'arrive') {
      s.arriveT += dt;
      if (s.arriveT >= (K.ARRIVE[s.kind] || 0)) begin(s);
    } else {
      s.elapsed += dt;
      s.dodgeRemaining = Math.max(0, s.dodgeRemaining - dt);
      if (s.kind === 'glider') { hunt(s, dt, ctx); if (s.m.dive) diving(s, dt, ctx); else moveGlider(s, dt); }
      else if (s.kind === 'charge') { if (s.m.free) moveRhino(s, dt, ctx); else moveCharge(s, dt); }
      else moveLeap(s, dt, ctx);
    }
    place(s);
    if (old && s.at && dt > 0) s.vel = { x: (s.at.x - old.x) / dt, y: (s.at.y - old.y) / dt, z: (s.at.z - old.z) / dt };
    turnFace(s, dt);
    if (s.phase === 'villain' && ctx && ctx.you) attacking(s, dt, ctx);
    flying(s, dt, ctx);
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
    var m = s.m, P = s.path.perches, q = m.dest || P[m.to];
    if (s.phase !== 'arrive' && m.flying && m.from && q) return lerp(m.from.y, q.y, Math.min(1, m.t / m.dur));
    if (m.spot) return m.spot.y;
    return P[m.at] ? P[m.at].y : s.at.y;
  }
  function thugSphere(t) { return { x: t.x, y: t.y + K.THUG_CHEST, z: t.z, r: K.THUG_R }; }

  // What was on screen at a moment, so a shot can be judged against what the
  // player saw when they aimed rather than where things have moved on to since
  // (world-game.js keeps one of these with each frame's camera). The body is
  // a fresh sample each frame, so keeping it by reference is safe.
  function snapshot(s) {
    return { villain: copy(s.at), body: s.body || null, thugs: s.thugs.map(function (t) { return { x: t.x, y: t.y, z: t.z }; }),
      bombs: (s.bombs || []).map(function (b) { return { id: b.id, x: b.x, y: b.y, z: b.z }; }) };
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
    // Dazed (P5): each hit does more (Combat has done the first 20).
    if (r.hit && s.mode === 'playing' && dazed(s)) {
      s.health = Math.max(0, s.health - s.rules.shotDamage * (s.rules.dazedDamage - 1));
      if (s.health === 0) s.mode = 'won';
      r.dazed = true;
    }
    // Committed to an attack (or reeling from one) he doesn't dodge.
    if (s.mode === 'playing' && !committed(s)) dodge(s, at && awayFrom(s, shot, at));
    else if (s.mode === 'won') stopAttacks(s);          // his bombs in the air go with him
    r.kind = 'villain'; r.body = body;
    if (body) r.point = body.point;
    return r;
  }
  // The Rhino, dazed: your hits do Difficulty's dazedDamage times as much.
  function dazed(s) { return s.time < s.dazedUntil; }
  // Winding up, striking, off his patrol (the Rhino) or mid-pounce: no dodging.
  function committed(s) {
    if (s.kind === 'glider') return false;
    if (AttacksRef.busy(s.attack)) return true;
    return s.kind === 'charge' && !!s.m.free;
  }

  // --- a web at a bomb ----------------------------------------------------------------
  // Which bomb in flight a shot is aimed at (its own small cone, before any
  // villain - Swing.decide's order): judged against where the bombs were when
  // you aimed if `seen` has them. Its id, or null.
  function aimBomb(s, shot, seen) {
    if (!s.bombs || !s.bombs.length || s.mode !== 'playing') return null;
    var live = s.bombs.filter(function (b) { return b.popAt === null; });
    var list = live.map(function (b) {
      var was = seen && seen.bombs && seen.bombs.filter(function (q) { return q.id === b.id; })[0];
      return was || b;
    });
    var i = AttacksRef.aimBomb(shot.origin, shot.dir, list, AttacksRef.constants.BOMB_CONE, shot.blocked);
    return i >= 0 ? live[i].id : null;
  }
  // Shoot it down: it goes off when the web gets there, `delay` seconds on.
  // A web shot like any other (the cooldown), but not a shot at him: he
  // doesn't dodge it and it isn't counted.
  function shootBomb(s, id, delay) {
    if (s.mode !== 'playing' || s.cooldownRemaining > 0) return { accepted: false };
    var b = (s.bombs || []).filter(function (q) { return q.id === id && q.popAt === null; })[0];
    if (!b) return { accepted: false };
    s.cooldownRemaining = CombatRef.COOLDOWN;
    b.popAt = s.time + Math.max(0, delay || 0);
    return { accepted: true, hit: true, kind: 'bomb', id: id, point: { x: b.x, y: b.y, z: b.z } };
  }
  // Where a bomb will be `delay` seconds on (for the web flying to it).
  function bombAhead(s, id, delay) {
    var b = (s.bombs || []).filter(function (q) { return q.id === id; })[0];
    return b ? AttacksRef.bombAt(b, b.t + Math.max(0, delay || 0)) : null;
  }
  // What the fight's events since last asked were (and forget them).
  function drain(s) { var e = s.events || []; s.events = []; return e; }

  var api = { start: start, play: play, pause: pause, tick: tick, fire: fire, snapshot: snapshot,
    billboard: billboard, onSprite: onSprite, bodyHit: bodyHit, onBody: onBody, ground: ground,
    thugSphere: thugSphere, standing: standing, left: left, hurt: hurt, aimBomb: aimBomb, shootBomb: shootBomb,
    bombAhead: bombAhead, drain: drain, dazed: dazed, committed: committed, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Fight = api;
})(typeof window === 'undefined' ? globalThis : window);

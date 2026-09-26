(function (root) {
  'use strict';
  // Which clip each villain plays, from the state of its fight. world/fight.js
  // moves the villain; this watches what it does and says what the model
  // should play: the Goblin's flying and banking, the Rhino's entrance, wind-
  // up, run and skid, Venom's crouch, leap and landing timed to the leap's
  // real arc, and for all three the dodges, hits and defeat. No Three.js:
  // villain-view.js passes the commands to the model's CharacterRig.
  //
  //   var a = VillainAnim.create(kind, clips)   clips: { name: seconds }
  //   var out = VillainAnim.step(a, fight, dt)
  //   out.play:  [[clip, opts], ...] for CharacterRig.play, in order
  //   out.speed: ground speed for 'loco' (the rhino's run), or null
  //   out.roll, out.pitch: the goblin's bank and climb, in radians
  //
  // Two pure helpers the render side uses each frame, given Rig.pose():
  //   bodyYaw(pose, curves)  which way the pose squares the chest, relative to
  //                          the model's front, so the root can take it back
  //                          out and the villain faces exactly where fight.js
  //                          says (Venom's idle stands 53 degrees off, and the
  //                          turn clips turn the body by themselves)
  //   lift(pose, clips, lowest, ankle)  how far to lower a model whose clip
  //                          lifts its feet (Venom's jumps), so they follow
  //                          the arc the fight moves him along

  var DAMAGE = (root.Combat && root.Combat.DAMAGE) || 20;
  var K = {
    TURN_ON: .35, TURN_OFF: .2,     // yaw rate (rad/s) at which the goblin leans into a turn, and out of it
    BANK: 1.4, BANK_MAX: .6, BANK_EASE: 4,   // his bank: this many times the true one, capped, eased in
    PITCH: .5, PITCH_MAX: .3,
    // leap_start slowed so its take-off (TAKEOFF s into the clip, where his
    // feet leave the beam) comes at the end of fight.js's crouch.
    TAKEOFF: .14, LEAP_SPEED: .6,
    LAND_LEAD: .12,                 // seconds before touching down that land starts (its impact frame)
    DROP_LEAD: .17,                 // ...and descent_end, for venom's entrance
    TURNING: 1,                     // a clip whose chest swings more than this (radians) turns the body itself
    GRAVITY: 9.8
  };

  function create(kind, clips) {
    return { kind: kind, clips: clips || {}, started: false, seen: null, base: null,
      roll: 0, pitch: 0, turning: 0, flights: 0, landed: -1, arrived: {} };
  }
  function dur(a, c) { return a.clips[c] || 0; }

  function step(a, s, dt) {
    var out = { play: [], speed: null, roll: a.roll, pitch: a.pitch };
    var play = function (c, o) { out.play.push([c, o || {}]); };
    var base = function (c, o) { if (a.base !== c) { a.base = c; play(c, o); } };
    var m = s.m || {}, was = a.seen;
    var now = { hits: s.hits, dodge: s.dodge ? s.dodge.n : 0, mode: s.mode, phase: s.phase, state: m.state,
      flying: !!m.flying, crouch: m.crouch > 0, to: m.to, t: m.t };
    a.seen = now;
    if (!s.at) return out;
    if (!was || !a.started) { a.started = true; was = { hits: now.hits, dodge: now.dodge, mode: now.mode, phase: null }; }

    // The end: beaten, or the clock ran out and he got away.
    if (s.mode === 'won') { if (was.mode !== 'won') { a.base = null; play('defeat', { hold: true, fade: .1 }); } return settle(a, s, dt, out, true); }
    if (s.mode === 'lost') { if (was.mode !== 'lost') play('roar'); return settle(a, s, dt, out, true); }

    if (s.phase === 'arrive') arriving(a, s, was, base, play);
    else if (s.phase === 'villain') {
      if (a.kind === 'glider') glider(a, s, base);
      else if (a.kind === 'charge') charge(a, s, was, now, base, play, out);
      else leaper(a, s, was, now, base, play);
    }
    // Shot at: a hit flinches (the last hit before the end staggers him), a
    // dodge shows which way he went.
    var big = false;
    if (now.hits > was.hits && s.mode === 'playing') {
      if (s.health <= DAMAGE) { big = true; play('hit_big'); } else play('hit');
    }
    if (now.dodge > was.dodge && s.dodge.side && !big) play(s.dodge.side === 'l' ? 'dodge_l' : 'dodge_r');
    return settle(a, s, dt, out, false);
  }

  // The entrance, timed from the fight's own clock for it.
  function arriving(a, s, was, base, play) {
    var t = s.arriveT || 0, done = a.arrived;
    function once(key, at, fn) { if (!done[key] && t >= at) { done[key] = true; fn(); } }
    if (was.phase !== 'arrive') a.arrived = done = {};
    if (a.kind === 'glider') { base('fly'); once('roar', 0, function () { play('roar'); }); }
    else if (a.kind === 'charge') {
      base('idle');
      once('entrance', 0, function () { play('entrance', { fade: 0 }); });
      once('roar', dur(a, 'entrance') - .1, function () { play('roar'); });
    } else {
      var land = ((root.Fight && root.Fight.constants.ENTRY) || 1.1) - K.DROP_LEAD;
      once('fall', 0, function () { base('descent_loop', { fade: 0 }); play('descent_start', { fade: 0 }); });
      once('land', land, function () { play('descent_end', { fade: .06 }); base('idle'); });
      once('roar', land + dur(a, 'descent_end') - .2, function () { play('roar'); });
    }
  }

  function glider(a, s, base) {
    var r = s.turnRate || 0;
    if (a.turning === 0 && Math.abs(r) > K.TURN_ON) a.turning = r > 0 ? 1 : -1;
    else if (a.turning !== 0 && (Math.abs(r) < K.TURN_OFF || r * a.turning < 0)) a.turning = 0;
    base(a.turning > 0 ? 'fly_turn_l' : a.turning < 0 ? 'fly_turn_r' : 'fly', { fade: .35 });
  }

  function charge(a, s, was, now, base, play, out) {
    var st = now.state, changed = st !== was.state || was.phase !== 'villain';
    if (st === 'run' || st === 'skid') { base('loco', { fade: .2 }); out.speed = s.m.v; }
    else { base('idle', { fade: .3 }); out.speed = 0; }
    if (!changed) return;
    if (st === 'turn') play(s.m.turn > 0 ? 'turn_l' : 'turn_r', { fade: .15 });
    else if (st === 'windup') play('attack', { fade: .15 });
    else if (st === 'skid') play('skid', { fade: .2 });
  }

  function leaper(a, s, was, now, base, play) {
    var m = s.m;
    if (now.crouch && !was.crouch) play('leap_start', { speed: K.LEAP_SPEED, fade: .08 });
    if (now.flying && !was.flying) { a.flights++; base('leap_air', { fade: .15 }); }
    if (now.flying && a.landed !== a.flights && m.dur - m.t <= K.LAND_LEAD) {
      a.landed = a.flights;
      play('land', { fade: .05 }); base('idle', { fade: .05 });
    }
    // A leap too short to catch its landing lead still ends standing.
    if (!now.flying && a.base === 'leap_air') base('idle');
  }

  // The goblin's bank and climb, eased.
  function settle(a, s, dt, out, still) {
    if (a.kind === 'glider') {
      var v = Math.hypot(s.vel.x, s.vel.z), w = still ? 0 : s.turnRate || 0;
      var bank = Math.max(-K.BANK_MAX, Math.min(K.BANK_MAX, Math.atan(v * w / K.GRAVITY) * K.BANK));
      var climb = still ? 0 : Math.max(-K.PITCH_MAX, Math.min(K.PITCH_MAX, -Math.atan2(s.vel.y, Math.max(3, v)) * K.PITCH));
      var k = 1 - Math.exp(-K.BANK_EASE * (dt || 0));
      a.roll += (-bank - a.roll) * k; a.pitch += (climb - a.pitch) * k;
    }
    out.roll = a.roll; out.pitch = a.pitch;
    return out;
  }

  // --- helpers for the render side -------------------------------------------------
  // A clip's chest yaw (its shoulder line's, relative to the model's front),
  // sampled at evenly spaced times through it: unwrapped so a turn past 180
  // degrees stays continuous, with its average, and whether the clip turns the
  // body by itself (it swings more than TURNING).
  function curve(samples, duration) {
    var s = samples.slice(), i, sx = 0, sz = 0;
    for (i = 1; i < s.length; i++) s[i] = s[i - 1] + wrap(s[i] - s[i - 1]);
    s.forEach(function (a) { sx += Math.sin(a); sz += Math.cos(a); });
    var lo = Math.min.apply(null, s), hi = Math.max.apply(null, s);
    return { duration: duration, samples: s, mean: Math.atan2(sx, sz), turning: hi - lo > K.TURNING };
  }
  // Which way the pose squares the chest: each clip in it counts with its
  // weight - its average yaw, or for a clip that turns the body, where the
  // turn has got to. Additive clips don't count.
  function bodyYaw(pose, curves) {
    var y = 0;
    (pose || []).forEach(function (p) {
      var c = curves && curves[p.clip];
      if (!c || p.additive) return;
      if (!c.turning || c.samples.length < 2) { y += p.w * c.mean; return; }
      var u = Math.max(0, Math.min(1, p.t / (c.duration || 1))) * (c.samples.length - 1), i = Math.min(c.samples.length - 2, Math.floor(u));
      y += p.w * (c.samples[i] + (c.samples[i + 1] - c.samples[i]) * (u - i));
    });
    return y;
  }
  // How far down to move a model so its lowest foot stays `ankle` above the
  // point it is placed at, while clips that lift its feet play (weighted by
  // how much of the pose they are). lowest: the lowest ankle's height above
  // the model's origin in this pose. Never raises it.
  function lift(pose, clips, lowest, ankle) {
    var w = 0;
    (pose || []).forEach(function (p) { if (!p.additive && clips.indexOf(p.clip) >= 0) w += p.w; });
    return -(Math.min(1, w) * Math.max(0, lowest - ankle)) || 0;
  }
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

  var api = { create: create, step: step, curve: curve, bodyYaw: bodyYaw, lift: lift, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.VillainAnim = api;
})(typeof window === 'undefined' ? globalThis : window);

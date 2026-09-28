(function (root) {
  'use strict';
  // Which clip each villain plays, from the state of its fight. world/fight.js
  // moves the villain; this watches what it does and says what the model
  // should play: the Goblin's flying and banking, the Rhino's entrance, wind-
  // up, run and skid, Venom's crouch, leap and landing timed to the leap's
  // real arc, and for all three the dodges, hits and defeat. No Three.js:
  // villain-view.js passes the commands to the model's CharacterRig.
  //
  // Their attacks (P4, P5): the Goblin's throw, timed so the bomb leaves his
  // hand as the wind-up ends; the Rhino's charge wind-up, run, skid past and
  // dazed stun; Venom's pounce (a roar, then the crouch), his combo's three
  // swipes and his tentacle lash - each wind-up slowed so the clip's strike
  // frame (the manifest's events) lands just as the attack does. A stagger
  // plays hit_big.
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
    GRAVITY: 9.8,
    MIN_WIND: .4                    // a wind-up is never slowed below this: it starts later instead
  };

  // events: the manifest's clip events ({ attack: { release_seconds } }), so
  // a throw's wind-up can be timed to end on its release.
  function create(kind, clips, events) {
    return { kind: kind, clips: clips || {}, events: events || {}, started: false, seen: null, base: null,
      roll: 0, pitch: 0, turning: 0, flights: 0, landed: -1, arrived: {}, attacks: 0, plan: [], staggers: 0 };
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

    // The end: beaten, or you went down and he roars over you.
    if (s.mode === 'won') { if (was.mode !== 'won') { a.base = null; play('defeat', { hold: true, fade: .1 }); } return settle(a, s, dt, out, true); }
    if (s.mode === 'lost') { if (was.mode !== 'lost') play('roar'); return settle(a, s, dt, out, true); }

    if (s.phase === 'arrive') arriving(a, s, was, base, play);
    else if (s.phase === 'villain') {
      if (a.kind === 'glider') glider(a, s, base);
      else if (a.kind === 'charge') charge(a, s, was, now, base, play, out);
      else leaper(a, s, was, now, base, play);
    }
    // Winding up a throw (P4, attacks.js): the attack clip, slowed or sped so
    // its release frame - where the bomb leaves his hand - ends the wind-up.
    // The volley (P7) starts the same way, and each bomb after the first is
    // a quick throw from just before the release; the dive's wind-up is his
    // cackle (roar), sped up to fit.
    var at = s.attack, rel = (a.events.attack && a.events.attack.release_seconds) || (a.clips.attack || 1) / 2;
    if (at && at.n > a.attacks) {
      a.attacks = at.n; a.thrown = 1;
      var tel = at.tele || (at.d && at.d.telegraph) || .9;
      if (at.phase === 'telegraph' && (at.move === 'bomb' || at.move === 'volley') && a.clips.attack) play('attack', { speed: rel / tel, fade: .12 });
      if (at.phase === 'telegraph' && at.move === 'dive' && a.clips.roar) play('roar', { speed: Math.max(1, dur(a, 'roar') / (tel + .6)), fade: .1 });
      a.plan = plan(a, at);
    }
    if (at && at.volley && at.volley.thrown > (a.thrown || 1) && a.clips.attack) {
      a.thrown = at.volley.thrown;
      play('attack', { from: Math.max(0, rel - .15), speed: 1.6, fade: .05, restart: true });
    }
    // The rest of Venom's attack clips, as the attack's clock reaches them.
    if (at && a.plan.length) {
      a.plan = a.plan.filter(function (e) {
        var phase = e.during || 'active';
        if (at.phase !== 'telegraph' && at.phase !== 'active') return false;       // called off, or over
        if (e.swipe && at.combo && e.swipe >= at.combo.n) return false;             // the combo was cut short
        if (at.clock < e.t || at.phase !== phase) return at.phase === 'telegraph' || phase === 'active';
        play(e.clip, e.opts);
        return false;
      });
    }
    // Shot at: a hit flinches (the last hit before the end staggers him), a
    // dodge shows which way he went. Laid into during a wind-up, he staggers.
    var big = false;
    if (now.hits > was.hits && s.mode === 'playing') {
      if (s.health <= DAMAGE) { big = true; play('hit_big'); } else play('hit');
    }
    if ((s.staggers || 0) > a.staggers) { a.staggers = s.staggers; if (!big) { big = true; play('hit_big', { fade: .08 }); } }
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

  // The rhino: his patrol (turn, the first wind-up, run, skid) and, off it
  // (P5), a charge's wind-up (his attack clip, sped up to fit), the run at
  // you, the skid past, the dazed stun, and trotting back.
  var MOVING = { run: 1, skid: 1, charge: 1, overrun: 1, 'return': 1 };
  function charge(a, s, was, now, base, play, out) {
    var st = now.state, changed = st !== was.state || was.phase !== 'villain';
    if (MOVING[st] || (st === 'brace' && s.m.v > .5)) { base('loco', { fade: .2 }); out.speed = s.m.v; }
    else { base('idle', { fade: .3 }); out.speed = 0; }
    if (!changed) return;
    var tel = (s.attack && (s.attack.tele || (s.attack.d && s.attack.d.telegraph))) || .9, D = s.rules || {};
    if (st === 'turn') play(s.m.turn > 0 ? 'turn_l' : 'turn_r', { fade: .15 });
    else if (st === 'windup') play('attack', { fade: .15 });
    else if (st === 'brace') play('attack', { speed: dur(a, 'attack') / tel || 1, fade: .15 });
    else if (st === 'skid' || st === 'overrun') play('skid', { fade: .2 });
    else if (st === 'stun') play('stun', { speed: dur(a, 'stun') / (D.dazed || dur(a, 'stun')) || 1, fade: .1 });
  }

  // Venom's attack clips, as { t (seconds after the wind-up began), clip,
  // opts, during: 'telegraph' (else the strike), swipe: which of a combo's }.
  // A wind-up plays its clip slowed so the strike frame comes as the wind-up
  // ends, then the clip carries on at its own speed from there.
  function plan(a, at) {
    var tel = at.tele || (at.d && at.d.telegraph) || .9, out = [], AK = (root.Attacks && root.Attacks.constants) || {};
    if (a.kind !== 'leap') return out;
    function strikeAt(c) { return (a.events[c] && a.events[c].release_seconds) || dur(a, c) / 3; }
    function windUp(c) {
      var h = strikeAt(c), v = Math.max(K.MIN_WIND, h / tel);
      out.push({ t: tel - h / v, clip: c, opts: { speed: v, fade: .12 }, during: 'telegraph' });
      out.push({ t: tel, clip: c, opts: { from: h, fade: .05 } });
    }
    if (at.move === 'combo') {
      windUp('attack');
      ['attack2', 'attack3'].forEach(function (c, i) {
        out.push({ t: tel + (i + 1) * (AK.COMBO_GAP || .65) - strikeAt(c), clip: c, opts: { fade: .08 }, swipe: i + 1 });
      });
    } else if (at.move === 'lash') windUp('tentacles');
    else if (at.move === 'pounce') {
      // He rears up and roars, then crouches: the crouch's take-off ends the wind-up.
      var crouch = (root.Fight && root.Fight.constants.CROUCH) || .23;
      out.push({ t: 0, clip: 'roar', opts: { fade: .15 }, during: 'telegraph' });
      out.push({ t: Math.max(0, tel - crouch), clip: 'leap_start', opts: { speed: K.LEAP_SPEED, fade: .08 }, during: 'telegraph' });
    }
    return out;
  }

  function leaper(a, s, was, now, base, play) {
    var m = s.m;
    if (now.crouch && !was.crouch) play('leap_start', { speed: K.LEAP_SPEED, fade: .08 });
    if (now.flying && !was.flying) { a.flights++; base('leap_air', { fade: .15 }); }
    if (now.flying && a.landed !== a.flights && m.dur - m.t <= K.LAND_LEAD) {
      a.landed = a.flights;
      // A pounce comes down hard.
      play(m.pounce && a.clips.land_heavy ? 'land_heavy' : 'land', { fade: .05 }); base('idle', { fade: .05 });
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

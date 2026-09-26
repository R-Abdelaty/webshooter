(function (root) {
  'use strict';
  // The logic behind an animated character, with no Three.js in it so the
  // tests can check it (characters.js is the Three.js side):
  //
  // - validate the model manifest (assets/models/characters.json), and check
  //   a loaded model against it;
  // - map the clip names the game asks for to the clips a model has, with
  //   fallbacks (a model with no hit_big plays hit);
  // - a small animation state machine: a base state that loops (idle, fly,
  //   or 'loco' - idle/walk/run blended by speed with their strides matched),
  //   one-shots that cross-fade in over it and hand back to it when they end,
  //   and additive clips (hit) layered on top, so a hit doesn't stop a run.
  //   It says, each frame, which clip is at which time with which weight;
  //   the render side only copies that into its AnimationMixer;
  // - weak spots and body capsules that follow bones, from bone world
  //   matrices given as plain 16-number arrays (column-major, as Three.js
  //   Matrix4.elements), and a ray test against a capsule.

  var WEAK_SPOTS = ['CHEST', 'HEAD', 'SHOULDER'];
  var STANDARD = ['idle', 'walk', 'run', 'dodge_l', 'dodge_r', 'hit', 'hit_big', 'attack', 'defeat'];
  // What to play when a model lacks a clip, best first. A missing one-shot
  // with nothing listed simply doesn't play.
  var FALLBACKS = {
    walk: ['run', 'idle'], run: ['walk', 'idle'], idle_fidget: ['idle'],
    fly: ['idle'], fly_turn_l: ['fly', 'idle'], fly_turn_r: ['fly', 'idle'],
    turn_l: ['skid'], turn_r: ['skid'],
    cling_idle: ['idle'], crawl_idle: ['idle'], crawl_move: ['walk', 'run'], descent_loop: ['leap_air'],
    leap_air: ['leap_start'], land_heavy: ['land'],
    hit_big: ['hit'], stun: ['hit_big', 'hit'], defeat: ['hit_big'],
    entrance: ['roar'], attack2: ['attack'], attack3: ['attack']
  };
  var ADDITIVE = ['hit'];
  var FADE = { base: .25, shotIn: .12, shotOut: .2, addIn: .05, addOut: .15 };
  var LOCO = 'loco';

  // --- the manifest --------------------------------------------------------------
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isStr(x) { return typeof x === 'string' && x.length > 0; }

  // Everything wrong with a manifest, as sentences; [] when it is fine.
  function validate(man) {
    var err = [];
    if (!man || typeof man !== 'object' || !man.villains || typeof man.villains !== 'object') return ['no "villains" object'];
    Object.keys(man.villains).forEach(function (id) {
      var v = man.villains[id], at = id + ': ';
      if (!v || typeof v !== 'object') { err.push(at + 'not an object'); return; }
      if (!isStr(v.file) || !/\.glb$/.test(v.file)) err.push(at + 'file must be a .glb');
      if (!isNum(v.height) || v.height <= 0) err.push(at + 'height must be a positive number of metres');
      if (v.scale !== undefined && (!isNum(v.scale) || v.scale <= 0)) err.push(at + 'scale must be positive');
      if (v.loops !== undefined && (!Array.isArray(v.loops) || !v.loops.every(isStr))) err.push(at + 'loops must be clip names');
      if (v.speeds !== undefined) {
        var s = v.speeds || {};
        if (!isNum(s.walk) || !isNum(s.run) || s.walk <= 0 || s.run <= s.walk) err.push(at + 'speeds needs walk > 0 and run > walk (m/s)');
      }
      Object.keys(v.props || {}).forEach(function (p) {
        if (!v.props[p] || !isStr(v.props[p].file) || !/\.glb$/.test(v.props[p].file)) err.push(at + 'prop ' + p + ' needs a .glb file');
      });
      Object.keys(v.events || {}).forEach(function (c) {
        var e = v.events[c];
        if (!e || !isNum(e.release_seconds) || e.release_seconds < 0) err.push(at + 'event on ' + c + ' needs release_seconds');
      });
      var names = {};
      if (!Array.isArray(v.weakSpots) || !v.weakSpots.length) err.push(at + 'weakSpots missing');
      else v.weakSpots.forEach(function (w, i) {
        var wa = at + 'weakSpots[' + i + '] ';
        if (!w || WEAK_SPOTS.indexOf(w.name) < 0) err.push(wa + 'name must be one of ' + WEAK_SPOTS.join('/'));
        else if (names[w.name]) err.push(wa + w.name + ' twice'); else names[w.name] = true;
        if (!w || !isStr(w.bone)) err.push(wa + 'needs a bone');
        if (!w || !Array.isArray(w.offset) || w.offset.length !== 3 || !w.offset.every(isNum)) err.push(wa + 'offset must be [x, y, z]');
        if (!w || !isNum(w.radius) || w.radius <= 0) err.push(wa + 'radius must be positive');
      });
      if (!Array.isArray(v.body)) err.push(at + 'body capsules missing');
      else v.body.forEach(function (c, i) {
        if (!Array.isArray(c) || c.length !== 3 || !isStr(c[0]) || !isStr(c[1]) || !isNum(c[2]) || c[2] <= 0)
          err.push(at + 'body[' + i + '] must be [boneA, boneB, radius]');
      });
    });
    return err;
  }

  // Every bone a manifest entry reads.
  function bonesOf(entry) {
    var out = [];
    (entry.weakSpots || []).forEach(function (w) { if (out.indexOf(w.bone) < 0) out.push(w.bone); });
    (entry.body || []).forEach(function (c) { [c[0], c[1]].forEach(function (b) { if (out.indexOf(b) < 0) out.push(b); }); });
    return out;
  }
  // What a loaded model is missing that its entry asks for: bones and clips.
  function check(entry, bones, clips) {
    var has = function (list, x) { return list.indexOf(x) >= 0; }, warn = [];
    bonesOf(entry).forEach(function (b) { if (!has(bones, b)) warn.push('no bone ' + b); });
    (entry.loops || []).forEach(function (c) { if (!has(clips, c)) warn.push('no loop clip ' + c); });
    Object.keys(entry.events || {}).forEach(function (c) { if (!has(clips, c)) warn.push('no clip ' + c + ' for its event'); });
    return warn;
  }

  // --- clip names ---------------------------------------------------------------
  // The clip to play for `want`, given the names a model has: itself, else the
  // first fallback it has, else null.
  function resolve(clips, want) {
    if (want === LOCO) return LOCO;
    if (clips.indexOf(want) >= 0) return want;
    var alt = FALLBACKS[want] || [];
    for (var i = 0; i < alt.length; i++) if (clips.indexOf(alt[i]) >= 0) return alt[i];
    return null;
  }
  // The standard names this model can't play even with a fallback.
  function missing(clips) {
    return STANDARD.filter(function (c) { return resolve(clips, c) === null; });
  }

  // --- the state machine --------------------------------------------------------------
  // spec: { clips: { name: seconds }, loops: [names], speeds: { walk, run }
  //   (m/s, for 'loco'), additive: [names], events: { clip: { release_seconds } },
  //   base: the first base state (default 'idle') }.
  function machine(spec) {
    var names = Object.keys(spec.clips || {});
    var m = {
      clips: spec.clips || {}, names: names,
      loops: (spec.loops || []).filter(function (c) { return names.indexOf(c) >= 0; }),
      additive: (spec.additive || ADDITIVE).slice(), speeds: spec.speeds || null,
      events: spec.events || {}, fade: spec.fade || FADE,
      slots: [], adds: [], speed: 0, phase: 0, time: 0, missing: []
    };
    var first = resolve(names, spec.base || 'idle') || names[0];
    if (first) m.slots.push(slot(m, first, 'base', 1, 1));
    return m;
  }
  function slot(m, name, kind, w, target) {
    return { name: name, kind: kind, t: 0, w: w, target: target, rate: 1 / m.fade.base,
      speed: 1, loop: isLoop(m, name), hold: false, fadeOut: m.fade.shotOut, oneShot: kind === 'shot', ended: false };
  }
  function isLoop(m, name) { return name === LOCO || m.loops.indexOf(name) >= 0; }
  function dur(m, name) { return m.clips[name] || 0; }
  function baseSlot(m) { for (var i = 0; i < m.slots.length; i++) if (m.slots[i].kind === 'base') return m.slots[i]; return null; }
  function shotSlot(m) { for (var i = 0; i < m.slots.length; i++) if (m.slots[i].kind === 'shot') return m.slots[i]; return null; }
  function fadeOut(s, time) { s.kind = 'out'; s.target = 0; s.rate = 1 / Math.max(1e-3, time); }

  // Ask for a clip. A loop (or 'loco', or opts.loop) becomes the base state;
  // an additive clip is layered on top; anything else is a one-shot that
  // cross-fades in over the base and hands back to it at its end - or holds
  // its last frame (opts.hold, for defeat). opts: { speed, fade, hold, loop,
  // restart }. Returns the clip actually used, or null if there is none.
  function play(m, want, opts) {
    opts = opts || {};
    var name = resolve(m.names, want);
    if (!name) { if (m.missing.indexOf(want) < 0) m.missing.push(want); return null; }
    var shot = shotSlot(m), base = baseSlot(m);
    if (name !== LOCO && m.additive.indexOf(name) >= 0 && !opts.loop) {
      m.adds = m.adds.filter(function (a) { return a.name !== name; });
      m.adds.push({ name: name, t: 0, speed: opts.speed || 1 });
      return name;
    }
    if (opts.loop || isLoop(m, name)) {
      var f = opts.fade !== undefined ? opts.fade : m.fade.base;
      // A new base state ends a held one-shot (getting up after a defeat).
      if (shot && shot.hold) { fadeOut(shot, f); shot.ended = true; shot = null; if (base) { base.target = 1; base.rate = 1 / Math.max(1e-3, f); } }
      if (base && base.name === name && !opts.restart) { base.speed = opts.speed || 1; return name; }
      if (base) fadeOut(base, f);
      // Coming back to a clip that is still fading out picks it up where it is.
      var back = m.slots.filter(function (s) { return s.kind === 'out' && s.name === name; })[0];
      var s = back || slot(m, name, 'base', 0, 0);
      if (!back) m.slots.push(s);
      s.kind = 'base'; s.loop = true; s.speed = opts.speed || 1;
      if (opts.restart) s.t = 0;
      s.target = shot ? 0 : 1; s.rate = 1 / Math.max(1e-3, f);
      if (!(f > 0)) { s.w = s.target; m.slots.forEach(function (o) { if (o.kind === 'out') o.w = 0; }); }
      return name;
    }
    // A one-shot: it replaces any one-shot playing, and the base waits under it.
    var fin = opts.fade !== undefined ? opts.fade : m.fade.shotIn;
    // An interrupted one-shot never reports its end.
    if (shot) { fadeOut(shot, fin); shot.ended = true; }
    var n = slot(m, name, 'shot', 0, 1);
    n.rate = 1 / Math.max(1e-3, fin); n.speed = opts.speed || 1; n.hold = !!opts.hold; n.loop = false;
    if (!(fin > 0)) n.w = 1;
    m.slots.push(n);
    if (base) { base.target = 0; base.rate = n.rate; }
    return name;
  }

  // Walking speed for 'loco', in m/s.
  function setSpeed(m, v) { m.speed = Math.max(0, v || 0); }

  // How idle, walk and run mix at a speed, and how fast the stride cycle
  // turns (cycles per second) so the feet keep up with the ground.
  function locoBlend(m, v) {
    var hasW = m.clips.walk > 0, hasR = m.clips.run > 0, S = m.speeds || { walk: 1.5, run: 5 };
    var walk = hasW ? 'walk' : (hasR ? 'run' : null), run = hasR ? 'run' : walk;
    var out = { idle: 0, walk: 0, run: 0, cps: 0, walkClip: walk, runClip: run };
    if (!walk || v <= .05) { out.idle = 1; return out; }
    var wd = dur(m, walk), rd = dur(m, run);
    if (v < S.walk) {
      var a = v / S.walk;
      out.idle = 1 - a; out.walk = a;
      out.cps = Math.max(.5, a) / wd;
    } else if (v < S.run) {
      var k = (v - S.walk) / (S.run - S.walk);
      out.walk = 1 - k; out.run = k;
      out.cps = (1 - k) / wd + k / rd;
    } else {
      out.run = 1;
      out.cps = Math.min(1.6, v / S.run) / rd;
    }
    if (walk === run) { out.walk += out.run; out.run = 0; }
    return out;
  }

  // Advance by dt seconds. Returns what happened: [{ type: 'end', clip }]
  // when a one-shot finishes, [{ type: 'release', clip }] at an event time.
  function step(m, dt) {
    var ev = [];
    m.time += dt;
    var base = baseSlot(m);
    m.slots.forEach(function (s) {
      var d = s.name === LOCO ? 0 : dur(m, s.name), t0 = s.t;
      if (s.name === LOCO) { s.t += dt; }
      else if (s.loop) { s.t = d > 0 ? (s.t + dt * s.speed) % d : 0; }
      else {
        s.t = Math.min(d, s.t + dt * s.speed);
        var e = m.events[s.name];
        if (s.oneShot && !s.ended && e && t0 < e.release_seconds && s.t >= e.release_seconds) ev.push({ type: 'release', clip: s.name });
        if (s.oneShot && !s.ended && s.t >= d) { s.ended = true; ev.push({ type: 'end', clip: s.name }); }
        // Hand back to the base in time for the shot's last frame.
        if (s.kind === 'shot' && !s.hold && s.t >= d - s.fadeOut) {
          fadeOut(s, s.fadeOut);
          if (base) { base.target = 1; base.rate = 1 / s.fadeOut; }
        }
      }
      var dw = s.rate * dt;
      s.w = s.w < s.target ? Math.min(s.target, s.w + dw) : Math.max(s.target, s.w - dw);
    });
    // A faded one-shot stays until its last frame, so its end is still reported.
    m.slots = m.slots.filter(function (s) { return !(s.kind === 'out' && s.w <= 0 && (!s.oneShot || s.ended)); });
    if (!shotSlot(m) && base && base.target < 1) { base.target = 1; base.rate = 1 / m.fade.shotOut; }
    m.phase = (m.phase + locoBlend(m, m.speed).cps * dt) % 1;
    m.adds = m.adds.filter(function (a) { a.t += dt * a.speed; return a.t < dur(m, a.name); });
    return ev;
  }

  // Which clip is at which time with which weight, for the render side:
  // [{ clip, t, w, additive }]. The non-additive weights add up to 1, so no
  // rest pose bleeds through a cross-fade.
  function pose(m) {
    var list = [], sum = 0;
    function add(clip, t, w) {
      if (!clip || !(w > 1e-4)) return;
      for (var i = 0; i < list.length; i++) if (list[i].clip === clip) {
        // The same clip in two slots: one action, one time - the stronger's.
        if (w > list[i].w) list[i].t = t;
        list[i].w += w; sum += w; return;
      }
      list.push({ clip: clip, t: t, w: w, additive: false }); sum += w;
    }
    m.slots.forEach(function (s) {
      if (s.name !== LOCO) { add(s.name, s.t, s.w); return; }
      var b = locoBlend(m, m.speed);
      add(resolve(m.names, 'idle'), s.t % Math.max(1e-6, dur(m, resolve(m.names, 'idle')) || 1), s.w * b.idle);
      add(b.walkClip, m.phase * dur(m, b.walkClip), s.w * b.walk);
      add(b.runClip, m.phase * dur(m, b.runClip), s.w * b.run);
    });
    if (sum > 0) list.forEach(function (p) { p.w /= sum; });
    m.adds.forEach(function (a) {
      var d = dur(m, a.name), w = Math.min(1, a.t / m.fade.addIn, (d - a.t) / m.fade.addOut);
      if (w > 1e-4) list.push({ clip: a.name, t: a.t, w: Math.max(0, w), additive: true });
    });
    return list;
  }

  // The state in words, for the viewer and the tests.
  function state(m) {
    var b = baseSlot(m), s = shotSlot(m);
    return { base: b ? b.name : null, shot: s ? s.name : null, additive: m.adds.map(function (a) { return a.name; }) };
  }

  // How often a character's pose needs working out: every frame near and in
  // view, less often far away or off screen. Returns a frame interval.
  function updateEvery(distance, onScreen) {
    if (!onScreen) return 4;
    return distance < 40 ? 1 : distance < 90 ? 2 : 3;
  }

  // --- bones -> weak spots and capsules ------------------------------------------------
  function origin(e) { return { x: e[12], y: e[13], z: e[14] }; }
  function axis(e, i) {
    var x = e[i], y = e[i + 1], z = e[i + 2], l = Math.sqrt(x * x + y * y + z * z) || 1;
    return { x: x / l, y: y / l, z: z / l };
  }
  // A point `offset` metres from a bone, along the bone's own axes (its
  // rotation only: a scaled model's offsets and radii stay in metres).
  function pointOn(e, offset) {
    var o = origin(e), X = axis(e, 0), Y = axis(e, 4), Z = axis(e, 8), a = offset || [0, 0, 0];
    return { x: o.x + X.x * a[0] + Y.x * a[1] + Z.x * a[2],
      y: o.y + X.y * a[0] + Y.y * a[1] + Z.y * a[2],
      z: o.z + X.z * a[0] + Y.z * a[1] + Z.z * a[2] };
  }
  // The weak spots and capsules of one manifest entry, from matrixOf(bone) ->
  // a 16-number world matrix (or null if the model has no such bone):
  // { spots: [{ name, x, y, z, r }], capsules: [{ a, b, r }] } - plain data.
  function sample(entry, matrixOf) {
    var spots = [], capsules = [];
    (entry.weakSpots || []).forEach(function (w) {
      var e = matrixOf(w.bone);
      if (!e) return;
      var p = pointOn(e, w.offset);
      spots.push({ name: w.name, x: p.x, y: p.y, z: p.z, r: w.radius });
    });
    (entry.body || []).forEach(function (c) {
      var a = matrixOf(c[0]), b = matrixOf(c[1]);
      if (a && b) capsules.push({ a: origin(a), b: origin(b), r: c[2] });
    });
    return { spots: spots, capsules: capsules };
  }

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  // Where a ray (unit dir) first enters a capsule, as a distance, or null.
  function rayCapsule(o, d, cap) {
    var ba = sub(cap.b, cap.a), oa = sub(o, cap.a), r = cap.r;
    var baba = dot(ba, ba), bard = dot(ba, d), baoa = dot(ba, oa), rdoa = dot(d, oa), oaoa = dot(oa, oa);
    if (baba < 1e-12) return raySphere(o, d, cap.a, r);
    var a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
    var h = b * b - a * c;
    if (a > 1e-12 && h >= 0) {
      var t = (-b - Math.sqrt(h)) / a, y = baoa + t * bard;
      if (y > 0 && y < baba) return t >= 0 ? t : (inside(o, cap) ? 0 : null);
    }
    // The ends: the sphere at whichever end the ray meets first.
    var ta = raySphere(o, d, cap.a, r), tb = raySphere(o, d, cap.b, r);
    if (ta === null) return tb; if (tb === null) return ta;
    return Math.min(ta, tb);
  }
  function raySphere(o, d, c, r) {
    var oc = sub(o, c), b = dot(oc, d), cc = dot(oc, oc) - r * r, h = b * b - cc;
    if (h < 0) return null;
    var t = -b - Math.sqrt(h);
    if (t >= 0) return t;
    return cc <= 0 ? 0 : null;              // starting inside counts as a hit at 0
  }
  function inside(p, cap) {
    var ba = sub(cap.b, cap.a), pa = sub(p, cap.a), k = Math.max(0, Math.min(1, dot(pa, ba) / (dot(ba, ba) || 1)));
    var q = sub(pa, { x: ba.x * k, y: ba.y * k, z: ba.z * k });
    return dot(q, q) <= cap.r * cap.r;
  }

  var api = {
    WEAK_SPOTS: WEAK_SPOTS, STANDARD: STANDARD, FALLBACKS: FALLBACKS, ADDITIVE: ADDITIVE, FADE: FADE, LOCO: LOCO,
    validate: validate, bonesOf: bonesOf, check: check, resolve: resolve, missing: missing,
    machine: machine, play: play, setSpeed: setSpeed, step: step, pose: pose, state: state, locoBlend: locoBlend,
    updateEvery: updateEvery, pointOn: pointOn, sample: sample, rayCapsule: rayCapsule
  };
  if (typeof module !== 'undefined') module.exports = api;
  root.Rig = api;
})(typeof window === 'undefined' ? globalThis : window);

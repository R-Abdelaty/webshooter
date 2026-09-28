(function (root) {
  'use strict';
  // Where the camera is (docs/PLAYER_PLAN.md, Session P2). No Three.js.
  //
  // FIRST PERSON: at Player's eye, with a small bob as you run and a dip
  // when you land (CAMERA MOTION: REDUCED takes them out).
  // THIRD PERSON: over the right shoulder, BACK metres behind and UP above
  // a pivot at the player's neck, turning with the view - pulled in when
  // the city is in the way, so there is never a wall between the camera
  // and the player. The pull-in tests the city's collision boxes directly
  // (City.query), a few rays around the camera's line, not world.raycast:
  // that walks every instanced building and costs milliseconds a ray. It
  // comes in at once (a wall must never show) and eases back out.
  //
  // Aim is the same in both: the ray through the crosshair from wherever
  // the camera is (Look.ray). Yaw and pitch are Player's (yaw 0 looks north,
  // -z, and positive turns left; pitch positive looks up).

  var CityRef = root.City || (typeof require === 'function' ? require('./city.js') : null);

  var K = {
    BACK: 3.5, UP: .6, SIDE: .55,  // metres: behind, above and to the right of the pivot
    PIVOT: 1.5,                    // the pivot's height above the feet (the neck)
    NEAR: .45,                     // the boom never gets shorter than this
    PAD: .3,                       // ...and stops this far short of what it meets
    PROBE: .22,                    // the rays run this far round the camera's line (the near plane's corners)
    OUT: 3,                        // how fast it eases back out, per second
    HIDE: .7,                      // closer than this to the pivot, the body is hidden (you'd be inside it)
    // First person, FULL. REDUCED is none of it.
    BOB: .022, BOB_SIDE: .012,     // metres of bob at a run, up and down / side to side
    BOB_V: 3,                      // m/s: the bob fades in up to this speed
    DIP: .09, DIP_T: .28,          // a landing's dip, metres, and how long it lasts
    CROUCH: .55, CROUCH_T: 6,      // a perch lowers the eye this far, easing at this rate a second
    // Swinging (P3). Third person: the camera trails the direction of travel
    // by LAG seconds of your velocity (at most LAG_MAX metres) and rises
    // LAG_UP at speed, easing at LAG_EASE a second.
    LAG: .1, LAG_MAX: 2.2, LAG_UP: .8, LAG_EASE: 3,
    // The comfort-capped effects (swingFx): a wider view with speed, from
    // KICK_V to KICK_V1 m/s, at most KICK degrees; first person also rolls
    // into the arc, at most ROLL radians, and shows speed lines from LINES_V.
    // REDUCED halves the kick and has no roll and no lines. Never a flip.
    KICK: 10, KICK_V: 12, KICK_V1: 34, ROLL: .07, ROLL_V: 12, LINES_V: [18, 34], FX_EASE: 4,
    // Being hit (P4): a shake of SHAKE_PER radians a point of damage, at
    // most SHAKE_MAX, settling over SHAKE_T s (REDUCED halves it); the red
    // vignette fades over VIGNETTE_T, and a LOW_TINT of it stays below LOW_HP.
    SHAKE_PER: .0009, SHAKE_MAX: .022, SHAKE_T: .3, VIGNETTE_T: .8, LOW_HP: .3, LOW_TINT: .35,
    // Going down: over SLUMP_T s the eye sinks SLUMP_DROP m, tips SLUMP_PITCH
    // radians down and leans SLUMP_ROLL.
    SLUMP_T: 1.2, SLUMP_DROP: 1.15, SLUMP_PITCH: .45, SLUMP_ROLL: .12
  };

  var DEFAULTS = { camera: 'first', cameraMotion: 'full' };
  // The two settings, cleaned: anything unknown is the default.
  function settings(raw) {
    raw = raw || {};
    return { camera: raw.camera === 'third' ? 'third' : 'first', cameraMotion: raw.cameraMotion === 'reduced' ? 'reduced' : 'full' };
  }
  // Save them into the stored settings (ws.settings.v2), keeping everything
  // else there. storage: localStorage, or anything with getItem/setItem.
  var KEY = 'ws.settings.v2';
  function load(storage) {
    try { return settings(JSON.parse(storage.getItem(KEY) || '{}')); } catch (_) { return settings(null); }
  }
  function save(storage, s) {
    var all = {};
    try { all = JSON.parse(storage.getItem(KEY) || '{}') || {}; } catch (_) {}
    var c = settings(Object.assign({}, all, s));
    all.camera = c.camera; all.cameraMotion = c.cameraMotion;
    try { storage.setItem(KEY, JSON.stringify(all)); } catch (_) {}
    return c;
  }

  function add(a, b, k) { return { x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k }; }
  // The view's axes for a yaw and pitch (as on the Three.js camera, YXZ).
  function axes(yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return {
      fwd: { x: -sy * cp, y: sp, z: -cy * cp },
      up: { x: sy * sp, y: cp, z: cy * sp },
      right: { x: cy, y: 0, z: -sy }
    };
  }
  function pivot(p) { return { x: p.x, y: p.y + K.PIVOT, z: p.z }; }
  // Where the boom wants the camera, from the pivot: a unit direction and a length.
  function boom(yaw, pitch) {
    var a = axes(yaw, pitch);
    var v = { x: -a.fwd.x * K.BACK + a.up.x * K.UP + a.right.x * K.SIDE,
      y: -a.fwd.y * K.BACK + a.up.y * K.UP, z: -a.fwd.z * K.BACK + a.up.z * K.UP + a.right.z * K.SIDE };
    var l = Math.hypot(v.x, v.y, v.z);
    return { dir: { x: v.x / l, y: v.y / l, z: v.z / l }, len: l, axes: a };
  }

  // Where a ray (unit d) first meets a box { x0..x1, y0..y1, z0..z1 }, as a
  // distance within [0, far], or null. A ray starting inside is null: that
  // box is the one the player stands against, not one in the way.
  function rayBox(o, d, b, far) {
    var t0 = 0, t1 = far, lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    var inside = true;
    for (var i = 0; i < 3; i++) {
      if (oo[i] < lo[i] || oo[i] > hi[i]) inside = false;
      if (Math.abs(dd[i]) < 1e-12) { if (oo[i] < lo[i] || oo[i] > hi[i]) return null; continue; }
      var a = (lo[i] - oo[i]) / dd[i], c = (hi[i] - oo[i]) / dd[i];
      if (a > c) { var t = a; a = c; c = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) return null;
    }
    return inside ? null : t0;
  }
  // The first of the city's boxes, or the street (y = 0), along a ray.
  function cast(city, o, d, far) {
    var best = d.y < -1e-9 && o.y > 0 ? -o.y / d.y : Infinity;
    var e = { x: o.x + d.x * far, z: o.z + d.z * far };
    var boxes = city ? CityRef.query(city, Math.min(o.x, e.x) - .5, Math.min(o.z, e.z) - .5, Math.max(o.x, e.x) + .5, Math.max(o.z, e.z) + .5) : [];
    for (var i = 0; i < boxes.length; i++) {
      var t = rayBox(o, d, boxes[i], Math.min(far, best));
      if (t !== null && t < best) best = t;
    }
    return best <= far ? best : null;
  }

  // How long the boom can be: the shortest of the rays from round the pivot
  // out along the boom (its line, and PROBE to each side and above and
  // below it), less PAD; never shorter than NEAR, never longer than wanted.
  // hits: those rays' distances (null for a clear ray).
  function allowed(len, hits) {
    var m = len;
    (hits || []).forEach(function (h) { if (h !== null && h !== undefined && isFinite(h)) m = Math.min(m, h - K.PAD); });
    return Math.max(K.NEAR, Math.min(len, m));
  }
  function probes(o, b) {
    var r = b.axes.right, u = b.axes.up, k = K.PROBE;
    return [o, add(o, r, k), add(o, r, -k), add(o, u, k), add(o, u, -k)];
  }
  // Eased: in at once, out at OUT per second.
  function ease(cur, target, dt) {
    if (cur === null || cur === undefined || target <= cur) return target;
    return cur + (target - cur) * (1 - Math.exp(-K.OUT * (dt > 0 ? dt : 0)));
  }

  // The third-person camera, one frame. s: a state from create(); p: Player.
  // Returns { eye, dist, hide } - hide when it's too close to show the body.
  function create() { return { dist: null, bobT: 0, dip: 0, crouch: 0, lag: { x: 0, y: 0, z: 0 }, kick: 0, roll: 0, lines: 0 }; }
  // opts.moving: swinging, flying or zipping - the camera trails you; its
  // offset from the boom eases back when you stop.
  function third(s, p, city, dt, opts) {
    var o = pivot(p), b = boom(p.yaw, p.pitch), want = { x: 0, y: 0, z: 0 };
    if (opts && opts.moving) {
      var v = Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0), k = Math.min(1, v * K.LAG / K.LAG_MAX);
      var m = v > 1e-6 ? K.LAG_MAX * k / v : 0;
      want = { x: -(p.vx || 0) * m, y: -(p.vy || 0) * m + K.LAG_UP * k, z: -(p.vz || 0) * m };
    }
    if (!s.lag) s.lag = { x: 0, y: 0, z: 0 };
    var e = 1 - Math.exp(-K.LAG_EASE * (dt > 0 ? dt : 0));
    s.lag.x += (want.x - s.lag.x) * e; s.lag.y += (want.y - s.lag.y) * e; s.lag.z += (want.z - s.lag.z) * e;
    // The boom with the trail added, then pulled in off the city as before.
    var w = add(add({ x: 0, y: 0, z: 0 }, b.dir, b.len), s.lag, 1), l = Math.hypot(w.x, w.y, w.z) || 1e-6;
    var line = { dir: { x: w.x / l, y: w.y / l, z: w.z / l }, len: l, axes: b.axes };
    var hits = probes(o, line).map(function (q) { return cast(city, q, line.dir, line.len + K.PAD); });
    s.dist = ease(s.dist, allowed(line.len, hits), dt);
    return { eye: add(o, line.dir, s.dist), dist: s.dist, hide: s.dist < K.HIDE };
  }

  // The swing's comfort-capped camera effects, eased, one frame. o: {
  //   speed (m/s), swinging (on a line), lateral (-1..1: how far to the
  //   right of the view the line pulls), first (first person) }; motion:
  //   'full' | 'reduced'. Returns { fov (degrees to add), roll (radians, as
  //   the camera's rotation.z: negative leans right), lines (0..1) }.
  function swingFx(s, o, dt, motion) {
    o = o || {};
    var reduced = motion === 'reduced', v = o.speed || 0;
    var k = sstep(K.KICK_V, K.KICK_V1, v) * K.KICK * (reduced ? .5 : 1);
    var r = reduced || !o.first || !o.swinging ? 0 : -K.ROLL * Math.max(-1, Math.min(1, o.lateral || 0)) * Math.min(1, v / K.ROLL_V);
    var n = reduced || !o.first ? 0 : sstep(K.LINES_V[0], K.LINES_V[1], v);
    var e = 1 - Math.exp(-K.FX_EASE * (dt > 0 ? dt : 0));
    s.kick = (s.kick || 0) + (k - (s.kick || 0)) * e;
    s.roll = (s.roll || 0) + (r - (s.roll || 0)) * e;
    s.lines = (s.lines || 0) + (n - (s.lines || 0)) * e;
    return { fov: Math.min(K.KICK, s.kick), roll: Math.max(-K.ROLL, Math.min(K.ROLL, s.roll)), lines: Math.min(1, s.lines) };
  }
  function sstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  // First person: the eye, bobbing with the stride and dipping on a landing.
  // p: Player; eye: Player.eye(p); landed: this frame touched down hard;
  // motion: 'full' or 'reduced'.
  // crouch: perched (the eye comes down, in either motion setting).
  function first(s, p, eye, dt, landed, motion, crouch) {
    dt = dt > 0 ? dt : 0;
    s.crouch = (s.crouch || 0) + ((crouch ? 1 : 0) - (s.crouch || 0)) * (1 - Math.exp(-K.CROUCH_T * dt));
    eye = { x: eye.x, y: eye.y - K.CROUCH * s.crouch, z: eye.z };
    if (landed) s.dip = K.DIP_T;
    s.dip = Math.max(0, s.dip - dt);
    var v = p.grounded ? Math.hypot(p.vx || 0, p.vz || 0) : 0;
    s.bobT += dt * Math.max(0, v) / 2.6;          // a stride about every 2.6 m
    if (motion === 'reduced') return { x: eye.x, y: eye.y, z: eye.z };
    var k = Math.min(1, v / K.BOB_V), ph = s.bobT * Math.PI * 2, r = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
    var up = -Math.abs(Math.sin(ph)) * K.BOB * k, side = Math.sin(ph) * K.BOB_SIDE * k;
    var dip = s.dip > 0 ? -K.DIP * Math.sin(Math.PI * (1 - s.dip / K.DIP_T)) : 0;
    return { x: eye.x + r.x * side, y: eye.y + up + dip, z: eye.z + r.z * side };
  }

  // --- being hit, and going down (P4) ------------------------------------------------
  // A hit's shake: radians, by damage (a heavy hit shakes most), never more
  // than SHAKE_MAX, halved by REDUCED; it settles over SHAKE_T.
  function hurtShake(damage, motion) {
    var a = Math.min(K.SHAKE_MAX, K.SHAKE_PER * Math.max(0, damage || 0));
    return { amp: motion === 'reduced' ? a * .5 : a, ms: K.SHAKE_T * 1000 };
  }
  // The red at the edges of the view: its strength (0..1) `t` seconds after a
  // hit of `damage`, fading over VIGNETTE_T, plus a steady tinge while your
  // health is low (frac: what's left, 0..1).
  function vignette(damage, t, frac) {
    var hit = t >= 0 && t < K.VIGNETTE_T ? Math.min(1, .35 + (damage || 0) / 40) * (1 - t / K.VIGNETTE_T) : 0;
    var low = frac < K.LOW_HP ? K.LOW_TINT * (1 - frac / K.LOW_HP) : 0;
    return Math.min(1, Math.max(hit, low));
  }
  // Going down: `t` seconds after the killing hit the view sinks toward the
  // ground and tips down, with a slight lean - eased, once, never a spin.
  // Third person just tips the boom down a little. Returns { drop (metres
  // off the eye), pitch (radians to add, down is negative), roll }: all
  // nothing while t is null (not gone down this life).
  function slump(t, third) {
    if (t === null || t === undefined) return { drop: 0, pitch: 0, roll: 0 };
    var u = sstep(0, K.SLUMP_T, t > 0 ? t : 0);
    if (third) return { drop: 0, pitch: -K.SLUMP_PITCH * .4 * u, roll: 0 };
    return { drop: K.SLUMP_DROP * u, pitch: -K.SLUMP_PITCH * u, roll: K.SLUMP_ROLL * u };
  }

  var api = { settings: settings, load: load, save: save, KEY: KEY, DEFAULTS: DEFAULTS, axes: axes, pivot: pivot, boom: boom,
    rayBox: rayBox, cast: cast, allowed: allowed, ease: ease, create: create, third: third, first: first, swingFx: swingFx,
    hurtShake: hurtShake, vignette: vignette, slump: slump, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.PlayerCamera = api;
})(typeof window === 'undefined' ? globalThis : window);

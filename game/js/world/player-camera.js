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
    DIP: .09, DIP_T: .28           // a landing's dip, metres, and how long it lasts
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
  function create() { return { dist: null, bobT: 0, dip: 0 }; }
  function third(s, p, city, dt) {
    var o = pivot(p), b = boom(p.yaw, p.pitch);
    var hits = probes(o, b).map(function (q) { return cast(city, q, b.dir, b.len + K.PAD); });
    s.dist = ease(s.dist, allowed(b.len, hits), dt);
    return { eye: add(o, b.dir, s.dist), dist: s.dist, hide: s.dist < K.HIDE };
  }

  // First person: the eye, bobbing with the stride and dipping on a landing.
  // p: Player; eye: Player.eye(p); landed: this frame touched down hard;
  // motion: 'full' or 'reduced'.
  function first(s, p, eye, dt, landed, motion) {
    dt = dt > 0 ? dt : 0;
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

  var api = { settings: settings, load: load, save: save, KEY: KEY, DEFAULTS: DEFAULTS, axes: axes, pivot: pivot, boom: boom,
    rayBox: rayBox, cast: cast, allowed: allowed, ease: ease, create: create, third: third, first: first, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.PlayerCamera = api;
})(typeof window === 'undefined' ? globalThis : window);

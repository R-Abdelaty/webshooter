(function (root) {
  'use strict';
  // A web shot in flight, as geometry (no Three.js; web-lines.js draws it).
  // It is shot, not held: it leaves the wrist at the snap (from, where the
  // wrist was then) and is free of the hand after that.
  //
  // A web isn't one bright line. It's a bundle of fine, translucent,
  // grey-white fibres, tight at the wrist, that fans out as it goes and
  // meets its target splayed. It leaves the shooter at the snap of the
  // hand, flies out fast (sagging a little while it's in the air), lands
  // taut, holds a moment and fades.
  //
  //   var s = WebShot.shot({ from, to, launch })   launch: ms (performance.now)
  //     -> { launch, arrive, done, len, strands: [...] }
  //   WebShot.state(s, now)  -> { tip (0..1 of the way out), taut (0..1), k (fade) } or null
  //   WebShot.build(s, from, to, now, eye, pxPerM, out)  fills out.pos (xyz),
  //     out.col (rgba) and out.uv for every strand as a ribbon facing the eye;
  //     returns false when there is nothing to draw. The index order is
  //     WebShot.indices().
  //   WebShot.snap(camera)  seconds from the flick to the snap of the hand
  //     ('first' or 'third'), from the clips PlayerAnim plays.

  var PA = root.PlayerAnim || (typeof require === 'function' ? require('./player-anim.js') : null);

  var K = {
    STRANDS: 15, SEGS: 16,        // fibres in the bundle, and segments along each
    HAZE: 3,                      // ...of which these are faint wide films between them
    SPEED: 280,                   // m/s it flies out at...
    TRAVEL: [.05, .15],           // ...but never quicker or slower than this, seconds
    HOLD: .12, FADE: .25,         // taut for this long once it lands, then gone over this
    SPREAD0: .012,                // metres: the bundle's radius at the wrist
    SPREAD_PER_M: .06,            // ...and at the far end, per metre of length,
    SPREAD1: [.06, .5],           // held within this
    FAN: 1.7,                     // how late it fans out (a higher power stays tight longer)
    WIDTH: [.004, .01],           // a fibre's width, metres...
    CORE: 1.8,                    // ...the core fibre this many times the widest
    MIN_PX: 1.3,                  // ...but never thinner on screen than this many pixels
    HAZE_W: .7, HAZE_ALPHA: .13,  // a film's width, as a share of the fan's spread there, and how see-through
    SAG: .035,                    // of the length, as it flies (none once it's taut)
    WAVE: .18,                    // each fibre's wander, as a share of the spread there
    COLOR: [.86, .88, .9], ALPHA: .62, CORE_ALPHA: .95,
    GLINT: .35                    // how bright the light running along it gets
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

  // Seconds from the flick to the snap, when the web leaves: the shooting
  // clip's event, from where PlayerAnim starts it, at its speed.
  function snap(camera) {
    var A = PA.constants;
    if (camera === 'third') return Math.max(0, (A.SHOOT_SNAP - A.SHOOT.from) / A.SHOOT.speed);
    return Math.max(0, (A.FP_SNAP - A.FP_SHOOT.from) / A.FP_SHOOT.speed);
  }
  function travel(len) { return clamp(len / K.SPEED, K.TRAVEL[0], K.TRAVEL[1]); }

  function shot(o) {
    var len = dist(o.from, o.to), r = rnd(o.seed === undefined ? Math.floor(Math.random() * 1e9) : o.seed), strands = [];
    for (var i = 0; i < K.STRANDS; i++) {
      var core = i === 0, haze = i > 0 && i <= K.HAZE;
      strands.push({ haze: haze, hw: K.HAZE_W * (.6 + .4 * r()),
        a: r() * Math.PI * 2,                          // which way round the bundle it sits
        r: core ? 0 : .3 + .7 * Math.sqrt(r()),        // how far out it fans
        w: core ? K.WIDTH[1] * K.CORE : K.WIDTH[0] + r() * (K.WIDTH[1] - K.WIDTH[0]),
        alpha: core ? K.CORE_ALPHA : haze ? K.HAZE_ALPHA : K.ALPHA * (.55 + .45 * r()),
        phase: r() * Math.PI * 2, waves: 1 + r() * 2.5, glint: r() * Math.PI * 2
      });
    }
    var arrive = o.launch + travel(len) * 1000;
    return { launch: o.launch, arrive: arrive, done: arrive + (K.HOLD + K.FADE) * 1000, len: len, strands: strands };
  }

  function state(s, now) {
    if (now < s.launch || now >= s.done) return null;
    var fly = Math.max(1e-3, s.arrive - s.launch), tip = clamp((now - s.launch) / fly, 0, 1);
    var after = (now - s.arrive) / 1000, k = after <= K.HOLD ? 1 : clamp(1 - (after - K.HOLD) / K.FADE, 0, 1);
    // It snaps taut over the moment it lands; then its tail, let go at the
    // wrist, reels in to where it landed as it fades.
    var taut = clamp((now - s.arrive) / 60 + 1, 0, 1);
    var tail = after <= 0 ? 0 : Math.pow(clamp(after / (K.HOLD + K.FADE), 0, 1), 1.4);
    return { tip: 1 - Math.pow(1 - tip, 1.6), taut: taut, k: k, tail: tail };
  }

  // Two axes square to a direction.
  function across(d) {
    var up = Math.abs(d.y) > .95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    var b1 = norm(cross(d, up)), b2 = cross(b1, d);
    return [b1, b2];
  }
  function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
  function norm(a) { var l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }

  // Where fibre `f` is at u (0 at the wrist, 1 at the target) on a web from
  // `from` to `to`, `taut` (0 flying, 1 landed) of the way to straight.
  function spread(s, u) {
    var S1 = clamp(s.len * K.SPREAD_PER_M, K.SPREAD1[0], K.SPREAD1[1]);
    return K.SPREAD0 + (S1 - K.SPREAD0) * Math.pow(u, K.FAN);
  }
  function point(s, f, from, to, u, taut, ax) {
    var d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    ax = ax || across(norm(d));
    var sp = spread(s, u);
    var wob = f.r ? K.WAVE * Math.sin(f.phase + u * f.waves * Math.PI * 2) * (1 - .6 * taut) : 0;
    var c = Math.cos(f.a) * f.r * sp + wob * sp, e = Math.sin(f.a) * f.r * sp;
    var sag = -K.SAG * s.len * Math.sin(Math.PI * u) * (1 - taut);
    return { x: from.x + d.x * u + ax[0].x * c + ax[1].x * e, y: from.y + d.y * u + ax[0].y * c + ax[1].y * e + sag, z: from.z + d.z * u + ax[0].z * c + ax[1].z * e };
  }

  function indices() {
    var out = [], per = (K.SEGS + 1) * 2;
    for (var f = 0; f < K.STRANDS; f++) for (var i = 0; i < K.SEGS; i++) {
      var a = f * per + i * 2;
      out.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    return out;
  }
  function size() { return K.STRANDS * (K.SEGS + 1) * 2; }

  // Each fibre as a ribbon turned to face the eye. pxPerM: metres a pixel
  // covers at one metre from the eye (so fibres far off stay visible).
  function build(s, from, to, now, eye, pxPerM, out) {
    var st = state(s, now);
    if (!st || !from || !to) return false;
    var d = norm({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }), ax = across(d), v = 0;
    var pos = out.pos, col = out.col, uv = out.uv, t = now / 1000;
    s.strands.forEach(function (f) {
      var prev = null;
      for (var i = 0; i <= K.SEGS; i++) {
        var u = st.tail + (st.tip - st.tail) * i / K.SEGS, p = point(s, f, from, to, u, st.taut, ax);
        var q = i < K.SEGS ? point(s, f, from, to, st.tail + (st.tip - st.tail) * (i + 1) / K.SEGS, st.taut, ax) : null;
        var tg = norm(q ? { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z } : { x: p.x - prev.x, y: p.y - prev.y, z: p.z - prev.z });
        var view = norm({ x: eye.x - p.x, y: eye.y - p.y, z: eye.z - p.z }), side = norm(cross(tg, view));
        var w = Math.max(f.haze ? spread(s, u) * f.hw : f.w, K.MIN_PX * pxPerM * dist(eye, p)) / 2;
        var a = f.alpha * st.k * (u < .02 ? u / .02 : 1) * (1 - .45 * Math.pow(u, 3)) * (i === 0 && st.tail > 0 ? .3 : 1);
        var g = 1 + K.GLINT * Math.pow(Math.max(0, Math.sin(u * 14 - t * 9 + f.glint)), 12);
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          pos[v * 3] = p.x + side.x * w * sgn; pos[v * 3 + 1] = p.y + side.y * w * sgn; pos[v * 3 + 2] = p.z + side.z * w * sgn;
          col[v * 4] = K.COLOR[0] * g; col[v * 4 + 1] = K.COLOR[1] * g; col[v * 4 + 2] = K.COLOR[2] * g; col[v * 4 + 3] = a;
          uv[v * 2] = u; uv[v * 2 + 1] = sgn < 0 ? 0 : 1;
          v++;
        }
        prev = p;
      }
    });
    return true;
  }

  var api = { shot: shot, state: state, point: point, spread: spread, build: build, indices: indices, size: size, snap: snap, travel: travel, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.WebShot = api;
})(typeof window === 'undefined' ? globalThis : window);

(function (root) {
  'use strict';
  // What a hit looks like, as plain data (no Three.js; world/fx.js draws it):
  //
  //  - bursts of particles thrown off the point a web lands: strands of web
  //    everywhere, sparks off the Rhino's armour, black splashes of symbiote
  //    off Venom;
  //  - the impact flash at the exact point the shot met the villain, so a hit
  //    anywhere on him reads clearly without a target to aim at;
  //  - the hit-stop: the fight and the villain freeze for a few frames on
  //    every hit (the camera doesn't, so the wrist never feels it);
  //  - on defeat, the villain dissolves from the edges of a noise pattern,
  //    with a web-white glow on the edge, as webs wrap round him.
  //
  // x east, z south, y up, metres, seconds.

  var HITSTOP_MS = 70;          // about four frames at 60 fps
  var DISSOLVE = { START: .7, DUR: .9 };   // seconds after the win: his defeat clip plays first

  // Each kind of particle: how many a burst throws, how fast (m/s) and how
  // widely (degrees from the surface normal), how long they live, how big
  // they are (m), how strongly air slows them (1/s) and gravity (m/s/s).
  var KINDS = {
    web: { n: 14, v0: 2, v1: 5, cone: 70, life0: .3, life1: .55, size0: .05, size1: .1, drag: 3, g: 4 },
    sparks: { n: 22, v0: 5, v1: 11, cone: 80, life0: .22, life1: .5, size0: .02, size1: .04, drag: .6, g: 9.8, streak: .035 },
    symbiote: { n: 16, v0: 2, v1: 5.5, cone: 75, life0: .5, life1: .9, size0: .07, size1: .16, drag: 1, g: 9.8 },
    // The web wrapping round a beaten villain: slow, rising strands.
    wrap: { n: 30, v0: .6, v1: 2, cone: 85, life0: .6, life1: 1.1, size0: .06, size1: .12, drag: 2, g: -.6 }
  };
  // Per villain: the particles of a hit, and the flash's colour (linear, and
  // above 1, so it tone-maps to a hot white core) and size in metres.
  var STYLES = {
    goblin: { kinds: ['web'], flash: [2.6, 2.5, 2.1], size: .9 },
    rhino: { kinds: ['web', 'sparks'], flash: [3.2, 2.1, 1.1], size: 1.1 },
    venom: { kinds: ['web', 'symbiote'], flash: [2.4, 2.3, 3], size: 1 }
  };
  function style(id) { return STYLES[id] || STYLES.goblin; }

  function unit(v) { var l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // A direction within `deg` degrees of n, uniformly over the cap.
  function inCone(n, deg, rnd) {
    n = unit(n);
    var a = Math.abs(n.x) < .9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    var u = unit({ x: n.y * a.z - n.z * a.y, y: n.z * a.x - n.x * a.z, z: n.x * a.y - n.y * a.x });
    var w = { x: n.y * u.z - n.z * u.y, y: n.z * u.x - n.x * u.z, z: n.x * u.y - n.y * u.x };
    var cmin = Math.cos(deg * Math.PI / 180), c = lerp(cmin, 1, rnd()), s = Math.sqrt(Math.max(0, 1 - c * c)), ph = rnd() * Math.PI * 2;
    return { x: n.x * c + (u.x * Math.cos(ph) + w.x * Math.sin(ph)) * s, y: n.y * c + (u.y * Math.cos(ph) + w.y * Math.sin(ph)) * s,
      z: n.z * c + (u.z * Math.cos(ph) + w.z * Math.sin(ph)) * s };
  }

  // A burst of one kind from `point`, thrown out round `normal`. opts.scale
  // scales the count (the LOW setting halves it); opts.rnd is the random
  // source (Math.random by default).
  function burst(kind, point, normal, opts) {
    var k = KINDS[kind], o = opts || {}, rnd = o.rnd || Math.random, out = [], i;
    if (!k) return out;
    var n = Math.max(1, Math.round(k.n * (o.scale === undefined ? 1 : o.scale)));
    for (i = 0; i < n; i++) {
      var d = inCone(normal, k.cone, rnd), v = lerp(k.v0, k.v1, rnd());
      out.push({ kind: kind, x: point.x, y: point.y, z: point.z, vx: d.x * v, vy: d.y * v, vz: d.z * v,
        age: 0, life: lerp(k.life0, k.life1, rnd()), size: lerp(k.size0, k.size1, rnd()), drag: k.drag, g: k.g,
        shade: .75 + .25 * rnd() });
    }
    return out;
  }
  // All of a villain's hit: every kind its style throws.
  function hit(id, point, normal, opts) {
    var s = style(id), out = [];
    s.kinds.forEach(function (k) { out = out.concat(burst(k, point, normal, opts)); });
    return out;
  }

  // Move particles on by dt; returns those still alive (the same objects).
  function step(list, dt) {
    if (!(dt > 0)) return list;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i], f = Math.exp(-p.drag * dt);
      p.vx *= f; p.vz *= f; p.vy = p.vy * f - p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.age += dt;
      if (p.age < p.life) out.push(p);
    }
    return out;
  }
  // How visible a particle is: full, then fading over the last 40% of its life.
  function alpha(p) { var u = p.age / p.life; return u < .6 ? 1 : Math.max(0, (1 - u) / .4); }

  // The hit-stop: a hit at `now` holds the fight until the time this returns
  // (a hit during one extends it, never doubles it).
  function stopUntil(now, until) { return Math.max(until || 0, now + HITSTOP_MS); }
  function stopped(now, until) { return now < (until || 0); }

  // How far the defeat dissolve has gone, 0..1, `t` seconds after the win.
  function dissolve(t) {
    var u = (t - DISSOLVE.START) / DISSOLVE.DUR;
    if (!(u > 0)) return 0;
    if (u >= 1) return 1;
    return u * u * (3 - 2 * u);
  }

  var api = { HITSTOP_MS: HITSTOP_MS, DISSOLVE: DISSOLVE, KINDS: KINDS, STYLES: STYLES, style: style, inCone: inCone,
    burst: burst, hit: hit, step: step, alpha: alpha, stopUntil: stopUntil, stopped: stopped, dissolve: dissolve };
  if (typeof module !== 'undefined') module.exports = api;
  root.HitFx = api;
})(typeof window === 'undefined' ? globalThis : window);

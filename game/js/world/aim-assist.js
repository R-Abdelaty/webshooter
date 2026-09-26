(function (root) {
  'use strict';
  // Does a shot hit a sphere? A wrist is less steady than a mouse, so a shot
  // counts if it passes within a small angle of the sphere's edge, not only if
  // it goes through it: the sphere is widened by a cone of TOLERANCE_DEG around
  // the ray. The cone is angular rather than a fixed number of metres so the
  // help is the same on screen near and far.
  //
  // Points and directions are plain {x, y, z}; directions are unit length. No
  // Three.js, so the tests can check it.

  var TOLERANCE_DEG = 1.5;
  var DEG = 180 / Math.PI;

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function len(a) { return Math.sqrt(dot(a, a)); }

  // How far the ray misses the sphere {x, y, z, r}, in degrees: 0 if it goes
  // through it, otherwise the angle between the ray and the nearest edge of the
  // sphere as seen from the origin. `distance` is how far away the sphere's
  // near surface is; `front` says whether it is ahead of the shooter at all.
  function miss(origin, dir, s) {
    var v = sub(s, origin), d = len(v), r = s.r || 0;
    if (d <= r) return { deg: 0, distance: 0, front: true };
    var cos = Math.max(-1, Math.min(1, dot(v, dir) / d));
    var off = Math.acos(cos) - Math.asin(r / d);
    return { deg: Math.max(0, off * DEG), distance: d - r, front: cos > 0 };
  }

  function test(origin, dir, s, tolerance) {
    var tol = Number.isFinite(tolerance) ? tolerance : TOLERANCE_DEG, m = miss(origin, dir, s);
    return m.front && m.deg <= tol;
  }

  // The sphere a shot hits out of several, or null. The closest to the line of
  // the shot wins, and among ones it goes straight through, the nearest.
  // opts.blocked is how far along the ray the city was hit (Infinity if it
  // wasn't): a target whose near surface is further than that is behind a wall.
  function pick(origin, dir, spheres, opts) {
    opts = opts || {};
    var tol = Number.isFinite(opts.tolerance) ? opts.tolerance : TOLERANCE_DEG;
    var blocked = Number.isFinite(opts.blocked) ? opts.blocked : Infinity, best = null, i;
    for (i = 0; i < spheres.length; i++) {
      var m = miss(origin, dir, spheres[i]);
      if (!m.front || m.deg > tol || m.distance > blocked + .05) continue;
      if (!best || m.deg < best.deg - 1e-9 || (Math.abs(m.deg - best.deg) <= 1e-9 && m.distance < best.distance))
        best = { index: i, target: spheres[i], deg: m.deg, distance: m.distance };
    }
    return best;
  }

  // Where a ray reaches its closest approach to a point: the spot on the
  // target a web should stick to. Never behind the origin.
  function closest(origin, dir, p) {
    var t = Math.max(0, dot(sub(p, origin), dir));
    return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t, t: t };
  }

  var api = { TOLERANCE_DEG: TOLERANCE_DEG, miss: miss, test: test, pick: pick, closest: closest };
  if (typeof module !== 'undefined') module.exports = api;
  root.AimAssist = api;
})(typeof window === 'undefined' ? globalThis : window);

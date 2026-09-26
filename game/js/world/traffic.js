(function (root) {
  'use strict';
  // The city's traffic and pedestrians, as plain data and pure functions of
  // time: where every car and walker is at a given moment. No Three.js;
  // life.js draws the ones near you.
  //
  // Cars drive loops round rectangles of blocks, always turning right, on the
  // right-hand side of the road (so a loop keeps to the lanes on its inside).
  // The rectangles tile the grid, and a tiling never puts two loops in the
  // same lane going the same way, so cars on a straight never run into one
  // another: every car on a loop has that loop's speed. There are two tilings,
  // one in the inner lanes and one, offset by a block, in the outer lanes.
  // Cars do cross at junctions - there are no lights.
  //
  // Pedestrians walk loops round each block's pavement (and the park's, and
  // the riverside promenade), both ways, the two directions on different
  // lines along the pavement.
  //
  // Every car and walker has a `rank` in [0, 1); a density d keeps those with
  // rank < d, so LOW's half is a subset of MED's and changing the setting
  // mid-game doesn't reshuffle anyone.
  //
  //   var sim = Traffic.create(city)
  //   Traffic.carAt(sim, car, t)       -> { x, y, z, yaw }
  //   Traffic.personAt(sim, p, t)      -> { x, y, z, yaw, phase }
  //   Traffic.near(sim, 'cars', eye, { range, max, density }, t, out) -> count
  //   Traffic.clear(sim, focus)        hide the loops that pass through a
  //                                    fight's action (Encounters.focus)
  //
  // x east, z south, y up, metres; yaw 0 faces north (-z) and positive yaw
  // turns left, as in player.js.

  var CityRef = root.City || (typeof require === 'function' ? require('./city.js') : null);

  var K = {
    // Lane centres from the road's centre line: an avenue's inner and outer
    // lanes (its dashed lines are 5.5 m out, its kerb 11), a street's.
    AVENUE_LANES: [2.85, 8.2], STREET_LANES: [2, 5.5],
    CORNER: 5,                    // a car's turning radius
    CAR_GAP: 34,                  // metres of loop per car, at full density
    CAR_SPEED: [7.5, 11.5],       // m/s: a loop's speed is somewhere in here
    CAB: .35,                     // the share of cars that are yellow cabs
    // Pedestrians: how far from the kerb each direction walks, and how many.
    WALK_LINES: [[.9, 1.8], [2.1, 3.1]],
    WALK_CORNER: 1.5,
    WALK_GAP: 16,                 // metres of pavement per walker, each way
    WALK_SPEED: [1.1, 1.6],
    STRIDE: 1.4,                  // metres per full walking cycle (two steps)
    // A fight's action at street level empties the loops that pass within
    // this much of it (for the Rhino's charge, Venom's site); one up on a
    // roof (the Goblin's) empties nothing.
    CLEAR_PAD: 15, STREET_LEVEL: 5
  };

  var PAINT = [[.93, .93, .9], [.08, .08, .09], [.55, .57, .6], [.62, .09, .09], [.13, .22, .45], [.2, .32, .24],
    [.78, .76, .7], [.35, .36, .38], [.5, .12, .08]];
  var CAB_YELLOW = [.97, .74, .08];
  var SHIRTS = [[.85, .85, .82], [.12, .13, .16], [.55, .12, .12], [.2, .3, .55], [.75, .62, .35], [.3, .45, .32],
    [.9, .55, .2], [.45, .45, .48], [.6, .35, .55], [.15, .4, .5]];
  var LOWERS = [[.1, .12, .2], [.16, .16, .17], [.35, .3, .24], [.28, .3, .36], [.45, .42, .38]];
  var SKINS = [[.96, .8, .66], [.87, .66, .5], [.72, .5, .36], [.5, .34, .24], [.36, .24, .17]];

  function pick(rnd, list) { return list[Math.floor(rnd() * list.length) % list.length]; }
  function lerp(a, b, k) { return a + (b - a) * k; }

  // --- rounded-rectangle loops ----------------------------------------------------
  // A loop is a rectangle x0..x1, z0..z1 with corners of radius r, driven
  // clockwise as seen from above with north up: east along z0, south along
  // x1, west along z1, north along x0 - right turns only.
  function loop(x0, x1, z0, z1, r) {
    var w = x1 - x0, d = z1 - z0;
    r = Math.min(r, w / 2, d / 2);
    var a = w - 2 * r, b = d - 2 * r, q = Math.PI * r / 2;
    return { x0: x0, x1: x1, z0: z0, z1: z1, r: r, legs: [a, q, b, q, a, q, b, q], len: 2 * a + 2 * b + 4 * q };
  }
  // The point s metres along a loop (clockwise), with the way it faces.
  // back: walked the other way round.
  function pointOn(L, s, back, out) {
    out = out || {};
    s = ((s % L.len) + L.len) % L.len;
    if (back) s = L.len - s;
    var r = L.r, legs = L.legs, i = 0;
    while (i < 7 && s > legs[i]) { s -= legs[i]; i++; }
    var x, z, dx, dz, th;
    switch (i) {
      case 0: x = L.x0 + r + s; z = L.z0; dx = 1; dz = 0; break;
      case 2: x = L.x1; z = L.z0 + r + s; dx = 0; dz = 1; break;
      case 4: x = L.x1 - r - s; z = L.z1; dx = -1; dz = 0; break;
      case 6: x = L.x0; z = L.z1 - r - s; dx = 0; dz = -1; break;
      default:
        // The corners: arcs round their centres, from the angle each starts at.
        var c = [null, [L.x1 - r, L.z0 + r, -Math.PI / 2], null, [L.x1 - r, L.z1 - r, 0], null,
          [L.x0 + r, L.z1 - r, Math.PI / 2], null, [L.x0 + r, L.z0 + r, Math.PI]][i];
        th = c[2] + (r > 0 ? s / r : 0);
        x = c[0] + r * Math.cos(th); z = c[1] + r * Math.sin(th);
        dx = -Math.sin(th); dz = Math.cos(th);
    }
    if (back) { dx = -dx; dz = -dz; }
    out.x = x; out.z = z; out.yaw = Math.atan2(-dx, -dz);
    return out;
  }
  // How far p is from the loop's path (not its inside).
  function distToLoop(L, p) {
    var inX = p.x >= L.x0 && p.x <= L.x1, inZ = p.z >= L.z0 && p.z <= L.z1;
    if (inX && inZ) return Math.min(p.x - L.x0, L.x1 - p.x, p.z - L.z0, L.z1 - p.z);
    var dx = Math.max(L.x0 - p.x, 0, p.x - L.x1), dz = Math.max(L.z0 - p.z, 0, p.z - L.z1);
    return Math.hypot(dx, dz);
  }
  // How far p is from anywhere on or inside the loop's rectangle.
  function distToBox(L, p) {
    return Math.hypot(Math.max(L.x0 - p.x, 0, p.x - L.x1), Math.max(L.z0 - p.z, 0, p.z - L.z1));
  }

  // --- the tilings ----------------------------------------------------------------
  // Cut the grid of blocks into rectangles of at most w x h blocks, with cuts
  // on the lines i = offI (mod w) and j = offJ (mod h), skipping `used` cells
  // (the park, which is its own rectangle).
  function tiles(nx, nz, used, w, h, offI, offJ) {
    var taken = {}, out = [], i, j, k;
    function free(a, b) { return a >= 0 && a < nx && b >= 0 && b < nz && !used(a, b) && !taken[a + ',' + b]; }
    function cut(n, off, m) { return ((n - off) % m + m) % m === 0; }
    for (j = 0; j < nz; j++) for (i = 0; i < nx; i++) {
      if (!free(i, j)) continue;
      var i1 = i, j1 = j;
      while (free(i1 + 1, j) && !cut(i1 + 1, offI, w)) i1++;
      for (;;) {
        var jn = j1 + 1, ok = jn < nz && !cut(jn, offJ, h);
        for (k = i; ok && k <= i1; k++) if (!free(k, jn)) ok = false;
        if (!ok) break;
        j1 = jn;
      }
      for (k = i; k <= i1; k++) for (var m = j; m <= j1; m++) taken[k + ',' + m] = 1;
      out.push({ i0: i, i1: i1, j0: j, j1: j1 });
    }
    return out;
  }

  function create(city, seed) {
    var L = city.layout, B = city.bounds, rnd = CityRef.mulberry32(((seed === undefined ? city.seed : seed) ^ 0x7a11c) >>> 0);
    var PX = L.BLOCK_X + L.AVENUE, PZ = L.BLOCK_Z + L.STREET;
    var P = L.PARK;
    function avenueX(k) { return B.x0 + k * PX + L.AVENUE / 2; }
    function streetZ(r) { return B.z0 + r * PZ + L.STREET / 2; }
    function inPark(i, j) { return i >= P.i0 && i <= P.i1 && j >= P.j0 && j <= P.j1; }
    var park = { i0: P.i0, i1: P.i1, j0: P.j0, j1: P.j1 };

    // Cars: one set of loops per tiling, each in its own lanes.
    var routes = [], cars = [];
    [{ lane: 0, w: 2, h: 2, offI: 0, offJ: 0 }, { lane: 1, w: 2, h: 3, offI: 1, offJ: 1 }].forEach(function (set) {
      var oA = K.AVENUE_LANES[set.lane], oS = K.STREET_LANES[set.lane];
      [park].concat(tiles(L.BLOCKS_X, L.BLOCKS_Z, inPark, set.w, set.h, set.offI, set.offJ)).forEach(function (t) {
        var lp = loop(avenueX(t.i0) + oA, avenueX(t.i1 + 1) - oA, streetZ(t.j0) + oS, streetZ(t.j1 + 1) - oS, K.CORNER);
        lp.lane = set.lane; lp.tile = t; lp.speed = lerp(K.CAR_SPEED[0], K.CAR_SPEED[1], rnd());
        var id = routes.length, n = Math.max(1, Math.floor(lp.len / K.CAR_GAP)), step = lp.len / n;
        routes.push(lp);
        for (var c = 0; c < n; c++) {
          var cab = rnd() < K.CAB;
          cars.push({ route: id, s0: (c + (rnd() - .5) * .5) * step, rank: rnd(), cab: cab, color: cab ? CAB_YELLOW : pick(rnd, PAINT) });
        }
      });
    });

    // Pedestrians: a loop each way round every block's pavement, the park's
    // and the promenade.
    var walks = [], people = [];
    function walkLoops(x0, x1, z0, z1, y) {
      K.WALK_LINES.forEach(function (band, dir) {
        var d = lerp(band[0], band[1], rnd());
        var lp = loop(x0 + d, x1 - d, z0 + d, z1 - d, K.WALK_CORNER);
        lp.y = y; lp.back = dir === 1;
        var id = walks.length, n = Math.max(1, Math.floor(lp.len / K.WALK_GAP)), step = lp.len / n;
        walks.push(lp);
        for (var c = 0; c < n; c++) {
          people.push({ walk: id, s0: (c + (rnd() - .5) * .8) * step, speed: lerp(K.WALK_SPEED[0], K.WALK_SPEED[1], rnd()),
            rank: rnd(), shirt: pick(rnd, SHIRTS), lower: pick(rnd, LOWERS), skin: pick(rnd, SKINS), phase: rnd() * K.STRIDE });
        }
      });
    }
    city.blocks.forEach(function (b) { walkLoops(b.x0, b.x1, b.z0, b.z1, L.CURB); });
    var pr = CityRef.PARK_RECT;
    walkLoops(pr.x0, pr.x1, pr.z0, pr.z1, L.CURB);
    // The promenade: between the trees and the kerb, the length of the city.
    var pm = city.promenade;
    walkLoops(pm.x0 + 8.5, pm.x1 - 1, B.z0, B.z1, pm.top);

    return { routes: routes, cars: cars, walks: walks, people: people, hidden: { routes: {}, walks: {} } };
  }

  // --- where things are -----------------------------------------------------------
  function carAt(sim, car, t, out) {
    var r = sim.routes[car.route];
    out = pointOn(r, car.s0 + r.speed * t, false, out);
    out.y = 0;
    return out;
  }
  function personAt(sim, p, t, out) {
    var w = sim.walks[p.walk], s = p.s0 + p.speed * t;
    out = pointOn(w, s, w.back, out);
    out.y = w.y;
    // Where the walker is in their stride, 0..1.
    var ph = (s + p.phase) / K.STRIDE;
    out.phase = ph - Math.floor(ph);
    return out;
  }

  // What the GPU needs to move a car or walker on from time T by itself
  // (life.js does it in the vertex shader, so nothing is uploaded per
  // frame): its loop, how far round it is at T (kept under one lap, so the
  // numbers stay small), its speed, which way round, the height it moves at,
  // and for a walker where in the stride it is at T, in metres of STRIDE.
  // At T + u it is at pointOn(loop, s + speed * u, back), stride phase
  // fract((phase + speed * u) / STRIDE).
  function slot(sim, kind, it, T, out) {
    out = out || {};
    var cars = kind === 'cars', L = cars ? sim.routes[it.route] : sim.walks[it.walk], speed = cars ? L.speed : it.speed;
    var s = it.s0 + speed * T;
    out.x0 = L.x0; out.x1 = L.x1; out.z0 = L.z0; out.z1 = L.z1; out.r = L.r;
    out.s = ((s % L.len) + L.len) % L.len; out.speed = speed; out.back = !cars && L.back ? 1 : 0;
    out.y = cars ? 0 : L.y;
    var ph = cars ? 0 : (s + it.phase) % K.STRIDE;
    out.phase = ph < 0 ? ph + K.STRIDE : ph;
    return out;
  }

  // The nearest cars (kind 'cars') or walkers ('people') to `eye`, within
  // opts.range metres and at most opts.max of them, keeping only those whose
  // rank is under opts.density, nearest first. Fills `out` (reusing its
  // objects) and returns how many. Each entry: { x, y, z, yaw, d, item }
  // (and `phase` for walkers).
  var scratch = [];
  function near(sim, kind, eye, opts, t, out) {
    var cars = kind === 'cars', loops = cars ? sim.routes : sim.walks, list = cars ? sim.cars : sim.people;
    var hidden = cars ? sim.hidden.routes : sim.hidden.walks, range = opts.range, dens = opts.density === undefined ? 1 : opts.density;
    var ok = {}, n = 0, i, e;
    for (i = 0; i < loops.length; i++) if (!hidden[i] && distToBox(loops[i], eye) <= range) ok[i] = true;
    for (i = 0; i < list.length; i++) {
      var it = list[i], li = cars ? it.route : it.walk;
      if (!ok[li] || it.rank >= dens) continue;
      e = scratch[n] || (scratch[n] = {});
      if (cars) carAt(sim, it, t, e); else personAt(sim, it, t, e);
      e.d = Math.hypot(e.x - eye.x, e.z - eye.z);
      if (e.d > range) continue;
      e.item = it;
      n++;
    }
    var sorted = scratch.slice(0, n).sort(function (a, b) { return a.d - b.d; }), m = Math.min(n, opts.max === undefined ? n : opts.max);
    for (i = 0; i < m; i++) {
      var src = sorted[i], dst = out[i] || (out[i] = {});
      dst.x = src.x; dst.y = src.y; dst.z = src.z; dst.yaw = src.yaw; dst.d = src.d; dst.item = src.item; dst.phase = src.phase;
    }
    out.length = m;
    return m;
  }

  // Empty the loops that pass through a fight's action, if it's at street
  // level; null (or a fight up on a roof) brings everyone back.
  function clear(sim, focus) {
    sim.hidden = { routes: {}, walks: {} };
    if (!focus || focus.y - focus.r > K.STREET_LEVEL) return sim.hidden;
    var reach = focus.r + K.CLEAR_PAD;
    sim.routes.forEach(function (r, i) { if (distToLoop(r, focus) <= reach) sim.hidden.routes[i] = true; });
    sim.walks.forEach(function (w, i) { if (distToLoop(w, focus) <= reach) sim.hidden.walks[i] = true; });
    return sim.hidden;
  }

  // How loud the street is where you stand, 0..1: busier the more cars are
  // close, and quieter the higher you are above it.
  function noise(nearCars, eye) {
    var sum = 0;
    for (var i = 0; i < nearCars.length; i++) sum += 1 / (1 + Math.pow(nearCars[i].d / 25, 2));
    var height = Math.max(0, eye.y - 2);
    return Math.min(1, sum / 4) / (1 + height / 40);
  }

  var api = { create: create, carAt: carAt, personAt: personAt, slot: slot, near: near, clear: clear, noise: noise,
    loop: loop, pointOn: pointOn, tiles: tiles, distToLoop: distToLoop, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Traffic = api;
})(typeof window === 'undefined' ? globalThis : window);

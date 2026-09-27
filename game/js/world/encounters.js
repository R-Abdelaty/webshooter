(function (root) {
  'use strict';
  // Where each fight happens in the city, as plain data worked out from the
  // city itself, so the same seed always gives the same places:
  //
  //   Green Goblin  glides in circles round the spawn tower's roof; you fight
  //                 from the middle of that roof.
  //   Rhino         charges up and down an avenue; you fight from the edge of
  //                 a low roof above it.
  //   Venom         leaps between the construction site's beams; you fight
  //                 from a container in the yard. A wave of masked thugs can
  //                 come first (THUGS.ENABLED, off for now).
  //   Training      targets on the walls and roofs round a mid-height roof.
  //
  // Each has a vantage (where the fight puts you, facing the action), because
  // until the shooter has a stick the wrist can't walk you anywhere. Each also
  // has a trigger on the street - the foot of the building, or the site gate -
  // so a keyboard player can walk to it and start it there.
  //
  // No Three.js. x east, z south, y up, metres; yaw 0 faces north (-z) and
  // positive yaw turns left, as in player.js.

  var CityRef = root.City || (typeof require === 'function' ? require('./city.js') : null);

  var K = {
    EYE: 1.7,
    TRIGGER: 5,                 // metres from a trigger's centre that starts it
    // Goblin: radius and height above the roof of his circuit round you.
    GLIDER: { R0: 12, R1: 20, H0: 3, H1: 9, SCALE: 60 },
    // Rhino: roof height for the vantage, how far each way along the avenue
    // he charges, and how far either side of its centre line he swerves.
    CHARGE: { ROOF_MIN: 12, ROOF_MAX: 30, HALF: 32, LANE: 7, SCALE: 64 },
    // Venom: how far away a beam may be to leap to, how much beam his
    // sideways dodge needs and how far along one to look, and the thugs.
    LEAP: { RANGE: 28, HOP_MIN: 3, HOP_MAX: 13, SCALE: 50, DASH_ROOM: 2.5, BEAM_MAX: 4 },
    // ENABLED: the wave of thugs before Venom. Off for now - the game is the
    // three villains - until the masked hitmen have a model (Session H in
    // docs/CHARACTERS_PLAN.md). With it off his fight starts at his entrance.
    THUGS: { ENABLED: false, COUNT: 6, MIN: 6, MAX: 30, SPACING: 2.5, SPREAD: 70 },
    // Training: roof heights to stand on, and target distances.
    RANGE: { ROOF_MIN: 28, ROOF_MAX: 60, NEAR: 12, FAR: 75, MAX_TARGETS: 60, SPACING: 6 }
  };
  // SCALE turns the level's speeds (fractions of the 2D arena per second, in
  // levels.js) into metres per second: speed = level.moveSpeed * SCALE.

  function round2(n) { return Math.round(n * 100) / 100; }
  function yawToward(from, to) { return Math.atan2(-(to.x - from.x), -(to.z - from.z)); }
  function pitchToward(from, to) { return Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z)); }

  // --- geometry against the city's collision boxes ----------------------------
  // Does the segment a->b pass through box c? (slab test)
  function segBox(a, b, c) {
    var t0 = 0, t1 = 1, axes = ['x', 'y', 'z'], i;
    for (i = 0; i < 3; i++) {
      var k = axes[i], d = b[k] - a[k], lo = c[k + '0'], hi = c[k + '1'];
      if (Math.abs(d) < 1e-12) { if (a[k] < lo || a[k] > hi) return false; continue; }
      var u = (lo - a[k]) / d, v = (hi - a[k]) / d;
      if (u > v) { var s = u; u = v; v = s; }
      t0 = Math.max(t0, u); t1 = Math.min(t1, v);
      if (t0 > t1) return false;
    }
    return true;
  }
  // A clear line from a to b through the city, stopping `trim` metres short of
  // b so the thing at b (a beam, a wall) doesn't count against itself.
  function sightClear(city, a, b, trim) {
    var d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), k = d > 0 ? Math.max(0, 1 - (trim || 0) / d) : 0;
    var e = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
    var list = CityRef.query(city, Math.min(a.x, e.x) - .5, Math.min(a.z, e.z) - .5, Math.max(a.x, e.x) + .5, Math.max(a.z, e.z) + .5), i;
    for (i = 0; i < list.length; i++) if (segBox(a, e, list[i])) return false;
    return true;
  }
  // The top a figure standing at (x, z) would stand on, looking no higher than
  // `below`: the highest box top under it.
  function groundAt(city, x, z, below) {
    var list = CityRef.query(city, x, z, x, z), best = 0, i, c;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1 || c.y1 > below + 1e-6) continue;
      if (c.y1 > best) best = c.y1;
    }
    return best;
  }
  // Room to stand at (x, y, z): something to stand on at y, and nothing within
  // r of it between the feet and head height.
  function standable(city, x, y, z, r) {
    var list = CityRef.query(city, x - r, z - r, x + r, z + r), floor = false, i, c;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      if (Math.abs(c.y1 - y) < .02 && x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) floor = true;
      if (c.y1 <= y + .02 || c.y0 >= y + 2) continue;
      var cx = Math.max(c.x0, Math.min(x, c.x1)), cz = Math.max(c.z0, Math.min(z, c.z1));
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r) return false;
    }
    return floor;
  }
  // The most open spot on a roof tier t: as far as it can be from the roof
  // plant (which would hide a fight behind it) and the parapet, keeping to the
  // middle when that is a tie.
  function openSpot(city, t) {
    var things = CityRef.query(city, t.x0, t.z0, t.x1, t.z1).filter(function (c) { return c.y0 >= t.y1 - .01 && c.y1 > t.y1 + .05; });
    var cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2, best = null, x, z;
    for (x = t.x0 + 2; x <= t.x1 - 2; x += 1) for (z = t.z0 + 2; z <= t.z1 - 2; z += 1) {
      var room = Infinity;
      things.forEach(function (c) {
        var dx = Math.max(c.x0 - x, 0, x - c.x1), dz = Math.max(c.z0 - z, 0, z - c.z1);
        room = Math.min(room, Math.hypot(dx, dz));
      });
      var score = Math.min(room, 12) - .15 * Math.hypot(x - cx, z - cz);
      if (room >= 1 && (!best || score > best.score)) best = { score: score, x: round2(x), y: t.y1, z: round2(z) };
    }
    return best && { x: best.x, y: best.y, z: best.z };
  }

  // A spot on the pavement at the foot of a building: the middle of the first
  // side of its bottom tier that faces a street, two metres out.
  function footOf(city, b) {
    var t = b.tiers[0], blk = blockOf(city, b), S = city.layout.SIDEWALK, cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
    var sides = [[t.z1, blk.z1 - S, { x: cx, z: t.z1 + 2 }], [t.z0, blk.z0 + S, { x: cx, z: t.z0 - 2 }],
      [t.x1, blk.x1 - S, { x: t.x1 + 2, z: cz }], [t.x0, blk.x0 + S, { x: t.x0 - 2, z: cz }]];
    for (var i = 0; i < sides.length; i++)
      if (Math.abs(sides[i][0] - sides[i][1]) < .01) return { x: round2(sides[i][2].x), z: round2(sides[i][2].z), y: 0 };
    return null;
  }

  function blockOf(city, b) {
    var cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    return city.blocks.filter(function (k) { return cx >= k.x0 && cx <= k.x1 && cz >= k.z0 && cz <= k.z1; })[0];
  }
  function walkable(b) { return !b.filler; }

  // --- Green Goblin -----------------------------------------------------------
  function goblin(city) {
    var tower = city.buildings.filter(function (b) { return b.spawn; })[0], t = tower.tiers[tower.tiers.length - 1];
    var cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2, spot = openSpot(city, t);
    var yaw = city.spawn.yaw, G = K.GLIDER;
    return {
      id: 'goblin', index: 0, level: 0, villain: 0, kind: 'glider',
      vantage: { x: spot.x, y: spot.y, z: spot.z, yaw: yaw, pitch: .06 },
      trigger: footOf(city, tower),
      intro: 'He hunts you across the rooftops on his glider, and he fights back: pumpkin bombs, and his glider guns. ' +
        'When he winds up, get moving - swing out of the red laser\'s line, and shoot the bombs out of the air. ' +
        'Hit him anywhere. No clock: it ends when he goes down, or you do.',
      path: { cx: spot.x, cz: spot.z, y: t.y1, r0: G.R0, r1: G.R1, h0: G.H0, h1: G.H1, scale: G.SCALE,
        // He starts in front of you.
        start: Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) }
    };
  }

  // --- Rhino ------------------------------------------------------------------
  // A low, flat roof whose edge is the avenue's sidewalk, nearest the spawn.
  // You perch on its parapet: standing back from it, the parapet hides the
  // street right below.
  function rhino(city) {
    var L = city.layout, C = K.CHARGE, P = CityRef.PARK_RECT, best = null;
    city.buildings.forEach(function (b) {
      if (!walkable(b) || b.spawn || b.landmark || b.tiers.length !== 1) return;
      var t = b.tiers[0], blk = blockOf(city, b);
      if (!blk || t.y1 < C.ROOF_MIN || t.y1 > C.ROOF_MAX) return;
      [-1, 1].forEach(function (side) {
        var edge = side < 0 ? t.x0 : t.x1;
        if (Math.abs(edge - (side < 0 ? blk.x0 + L.SIDEWALK : blk.x1 - L.SIDEWALK)) > .01) return;
        var ax = side < 0 ? blk.x0 - L.AVENUE / 2 : blk.x1 + L.AVENUE / 2, zc = (t.z0 + t.z1) / 2;
        var z0 = Math.max(city.walk.z0 + 6, zc - C.HALF), z1 = Math.min(city.walk.z1 - 6, zc + C.HALF);
        // The avenues inside the park are paths, not roads.
        if (ax > P.x0 && ax < P.x1 && z1 > P.z0 && z0 < P.z1) return;
        if (ax > city.bounds.x1 || ax < city.bounds.x0) return;
        var px = edge - side * .15, spot = null, dz, ledge = 0;
        for (dz = 0; dz <= (t.z1 - t.z0) / 2 - 2 && spot === null; dz += 1) [zc - dz, zc + dz].forEach(function (z) {
          var y = groundAt(city, px, z, t.y1 + 2);
          if (spot === null && y > t.y1 && standable(city, px, y, z, .5)) { spot = z; ledge = y; }
        });
        if (spot === null) return;
        var d = Math.hypot((edge - city.spawn.x), (zc - city.spawn.z)), score = d + Math.abs(t.y1 - 20) * 6;
        if (!best || score < best.score) best = { score: score, b: b, t: t, side: side, ax: ax, z: spot, z0: z0, z1: z1, edge: edge, x: px, y: ledge };
      });
    });
    var s = best, v = { x: round2(s.x), y: round2(s.y), z: s.z };
    var mid = { x: s.ax, y: 1.4, z: s.z }, eye = { x: v.x, y: v.y + K.EYE, z: v.z };
    return {
      id: 'rhino', index: 1, level: 1, villain: 1, kind: 'charge',
      vantage: { x: v.x, y: v.y, z: v.z, yaw: yawToward(eye, mid), pitch: round2(pitchToward(eye, mid) * .75) },
      trigger: { x: round2(s.edge + s.side * 2), z: round2(s.z), y: 0 },
      intro: 'He is charging up and down the avenue below. Hit him anywhere - he swerves when you shoot. ' +
        'He is tough: no clock, it ends when he goes down.',
      path: { x: s.ax, z0: round2(s.z0), z1: round2(s.z1), y: 0, lane: C.LANE, scale: C.SCALE }
    };
  }

  // --- Venom and the thugs ------------------------------------------------------
  // The beams leading off a perch, along x and z: which way, and how far there
  // is something to stand on at the perch's height (Venom dodges sideways
  // along one). Only those at least DASH_ROOM long.
  function beamsFrom(city, x, y, z) {
    var out = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var len = 0;
      for (var k = .5; k <= K.LEAP.BEAM_MAX + 1e-9; k += .5) {
        if (groundAt(city, x + d[0] * k, z + d[1] * k, y + .3) < y - .01) break;
        len = k;
      }
      if (len >= K.LEAP.DASH_ROOM) out.push({ x: d[0], z: d[1], len: len });
    });
    return out;
  }
  function venom(city) {
    var site = city.site, f = site.frame, look = site.lookout, L = K.LEAP, T = K.THUGS;
    var v = { x: look.x, y: look.y, z: look.z }, eye = { x: v.x, y: v.y + K.EYE, z: v.z };
    var yaw = -Math.PI / 2;           // facing east, at the frame
    // Perches: the tops of the frame's nodes, where there is a beam (or slab)
    // to stand on, headroom, a clear line from you, and not too far.
    var perches = [], a, b, fl;
    for (fl = 1; fl <= f.storeys; fl++) for (a = 0; a <= Math.round((f.x1 - f.x0) / 8); a++) for (b = 0; b <= Math.round((f.z1 - f.z0) / 8); b++) {
      var x = f.x0 + a * 8, z = f.z0 + b * 8, y = groundAt(city, x, z, fl * f.floor + f.base + .3);
      if (y < fl * f.floor + f.base - .01) continue;             // no beam at this node on this floor
      var chest = { x: x, y: y + 1.3, z: z }, d = Math.hypot(chest.x - eye.x, chest.y - eye.y, chest.z - eye.z);
      if (d > L.RANGE) continue;
      var head = CityRef.query(city, x - .3, z - .3, x + .3, z + .3).some(function (c) {
        return c.y0 > y + .05 && c.y0 < y + 2.6 && x >= c.x0 - .3 && x <= c.x1 + .3 && z >= c.z0 - .3 && z <= c.z1 + .3;
      });
      if (head || !sightClear(city, eye, chest, 1.2)) continue;
      perches.push({ x: round2(x), y: round2(y), z: round2(z), beams: beamsFrom(city, x, y, z) });
    }
    // The thugs (when the wave is on) stand in the gap between you and the
    // frame, on its ground floor between the columns, and a couple on the
    // first floor's edge. They draw on their own random stream, so switching
    // the wave on or off changes nothing else.
    var rnd = CityRef.mulberry32((city.seed ^ 0x5eed7) >>> 0), cands = [], thugs = [], i;
    function column(x) { var k = Math.round((x - f.x0) / 8); return k >= 0 && Math.abs(x - (f.x0 + k * 8)) < 1.2; }
    if (T.ENABLED) for (x = v.x + 4; x <= f.x0 + 22; x += 1.5) for (z = f.z0 - 2; z <= f.z1 + 2; z += 1.5) {
      if (column(x)) continue;
      var floors = [groundAt(city, x, z, .6)];
      if (x > f.x0 + .5 && x < f.x0 + 3.5) floors.push(groundAt(city, x, z, f.floor + f.base + .6));
      floors.forEach(function (gy) {
        if (!standable(city, x, gy, z, .45) || !standable(city, x, gy, z + 1, .45) || !standable(city, x, gy, z - 1, .45)) return;
        var c = { x: round2(x), y: round2(gy), z: round2(z) }, ch = { x: c.x, y: c.y + 1.15, z: c.z };
        var d = Math.hypot(ch.x - eye.x, ch.y - eye.y, ch.z - eye.z), ang = Math.abs(yawToward(eye, c) - yaw) * 180 / Math.PI;
        if (d < T.MIN || d > T.MAX || ang > T.SPREAD) return;
        if (!sightClear(city, eye, ch, .8) || !sightClear(city, eye, { x: c.x, y: c.y + 1.7, z: c.z }, .5)) return;
        cands.push(c);
      });
    }
    for (i = 0; i < 400 && thugs.length < T.COUNT && cands.length; i++) {
      var c = cands[Math.floor(rnd() * cands.length)];
      if (thugs.some(function (t) { return Math.abs(t.y - c.y) < 1 && Math.hypot(t.x - c.x, t.z - c.z) < T.SPACING; })) continue;
      // Every other one takes two hits.
      thugs.push({ x: c.x, y: c.y, z: c.z, hp: thugs.length % 2 ? 2 : 1, phase: round2(rnd() * Math.PI * 2) });
    }
    return {
      id: 'venom', index: 2, level: 2, villain: 2, kind: 'leap',
      vantage: { x: v.x, y: v.y, z: v.z, yaw: yaw, pitch: .1 },
      trigger: { x: site.gate.x, z: round2(site.gate.z + 2.5), y: 0 },
      intro: thugs.length ? 'Clear the masked thugs first - one or two hits each. Then Venom comes for you.' :
        'He drops onto the steel frame and leaps from beam to beam. Hit him anywhere - he dashes along a beam when you shoot. ' +
        'He is tough: no clock, it ends when he goes down.',
      path: { perches: perches, hopMin: L.HOP_MIN, hopMax: L.HOP_MAX, scale: L.SCALE },
      thugs: thugs
    };
  }

  // --- the training range -------------------------------------------------------
  // Target spots round a roof: on the roofs of the buildings near it and on
  // the faces of their walls that look towards it, at mixed distances, each
  // with a clear line from where you stand.
  function targetsFrom(city, eye, self) {
    var R = K.RANGE, out = [];
    function add(p) {
      var d = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z), el = pitchToward(eye, p) * 180 / Math.PI;
      if (d < R.NEAR || d > R.FAR || el < -55 || el > 50) return;
      if (out.some(function (q) { return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < R.SPACING; })) return;
      if (!sightClear(city, eye, p, .7)) return;
      out.push({ x: round2(p.x), y: round2(p.y), z: round2(p.z), d: round2(d) });
    }
    city.buildings.forEach(function (b) {
      if (!walkable(b) || b === self) return;
      b.tiers.forEach(function (t, n) {
        var nx = Math.max(t.x0, Math.min(eye.x, t.x1)), nz = Math.max(t.z0, Math.min(eye.z, t.z1));
        if (Math.hypot(nx - eye.x, nz - eye.z) > R.FAR) return;
        if (n === b.tiers.length - 1) add({ x: (t.x0 + t.x1) / 2, y: t.y1 + 1.6, z: (t.z0 + t.z1) / 2 });
        // The faces that look towards you, a third and two thirds along, at
        // about your height, below it and above it.
        [['x', t.x0, -1], ['x', t.x1, 1], ['z', t.z0, -1], ['z', t.z1, 1]].forEach(function (face) {
          var axis = face[0], at = face[1], out = face[2];
          if ((eye[axis] - at) * out <= 0) return;
          [1 / 3, 2 / 3].forEach(function (u) {
            [eye.y - 9, eye.y + 1, eye.y + 11].forEach(function (y) {
              if (y < 3 || y > t.y1 - 2) return;
              var p = axis === 'x' ? { x: at + out * .5, y: y, z: t.z0 + (t.z1 - t.z0) * u } : { x: t.x0 + (t.x1 - t.x0) * u, y: y, z: at + out * .5 };
              add(p);
            });
          });
        });
      });
    });
    return out.slice(0, R.MAX_TARGETS);
  }
  function training(city) {
    var R = K.RANGE, sp = city.spawn, pool = city.buildings.filter(function (b) {
      var t = b.tiers[b.tiers.length - 1];
      return walkable(b) && !b.spawn && !b.landmark && b.tiers.length === 1 && t.y1 >= R.ROOF_MIN && t.y1 <= R.ROOF_MAX;
    }).sort(function (p, q) {
      return Math.hypot((p.x0 + p.x1) / 2 - sp.x, (p.z0 + p.z1) / 2 - sp.z) - Math.hypot((q.x0 + q.x1) / 2 - sp.x, (q.z0 + q.z1) / 2 - sp.z);
    }).slice(0, 10), best = null;
    pool.forEach(function (b) {
      var t = b.tiers[0], s = openSpot(city, t), foot = footOf(city, b);
      if (!s || !foot) return;
      var eye = { x: s.x, y: s.y + K.EYE, z: s.z }, list = targetsFrom(city, eye, b);
      if (!best || list.length > best.list.length) best = { b: b, t: t, s: s, eye: eye, list: list, foot: foot };
    });
    var t = best.t, list = best.list, eye = best.eye;
    // Face the middle of the targets.
    var sx = 0, sz = 0;
    list.forEach(function (p) { var d = Math.hypot(p.x - eye.x, p.z - eye.z) || 1; sx += (p.x - eye.x) / d; sz += (p.z - eye.z) / d; });
    return {
      id: 'training', kind: 'range',
      vantage: { x: best.s.x, y: best.s.y, z: best.s.z, yaw: Math.atan2(-sx, -sz), pitch: 0 },
      trigger: best.foot,
      targets: list
    };
  }

  function build(city) {
    return { fights: [goblin(city), rhino(city), venom(city)], training: training(city) };
  }

  // Which trigger (if any) is someone at p standing in? Only at street level,
  // so standing on a roof above one does nothing.
  function triggered(spots, p) {
    for (var i = 0; i < spots.length; i++) {
      var t = spots[i].trigger;
      if (t && Math.hypot(p.x - t.x, p.z - t.z) <= K.TRIGGER && Math.abs(p.y - t.y) < 1.5) return spots[i];
    }
    return null;
  }

  // Where a fight's action is: a centre and a radius that its villain keeps
  // within - the goblin's circuit, the rhino's stretch of avenue, venom's
  // beams. The render side aims the shadow at it and takes the city's
  // reflection (the villains' environment map) from its centre.
  function focus(enc) {
    var p = enc.path, r;
    if (enc.kind === 'glider') return { x: p.cx, y: round2(p.y + (p.h0 + p.h1) / 2), z: p.cz, r: p.r1 + 2 };
    if (enc.kind === 'charge') return { x: p.x, y: 1.5, z: round2((p.z0 + p.z1) / 2), r: round2(Math.hypot((p.z1 - p.z0) / 2, p.lane) + 2) };
    var P = p.perches, n = P.length || 1, c = { x: 0, y: 0, z: 0 };
    P.forEach(function (q) { c.x += q.x / n; c.y += q.y / n; c.z += q.z / n; });
    r = 0;
    P.forEach(function (q) { r = Math.max(r, Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z)); });
    // His arcs rise above the beams, and his entrance drops from higher still.
    return { x: round2(c.x), y: round2(c.y + 1.2), z: round2(c.z), r: round2(r + 4) };
  }

  var api = { build: build, triggered: triggered, focus: focus, sightClear: sightClear, segBox: segBox, standable: standable,
    groundAt: groundAt, yawToward: yawToward, pitchToward: pitchToward, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Encounters = api;
})(typeof window === 'undefined' ? globalThis : window);

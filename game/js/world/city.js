(function (root) {
  'use strict';
  // The city as plain data: blocks, roads, lane markings, buildings (as stacks
  // of boxes), roof props, the park, the waterfront and the construction site,
  // plus the collision boxes the player walks against. Nothing here knows about
  // Three.js - city-mesh.js turns this into meshes - so the tests can check the
  // layout in node, and the same seed always gives the same city.
  //
  // Axes: x runs east, z runs south, y is up, one unit is a metre. Avenues run
  // north-south (along z) and are wide; streets run east-west and are narrow,
  // so blocks are long east-west like Manhattan's. The river is on the west.

  var L = {
    BLOCKS_X: 10, BLOCKS_Z: 17,     // blocks across (east-west) and down (north-south)
    BLOCK_X: 100, BLOCK_Z: 56,      // block size, kerb to kerb
    AVENUE: 22, STREET: 16,         // road widths
    SIDEWALK: 4, CURB: 0.15,
    PARK: { i0: 4, i1: 6, j0: 2, j1: 7 },   // 3 x 6 blocks, Central Park style
    SITE: { i: 7, j: 11 },          // the construction-site block (Session 3's fight)
    SPAWN: { i: 0, j: 12 },         // the tall tower you start on, by the river
    SPAWN_HEIGHT: 196,
    PROMENADE: 24,                  // riverside walk west of the first avenue
    RIVER: 1100,                    // water width to the far bank
    FILLER: 900                     // how far the unwalkable backdrop city reaches
  };

  // Facade proportions per building type. Heights are whole floors, so the
  // window rows (drawn in world space by the facade shader) never get cut in half
  // at the roof line.
  var TYPES = {
    brick:     { floor: 3.3, bay: 3.0, parapet: 1.1 },
    sandstone: { floor: 3.6, bay: 3.4, parapet: 1.2 },
    office:    { floor: 3.8, bay: 3.0, parapet: 1.0 },
    glass:     { floor: 4.0, bay: 2.0, parapet: 0.8 }
  };
  var TYPE_NAMES = ['brick', 'sandstone', 'office', 'glass'];
  var PALETTE = {
    brick:     [[.62,.30,.22],[.55,.26,.20],[.70,.40,.30],[.50,.32,.26],[.74,.58,.44]],
    sandstone: [[.88,.79,.63],[.80,.70,.55],[.92,.87,.76],[.77,.67,.53]],
    office:    [[.82,.82,.80],[.70,.72,.74],[.86,.83,.77],[.64,.64,.64]],
    glass:     [[.56,.69,.82],[.46,.59,.72],[.62,.73,.80],[.50,.62,.64]]
  };

  // Three supertalls that read from anywhere, like the skyline in the clips.
  var LANDMARKS = [
    { i: 8, j: 1, height: 400, type: 'glass', style: 'taper' },
    { i: 3, j: 9, height: 320, type: 'sandstone', style: 'deco' },
    { i: 2, j: 16, height: 272, type: 'glass', style: 'slab' }
  ];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var WIDTH = L.BLOCKS_X * L.BLOCK_X + (L.BLOCKS_X + 1) * L.AVENUE;
  var DEPTH = L.BLOCKS_Z * L.BLOCK_Z + (L.BLOCKS_Z + 1) * L.STREET;
  var X0 = -WIDTH / 2, Z0 = -DEPTH / 2;
  var PITCH_X = L.BLOCK_X + L.AVENUE, PITCH_Z = L.BLOCK_Z + L.STREET;

  function blockRect(i, j) {
    var x0 = X0 + L.AVENUE + i * PITCH_X, z0 = Z0 + L.STREET + j * PITCH_Z;
    return { x0: x0, x1: x0 + L.BLOCK_X, z0: z0, z1: z0 + L.BLOCK_Z };
  }
  function inset(r, d) { return { x0: r.x0 + d, x1: r.x1 - d, z0: r.z0 + d, z1: r.z1 - d }; }
  function inside(a, b) { return a.x0 >= b.x0 - 1e-9 && a.x1 <= b.x1 + 1e-9 && a.z0 >= b.z0 - 1e-9 && a.z1 <= b.z1 + 1e-9; }
  function overlaps(a, b) { return a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.z0 < b.z1 - 1e-6 && a.z1 > b.z0 + 1e-6; }
  function box(x0, x1, y0, y1, z0, z1) { return { x0: x0, x1: x1, y0: y0, y1: y1, z0: z0, z1: z1 }; }
  function round2(n) { return Math.round(n * 100) / 100; }

  var PARK_RECT = (function () {
    var a = blockRect(L.PARK.i0, L.PARK.j0), b = blockRect(L.PARK.i1, L.PARK.j1);
    return { x0: a.x0, x1: b.x1, z0: a.z0, z1: b.z1 };
  })();

  // --- roads and markings --------------------------------------------------
  function roads() {
    var out = [], k, j, r, i, seg;
    function add(s) { if (!inside(s, PARK_RECT)) out.push(s); }
    for (k = 0; k <= L.BLOCKS_X; k++) {
      var ax0 = X0 + k * PITCH_X;
      for (j = 0; j < L.BLOCKS_Z; j++) {
        var b = blockRect(0, j);
        add({ kind: 'avenue', x0: ax0, x1: ax0 + L.AVENUE, z0: b.z0, z1: b.z1 });
      }
      for (r = 0; r <= L.BLOCKS_Z; r++) {
        var sz0 = Z0 + r * PITCH_Z;
        add({ kind: 'intersection', x0: ax0, x1: ax0 + L.AVENUE, z0: sz0, z1: sz0 + L.STREET });
      }
    }
    for (r = 0; r <= L.BLOCKS_Z; r++) {
      var z0 = Z0 + r * PITCH_Z;
      for (i = 0; i < L.BLOCKS_X; i++) {
        seg = blockRect(i, 0);
        add({ kind: 'street', x0: seg.x0, x1: seg.x1, z0: z0, z1: z0 + L.STREET });
      }
    }
    return out;
  }

  // Double yellow down the middle of an avenue, dashed white lanes either side,
  // zebra crossings and stop lines at each end. Streets are one-way here: a
  // dashed white centre line. Each mark is a flat rectangle: x/z centre, w along
  // x, d along z.
  function markings(roadList) {
    var out = [];
    function m(x, z, w, d, c) { out.push({ x: round2(x), z: round2(z), w: w, d: d, c: c }); }
    roadList.forEach(function (s) {
      var cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, n, t, a;
      if (s.kind === 'avenue') {
        var len = s.z1 - s.z0, run = len - 2 * 5.5;
        m(cx - .2, cz, .15, run, 'y'); m(cx + .2, cz, .15, run, 'y');
        [-5.5, 5.5].forEach(function (off) {
          for (t = s.z0 + 7; t + 3 < s.z1 - 6; t += 9) m(cx + off, t + 1.5, .15, 3, 'w');
        });
        [s.z0, s.z1].forEach(function (end, e) {
          var dir = e ? -1 : 1;
          for (a = s.x0 + 1.2; a < s.x1 - 1; a += 1.4) m(a + .35, end + dir * 2, .7, 3.2, 'w');
          m(cx, end + dir * 4.3, L.AVENUE - 2, .4, 'w');
        });
      } else if (s.kind === 'street') {
        for (t = s.x0 + 7; t + 3 < s.x1 - 6; t += 9) m(t + 1.5, cz, 3, .15, 'w');
        [s.x0, s.x1].forEach(function (end, e) {
          var dir = e ? -1 : 1;
          for (n = s.z0 + 1.2; n < s.z1 - 1; n += 1.4) m(end + dir * 2, n + .35, 3.2, .7, 'w');
          m(end + dir * 4.3, cz, .4, L.STREET - 2, 'w');
        });
      }
    });
    return out;
  }

  // --- buildings ------------------------------------------------------------
  function pick(rnd, list) { return list[Math.floor(rnd() * list.length) % list.length]; }
  function tint(rnd, type) {
    var c = pick(rnd, PALETTE[type]), j = (rnd() - .5) * .08;
    return [round2(c[0] + j), round2(c[1] + j), round2(c[2] + j)];
  }
  function floors(type, h) { var f = TYPES[type].floor; return Math.max(1, Math.round(h / f)) * f; }

  // Which kinds of building a block gets depends on where it is: walk-ups and
  // sandstone apartments uptown and along the park, offices midtown, glass
  // towers downtown in the south - roughly how the clips' city reads.
  function district(i, j) {
    var south = j / (L.BLOCKS_Z - 1);
    var c = blockRect(i, j), px = Math.max(PARK_RECT.x0 - c.x1, c.x0 - PARK_RECT.x1, 0),
        pz = Math.max(PARK_RECT.z0 - c.z1, c.z0 - PARK_RECT.z1, 0);
    var nearPark = Math.hypot(px, pz) < 90;
    if (nearPark) return { w: { brick: .25, sandstone: .6, office: .15, glass: 0 }, tall: .8 };
    if (south > .7) return { w: { brick: .08, sandstone: .17, office: .3, glass: .45 }, tall: 1.5 };
    if (south > .4) return { w: { brick: .15, sandstone: .3, office: .35, glass: .2 }, tall: 1.2 };
    return { w: { brick: .45, sandstone: .35, office: .15, glass: .05 }, tall: .8 };
  }
  function chooseType(rnd, w) {
    var r = rnd(), acc = 0, k;
    for (k = 0; k < TYPE_NAMES.length; k++) { acc += w[TYPE_NAMES[k]]; if (r < acc) return TYPE_NAMES[k]; }
    return 'office';
  }
  function heightFor(rnd, type, tall) {
    var h;
    if (type === 'brick') h = 12 + rnd() * 16;
    else if (type === 'sandstone') h = 28 + rnd() * rnd() * 70;
    else if (type === 'office') h = 36 + rnd() * rnd() * 110;
    else h = 60 + rnd() * rnd() * 150;
    if (type !== 'brick') h *= tall;
    return h;
  }

  // Tiers are the setbacks: each is a box standing on the ground, narrower and
  // taller than the one before, so the stack reads as a wedding-cake tower.
  function tiersFor(rnd, type, lot, height) {
    var out = [], w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    var steps = type === 'brick' ? 0 : type === 'sandstone' ? Math.floor(rnd() * 3) :
      Math.floor(rnd() * 2);
    if (height < 40) steps = 0;
    var r = { x0: lot.x0, x1: lot.x1, z0: lot.z0, z1: lot.z1 }, y1 = floors(type, height), n;
    var base = steps ? floors(type, y1 * (.55 + rnd() * .2)) : y1;
    out.push(box(r.x0, r.x1, 0, base, r.z0, r.z1));
    for (n = 1; n <= steps; n++) {
      var ix = Math.min(w * .18, 2 + rnd() * 4), iz = Math.min(d * .18, 2 + rnd() * 4);
      r = { x0: r.x0 + ix, x1: r.x1 - ix, z0: r.z0 + iz, z1: r.z1 - iz };
      if (r.x1 - r.x0 < 10 || r.z1 - r.z0 < 10) break;
      var top = n === steps ? y1 : floors(type, base + (y1 - base) * (.5 + rnd() * .3));
      if (top <= out[out.length - 1].y1) break;
      out.push(box(round2(r.x0), round2(r.x1), 0, top, round2(r.z0), round2(r.z1)));
    }
    return out;
  }

  // Cut a block into lots: slices across its length, some split front and back.
  function lotsFor(rnd, r, type0) {
    var lots = [], x = r.x0, w;
    while (x < r.x1 - 1e-6) {
      w = 14 + rnd() * 18;
      if (r.x1 - (x + w) < 12) w = r.x1 - x;
      var slice = { x0: x, x1: x + w, z0: r.z0, z1: r.z1 };
      if (rnd() < .65 && r.z1 - r.z0 > 36) {
        var cut = r.z0 + (r.z1 - r.z0) * (.4 + rnd() * .2);
        lots.push({ x0: slice.x0, x1: slice.x1, z0: slice.z0, z1: cut });
        lots.push({ x0: slice.x0, x1: slice.x1, z0: cut, z1: slice.z1 });
      } else lots.push(slice);
      x += w;
    }
    return lots.map(function (l) { return { x0: round2(l.x0), x1: round2(l.x1), z0: round2(l.z0), z1: round2(l.z1) }; });
  }

  // Parapets sit on the roof's edge, inside its footprint, so nothing overhangs
  // the pavement below.
  function parapetsFor(t, h, list) {
    var th = .3, y0 = t.y1, y1 = t.y1 + h;
    list.push(box(t.x0, t.x1, y0, y1, t.z0, t.z0 + th));
    list.push(box(t.x0, t.x1, y0, y1, t.z1 - th, t.z1));
    list.push(box(t.x0, t.x0 + th, y0, y1, t.z0 + th, t.z1 - th));
    list.push(box(t.x1 - th, t.x1, y0, y1, t.z0 + th, t.z1 - th));
  }

  // Water tanks on the older buildings, air-handling boxes and stair bulkheads
  // on the rest. Placed with a few tries so they don't stack inside each other,
  // and kept out of `keepClear` (the spot you spawn on).
  function roofPropsFor(rnd, b, top, props, keepClear) {
    var room = inset(top, 1.6), placed = [], tries, want = [];
    if (room.x1 - room.x0 < 6 || room.z1 - room.z0 < 6) return;
    if ((b.type === 'brick' || b.type === 'sandstone') && rnd() < .65) want.push('tank');
    if (rnd() < .55) want.push('bulkhead');
    var ac = b.type === 'office' || b.type === 'glass' ? 1 + Math.floor(rnd() * 4) : Math.floor(rnd() * 2);
    while (ac--) want.push('ac');
    if (b.type === 'glass' && rnd() < .4) want.push('mech');
    want.forEach(function (kind) {
      for (tries = 0; tries < 8; tries++) {
        var w, d, h, legs = 0;
        if (kind === 'tank') { w = d = 4 + rnd() * 1.6; h = 4.5 + rnd() * 1.5; legs = 3 + rnd() * 2; }
        else if (kind === 'bulkhead') { w = 3.2; d = 4; h = 3.2; }
        else if (kind === 'mech') { w = (room.x1 - room.x0) * .45; d = (room.z1 - room.z0) * .45; h = 4 + rnd() * 3; }
        else { w = 2 + rnd() * 2.5; d = 2 + rnd() * 2; h = 1.4 + rnd() * 1.2; }
        if (w > room.x1 - room.x0 || d > room.z1 - room.z0) break;
        var x0 = room.x0 + rnd() * (room.x1 - room.x0 - w), z0 = room.z0 + rnd() * (room.z1 - room.z0 - d);
        var fp = { x0: x0 - .8, x1: x0 + w + .8, z0: z0 - .8, z1: z0 + d + .8 };
        if (placed.some(function (p) { return overlaps(p, fp); })) continue;
        if (keepClear && overlaps(keepClear, fp)) continue;
        placed.push(fp);
        var y = top.y1;
        props.push({ kind: kind, x0: round2(x0), x1: round2(x0 + w), z0: round2(z0), z1: round2(z0 + d),
          y0: round2(y), y1: round2(y + legs + h), legs: round2(legs) });
        break;
      }
    });
  }

  function makeBuilding(rnd, id, type, lot, height) {
    var b = { id: id, type: type, tint: tint(rnd, type), tiers: tiersFor(rnd, type, lot, height) };
    b.x0 = lot.x0; b.x1 = lot.x1; b.z0 = lot.z0; b.z1 = lot.z1;
    b.height = b.tiers[b.tiers.length - 1].y1;
    return b;
  }

  function landmark(rnd, id, lm, r) {
    var cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, h = floors(lm.type, lm.height), tiers = [], n;
    function sq(half, y1) { tiers.push(box(round2(cx - half), round2(cx + half), 0, y1, round2(cz - half), round2(cz + half))); }
    if (lm.style === 'taper') {
      // Stepped in small increments so it reads as tapering, the way the
      // tallest tower in the first clip does.
      for (n = 0; n < 7; n++) sq(22 - n * 2.4, floors(lm.type, h * (.3 + n * .7 / 6)));
    } else if (lm.style === 'deco') {
      sq(22, floors(lm.type, h * .55)); sq(17, floors(lm.type, h * .75)); sq(12, floors(lm.type, h * .88)); sq(7, h);
    } else {
      tiers.push(box(round2(r.x0 + 12), round2(r.x1 - 12), 0, floors(lm.type, h * .82), round2(cz - 15), round2(cz + 15)));
      tiers.push(box(round2(r.x0 + 20), round2(r.x1 - 20), 0, h, round2(cz - 12), round2(cz + 12)));
    }
    var b = { id: id, type: lm.type, tint: tint(rnd, lm.type), tiers: tiers, landmark: lm.style };
    b.x0 = tiers[0].x0; b.x1 = tiers[0].x1; b.z0 = tiers[0].z0; b.z1 = tiers[0].z1;
    b.height = h;
    b.spire = { x: round2(cx), z: round2(cz), y0: h, y1: h + (lm.style === 'taper' ? 90 : 55), r: lm.style === 'taper' ? 1.2 : 2 };
    return b;
  }

  // --- park -------------------------------------------------------------------
  function park(rnd) {
    var g = inset(PARK_RECT, L.SIDEWALK), paths = [], trees = [];
    var w = g.x1 - g.x0, d = g.z1 - g.z0;
    var pond = { x: round2(g.x0 + w * .55), z: round2(g.z0 + d * .24), rx: round2(w * .22), rz: round2(d * .1) };
    var meadow = { x: g.x0 + w * .42, z: g.z0 + d * .62, rx: w * .24, rz: d * .1 };
    function seg(x0, z0, x1, z1, width) { paths.push({ x0: round2(x0), z0: round2(z0), x1: round2(x1), z1: round2(z1), width: width }); }
    // The loop drive, then footpaths that cross it.
    var lx0 = g.x0 + 22, lx1 = g.x1 - 22, lz0 = g.z0 + 22, lz1 = g.z1 - 22;
    seg(lx0, lz0, lx1, lz0, 7); seg(lx1, lz0, lx1, lz1, 7); seg(lx1, lz1, lx0, lz1, 7); seg(lx0, lz1, lx0, lz0, 7);
    seg(g.x0, g.z0 + d * .45, g.x1, g.z0 + d * .5, 4);
    seg(g.x0 + w * .5, g.z0, g.x0 + w * .3, g.z0 + d * .45, 3.5);
    seg(g.x0 + w * .3, g.z0 + d * .45, g.x0 + w * .7, g.z1, 3.5);
    seg(g.x0, g.z0 + d * .82, g.x1, g.z0 + d * .78, 4);
    seg(g.x0 + w * .15, g.z0, g.x0 + w * .15, g.z0 + d * .45, 3);
    function nearPath(x, z, pad) {
      return paths.some(function (p) {
        var vx = p.x1 - p.x0, vz = p.z1 - p.z0, len2 = vx * vx + vz * vz;
        var t = Math.max(0, Math.min(1, ((x - p.x0) * vx + (z - p.z0) * vz) / len2));
        return Math.hypot(x - (p.x0 + vx * t), z - (p.z0 + vz * t)) < p.width / 2 + pad;
      });
    }
    function inEllipse(e, x, z, pad) { return Math.pow((x - e.x) / (e.rx + pad), 2) + Math.pow((z - e.z) / (e.rz + pad), 2) < 1; }
    var cell = 9, gx, gz;
    for (gx = g.x0 + 3; gx < g.x1 - 3; gx += cell) for (gz = g.z0 + 3; gz < g.z1 - 3; gz += cell) {
      if (rnd() < .22) continue;
      var x = gx + rnd() * cell * .9, z = gz + rnd() * cell * .9;
      if (x > g.x1 - 2 || z > g.z1 - 2) continue;
      if (inEllipse(pond, x, z, 5) || nearPath(x, z, 2.5)) continue;
      if (inEllipse(meadow, x, z, 0) && rnd() < .9) continue;
      trees.push({ x: round2(x), z: round2(z), h: round2(7 + rnd() * 8), r: round2(2.8 + rnd() * 2.6),
        color: Math.floor(rnd() * 6), bare: 0 });
    }
    return { rect: PARK_RECT, grass: g, pond: pond, paths: paths, trees: trees };
  }

  // --- construction site --------------------------------------------------------
  // Steel frame, scaffolding, brick stacks on pallets, tarps, a fence and a
  // crane - the arena from the first clip. Every part is a box; tarps are thin
  // boxes tipped over (rx/rz radians) and are the only parts you can walk through.
  function site(rnd, r) {
    var g = inset(r, L.SIDEWALK), parts = [], f, a, b, n;
    function part(kind, x0, x1, y0, y1, z0, z1, extra) {
      var p = box(round2(x0), round2(x1), round2(y0), round2(y1), round2(z0), round2(z1));
      p.kind = kind; p.collide = true;
      if (extra) for (var k in extra) p[k] = extra[k];
      parts.push(p); return p;
    }
    // Plywood hoarding round the edge with a gate on the south side.
    var fx0 = g.x0 + .3, fx1 = g.x1 - .3, fz0 = g.z0 + .3, fz1 = g.z1 - .3, gate = (fx0 + fx1) / 2 - 20;
    part('fence', fx0, fx1, 0, 2.4, fz0, fz0 + .2);
    part('fence', fx0, gate - 5, 0, 2.4, fz1 - .2, fz1);
    part('fence', gate + 5, fx1, 0, 2.4, fz1 - .2, fz1);
    part('fence', fx0, fx0 + .2, 0, 2.4, fz0 + .2, fz1 - .2);
    part('fence', fx1 - .2, fx1, 0, 2.4, fz0 + .2, fz1 - .2);
    // The frame: six storeys of columns and beams on an 8 m grid, slabs poured
    // on the lower floors only.
    var FL = 4.2, STOREYS = 6, ox = g.x1 - 46, oz = g.z0 + 10, cols = 6, rows = 4, sp = 8;
    var frame = { x0: ox, x1: ox + (cols - 1) * sp, z0: oz, z1: oz + (rows - 1) * sp, floor: FL, storeys: STOREYS };
    for (a = 0; a < cols; a++) for (b = 0; b < rows; b++) {
      var cx = ox + a * sp, cz = oz + b * sp, top = STOREYS * FL - (a > 3 && b > 1 ? 2 * FL : 0);
      part('steel', cx - .22, cx + .22, 0, top, cz - .22, cz + .22);
    }
    part('slab', frame.x0 - .5, frame.x1 + .5, 0, .25, frame.z0 - .5, frame.z1 + .5);
    for (f = 1; f <= STOREYS; f++) {
      var y = f * FL;
      for (b = 0; b < rows; b++) {
        var reach = f > STOREYS - 2 && b > 1 ? ox + 3 * sp : frame.x1;
        part('steel', frame.x0 - .2, reach + .2, y - .5, y, oz + b * sp - .18, oz + b * sp + .18);
      }
      for (a = 0; a <= (f > STOREYS - 2 ? 5 : cols - 1); a++) {
        var zEnd = f > STOREYS - 2 && a > 3 ? oz + sp : frame.z1;
        part('steel', ox + a * sp - .18, ox + a * sp + .18, y - .5, y, frame.z0 - .2, zEnd + .2);
      }
      if (f <= 3) part('slab', frame.x0 - .2, frame.x1 + .2, y, y + .25, frame.z0 - .2, frame.z1 + .2);
      else if (f === 4) part('slab', frame.x0 - .2, ox + 2 * sp + .2, y, y + .25, frame.z0 - .2, frame.z1 + .2);
    }
    // Scaffolding up the north face: standards, ledgers and walkable boards.
    var sz = frame.z0 - 2.2, sx0 = frame.x0, sx1 = frame.x0 + 24, lift = 2;
    for (a = sx0; a <= sx1 + 1e-6; a += 2.4) {
      part('scaffold', a - .05, a + .05, 0, 16.5, sz - .05, sz + .05, { collide: false });
      part('scaffold', a - .05, a + .05, 0, 16.5, sz + 1.25, sz + 1.35, { collide: false });
    }
    for (n = 1; n <= 8; n++) {
      part('scaffold', sx0, sx1, n * lift + .9, n * lift + 1, sz - .05, sz + .05, { collide: false });
      part('plank', sx0, sx1, n * lift - .08, n * lift, sz, sz + 1.3);
    }
    // Materials in the open yard: brick stacks on pallets, some under tarps,
    // and a pile of spare beams.
    var yard = { x0: g.x0 + 4, x1: ox - 6, z0: g.z0 + 4, z1: g.z1 - 4 }, stacks = [];
    for (n = 0; n < 14; n++) {
      var px = yard.x0 + rnd() * (yard.x1 - yard.x0 - 3), pz = yard.z0 + rnd() * (yard.z1 - yard.z0 - 3);
      var fp = { x0: px - .6, x1: px + 1.8, z0: pz - .6, z1: pz + 1.8 };
      if (stacks.some(function (s) { return overlaps(s, fp); })) continue;
      stacks.push(fp);
      var hgt = .8 + Math.floor(rnd() * 3) * .5;
      part('pallet', px, px + 1.2, 0, .15, pz, pz + 1.2);
      part('brick', px + .05, px + 1.15, .15, .15 + hgt, pz + .05, pz + 1.15);
      if (rnd() < .35) parts.push({ kind: 'tarp', x0: round2(px - .2), x1: round2(px + 1.4), y0: round2(.15 + hgt), y1: round2(.2 + hgt),
        z0: round2(pz - .2), z1: round2(pz + 1.4), rx: round2((rnd() - .5) * .5), rz: round2((rnd() - .5) * .5), color: Math.floor(rnd() * 3), collide: false });
    }
    for (n = 0; n < 5; n++) part('steel', yard.x0 + 2, yard.x0 + 14, n * .35, n * .35 + .35, yard.z1 - 6 + (n % 2) * .5, yard.z1 - 5.6 + (n % 2) * .5);
    // Tarps hung off the frame's open upper floors.
    [[frame.x0 + 1, frame.x0 + 9], [frame.x0 + 17, frame.x0 + 25]].forEach(function (span, k) {
      parts.push({ kind: 'tarp', x0: round2(span[0]), x1: round2(span[1]), y0: round2(4 * FL - 5), y1: round2(4 * FL - .5),
        z0: round2(frame.z1 + .25), z1: round2(frame.z1 + .3), rx: .08, rz: 0, color: k, collide: false });
    });
    // Site office cabin by the gate.
    part('cabin', gate - 12, gate - 6, 0, 2.7, fz1 - 3.2, fz1 - .6);
    // Tower crane in the yard, jib swung over the frame (kept inside the block).
    var mx = g.x0 + 14, mz = g.z0 + 16, mastTop = 62;
    var crane = { x: mx, z: mz, top: mastTop };
    part('crane', mx - 1.2, mx + 1.2, 0, mastTop, mz - 1.2, mz + 1.2);
    part('crane', mx - 1, g.x1 - 6, mastTop, mastTop + 2, mz - 1, mz + 1, { collide: false });
    part('crane', mx - 14, mx - 1, mastTop, mastTop + 1.6, mz - 1, mz + 1, { collide: false });
    part('counterweight', mx - 14, mx - 9, mastTop - 3, mastTop, mz - 1.4, mz + 1.4, { collide: false });
    part('cabin', mx + 1.2, mx + 3.6, mastTop - 3, mastTop, mz - 1.2, mz + 1.2, { collide: false });
    // Everything above was laid out from the ground up; the block is a kerb-high
    // slab, so stand it all on top of that.
    parts.forEach(function (p) { p.y0 = round2(p.y0 + L.CURB); p.y1 = round2(p.y1 + L.CURB); });
    frame.base = L.CURB;
    return { rect: r, ground: g, frame: frame, parts: parts, crane: crane, gate: { x: round2(gate), z: round2(fz1) } };
  }

  // --- the backdrop beyond the walkable city ------------------------------------
  // Plain boxes on the same street grid, out to where the haze swallows them, and
  // a far bank across the river. They have no collision; you can't reach them.
  function filler(rnd, id0) {
    var out = [], id = id0, i, j;
    function lotBoxes(r, far, tallness) {
      var n = 2 + Math.floor(rnd() * 3), x = r.x0, k;
      for (k = 0; k < n; k++) {
        var w = k === n - 1 ? r.x1 - x : (r.x1 - r.x0) / n * (.7 + rnd() * .6);
        if (w < 6) continue;
        var type = TYPE_NAMES[Math.floor(rnd() * 4)], h = heightFor(rnd, type, tallness) * (1 - far * .35);
        var halves = rnd() < .5 ? [[r.z0, r.z1]] : [[r.z0, (r.z0 + r.z1) / 2], [(r.z0 + r.z1) / 2, r.z1]];
        halves.forEach(function (hz) {
          var y = floors(type, h * (.8 + rnd() * .4));
          out.push({ id: id++, type: type, tint: tint(rnd, type), filler: true,
            tiers: [box(round2(x), round2(x + w), 0, y, round2(hz[0]), round2(hz[1]))] });
        });
        x += w;
      }
    }
    var reachI = Math.ceil(L.FILLER / PITCH_X), reachJ = Math.ceil(L.FILLER / PITCH_Z);
    for (i = 0; i < L.BLOCKS_X + reachI; i++) for (j = -reachJ; j < L.BLOCKS_Z + reachJ; j++) {
      if (i < L.BLOCKS_X && j >= 0 && j < L.BLOCKS_Z) continue;
      var r = inset(blockRect(i, j), L.SIDEWALK);
      var dist = Math.max(i - L.BLOCKS_X + 1, -j, j - L.BLOCKS_Z + 1, 0) / Math.max(reachI, reachJ);
      lotBoxes(r, Math.min(1, dist), j > L.BLOCKS_Z * .6 ? 1.4 : 1);
    }
    // Across the river: a lower skyline strip.
    var bank = X0 - L.PROMENADE - L.RIVER;
    for (i = 1; i <= 6; i++) for (j = -reachJ; j < L.BLOCKS_Z + reachJ; j++) {
      var rr = blockRect(0, j), x1 = bank - (i - 1) * PITCH_X - L.AVENUE;
      lotBoxes({ x0: x1 - L.BLOCK_X + 2 * L.SIDEWALK, x1: x1, z0: rr.z0 + L.SIDEWALK, z1: rr.z1 - L.SIDEWALK }, .3 + i * .1, .9);
    }
    return out;
  }

  // --- collision --------------------------------------------------------------
  // Everything solid, as axis-aligned boxes. Walkable tops are just the tops of
  // boxes: the kerb, roofs, parapets, slabs, the promenade.
  function collidersFor(city) {
    var out = [];
    city.blocks.forEach(function (b) { out.push(box(b.x0, b.x1, 0, L.CURB, b.z0, b.z1)); });
    city.buildings.forEach(function (b) { b.tiers.forEach(function (t) { out.push(t); }); });
    city.parapets.forEach(function (p) { out.push(p); });
    city.props.forEach(function (p) { if (p.kind !== 'spire') out.push(box(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1)); });
    city.site.parts.forEach(function (p) { if (p.collide) out.push(box(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1)); });
    city.park.trees.forEach(function (t) { out.push(box(t.x - .3, t.x + .3, 0, t.h * .5, t.z - .3, t.z + .3)); });
    var pr = city.promenade;
    out.push(box(pr.x0, pr.x1, -3, pr.top, pr.z0, pr.z1));
    pr.railing.forEach(function (r) { out.push(r); });
    return out;
  }

  // A uniform grid over the colliders so a query only looks at the boxes near
  // the player rather than all few thousand of them.
  var GRID_CELL = 24;
  function grid(city) {
    if (city._grid) return city._grid;
    var cells = {}, list = city.colliders;
    list.forEach(function (c, n) {
      var i0 = Math.floor(c.x0 / GRID_CELL), i1 = Math.floor(c.x1 / GRID_CELL),
          k0 = Math.floor(c.z0 / GRID_CELL), k1 = Math.floor(c.z1 / GRID_CELL), i, k;
      for (i = i0; i <= i1; i++) for (k = k0; k <= k1; k++) (cells[i + ',' + k] || (cells[i + ',' + k] = [])).push(n);
    });
    Object.defineProperty(city, '_grid', { value: cells, enumerable: false });
    return cells;
  }
  function query(city, x0, z0, x1, z1) {
    var cells = grid(city), seen = {}, out = [], i, k, n, list;
    for (i = Math.floor(x0 / GRID_CELL); i <= Math.floor(x1 / GRID_CELL); i++)
      for (k = Math.floor(z0 / GRID_CELL); k <= Math.floor(z1 / GRID_CELL); k++) {
        list = cells[i + ',' + k]; if (!list) continue;
        for (n = 0; n < list.length; n++) if (!seen[list[n]]) { seen[list[n]] = 1; out.push(city.colliders[list[n]]); }
      }
    return out;
  }

  // --- the whole city -----------------------------------------------------------
  function generate(seed) {
    seed = Number.isFinite(seed) ? seed : 1;
    var rnd = mulberry32(seed), i, j, id = 0;
    var city = { seed: seed, layout: L, bounds: { x0: X0, x1: X0 + WIDTH, z0: Z0, z1: Z0 + DEPTH },
      blocks: [], roads: roads(), buildings: [], parapets: [], props: [] };
    city.markings = markings(city.roads);

    var spawnBlock = blockRect(L.SPAWN.i, L.SPAWN.j), spawnInner = inset(spawnBlock, L.SIDEWALK);
    var spawnLot = { x0: spawnInner.x0, x1: round2(spawnInner.x0 + 40), z0: spawnInner.z0, z1: spawnInner.z1 };
    var spawnCentre = { x: (spawnLot.x0 + spawnLot.x1) / 2, z: (spawnLot.z0 + spawnLot.z1) / 2 };
    // You start in the roof's north-east corner, just inside the parapet, so
    // the streets below are in view and not hidden behind it.
    var spawnAt = { x: spawnLot.x1 - 1.8, z: spawnLot.z0 + 1.8 };
    var landmarkAt = {};
    LANDMARKS.forEach(function (lm) { landmarkAt[lm.i + ',' + lm.j] = lm; });

    for (i = 0; i < L.BLOCKS_X; i++) for (j = 0; j < L.BLOCKS_Z; j++) {
      var r = blockRect(i, j);
      if (inside(r, PARK_RECT)) continue;
      var kind = i === L.SITE.i && j === L.SITE.j ? 'site' : 'city';
      city.blocks.push({ i: i, j: j, kind: kind, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 });
      if (kind === 'site') continue;
      var inner = inset(r, L.SIDEWALK), dist = district(i, j), lm = landmarkAt[i + ',' + j], lots;
      if (lm) { city.buildings.push(landmark(rnd, id++, lm, inner)); continue; }
      if (i === L.SPAWN.i && j === L.SPAWN.j) {
        // One plain tier, so the whole roof is flat and open.
        var top = floors('office', L.SPAWN_HEIGHT);
        city.buildings.push({ id: id++, type: 'office', tint: tint(rnd, 'office'), spawn: true, height: top,
          tiers: [box(spawnLot.x0, spawnLot.x1, 0, top, spawnLot.z0, spawnLot.z1)],
          x0: spawnLot.x0, x1: spawnLot.x1, z0: spawnLot.z0, z1: spawnLot.z1 });
        lots = lotsFor(rnd, { x0: spawnLot.x1, x1: inner.x1, z0: inner.z0, z1: inner.z1 });
      } else lots = lotsFor(rnd, inner);
      lots.forEach(function (lot) {
        var type = chooseType(rnd, dist.w), h = heightFor(rnd, type, dist.tall);
        // Nothing near the spawn tower may stand taller than it, so the opening
        // view is over the city, not into a wall.
        var cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
        if (Math.hypot(cx - spawnCentre.x, cz - spawnCentre.z) < 320) h = Math.min(h, 110);
        city.buildings.push(makeBuilding(rnd, id++, type, lot, h));
      });
    }

    // Roofs: parapets on every tier, props on the top one.
    var spawnClear = { x0: spawnAt.x - 12, x1: spawnAt.x + 12, z0: spawnAt.z - 12, z1: spawnAt.z + 12 };
    city.buildings.forEach(function (b) {
      b.tiers.forEach(function (t) { parapetsFor(t, TYPES[b.type].parapet, city.parapets); });
      if (b.spire) { city.props.push({ kind: 'spire', x0: b.spire.x - b.spire.r, x1: b.spire.x + b.spire.r,
        z0: b.spire.z - b.spire.r, z1: b.spire.z + b.spire.r, y0: b.spire.y0, y1: b.spire.y1, legs: 0 }); return; }
      roofPropsFor(rnd, b, b.tiers[b.tiers.length - 1], city.props, b.spawn ? spawnClear : null);
    });

    var spawnTower = city.buildings.filter(function (b) { return b.spawn; })[0];
    // Facing north-east: the park and the landmark towers ahead, the river on
    // your left - the opening shot of the second clip.
    city.spawn = { x: round2(spawnAt.x), y: spawnTower.height, z: round2(spawnAt.z), yaw: -Math.PI / 4, building: spawnTower.id };

    city.park = park(rnd);
    var siteBlock = city.blocks.filter(function (b) { return b.kind === 'site'; })[0];
    city.site = site(rnd, siteBlock);

    var px1 = X0, px0 = X0 - L.PROMENADE;
    city.promenade = { x0: px0, x1: px1, z0: Z0, z1: Z0 + DEPTH, top: .4,
      railing: [box(px0, px0 + .15, .4, 1.5, Z0, Z0 + DEPTH)], trees: [] };
    for (j = Z0 + 8; j < Z0 + DEPTH - 4; j += 14)
      city.promenade.trees.push({ x: round2(px0 + 6), z: round2(j + (rnd() - .5) * 3), h: round2(6 + rnd() * 3), r: round2(2.2 + rnd()), color: Math.floor(rnd() * 6), bare: rnd() < .5 ? 1 : 0 });
    city.water = { x0: px0 - L.RIVER - 4000, x1: px0, z0: Z0 - 5000, z1: Z0 + DEPTH + 5000, y: -1.2 };
    city.walk = { x0: px0 + .5, x1: X0 + WIDTH, z0: Z0, z1: Z0 + DEPTH };
    city.filler = filler(rnd, id);
    city.colliders = collidersFor(city);
    return city;
  }

  var api = { generate: generate, query: query, blockRect: blockRect, layout: L, TYPES: TYPES,
    overlaps: overlaps, inside: inside, PARK_RECT: PARK_RECT, mulberry32: mulberry32 };
  if (typeof module !== 'undefined') module.exports = api;
  root.City = api;
})(typeof window === 'undefined' ? globalThis : window);

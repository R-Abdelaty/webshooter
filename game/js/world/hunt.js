(function (root) {
  'use strict';
  // How the Rhino and Venom come after you (docs/PLAYER_PLAN.md, Session P8).
  // No Three.js: fight.js asks these where to go next, and moves them.
  //
  // THE RHINO keeps to the streets. The roads are a grid - avenues along z,
  // streets along x - and he may use the road and most of its pavement
  // (never the park's lawns, never a building). roads(city) makes that grid
  // once: the road strips as rectangles, and a node at every junction.
  //   snap(g, p)          the nearest point he can stand on to p
  //   route(g, from, to)  the way there along the streets: a list of
  //                       points, each in a straight line from the one
  //                       before along one road (the last is snap(to))
  //   around(g, you, from, ok)  a spot on the street near you that `ok`
  //                       likes (a clear throw at you), nearest him first
  //
  // VENOM goes over the top. hop(city, here, you, o) is his next move from
  // where he stands: a leap to a roof, the street, a beam, or next to you -
  // or, when you're higher than he can leap, onto the wall of a building to
  // climb it - whichever brings him nearest you, and only along a clear arc.
  // Null when he's as near as he needs to be (or nothing gets him nearer).
  // A wall is { x, y, z (his root, WALL_OFF out from the wall), nx, nz (its
  // outward normal), top (the roof he climbs to), box }; face into it.
  //
  // x east, z south, y up, metres.

  function need(name, file) { return root[name] || (typeof require === 'function' ? require(file) : null); }
  var CityRef = need('City', './city.js');
  var EncRef = need('Encounters', './encounters.js');
  var AttacksRef = need('Attacks', './attacks.js');

  var K = {
    // The Rhino: how far past a road's edge onto the pavement he may go (the
    // buildings stand SIDEWALK back from it), and how finely a straight run
    // is looked along.
    KERB: 2.5,
    RING: [12, 20, 28, 36], RING_DIRS: 16,   // where around(...) looks for a spot near you
    // Venom: how far a hop may go (level metres, tried at each of these and
    // in DIRS directions), how far up a leap can take him, how near you is
    // near enough, how much nearer a hop must bring him, what a metre of
    // climbing costs next to a metre of leaping, and how far off the wall
    // his root is when he clings to it (his crawl clips reach 0.6 m ahead).
    HOPS: [5, 9, 13, 17], DIRS: 16, MAX_UP: 7, NEAR: 5, GAIN: 1.5, CLIMB_COST: 1.7, WALL_OFF: .6,
    WALL_MIN: 3.5,          // a wall worth climbing rises at least this far above him
    CLING_UP: 2.5,          // he leaps onto a wall this far above where he stands...
    TOP_REACH: 2.3,         // ...and climbs until his root is this far below its top, then hops over
    ROOF_IN: 1.8,           // landing this far in from the edge
    UP_W: 1.5, DOWN_W: .5   // near you on the street: a metre below you costs this much, above you this
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function h2(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  // --- the rhino's streets --------------------------------------------------------
  function roads(city) {
    var L = city.layout, B = city.bounds, P = CityRef.PARK_RECT;
    var PX = L.BLOCK_X + L.AVENUE, PZ = L.BLOCK_Z + L.STREET, NX = L.BLOCKS_X, NZ = L.BLOCKS_Z;
    var ha = L.AVENUE / 2 + K.KERB, hs = L.STREET / 2 + K.KERB, rects = [], nodes = [], i, k, r;
    function ax(n) { return B.x0 + n * PX + L.AVENUE / 2; }
    function sz(n) { return B.z0 + n * PZ + L.STREET / 2; }
    function inPark(x, z) { return x > P.x0 + .5 && x < P.x1 - .5 && z > P.z0 + .5 && z < P.z1 - .5; }
    // The strips, split where they would cross the park.
    for (k = 0; k <= NX; k++) {
      var x = ax(k);
      if (x > P.x0 && x < P.x1) {
        rects.push({ x0: x - ha, x1: x + ha, z0: B.z0, z1: P.z0 + K.KERB, kind: 'avenue', n: k });
        rects.push({ x0: x - ha, x1: x + ha, z0: P.z1 - K.KERB, z1: B.z1, kind: 'avenue', n: k });
      } else rects.push({ x0: x - ha, x1: x + ha, z0: B.z0, z1: B.z1, kind: 'avenue', n: k });
    }
    for (r = 0; r <= NZ; r++) {
      var z = sz(r);
      if (z > P.z0 && z < P.z1) {
        rects.push({ x0: B.x0, x1: P.x0 + K.KERB, z0: z - hs, z1: z + hs, kind: 'street', n: r });
        rects.push({ x0: P.x1 - K.KERB, x1: B.x1, z0: z - hs, z1: z + hs, kind: 'street', n: r });
      } else rects.push({ x0: B.x0, x1: B.x1, z0: z - hs, z1: z + hs, kind: 'street', n: r });
    }
    // A node at every junction outside the park; each rect knows its nodes.
    var id = {};
    for (k = 0; k <= NX; k++) for (r = 0; r <= NZ; r++) {
      if (inPark(ax(k), sz(r))) continue;
      id[k + ',' + r] = nodes.length;
      nodes.push({ x: ax(k), z: sz(r), k: k, r: r, adj: [] });
    }
    rects.forEach(function (c) {
      c.nodes = [];
      nodes.forEach(function (q, n) { if (inRect(c, q)) c.nodes.push(n); });
    });
    // Neighbours: the next junction along an avenue or a street, if the way
    // between is a road (not across the park).
    nodes.forEach(function (q, n) {
      [[1, 0], [0, 1]].forEach(function (d) {
        var m = id[(q.k + d[0]) + ',' + (q.r + d[1])];
        if (m === undefined) return;
        var o = nodes[m];
        if (!share({ rects: rects }, q, o)) return;
        var len = h2(q, o);
        q.adj.push({ to: m, len: len }); o.adj.push({ to: n, len: len });
      });
    });
    return { rects: rects, nodes: nodes };
  }
  function inRect(c, p) { return p.x >= c.x0 - 1e-6 && p.x <= c.x1 + 1e-6 && p.z >= c.z0 - 1e-6 && p.z <= c.z1 + 1e-6; }
  function rectsAt(g, p) { return g.rects.filter(function (c) { return inRect(c, p); }); }
  // Do a and b lie on one strip (so the straight line between them does)?
  function share(g, a, b) { return g.rects.some(function (c) { return inRect(c, a) && inRect(c, b); }); }
  function onRoad(g, p) { return g.rects.some(function (c) { return inRect(c, p); }); }
  // The nearest point on the roads to p.
  function snap(g, p) {
    var best = null, bd = Infinity;
    g.rects.forEach(function (c) {
      var q = { x: clamp(p.x, c.x0, c.x1), z: clamp(p.z, c.z0, c.z1) }, d = h2(q, p);
      if (d < bd) { bd = d; best = q; }
    });
    return best;
  }
  // The way from `from` to `to` along the streets: [points], ending at snap(to).
  function route(g, from, to) {
    var a = onRoad(g, from) ? { x: from.x, z: from.z } : snap(g, from), b = snap(g, to);
    if (share(g, a, b)) return [b];
    var n = g.nodes.length, dist = new Array(n), prev = new Array(n), done = new Array(n), i;
    for (i = 0; i < n; i++) { dist[i] = Infinity; prev[i] = -1; done[i] = false; }
    rectsAt(g, a).forEach(function (c) { c.nodes.forEach(function (m) { dist[m] = Math.min(dist[m], h2(a, g.nodes[m])); }); });
    var goal = {};
    rectsAt(g, b).forEach(function (c) { c.nodes.forEach(function (m) { goal[m] = h2(b, g.nodes[m]); }); });
    var best = -1, bestCost = Infinity;
    for (;;) {
      var u = -1, du = Infinity;
      for (i = 0; i < n; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
      if (u < 0 || du >= bestCost) break;
      done[u] = true;
      if (goal[u] !== undefined && du + goal[u] < bestCost) { bestCost = du + goal[u]; best = u; }
      g.nodes[u].adj.forEach(function (e) {
        if (du + e.len < dist[e.to]) { dist[e.to] = du + e.len; prev[e.to] = u; }
      });
    }
    if (best < 0) return [b];
    var path = [];
    for (i = best; i >= 0; i = prev[i]) path.unshift({ x: g.nodes[i].x, z: g.nodes[i].z });
    path.push(b);
    // Straight on past junctions that aren't a turn.
    var out = [], at = a;
    for (i = 0; i < path.length; i++) {
      if (i + 1 < path.length && share(g, at, path[i + 1])) continue;
      out.push(path[i]); at = path[i];
    }
    return out;
  }
  // How far that is.
  function length(from, pts) {
    var l = 0, at = from;
    pts.forEach(function (p) { l += h2(at, p); at = p; });
    return l;
  }
  // A spot on the street around you that ok(spot) accepts, nearest `from`
  // first (or null): where he can throw at you from.
  function around(g, you, from, ok) {
    var list = [], seen = {};
    K.RING.forEach(function (r) {
      for (var i = 0; i < K.RING_DIRS; i++) {
        var a = i / K.RING_DIRS * Math.PI * 2, p = snap(g, { x: you.x + Math.cos(a) * r, z: you.z + Math.sin(a) * r });
        var key = Math.round(p.x) + ',' + Math.round(p.z);
        if (seen[key]) continue;
        seen[key] = true; list.push(p);
      }
    });
    list.sort(function (p, q) { return h2(p, from) - h2(q, from); });
    for (var j = 0; j < list.length; j++) if (ok(list[j])) return list[j];
    return null;
  }

  // --- venom over the top ---------------------------------------------------------
  // What you're up on: the building (the box) whose top you stand on - the
  // biggest one with its top from 1.5 m under your feet (a parapet's roof)
  // to just over them - if it's worth climbing. Null on the street, or in
  // the air with nothing under you.
  function perchOf(city, you) {
    var best = null;
    CityRef.query(city, you.x - .4, you.z - .4, you.x + .4, you.z + .4).forEach(function (c) {
      if (c.y1 < K.WALL_MIN || c.y1 > you.y + .3 || c.y1 < you.y - 1.5) return;
      if (you.x < c.x0 - .4 || you.x > c.x1 + .4 || you.z < c.z0 - .4 || you.z > c.z1 + .4) return;
      if (!best || (c.x1 - c.x0) * (c.z1 - c.z0) > (best.x1 - best.x0) * (best.z1 - best.z0)) best = c;
    });
    return best;
  }
  // How long it would take him to get to you from p, in metres of leaping:
  // on the street (or you in the air), how far, and a metre he'd have to
  // go up or down counts UP_W or DOWN_W; with you up on building B, the
  // level way to B, then over its roof to you, plus CLIMB_COST a metre of
  // its wall he'd have to climb - from his own height if he's within a
  // leap of it, else from the street (from far off he'll have to come down
  // anyway: minding his height there got him stuck on high beams). None of
  // the climb if he can leap straight onto it. Always less as he comes on.
  function eta(p, you, B, reach) {
    if (!B) {
      var dy = you.y - p.y;
      return h2(p, you) + (dy > 0 ? K.UP_W * dy : K.DOWN_W * -dy);
    }
    var qx = clamp(p.x, B.x0, B.x1), qz = clamp(p.z, B.z0, B.z1), e = Math.hypot(p.x - qx, p.z - qz);
    if (e < 1e-6 && p.y >= B.y1 - .1) return h2(p, you);                   // up there with you
    var rest = Math.hypot(you.x - qx, you.z - qz), from = e <= reach ? p.y : 0, climb = Math.max(0, B.y1 - from);
    if (e <= reach && climb <= K.MAX_UP - 1) climb = 0;                     // a leap takes him up
    else if (e <= reach) climb = Math.max(0, climb - K.CLING_UP);          // he clings on above his head
    return e + rest + K.CLIMB_COST * climb;
  }
  // (kept for the tests and the page's readout: how near a point is to you, from the street's view)
  function gap(p, you) { return eta(p, you, null); }
  // o: { perches (his beams: a hop may end on one), walk (the city's
  // walkable bounds), exact (you is a place to get to - a beam - rather
  // than someone to get near) }. here: his feet (or his root on a wall).
  function hop(city, here, you, o) {
    o = o || {};
    if (!o.exact && h2(here, you) <= K.NEAR && Math.abs(you.y - here.y) <= 2) return null;
    var reach = K.HOPS[K.HOPS.length - 1], walk = o.walk || city.walk, B = o.exact ? null : perchOf(city, you);
    var best = null, bestScore = eta(here, you, B, reach) - K.GAIN;
    function stand(x, z, perch) {
      if (walk && (x < walk.x0 + 1 || x > walk.x1 - 1 || z < walk.z0 + 1 || z > walk.z1 - 1)) return;
      var y = perch ? perch.y : EncRef.groundAt(city, x, z, here.y + K.MAX_UP);
      var p = { x: x, y: y, z: z };
      // Never right on top of you (a pounce comes down POUNCE_GAP off).
      if (!o.exact && Math.hypot(x - you.x, y - you.y, z - you.z) < AttacksRef.constants.POUNCE_GAP - .01) return;
      if (!perch && !AttacksRef.room(city, x, y, z, .45)) return;
      var sc = eta(p, you, B, reach) + .05 * h2(p, here);
      if (sc >= bestScore) return;                 // (the arc is the dear part: only for a better one)
      if (!AttacksRef.arcClear(city, here, p)) return;
      bestScore = sc; best = { to: p, perch: perch ? o.perches.indexOf(perch) : undefined };
    }
    // Next to you, if he can get there in one.
    var by = o.exact ? null : AttacksRef.landing(city, you, here);
    if (by && h2(by, here) <= reach && by.y - here.y <= K.MAX_UP) stand(by.x, by.z);
    // His beams.
    (o.perches || []).forEach(function (q) { if (h2(q, here) <= reach && q.y - here.y <= K.MAX_UP) stand(q.x, q.z, q); });
    // All round him, facing you first.
    var a0 = Math.atan2(you.z - here.z, you.x - here.x);
    for (var i = 0; i < K.DIRS; i++) {
      var a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI * 2 / K.DIRS;
      K.HOPS.forEach(function (d) { stand(here.x + Math.cos(a) * d, here.z + Math.sin(a) * d); });
    }
    // A wall to climb, when you're up higher than a leap takes him: yours,
    // or a lower one on the way. Its worth is getting onto its roof, less
    // the climb.
    if (B && B.y1 - here.y > K.MAX_UP - 1) {
      CityRef.query(city, here.x - reach, here.z - reach, here.x + reach, here.z + reach).forEach(function (c) {
        if (c.y1 - here.y < K.WALL_MIN || c.y0 > here.y + 1 || c.y1 > B.y1 + .1) return;
        var w = wallOf(city, c, here);
        if (!w || h2(w, here) > reach) return;
        var up = { x: clamp(you.x, c.x0 + K.ROOF_IN, c.x1 - K.ROOF_IN), y: c.y1, z: clamp(you.z, c.z0 + K.ROOF_IN, c.z1 - K.ROOF_IN) };
        var sc = eta(up, you, B, reach) + K.CLIMB_COST * (c.y1 - w.y) + .05 * h2(w, here);
        if (sc >= bestScore || !AttacksRef.arcClear(city, here, w)) return;
        bestScore = sc; best = { to: { x: w.x, y: w.y, z: w.z }, wall: w };
      });
    }
    return best;
  }
  // Where on box c's wall (the face towards `from`) he clings, leaping from
  // `from`: his root WALL_OFF out from it, CLING_UP above his feet (never
  // above where he'd climb over). Null if there's no room there.
  function wallOf(city, c, from) {
    var qx = clamp(from.x, c.x0, c.x1), qz = clamp(from.z, c.z0, c.z1), dx = from.x - qx, dz = from.z - qz;
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return null;      // he's over it
    var nx = 0, nz = 0;
    if (Math.abs(dx) >= Math.abs(dz)) nx = dx > 0 ? 1 : -1; else nz = dz > 0 ? 1 : -1;
    // Along the face, not round the corner: in from its ends.
    if (nx) qz = clamp(from.z, c.z0 + 1, c.z1 - 1); else qx = clamp(from.x, c.x0 + 1, c.x1 - 1);
    var y = clamp(from.y + K.CLING_UP, c.y0 + .3, c.y1 - K.TOP_REACH);
    var w = { x: qx + nx * K.WALL_OFF, y: y, z: qz + nz * K.WALL_OFF, nx: nx, nz: nz, top: c.y1, box: c };
    // Nothing else in the way of him there (another building against this one).
    var clash = CityRef.query(city, w.x - .3, w.z - .3, w.x + .3, w.z + .3).some(function (b) {
      return b !== c && b.y1 > w.y + .3 && b.y0 < w.y + 2.6 && w.x > b.x0 - .3 && w.x < b.x1 + .3 && w.z > b.z0 - .3 && w.z < b.z1 + .3;
    });
    return clash ? null : w;
  }
  // Where he lands, climbing over the top of wall w: ROOF_IN in from the
  // edge, on whatever is up there. Null if there's no room.
  function over(city, w) {
    for (var k = 0; k < 3; k++) {
      var d = K.WALL_OFF + K.ROOF_IN + k, x = w.x - w.nx * d, z = w.z - w.nz * d, y = EncRef.groundAt(city, x, z, w.top + 3);
      if (y >= w.top - .05 && AttacksRef.room(city, x, y, z, .45)) return { x: x, y: y, z: z };
    }
    return null;
  }
  // Which way he faces clinging to w: into the wall.
  function wallYaw(w) { return Math.atan2(-w.nx, -w.nz); }

  var api = { roads: roads, snap: snap, route: route, length: length, around: around, share: share, onRoad: onRoad,
    hop: hop, gap: gap, eta: eta, perchOf: perchOf, wallOf: wallOf, over: over, wallYaw: wallYaw, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Hunt = api;
})(typeof window === 'undefined' ? globalThis : window);

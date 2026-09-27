(function (root) {
  'use strict';
  // Web-swinging (docs/PLAYER_PLAN.md, Session P3): the line, the pendulum,
  // letting go, the zip to a roof and the perch. No Three.js: world-game.js
  // calls it and player-view.js / web-lines.js draw what it says.
  //
  // A flick or a click is judged by decide() in the order the plan fixes:
  //   1. a villain (or the training target) near the aim  -> 'shot'
  //   2. a building wall within RANGE and not below you    -> 'attach' (a line to swing on)
  //   3. a roof edge or roof top within RANGE              -> 'zip' (pulled up to it, perched)
  //   4. nothing that will take a line                     -> 'release' the line you hold, or 'none'
  //
  // While it has the player (mode 'swing', 'fly', 'zip' or 'perch') it owns
  // his position and velocity and world-game.js doesn't call Player.step; in
  // mode 'none' Player walks and jumps as before. The models only show it.
  //
  //   swing  the line holds your hands (GRIP above your feet) to the anchor:
  //          a rope, not a rod - slack when you're nearer than its length,
  //          taut and pulling when you reach it. Gravity is Player's. Past
  //          the bottom of the arc it reels in a little (SHORTEN), keeping
  //          your angular momentum, so a chain of swings gains height. It
  //          also reels in to keep your feet CLEAR of what's under you.
  //   fly    let go: you keep your speed (plus a BOOST if you let go near
  //          the top of the forward arc) and steer a little, until you land.
  //   zip    a fast eased pull along the line to a roof edge or top...
  //   perch  ...crouched there, facing out, until you move (walk off) or
  //          jump (dive off).
  //
  // Collision reuses Player's: walls push you out (and take the velocity
  // going into them, so you slide along), a floor under you lands you. No
  // fall damage. Nothing ever ends inside a building.
  //
  // Axes and yaw as Player's: x east, z south, y up; yaw 0 looks -z.

  function need(name, file) { return root[name] || (typeof require === 'function' ? require(file) : null); }
  var PlayerRef = need('Player', './player.js'), CityRef = need('City', './city.js');
  var PK = PlayerRef.constants;

  var K = {
    RANGE: 60,              // metres from your hands a line or a zip reaches
    BELOW: 1.5,             // an anchor may be this far below your hands, no more
    WALL_NY: .5,            // a surface whose normal is flatter than this is a wall...
    TOP_NY: .7,             // ...and steeper than this, a top
    EDGE_DROP: 2.5,         // a wall hit this close under the top of its building is its roof edge (a zip)
    MIN_TOP: 2,             // a top lower than this over the street is no roof (kerbs, pallets, the street)
    EDGE_SNAP: 3,           // a zip to a top this close to its edge perches on the edge
    MIN_ZIP: 2,             // a zip shorter than this isn't worth one
    VILLAIN_PAD: .3,        // an anchor this close to a villain's body is in it
    SHOT_CONE: 4,           // degrees: aiming this close to a villain is a shot, never a swing
    GRIP: 2.1,              // metres over your feet that the line holds (the hands, raised)
    MIN_LEN: 3, MAX_LEN: 60,
    LOW: .3,                // on attach the line reels in until the arc's bottom is this share of the anchor's height over the ground...
    REEL: 18,               // ...at this many m/s
    CLEAR: 1.4,             // the line keeps your feet this far over what's under you...
    CLEAR_RATE: 40,         // ...reeling in at up to this many m/s to do it
    SHORTEN: .22,           // near the bottom of the arc it reels in this share of its length a second...
    BOTTOM: .45,            // ...within this many radians of straight down...
    SHORTEN_V: 4,           // ...going at least this fast...
    PUMP_MAX: .3,           // ...and by no more than this share of the length it had on attach
    MAX_SPEED: 36,          // m/s, swinging or flying
    STEER: 6,               // m/s/s of steering from Move.vector() on a line...
    FLY_STEER: 5,           // ...and after letting go (it adds, it never brakes)
    // You swing where you look: your level velocity turns toward the view's
    // heading at this many radians a second on a line, and in the air (never
    // when it's more than LOOK_MAX off, so looking back doesn't reverse you).
    // The wrist alone has no stick to steer with; this is how it steers.
    LOOK_TURN: .9, LOOK_FLY: .5, LOOK_MAX: 1.75,
    BOOST: 4.5, BOOST_UP: 3, // m/s a release near the top of the forward arc adds, ahead and up
    TOP_ARC: [.45, 1],      // radians from straight down over which that boost comes in
    YANK: 9, YANK_UP: 5,    // m/s a line shot from standing throws you toward it, and up
    ZIP_SPEED: 42, ZIP_T: [.35, 1.1], ZIP_LIFT: 2.2, ZIP_OUT: 1.2,
    DIVE: 7,                // m/s forward, jumping off a perch
    SUB: 1 / 120            // the physics steps no longer than this
  };

  function create() {
    return { mode: 'none', anchor: null, len: 0, len0: 0, want: 0, hand: null, taut: false, load: 0, zip: null, perch: null,
      jumpHeld: false, t: 0 };
  }

  // --- small maths ----------------------------------------------------------------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function dist(a, b) { return len(sub(a, b)); }
  function copy(a) { return { x: a.x, y: a.y, z: a.z }; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function grip(p) { return { x: p.x, y: p.y + K.GRIP, z: p.z }; }
  function speed(p) { return Math.hypot(p.vx, p.vy, p.vz); }
  function yawOf(v) { return Math.atan2(-v.x, -v.z); }

  // How close a ray (o, unit d) comes to a segment a-b: { d: the gap, t: how
  // far along the ray }. Never behind the origin.
  function raySeg(o, d, a, b) {
    var u = sub(b, a), cc = dot(u, u), s = 0, k;
    if (cc < 1e-12) s = 0;
    else {
      // The segment point nearest the ray's line, then the ray point nearest that, then back.
      var w = sub(o, a), bb = dot(d, u), den = cc - bb * bb;
      s = den > 1e-9 ? clamp((dot(u, w) - bb * dot(d, w)) / den, 0, 1) : 0;
    }
    for (k = 0; k < 2; k++) {
      var q = { x: a.x + u.x * s, y: a.y + u.y * s, z: a.z + u.z * s }, t = Math.max(0, dot(sub(q, o), d));
      var r = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
      if (cc > 1e-12) s = clamp(dot(sub(r, a), u) / cc, 0, 1);
    }
    q = { x: a.x + u.x * s, y: a.y + u.y * s, z: a.z + u.z * s }; t = Math.max(0, dot(sub(q, o), d));
    return { d: dist(q, { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }), t: t };
  }
  function pointSeg(p, a, b) {
    var u = sub(b, a), cc = dot(u, u), s = cc > 1e-12 ? clamp(dot(sub(p, a), u) / cc, 0, 1) : 0;
    return dist(p, { x: a.x + u.x * s, y: a.y + u.y * s, z: a.z + u.z * s });
  }

  // Is any capsule ({a, b, r}) within `deg` degrees of the ray, in front of
  // it and nearer than `blocked` (where the city is along it)?
  function inCone(o, d, caps, deg, blocked) {
    var tol = (Number.isFinite(deg) ? deg : K.SHOT_CONE) * Math.PI / 180, far = Number.isFinite(blocked) ? blocked : Infinity;
    for (var i = 0; caps && i < caps.length; i++) {
      var c = caps[i], m = raySeg(o, d, c.a, c.b);
      if (m.t <= 0 && m.d > c.r) continue;
      if (m.t - c.r > far + .05) continue;
      if (Math.atan2(Math.max(0, m.d - c.r), Math.max(1e-6, m.t)) <= tol) return true;
    }
    return false;
  }

  // --- what the aim is at ------------------------------------------------------------
  function inBox(b, x, y, z, e) { return x >= b.x0 - e && x <= b.x1 + e && y >= b.y0 - e && y <= b.y1 + e && z >= b.z0 - e && z <= b.z1 + e; }
  function near(city, x, z, r) { return CityRef.query(city, x - r, z - r, x + r, z + r); }
  // The collision box a surface point lies on: the one it is just inside,
  // whose top is the lowest above it (the face it is on, not one behind).
  function boxAt(city, q) {
    var best = null;
    near(city, q.x, q.z, .2).forEach(function (b) {
      if (inBox(b, q.x, q.y, q.z, .03) && (!best || b.y1 < best.y1)) best = b;
    });
    return best;
  }
  // The top you'd stand on at (x, z), starting on a top at y: parapets and
  // props sit on tops, so climb any box standing there. { y, box }.
  function stack(city, x, z, y, box) {
    for (var n = 0; n < 6; n++) {
      var up = null;
      near(city, x, z, .05).forEach(function (b) {
        if (x >= b.x0 - 1e-3 && x <= b.x1 + 1e-3 && z >= b.z0 - 1e-3 && z <= b.z1 + 1e-3 && Math.abs(b.y0 - y) < .06 && b.y1 > y + 1e-3 && (!up || b.y1 > up.y1)) up = b;
      });
      if (!up) break;
      y = up.y1; box = up;
    }
    return { y: y, box: box };
  }
  // The box's width along a horizontal axis ('x' or 'z').
  function extent(b, axis) { return axis === 'x' ? b.x1 - b.x0 : b.z1 - b.z0; }

  // Perched on the edge of `box` (a top), on its side facing `out` (a unit
  // axis, {x, z}), at `along` (the other coordinate): on the parapet if one
  // stands there, centred on it; else just in from the edge.
  function edgePerch(city, box, out, along) {
    var ax = Math.abs(out.x) > Math.abs(out.z) ? 'x' : 'z', sgn = ax === 'x' ? Math.sign(out.x) : Math.sign(out.z);
    var edge = ax === 'x' ? (sgn > 0 ? box.x1 : box.x0) : (sgn > 0 ? box.z1 : box.z0);
    var R = PK.RADIUS, lo = ax === 'x' ? box.z0 : box.x0, hi = ax === 'x' ? box.z1 : box.x1;
    var o = hi - lo > 2 * R ? clamp(along, lo + R, hi - R) : (lo + hi) / 2;
    function at(inset) { var c = edge - sgn * inset; return ax === 'x' ? { x: c, z: o } : { x: o, z: c }; }
    var probe = at(.05), top = stack(city, probe.x, probe.z, box.y1, box);
    var inset = top.box !== box ? extent(top.box, ax) / 2 : Math.min(R, extent(box, ax) / 2);
    var p = at(inset);
    top = stack(city, p.x, p.z, box.y1, box);
    return { x: p.x, y: top.y, z: p.z, yaw: yawOf({ x: ax === 'x' ? sgn : 0, z: ax === 'z' ? sgn : 0 }), edge: true };
  }
  // Somewhere to stand is somewhere Player's walls don't push you out of.
  function clear(city, q) {
    var t = { x: q.x, y: q.y, z: q.z };
    PlayerRef.resolveWalls(t, city);
    return Math.hypot(t.x - q.x, t.z - q.z) < .05;
  }

  // What a hit (world.raycast's { point, normal, distance }) would do for a
  // player p. opts.villains: capsules an anchor mustn't be in.
  //   -> { kind: 'wall', point } | { kind: 'zip', point, perch: {x, y, z, yaw, edge} } | { kind: null, why }
  function classify(city, hit, p, opts) {
    opts = opts || {};
    if (!hit || !hit.point || !hit.normal) return { kind: null, why: 'nothing' };
    var pt = hit.point, n = hit.normal, g = grip(p);
    if (dist(g, pt) > K.RANGE) return { kind: null, why: 'far' };
    var box = boxAt(city, { x: pt.x - n.x * .05, y: pt.y - n.y * .05, z: pt.z - n.z * .05 });
    if (!box) return { kind: null, why: 'not a building' };
    var perch = null;
    if (Math.abs(n.y) < K.WALL_NY) {
      var out = Math.abs(n.x) > Math.abs(n.z) ? { x: Math.sign(n.x), z: 0 } : { x: 0, z: Math.sign(n.z) };
      var face = edgePerch(city, box, out, out.x ? pt.z : pt.x);
      if (box.y1 - pt.y <= K.EDGE_DROP) {
        if (face.y < K.MIN_TOP) return { kind: null, why: 'low' };
        perch = face;
      } else {
        if (pt.y < g.y - K.BELOW) return { kind: null, why: 'below' };
        var caps = opts.villains || [];
        for (var i = 0; i < caps.length; i++) if (pointSeg(pt, caps[i].a, caps[i].b) < caps[i].r + K.VILLAIN_PAD) return { kind: null, why: 'villain' };
        return { kind: 'wall', point: copy(pt) };
      }
    } else if (n.y > K.TOP_NY) {
      if (box.y1 < K.MIN_TOP) return { kind: null, why: 'street' };
      var e = [pt.x - box.x0, box.x1 - pt.x, pt.z - box.z0, box.z1 - pt.z], m = Math.min.apply(null, e), k = e.indexOf(m);
      if (m <= K.EDGE_SNAP) perch = edgePerch(city, box, [{ x: -1, z: 0 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: 0, z: 1 }][k], k < 2 ? pt.z : pt.x);
      else {
        var top = stack(city, pt.x, pt.z, box.y1, box), h = { x: pt.x - p.x, z: pt.z - p.z };
        perch = { x: pt.x, y: top.y, z: pt.z, yaw: Math.hypot(h.x, h.z) > 1e-6 ? yawOf(h) : p.yaw || 0, edge: false };
      }
    } else return { kind: null, why: 'slope' };
    if (!clear(city, perch)) return { kind: null, why: 'no room' };
    var zd = dist(p, perch);
    if (zd > K.RANGE + 2) return { kind: null, why: 'far' };
    if (zd < K.MIN_ZIP) return { kind: null, why: 'here' };
    return { kind: 'zip', point: copy(pt), perch: perch };
  }

  // The rules for a flick or a click. aim: { target (a villain or the
  // training target is within SHOT_CONE of the aim), hit (world.raycast's,
  // or null), player, city, villains (capsules) }; s: this module's state.
  //   -> { act: 'shot' | 'attach' | 'zip' | 'release' | 'none', anchor, perch, point, why }
  function decide(aim, s) {
    if (aim.target) return { act: 'shot' };
    var c = aim.hit && aim.city && aim.player ? classify(aim.city, aim.hit, aim.player, aim) : { kind: null, why: 'nothing' };
    if (c.kind === 'wall') return { act: 'attach', anchor: c.point };
    if (c.kind === 'zip') return { act: 'zip', perch: c.perch, point: c.point };
    return { act: s && s.mode === 'swing' ? 'release' : 'none', why: c.why };
  }

  // --- acting on it ----------------------------------------------------------------------
  // A line to `anchor`, held by `hand`. From standing (or a perch) it throws
  // you off your feet toward it; in the air it just catches you.
  function attach(s, p, anchor, hand) {
    var g = grip(p), d = dist(g, anchor), still = p.grounded || s.mode === 'perch';
    s.mode = 'swing'; s.anchor = copy(anchor); s.hand = hand === 'l' ? 'l' : 'r';
    s.len = s.len0 = clamp(d, K.MIN_LEN, K.MAX_LEN); s.taut = false; s.t = 0; s.zip = null; s.perch = null;
    // How long it reels in to: short enough that the bottom of the arc, under
    // the anchor, swings you along well above the street rather than down it.
    s.want = clamp(anchor.y - K.GRIP - Math.max(K.CLEAR, anchor.y * K.LOW), K.MIN_LEN, s.len);
    if (still) {
      // Up to YANK toward it (never more, however often you do it), and a hop.
      var u = sub(anchor, g), l = len(u) || 1, have = (p.vx * u.x + p.vy * u.y + p.vz * u.z) / l, add = Math.max(0, K.YANK - have);
      p.vx += u.x / l * add; p.vz += u.z / l * add; p.vy = Math.max(p.vy, u.y / l * add + K.YANK_UP);
      p.grounded = false;
    }
    return s;
  }
  // Let go of the line. Near the top of the forward arc - past the anchor,
  // still rising - it throws you on. Returns how much of the boost you got (0..1).
  function release(s, p) {
    if (s.mode !== 'swing') return 0;
    var off = sub(grip(p), s.anchor), d = len(off) || 1, theta = Math.acos(clamp(-off.y / d, -1, 1));
    var vh = Math.hypot(p.vx, p.vz), ahead = off.x * p.vx + off.z * p.vz > 0;
    var k = ahead && p.vy > -1 && vh > .5 ? smooth(K.TOP_ARC[0], K.TOP_ARC[1], theta) : 0;
    if (k > 0) { p.vx += p.vx / vh * K.BOOST * k; p.vz += p.vz / vh * K.BOOST * k; p.vy += K.BOOST_UP * k; }
    cap(p);
    s.mode = 'fly'; s.anchor = null; s.taut = false; s.load = 0;
    return k;
  }
  // Pulled along a line to `perch` ({x, y, z, yaw, edge}), then perched there.
  function zip(s, p, perch) {
    var from = { x: p.x, y: p.y, z: p.z }, to = copy(perch), D = dist(from, to);
    var out = { x: -Math.sin(perch.yaw), z: -Math.cos(perch.yaw) }, toward = { x: to.x - from.x, z: to.z - from.z };
    var lift = Math.max(from.y, to.y) + K.ZIP_LIFT, ctrl;
    // Onto an edge facing back at you: come in over it from your side and drop on.
    if (perch.edge && out.x * toward.x + out.z * toward.z < 0) ctrl = { x: to.x + out.x * K.ZIP_OUT, y: lift, z: to.z + out.z * K.ZIP_OUT };
    else ctrl = { x: from.x + toward.x * .7, y: lift, z: from.z + toward.z * .7 };
    s.mode = 'zip'; s.anchor = null; s.taut = false; s.perch = null;
    s.zip = { from: from, ctrl: ctrl, to: to, yaw: perch.yaw, t: 0, dur: clamp(D / K.ZIP_SPEED, K.ZIP_T[0], K.ZIP_T[1]) };
    p.grounded = false;
    return s;
  }
  function ease(u) { return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function bez(z, u) {
    var a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    return { x: a * z.from.x + b * z.ctrl.x + c * z.to.x, y: a * z.from.y + b * z.ctrl.y + c * z.to.y, z: a * z.from.z + b * z.ctrl.z + c * z.to.z };
  }

  // --- the physics ---------------------------------------------------------------------
  function cap(p) {
    var v = speed(p);
    if (v > K.MAX_SPEED) { var k = K.MAX_SPEED / v; p.vx *= k; p.vy *= k; p.vz *= k; }
  }
  // Steering: toward the way Move.vector() points (relative to the view's
  // yaw), adding speed that way, never braking.
  function steer(p, input, a, h) {
    var mv = (input && input.move) || { x: 0, z: 0 }, yaw = input && Number.isFinite(input.yaw) ? input.yaw : p.yaw || 0;
    if (!mv.x && !mv.z) return;
    var f = PlayerRef.forward(yaw), r = PlayerRef.right(yaw);
    p.vx += (r.x * mv.x + f.x * mv.z) * a * h; p.vz += (r.z * mv.x + f.z * mv.z) * a * h;
  }
  // Turn the level velocity toward the view's heading (see LOOK_TURN).
  function look(p, input, rate, h) {
    if (!input || !Number.isFinite(input.yaw) || !(rate > 0)) return;
    var vh = Math.hypot(p.vx, p.vz);
    if (vh < 3) return;
    var have = Math.atan2(p.vx, p.vz);
    var f = PlayerRef.forward(input.yaw), d = Math.atan2(f.x * p.vz - f.z * p.vx, f.x * p.vx + f.z * p.vz);
    if (Math.abs(d) > K.LOOK_MAX) return;
    var turn = Math.max(-rate * h, Math.min(rate * h, d)), a = have + turn;
    p.vx = Math.sin(a) * vh; p.vz = Math.cos(a) * vh;
  }
  // Walls: pushed out sideways, and the part of the velocity into them taken
  // away so you slide along. Returns true if a wall was met.
  function walls(p, city) {
    var bx = p.x, bz = p.z;
    PlayerRef.resolveWalls(p, city);
    PlayerRef.clampToWalk(p, city);
    var dx = p.x - bx, dz = p.z - bz, l = Math.hypot(dx, dz);
    if (l < 1e-7) return false;
    var nx = dx / l, nz = dz / l, vn = p.vx * nx + p.vz * nz;
    if (vn < 0) { p.vx -= vn * nx; p.vz -= vn * nz; }
    return true;
  }
  // Up and down against the city, from fromY. Returns true on landing.
  function floors(p, city, fromY) {
    if (p.vy > 0) {
      var top = PlayerRef.ceiling(p, city, fromY);
      if (p.y + PK.HEIGHT > top) { p.y = top - PK.HEIGHT; p.vy = 0; }
    }
    var f = PlayerRef.support(p, city, fromY);
    if (p.y <= f && p.vy <= 0) { p.y = f; return true; }
    return false;
  }
  function land(s, p, ev) {
    ev.push({ type: 'land', speed: speed(p), from: s.mode, at: { x: p.x, y: p.y, z: p.z } });
    p.vy = 0; p.grounded = true;
    s.mode = 'none'; s.anchor = null; s.taut = false; s.load = 0;
  }

  // One slice of a swing, h seconds.
  function swingStep(s, p, input, h, city, ev) {
    var a = s.anchor, fromY = p.y;
    p.vy = Math.max(-PK.MAX_FALL, p.vy - PK.GRAVITY * h);
    steer(p, input, K.STEER, h);
    look(p, input, K.LOOK_TURN, h);
    p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;

    // Keep your feet clear of what's under you: the lowest the line lets you
    // hang here, over the top below you.
    var under = PlayerRef.support(p, city, p.y), hx = p.x - a.x, hz = p.z - a.z, h2 = hx * hx + hz * hz;
    var room = a.y - K.GRIP - under - K.CLEAR;
    if (room > 0 && h2 < s.len * s.len && a.y - Math.sqrt(s.len * s.len - h2) - K.GRIP < under + K.CLEAR)
      s.len = Math.max(Math.sqrt(h2 + room * room), s.len - K.CLEAR_RATE * h, 1);

    // Reeling in to the length it wants.
    if (s.len > s.want) s.len = Math.max(s.want, s.len - K.REEL * h);
    var off = sub(grip(p), a), d = len(off), wasTaut = s.taut;
    s.taut = d >= s.len - 1e-3;
    if (s.taut && d > 1e-6) {
      var u = { x: off.x / d, y: off.y / d, z: off.z / d };
      // Onto the rope's sphere, and no speed outward along it (a rope doesn't stretch).
      p.x -= u.x * (d - s.len); p.y -= u.y * (d - s.len); p.z -= u.z * (d - s.len);
      var vr = p.vx * u.x + p.vy * u.y + p.vz * u.z;
      if (vr > 0) { p.vx -= vr * u.x; p.vy -= vr * u.y; p.vz -= vr * u.z; vr = 0; }
      var tx = p.vx - vr * u.x, ty = p.vy - vr * u.y, tz = p.vz - vr * u.z, vt = Math.hypot(tx, ty, tz);
      // Past the bottom of the arc, reel in a little: the same angular
      // momentum on a shorter line is more speed, and the arc climbs higher.
      var theta = Math.acos(clamp(-u.y, -1, 1)), floor = Math.min(s.want, s.len0) * (1 - K.PUMP_MAX);
      if (theta < K.BOTTOM && vt > K.SHORTEN_V && s.len > floor) {
        var nl = Math.max(floor, s.len * (1 - K.SHORTEN * h)), k = s.len / nl;
        p.x -= u.x * (s.len - nl); p.y -= u.y * (s.len - nl); p.z -= u.z * (s.len - nl);
        p.vx += tx * (k - 1); p.vy += ty * (k - 1); p.vz += tz * (k - 1);
        s.len = nl;
      }
      // How hard the line pulls, in g: what holds you on the arc, and up.
      s.load = (vt * vt / s.len + PK.GRAVITY * Math.max(0, -u.y)) / PK.GRAVITY;
      if (!wasTaut) ev.push({ type: 'taut', load: s.load });
    } else s.load = 0;

    // The city: slide along walls - if one holds you further out than the
    // line would, the line pays out rather than dragging you into it.
    if (walls(p, city)) { var d2 = dist(grip(p), a); if (d2 > s.len) s.len = d2; }
    cap(p);
    if (floors(p, city, fromY)) land(s, p, ev);
  }
  // One slice of flying free (let go, or dived off a perch).
  function flyStep(s, p, input, h, city, ev) {
    var fromY = p.y, vh0 = Math.hypot(p.vx, p.vz);
    p.vy = Math.max(-PK.MAX_FALL, p.vy - PK.GRAVITY * h);
    steer(p, input, K.FLY_STEER, h);
    look(p, input, K.LOOK_FLY, h);
    // Steering adds sideways speed, but doesn't make you faster than you were
    // (beyond a sprint's worth), so it can't be used to fly on forever.
    var vh = Math.hypot(p.vx, p.vz), lim = Math.max(vh0, PK.SPRINT);
    if (vh > lim) { p.vx *= lim / vh; p.vz *= lim / vh; }
    p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
    walls(p, city);
    cap(p);
    if (floors(p, city, fromY)) land(s, p, ev);
  }

  // One frame. input: { move (Move.vector()), buttons (Move.buttons()), yaw
  // (the view's) }. Returns { active: this module moved the player this
  // frame (so Player.step mustn't), events: [{ type: 'taut' | 'land' |
  // 'perch' | 'drop', ... }] }.
  function step(s, p, input, dt, city) {
    var ev = [], jump = !!(input && input.buttons && input.buttons.jump), pressed = jump && !s.jumpHeld;
    s.jumpHeld = jump;
    if (s.mode === 'none') return { active: false, events: ev };
    if (!(dt > 0)) return { active: true, events: ev };
    s.t += dt;
    var mv = (input && input.move) || { x: 0, z: 0 };

    if (s.mode === 'perch') {
      // Still until you move: walk off, or jump and dive.
      if (pressed) {
        var f = PlayerRef.forward(input && Number.isFinite(input.yaw) ? input.yaw : p.yaw);
        p.vx = f.x * K.DIVE; p.vz = f.z * K.DIVE; p.vy = PK.JUMP; p.grounded = false;
        s.mode = 'fly'; s.perch = null;
      } else if (Math.hypot(mv.x, mv.z) > .15) { s.mode = 'none'; s.perch = null; return { active: false, events: ev }; }
      else { p.vx = p.vy = p.vz = 0; p.grounded = true; p.speed = 0; return { active: true, events: ev }; }
    }

    if (s.mode === 'zip') {
      var z = s.zip, was = bez(z, ease(clamp(z.t / z.dur, 0, 1)));
      z.t = Math.min(z.dur, z.t + dt);
      var now = bez(z, ease(z.t / z.dur));
      p.x = now.x; p.y = now.y; p.z = now.z;
      p.vx = (now.x - was.x) / dt; p.vy = (now.y - was.y) / dt; p.vz = (now.z - was.z) / dt;
      p.grounded = false;
      if (z.t >= z.dur) {
        p.x = z.to.x; p.y = z.to.y; p.z = z.to.z; p.vx = p.vy = p.vz = 0; p.grounded = true;
        // Never inside anything: Player's walls have the last word.
        PlayerRef.resolveWalls(p, city);
        s.perch = { x: p.x, y: p.y, z: p.z, yaw: z.yaw };
        s.mode = 'perch'; s.zip = null;
        ev.push({ type: 'perch', at: { x: p.x, y: p.y, z: p.z }, yaw: s.perch.yaw });
      }
      p.speed = Math.hypot(p.vx, p.vz);
      return { active: true, events: ev };
    }

    // Space on a line lets go (a flick at nothing does too; world-game.js).
    if (s.mode === 'swing' && pressed) { release(s, p); ev.push({ type: 'drop', why: 'jump' }); }

    var n = Math.max(1, Math.ceil(dt / K.SUB)), h = dt / n;
    for (var i = 0; i < n && (s.mode === 'swing' || s.mode === 'fly'); i++) {
      if (s.mode === 'swing') swingStep(s, p, input, h, city, ev);
      else flyStep(s, p, input, h, city, ev);
    }
    p.grounded = s.mode === 'none';
    p.speed = Math.hypot(p.vx, p.vz);
    return { active: true, events: ev };
  }

  // The first of the city's collision boxes (or the street, y = 0) along a
  // ray, as world.raycast reports a hit: { point, normal, distance }, or
  // null. For the tests and scripted flicks; the game aims with world.raycast.
  function cast(city, o, d, far) {
    far = far || 1500;
    var best = d.y < -1e-9 && o.y > 0 ? -o.y / d.y : Infinity, bn = { x: 0, y: 1, z: 0 };
    var e = { x: o.x + d.x * Math.min(far, best), z: o.z + d.z * Math.min(far, best) };
    var list = CityRef.query(city, Math.min(o.x, e.x) - .5, Math.min(o.z, e.z) - .5, Math.max(o.x, e.x) + .5, Math.max(o.z, e.z) + .5);
    var oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    list.forEach(function (b) {
      var lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1], t0 = 0, t1 = Math.min(far, best), ax = -1;
      for (var i = 0; i < 3; i++) {
        if (Math.abs(dd[i]) < 1e-12) { if (oo[i] < lo[i] || oo[i] > hi[i]) return; continue; }
        var a = (lo[i] - oo[i]) / dd[i], c = (hi[i] - oo[i]) / dd[i];
        if (a > c) { var t = a; a = c; c = t; }
        if (a > t0) { t0 = a; ax = i; }
        t1 = Math.min(t1, c);
        if (t0 > t1) return;
      }
      if (ax < 0 || t0 >= best) return;               // starting inside, or behind the best
      best = t0; bn = { x: 0, y: 0, z: 0 }; bn[['x', 'y', 'z'][ax]] = dd[ax] > 0 ? -1 : 1;
    });
    if (!(best <= far)) return null;
    return { point: { x: o.x + d.x * best, y: o.y + d.y * best, z: o.z + d.z * best }, normal: bn, distance: best };
  }

  // What the player's models should show (PlayerAnim.step's `extra`).
  function anim(s) {
    return { swing: s.mode === 'swing' ? s.hand : null, zip: s.mode === 'zip', perched: s.mode === 'perch' };
  }
  // Is the module moving the player through the air (swing, fly or zip)?
  function airborne(s) { return s.mode === 'swing' || s.mode === 'fly' || s.mode === 'zip'; }

  var api = { create: create, decide: decide, classify: classify, attach: attach, release: release, zip: zip, step: step,
    anim: anim, airborne: airborne, inCone: inCone, cast: cast, raySeg: raySeg, grip: grip, speed: speed, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Swing = api;
})(typeof window === 'undefined' ? globalThis : window);

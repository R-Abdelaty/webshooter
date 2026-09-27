(function (root) {
  'use strict';
  // The first-person body: where your feet are, how fast you're going, which
  // way you face. Walking, sprinting, jumping, gravity, and collision against
  // the city's boxes. No Three.js - world-game.js puts the camera at eye().
  //
  // Collision is deliberately simple. You are a vertical cylinder; each box is
  // either a wall (its top is above your knees) and you are pushed out of it
  // sideways, or a floor (its top is within a step of your feet) and you stand
  // on it. Kerbs, slabs and roofs are all just the tops of boxes.

  var CityRef = root.City || (typeof require === 'function' ? require('./city.js') : null);

  var P = {
    EYE: 1.7, HEIGHT: 1.8, RADIUS: 0.35,
    WALK: 6, SPRINT: 14,
    JUMP: 6.4,            // take-off speed, m/s: clears a parapet, about 0.9 m of air
    GRAVITY: 22,          // a bit over real gravity; real gravity feels floaty in a game
    MAX_FALL: 60,
    STEP: 0.45,           // anything this low you just walk up onto
    ACCEL: 60, AIR_ACCEL: 14,
    PITCH_LIMIT: 75 * Math.PI / 180,
    SUBSTEP: 0.25         // never move further than this between collision checks
  };

  function create(spawn) {
    spawn = spawn || {};
    return { x: spawn.x || 0, y: spawn.y || 0, z: spawn.z || 0, vx: 0, vy: 0, vz: 0,
      yaw: spawn.yaw || 0, pitch: 0, grounded: true, speed: 0 };
  }

  // yaw 0 looks north (-z) and positive yaw turns left, matching a Three.js
  // camera's rotation.y.
  function forward(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
  function right(yaw) { return { x: Math.cos(yaw), z: -Math.sin(yaw) }; }

  function look(p, dyaw, dpitch) {
    p.yaw += dyaw;
    // Keep yaw in (-PI, PI] so it never grows without bound over a long session.
    p.yaw = Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw));
    p.pitch = Math.max(-P.PITCH_LIMIT, Math.min(P.PITCH_LIMIT, p.pitch + dpitch));
    return p;
  }

  // Push a circle (x, z, r) out of one box's footprint. Returns true if it moved.
  function pushOut(pos, r, b) {
    var cx = Math.max(b.x0, Math.min(pos.x, b.x1)), cz = Math.max(b.z0, Math.min(pos.z, b.z1));
    var dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    if (d2 > 1e-12) {
      var d = Math.sqrt(d2), k = (r - d) / d;
      pos.x += dx * k; pos.z += dz * k;
      return true;
    }
    // The centre is inside the box: leave by the nearest face.
    var left = pos.x - b.x0, rightD = b.x1 - pos.x, top = pos.z - b.z0, bottom = b.z1 - pos.z;
    var m = Math.min(left, rightD, top, bottom);
    if (m === left) pos.x = b.x0 - r; else if (m === rightD) pos.x = b.x1 + r;
    else if (m === top) pos.z = b.z0 - r; else pos.z = b.z1 + r;
    return true;
  }

  function touches(pos, r, b) {
    var cx = Math.max(b.x0, Math.min(pos.x, b.x1)), cz = Math.max(b.z0, Math.min(pos.z, b.z1));
    return (pos.x - cx) * (pos.x - cx) + (pos.z - cz) * (pos.z - cz) < r * r;
  }

  function near(p, city, pad) {
    return CityRef.query(city, p.x - P.RADIUS - pad, p.z - P.RADIUS - pad, p.x + P.RADIUS + pad, p.z + P.RADIUS + pad);
  }

  function resolveWalls(p, city) {
    var boxes = near(p, city, 0.5), pass, i, b, moved;
    for (pass = 0; pass < 3; pass++) {
      moved = false;
      for (i = 0; i < boxes.length; i++) {
        b = boxes[i];
        if (b.y1 <= p.y + P.STEP || b.y0 >= p.y + P.HEIGHT) continue;
        if (pushOut(p, P.RADIUS, b)) moved = true;
      }
      if (!moved) break;
    }
  }

  // The highest top under you that you could be standing on, coming from
  // `fromY`: anything at or below a step above it. Street level is 0.
  function support(p, city, fromY) {
    var boxes = near(p, city, 0.1), best = 0, i, b;
    for (i = 0; i < boxes.length; i++) {
      b = boxes[i];
      if (b.y1 > fromY + P.STEP + 1e-6 || b.y1 <= best) continue;
      if (touches(p, P.RADIUS * 0.8, b)) best = b.y1;
    }
    return best;
  }

  function ceiling(p, city, fromY) {
    var boxes = near(p, city, 0.1), low = Infinity, i, b;
    for (i = 0; i < boxes.length; i++) {
      b = boxes[i];
      if (b.y0 < fromY + P.HEIGHT - 1e-6) continue;
      if (touches(p, P.RADIUS * 0.8, b) && b.y0 < low) low = b.y0;
    }
    return low;
  }

  function clampToWalk(p, city) {
    var w = city.walk;
    if (!w) return;
    p.x = Math.max(w.x0 + P.RADIUS, Math.min(w.x1 - P.RADIUS, p.x));
    p.z = Math.max(w.z0 + P.RADIUS, Math.min(w.z1 - P.RADIUS, p.z));
  }

  // input: { move: {x, z} from Move.vector(), buttons: {jump, sprint} }
  function step(p, input, dt, city) {
    if (!(dt > 0)) return p;
    var mv = (input && input.move) || { x: 0, z: 0 }, btn = (input && input.buttons) || {};
    var f = forward(p.yaw), r = right(p.yaw), speed = btn.sprint ? P.SPRINT : P.WALK;
    var tx = (r.x * mv.x + f.x * mv.z) * speed, tz = (r.z * mv.x + f.z * mv.z) * speed;
    var a = (p.grounded ? P.ACCEL : P.AIR_ACCEL) * dt, dvx = tx - p.vx, dvz = tz - p.vz, dv = Math.hypot(dvx, dvz);
    if (dv > a) { dvx *= a / dv; dvz *= a / dv; }
    p.vx += dvx; p.vz += dvz;
    if (btn.jump && p.grounded) { p.vy = P.JUMP; p.grounded = false; }

    // Sideways, in short hops so a sprint can't skip through a thin wall.
    var dx = p.vx * dt, dz = p.vz * dt, n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / P.SUBSTEP)), i;
    for (i = 0; i < n; i++) {
      var bx = p.x, bz = p.z;
      p.x += dx / n; p.z += dz / n;
      resolveWalls(p, city);
      clampToWalk(p, city);
      // A wall took the move: stop pushing into it so you slide along it
      // rather than building up speed you can't use.
      if (Math.abs(p.x - bx) < Math.abs(dx / n) * 0.5) p.vx *= 0.5;
      if (Math.abs(p.z - bz) < Math.abs(dz / n) * 0.5) p.vz *= 0.5;
    }

    // Up and down.
    var fromY = p.y;
    p.vy = Math.max(-P.MAX_FALL, p.vy - P.GRAVITY * dt);
    p.y += p.vy * dt;
    if (p.vy > 0) {
      var top = ceiling(p, city, fromY);
      if (p.y + P.HEIGHT > top) { p.y = top - P.HEIGHT; p.vy = 0; }
    }
    var floor = support(p, city, fromY);
    if (p.y <= floor) { p.y = floor; p.vy = 0; p.grounded = true; }
    else p.grounded = false;
    p.speed = Math.hypot(p.vx, p.vz);
    return p;
  }

  function eye(p) { return { x: p.x, y: p.y + P.EYE, z: p.z }; }

  var api = { create: create, step: step, look: look, eye: eye, pushOut: pushOut, forward: forward, right: right,
    support: support, resolveWalls: resolveWalls, ceiling: ceiling, clampToWalk: clampToWalk, constants: P };
  if (typeof module !== 'undefined') module.exports = api;
  root.Player = api;
})(typeof window === 'undefined' ? globalThis : window);

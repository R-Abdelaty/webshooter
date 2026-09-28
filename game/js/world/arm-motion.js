(function (root) {
  'use strict';
  // The first-person arms, alive (docs/PLAYER_PLAN.md, Session P9): a
  // procedural layer over whatever clip the arms play. No Three.js:
  // player-view.js applies what this returns to the arms model.
  //
  //   var s = ArmMotion.create()
  //   var o = ArmMotion.step(s, f, dt)
  //     f: { yaw, pitch (the view's, radians; Player's convention: yaw 0
  //          looks -z, positive turns left), vel: {x, y, z} (m/s, world),
  //          land (the impact speed, m/s, on the frame you touch down; else 0),
  //          idle (standing still on the ground or a perch),
  //          line: { hand: 'l'|'r', anchor, grip } on a swing line, else null,
  //          motion: 'full' | 'reduced' (CAMERA MOTION) }
  //     o.pos  [x, y, z]  the arms' offset, metres, in camera space (x right,
  //                       y up, -z ahead) - both arms, about the eye
  //     o.rot  [x, y, z]  their turn about the eye, radians (Euler XYZ)
  //     o.hands { l, r }  [x, y, z] one hand's own offset (the free hand's
  //                       counter-swing), camera space
  //     o.flutter { l, r } { fore, fingers }  radians: the forearm's roll and
  //                       the fingers' curl in the wind
  //
  //   ArmMotion.keepClear(o, hands)  the same offsets, scaled down if they
  //     would bring a hand nearer the middle of the view than CLEAR (hands:
  //     each hand's camera-space position as its clip puts it). The hands
  //     never cover the crosshair; a clip that puts a hand there (the thwip)
  //     is left alone - only this layer is held back.
  //
  // What moves them:
  //   inertia   the arms lag the view's turn and your acceleration, on a
  //             damped spring, and settle when it stops;
  //   wind      with speed, a flutter on the forearms and fingers;
  //   counter   on a swing line the free arm swings against the pendulum:
  //             back and down on the way into the arc, ahead and up past
  //             the bottom, reaching for the next line;
  //   landing   a dip, by how hard you came down;
  //   breath    a slow sway while you stand still.
  // Everything is bounded, and CAMERA MOTION: REDUCED scales it down.

  var K = {
    SUB: 1 / 120,          // the springs are stepped this finely, whatever the frame rate
    // inertia: a damped spring (angular frequency W rad/s, damping ratio Z)
    W: 10, Z: .5,
    TURN_LAG: .02,         // radians of lag per rad/s the view turns
    TURN_MAX: 4,           // rad/s: faster turns count as this
    ROLL: .5,              // of the yaw lag, as a roll (the arms lean into a turn)
    ACC_LAG: .0016,        // metres of lag per m/s² of acceleration
    ACC_MAX: 25,           // m/s²: harder (a teleport, a blast) counts as this
    POS_MAX: .03,          // metres: the sway's offset never passes this on any axis
    ROT_MAX: .07,          // radians: nor its turn
    // landing: a dip on a spring of its own
    DIP_PER: .0045,        // metres per m/s of impact...
    DIP_MIN_V: 3,          // ...counted above this
    DIP_MAX: .065,         // at most
    DIP_W: 11, DIP_Z: .42,
    // wind: from FLUTTER_V[0] m/s, full at [1]
    FLUTTER_V: [7, 28],
    FLUTTER: .1,           // radians of forearm roll at full wind
    FINGERS: .22,          // ...and of finger curl
    FLUTTER_HZ: [2.5, 8],  // how fast, from the start of the wind to full
    WIND_EASE: 3,
    // the free arm's counter-swing on a line
    COUNTER: .055,         // metres at full swing
    COUNTER_V: 14,         // m/s: full swing from here
    COUNTER_EASE: 5,
    // breathing, standing still
    BREATH: .005,          // metres up and down
    BREATH_ROT: .012,      // radians
    BREATH_T: 4.4,         // seconds a breath
    BREATH_EASE: 1.5,
    REDUCED: .35,          // CAMERA MOTION: REDUCED keeps this much of all of it
    CLEAR: .3              // radians: this layer never brings a hand nearer the view's middle than this
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function wrap(x) { return Math.atan2(Math.sin(x), Math.cos(x)); }
  function ease(k, dt) { return 1 - Math.exp(-k * dt); }

  function create() {
    return {
      t: 0, last: null,
      pos: [0, 0, 0], vpos: [0, 0, 0], rot: [0, 0], vrot: [0, 0], dip: 0, vdip: 0,
      tpos: [0, 0, 0], trot: [0, 0],
      wind: 0, windPhase: 0, counter: { l: [0, 0, 0], r: [0, 0, 0] }, breath: 0
    };
  }

  // Back to still: after a teleport (a new life, a fight's vantage).
  function reset(s) { var n = create(); Object.keys(n).forEach(function (k) { s[k] = n[k]; }); return s; }

  // A world vector in the camera's level frame: x right, y up, z back.
  function toCamera(v, yaw) {
    var c = Math.cos(yaw), sn = Math.sin(yaw);
    // right (cos yaw, 0, -sin yaw); forward (-sin yaw, 0, -cos yaw) is -z
    return [v.x * c - v.z * sn, v.y, v.x * sn + v.z * c];
  }

  // A smooth wobble, -1..1, from a phase (three sines out of step).
  function noise(p, seed) {
    return (Math.sin(p + seed) + .6 * Math.sin(1.73 * p + 1.3 + seed * 2.1) + .4 * Math.sin(2.91 * p + 2.2 + seed * .7)) / 2;
  }

  // Where the free hand wants to be on a line: -1 (behind the anchor's
  // vertical, falling into the arc) .. 1 (past it, rising ahead), from the
  // grip's offset from the anchor along the way you're going.
  function phase(line, vel) {
    var dx = line.grip.x - line.anchor.x, dy = line.grip.y - line.anchor.y, dz = line.grip.z - line.anchor.z;
    var len = Math.hypot(dx, dy, dz), vh = Math.hypot(vel.x, vel.z);
    if (len < 1e-6 || vh < 1e-6) return 0;
    return clamp((dx * vel.x + dz * vel.z) / vh / len, -1, 1);
  }

  function step(s, f, dt) {
    dt = dt > 0 ? Math.min(dt, .1) : 0;
    var vel = f.vel || { x: 0, y: 0, z: 0 }, yaw = f.yaw || 0, pitch = f.pitch || 0;
    var turnY = 0, turnP = 0, acc = [0, 0, 0];
    if (s.last && dt > 0) {
      turnY = clamp(wrap(yaw - s.last.yaw) / dt, -K.TURN_MAX, K.TURN_MAX);
      turnP = clamp((pitch - s.last.pitch) / dt, -K.TURN_MAX, K.TURN_MAX);
      var a = { x: (vel.x - s.last.vel.x) / dt, y: (vel.y - s.last.vel.y) / dt, z: (vel.z - s.last.vel.z) / dt };
      var al = Math.hypot(a.x, a.y, a.z);
      if (al > K.ACC_MAX) { a.x *= K.ACC_MAX / al; a.y *= K.ACC_MAX / al; a.z *= K.ACC_MAX / al; }
      acc = toCamera(a, yaw);
    }
    s.last = { yaw: yaw, pitch: pitch, vel: { x: vel.x, y: vel.y, z: vel.z } };

    // Inertia: the arms lag behind (opposite) the acceleration and the turn.
    // A landing is a dip of its own, so its jolt isn't counted twice.
    if (f.land > 0) acc = [0, 0, 0];
    for (var i = 0; i < 3; i++) s.tpos[i] = -K.ACC_LAG * acc[i];
    s.trot[0] = -K.TURN_LAG * turnP;
    s.trot[1] = -K.TURN_LAG * turnY;

    // The landing: a kick down, by the impact.
    if (f.land > 0) {
      var depth = clamp((f.land - K.DIP_MIN_V) * K.DIP_PER, 0, K.DIP_MAX);
      // A spring set off from rest with v0 peaks about v0 / W * e^(-Z atan(..)) - near .6 v0 / W here.
      s.vdip = Math.min(s.vdip, -depth * K.DIP_W / .6);
    }

    var n = dt > 0 ? Math.ceil(dt / K.SUB) : 0, h = n ? dt / n : 0, W2 = K.W * K.W, D = 2 * K.Z * K.W;
    var DW2 = K.DIP_W * K.DIP_W, DD = 2 * K.DIP_Z * K.DIP_W;
    for (var k = 0; k < n; k++) {
      for (i = 0; i < 3; i++) {
        s.vpos[i] += (W2 * (s.tpos[i] - s.pos[i]) - D * s.vpos[i]) * h; s.pos[i] += s.vpos[i] * h;
        if (Math.abs(s.pos[i]) > K.POS_MAX) { s.pos[i] = clamp(s.pos[i], -K.POS_MAX, K.POS_MAX); s.vpos[i] = 0; }
      }
      for (i = 0; i < 2; i++) {
        s.vrot[i] += (W2 * (s.trot[i] - s.rot[i]) - D * s.vrot[i]) * h; s.rot[i] += s.vrot[i] * h;
        if (Math.abs(s.rot[i]) > K.ROT_MAX) { s.rot[i] = clamp(s.rot[i], -K.ROT_MAX, K.ROT_MAX); s.vrot[i] = 0; }
      }
      s.vdip += (-DW2 * s.dip - DD * s.vdip) * h; s.dip += s.vdip * h;
      if (Math.abs(s.dip) > K.DIP_MAX) { s.dip = clamp(s.dip, -K.DIP_MAX, K.DIP_MAX); s.vdip = 0; }
    }
    s.t += dt;

    // Wind: eased toward the speed's share, turning faster with it.
    var sp = Math.hypot(vel.x, vel.y, vel.z);
    var wWant = clamp((sp - K.FLUTTER_V[0]) / (K.FLUTTER_V[1] - K.FLUTTER_V[0]), 0, 1);
    s.wind += (wWant - s.wind) * ease(K.WIND_EASE, dt);
    s.windPhase += dt * 2 * Math.PI * (K.FLUTTER_HZ[0] + (K.FLUTTER_HZ[1] - K.FLUTTER_HZ[0]) * s.wind);

    // The free hand against the swing.
    var L = f.line, free = L ? (L.hand === 'l' ? 'r' : 'l') : null;
    ['l', 'r'].forEach(function (hd) {
      var want = [0, 0, 0];
      if (hd === free) {
        var p = phase(L, vel), g = clamp(Math.hypot(vel.x, vel.z) / K.COUNTER_V, 0, 1) * K.COUNTER;
        want = [0, .6 * p * g, -p * g];
      }
      var c = s.counter[hd], e = ease(K.COUNTER_EASE, dt);
      for (var j = 0; j < 3; j++) c[j] += (want[j] - c[j]) * e;
    });

    // Breathing while still.
    s.breath += ((f.idle ? 1 : 0) - s.breath) * ease(K.BREATH_EASE, dt);
    var br = Math.sin(2 * Math.PI * s.t / K.BREATH_T) * s.breath;

    var m = f.motion === 'reduced' ? K.REDUCED : 1;
    var fl = function (seed) {
      return { fore: m * K.FLUTTER * s.wind * noise(s.windPhase, seed), fingers: m * K.FINGERS * s.wind * noise(s.windPhase * 1.37, seed + 4) };
    };
    return {
      pos: [m * s.pos[0], m * (s.pos[1] + s.dip + K.BREATH * br), m * s.pos[2]],
      rot: [m * (s.rot[0] + K.BREATH_ROT * br), m * s.rot[1], m * K.ROLL * s.rot[1]],
      hands: { l: s.counter.l.map(function (v) { return m * v; }), r: s.counter.r.map(function (v) { return m * v; }) },
      flutter: { l: fl(0), r: fl(2.4) }
    };
  }

  // A camera-space point turned by rot (Euler XYZ, as Three.js applies it:
  // Rx Ry Rz) and moved by pos.
  function apply(p, rot, pos) {
    var x = p[0], y = p[1], z = p[2], c, sn, t;
    c = Math.cos(rot[2]); sn = Math.sin(rot[2]); t = x * c - y * sn; y = x * sn + y * c; x = t;
    c = Math.cos(rot[1]); sn = Math.sin(rot[1]); t = x * c + z * sn; z = -x * sn + z * c; x = t;
    c = Math.cos(rot[0]); sn = Math.sin(rot[0]); t = y * c - z * sn; z = y * sn + z * c; y = t;
    return [x + (pos ? pos[0] : 0), y + (pos ? pos[1] : 0), z + (pos ? pos[2] : 0)];
  }
  // How far off the view's middle a camera-space point is, in radians.
  function offAxis(p) {
    var l = Math.hypot(p[0], p[1], p[2]);
    return l < 1e-9 ? Math.PI : Math.acos(clamp(-p[2] / l, -1, 1));
  }
  function scaled(o, k) {
    var sc = function (v) { return v.map(function (x) { return x * k; }); };
    return { pos: sc(o.pos), rot: sc(o.rot), hands: { l: sc(o.hands.l), r: sc(o.hands.r) }, flutter: o.flutter };
  }
  function moved(o, hd, p) { return apply(p, o.rot, [o.pos[0] + o.hands[hd][0], o.pos[1] + o.hands[hd][1], o.pos[2] + o.hands[hd][2]]); }
  function keepClear(o, hands) {
    var ok = function (k) {
      var q = scaled(o, k);
      return ['l', 'r'].every(function (hd) {
        var p = hands && hands[hd];
        if (!p) return true;
        var before = offAxis(p), after = offAxis(moved(q, hd, p));
        return after >= Math.min(K.CLEAR, before) - 1e-9;
      });
    };
    if (ok(1)) return o;
    var lo = 0, hi = 1;
    for (var i = 0; i < 12; i++) { var mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return scaled(o, lo);
  }

  var api = { constants: K, create: create, reset: reset, step: step, keepClear: keepClear, apply: apply, offAxis: offAxis, phase: phase, toCamera: toCamera };
  if (typeof module !== 'undefined') module.exports = api;
  root.ArmMotion = api;
})(typeof window === 'undefined' ? globalThis : window);

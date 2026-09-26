(function (root) {
  'use strict';
  // The sums behind the 3D HUD, with no DOM and no Three.js; hud-view.js
  // draws it. The HUD is the first clip's: thin and cyan, the villain and his
  // health top left, the objective and the clock top right, a square minimap
  // bottom left, and an arrow at the edge of the screen toward the villain
  // when he is out of view.
  //
  //   Hud.status(game)               what each part of the HUD says, for the
  //                                  mode you are in
  //   Hud.toMap(p, eye, yaw, scale)  a world point on the minimap, which
  //                                  turns with you (your facing is up)
  //   Hud.edge(pt, half)             clamp a minimap point to its square
  //   Hud.pointer(v, w, h, margin)   where the off-screen arrow goes
  //
  // x east, z south, y up, metres; yaw 0 faces north (-z) and positive yaw
  // turns left, as in player.js.

  var K = {
    MAP_RANGE: 160,           // metres from you to the minimap's edge
    MAP_ROOF: 60,             // the minimap zooms out this much higher up a roof
    LOW: 10,                  // seconds left when the clock turns red
    SEGMENTS_MAX: 12          // a health bar never has more segments than this
  };

  // --- the minimap ------------------------------------------------------------------
  // p relative to you, in minimap pixels from its centre: x to the right, y
  // down, with the way you face pointing up.
  function toMap(p, eye, yaw, scale) {
    var dx = p.x - eye.x, dz = p.z - eye.z, s = Math.sin(yaw), c = Math.cos(yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    return { x: (dx * c - dz * s) * scale, y: (dx * s + dz * c) * scale };
  }
  // A minimap point held inside its square of half-width `half`, and
  // whether it had to be (a marker off the map sits on its edge).
  function edge(pt, half) {
    var m = Math.max(Math.abs(pt.x), Math.abs(pt.y));
    if (m <= half) return { x: pt.x, y: pt.y, clamped: false };
    var k = half / m;
    return { x: pt.x * k, y: pt.y * k, clamped: true };
  }
  // How many metres from you to the minimap's edge: further the higher you
  // stand, so a rooftop shows more of the city.
  function range(eyeY) {
    var up = Math.max(0, Math.min(1, (eyeY - 10) / 150));
    return K.MAP_RANGE + K.MAP_ROOF * up;
  }

  // --- the off-screen arrow -------------------------------------------------------
  // v: the point in camera space (x right, y up, z toward you, so in front
  // is z < 0). Returns where on a w x h screen the arrow sits, `margin` in
  // from its edge, and the angle it points (radians, 0 = right, clockwise
  // with y down).
  function pointer(v, w, h, margin) {
    var ang = Math.atan2(-v.y, v.x);
    if (Math.abs(v.x) < 1e-6 && Math.abs(v.y) < 1e-6) ang = v.z > 0 ? Math.PI / 2 : 0;
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var k = Math.min((w / 2 - margin) / Math.max(1e-6, Math.abs(dx)), (h / 2 - margin) / Math.max(1e-6, Math.abs(dy)));
    return { x: w / 2 + dx * k, y: h / 2 + dy * k, angle: ang };
  }
  // Is a projected point (fractions of the view, and whether it is in
  // front) on the screen, `inset` in from the edges?
  function onScreen(e, inset) {
    var i = inset === undefined ? .03 : inset;
    return !!e && e.front && e.x > i && e.x < 1 - i && e.y > i && e.y < 1 - i;
  }

  // --- what the HUD says --------------------------------------------------------------
  // The health bar's segments: one per hit it takes, unless that is too many.
  function segments(health, max, damage) {
    var n = Math.max(1, Math.min(K.SEGMENTS_MAX, Math.ceil(max / (damage || max))));
    var frac = max > 0 ? Math.max(0, Math.min(1, health / max)) : 0;
    return { count: n, lit: Math.max(0, Math.ceil(frac * n - 1e-9)), frac: frac };
  }
  function clock(sec) { return Math.max(0, sec).toFixed(1); }

  // game: { mode: 'fight'|'train'|'roam', fight, enc, range, villain: {name},
  //         damage, accuracy (0..1, training) }
  // Returns { left: { title, sub, health, segments, value } | null,
  //           right: { title, text, timer, low, frac } }
  // `health` is null when there is no bar; `frac` is how much of the clock
  // (or anything else the right-hand bar shows) is left, or null.
  function status(g) {
    var f = g.fight, r = g.range;
    if (g.mode === 'fight' && f && g.enc) {
      var name = g.villain.name, seg = segments(f.health, f.maxHealth, g.damage), en = 'ENCOUNTER ' + (g.enc.index + 1);
      var left = { title: name, sub: en, health: seg.frac, segments: seg, value: f.health };
      if (f.phase === 'thugs') {
        var up = 0, all = f.thugs.length;
        f.thugs.forEach(function (t) { if (!t.down) up++; });
        return { left: { title: 'MASKED THUGS', sub: en, health: all ? up / all : 0, segments: { count: Math.min(K.SEGMENTS_MAX, all), lit: up, frac: all ? up / all : 0 }, value: up },
          right: { title: 'OBJECTIVE', text: 'Clear the thugs · ' + up + ' left', timer: 'WAVE', low: false, frac: null } };
      }
      if (f.phase === 'arrive') return { left: left, right: { title: 'OBJECTIVE', text: 'Get ready: ' + name + ' is coming', timer: clock(f.timeLimit), low: false, frac: 1 } };
      var rem = Math.max(0, f.timeLimit - f.elapsed);
      var text = f.mode === 'won' ? name + ' is down' : f.mode === 'lost' ? name + ' got away' : 'Web up ' + name + ' before the clock runs out';
      return { left: left, right: { title: 'OBJECTIVE', text: text, timer: clock(rem), low: f.mode === 'playing' && rem <= K.LOW, frac: f.timeLimit > 0 ? rem / f.timeLimit : 0 } };
    }
    if (g.mode === 'train' && r) {
      var acc = Math.round((g.accuracy || 0) * 100);
      return { left: { title: 'TRAINING', sub: 'THE RANGE', health: null, segments: null, value: null },
        right: { title: 'HIT THE TARGETS', text: r.hits + ' hit / ' + r.shots + ' shot · ' + acc + '% · best streak ' + r.best,
          timer: 'STREAK ' + r.streak, low: false, frac: acc / 100 } };
    }
    return { left: { title: 'FREE ROAM', sub: 'THE CITY', health: null, segments: null, value: null },
      right: { title: 'OBJECTIVE', text: 'Walk into a light column to start a fight · Esc to pick one', timer: '', low: false, frac: null } };
  }

  var api = { toMap: toMap, edge: edge, range: range, pointer: pointer, onScreen: onScreen, segments: segments, status: status, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Hud = api;
})(typeof window === 'undefined' ? globalThis : window);

(function (root) {
  'use strict';
  // The sums behind the 3D HUD, with no DOM and no Three.js; hud-view.js
  // draws it. The HUD is the first clip's: thin and cyan. In a fight your
  // health is top left, a segmented bar that flashes when you're hit, and
  // the villain's is top right with the objective (there is no clock: P4). A
  // square minimap sits bottom left, and an arrow at the edge of the screen
  // points toward the villain when he is out of view - red when he's
  // winding up an attack out there.
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
    SEGMENTS_MAX: 15,         // a health bar never has more segments than this
    YOU_SEGMENT: 10,          // health points in each segment of yours
    HURT: .45,                // seconds your bar flashes after a hit
    LOW_HP: .3                // your bar turns red at this share of your health or less
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
  // is z < 0). Returns where on a w x h screen the arrow sits and the angle
  // it points (radians, 0 = right, clockwise with y down): on the line from
  // the middle of the screen toward the point, where it meets a box `margin`
  // in from the edges - a number, or { t, r, b, l } to keep clear of the HUD
  // along the top and bottom.
  function pointer(v, w, h, margin) {
    var m = typeof margin === 'number' ? { t: margin, r: margin, b: margin, l: margin } : margin;
    var ang = Math.atan2(-v.y, v.x);
    if (Math.abs(v.x) < 1e-6 && Math.abs(v.y) < 1e-6) ang = v.z > 0 ? Math.PI / 2 : 0;
    var dx = Math.cos(ang), dy = Math.sin(ang), E = 1e-6;
    var kx = dx > E ? (w / 2 - m.r) / dx : dx < -E ? (w / 2 - m.l) / -dx : Infinity;
    var ky = dy > E ? (h / 2 - m.b) / dy : dy < -E ? (h / 2 - m.t) / -dy : Infinity;
    var k = Math.max(0, Math.min(kx, ky));
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
  // game: { mode: 'fight'|'train'|'roam', fight, enc, range, villain: {name},
  //         damage, accuracy (0..1, training) }
  // Returns { left: { title, sub, health, segments, value, hurt, low },
  //           right: { title, text, timer, low, frac, foe } }
  // left is you in a fight (else what mode you're in); `health` is null when
  // there is no bar, `hurt` says the bar should flash (you were just hit),
  // `low` that it is red. right.foe is the villain's bar in a fight, else
  // null: { title, health, segments, value }. `frac` is the thin bar under
  // the objective (training's accuracy), or null. There is no clock.
  function status(g) {
    var f = g.fight, r = g.range;
    if (g.mode === 'fight' && f && g.enc) {
      var name = g.villain.name, en = 'ENCOUNTER ' + (g.enc.index + 1), y = f.you;
      var left = { title: 'SPIDER-MAN', sub: en, health: null, segments: null, value: null, hurt: false, low: false };
      if (y) {
        var ys = segments(y.hp, y.maxHp, K.YOU_SEGMENT);
        left.health = ys.frac; left.segments = ys; left.value = y.hp;
        left.hurt = f.time - y.hitAt < K.HURT; left.low = ys.frac <= K.LOW_HP;
      }
      var seg = segments(f.health, f.maxHealth, g.damage);
      var foe = { title: name, health: seg.frac, segments: seg, value: f.health };
      if (f.phase === 'thugs') {
        var up = 0, all = f.thugs.length;
        f.thugs.forEach(function (t) { if (!t.down) up++; });
        return { left: left, right: { title: 'OBJECTIVE', text: 'Clear the thugs · ' + up + ' left', timer: 'WAVE', low: false, frac: null,
          foe: { title: 'MASKED THUGS', health: all ? up / all : 0, segments: { count: Math.min(K.SEGMENTS_MAX, all), lit: up, frac: all ? up / all : 0 }, value: up } } };
      }
      var text = f.phase === 'arrive' ? 'Get ready: ' + name + ' is coming' :
        f.mode === 'won' ? name + ' is down' : f.mode === 'lost' ? 'You went down' : 'Take down ' + name + ' · he fights back';
      return { left: left, right: { title: 'OBJECTIVE', text: text, timer: '', low: false, frac: null, foe: foe } };
    }
    if (g.mode === 'train' && r) {
      var acc = Math.round((g.accuracy || 0) * 100);
      return { left: { title: 'TRAINING', sub: 'THE RANGE', health: null, segments: null, value: null, hurt: false, low: false },
        right: { title: 'HIT THE TARGETS', text: r.hits + ' hit / ' + r.shots + ' shot · ' + acc + '% · best streak ' + r.best,
          timer: 'STREAK ' + r.streak, low: false, frac: acc / 100, foe: null } };
    }
    return { left: { title: 'FREE ROAM', sub: 'THE CITY', health: null, segments: null, value: null, hurt: false, low: false },
      right: { title: 'OBJECTIVE', text: 'Walk into a light column to start a fight · Esc to pick one', timer: '', low: false, frac: null, foe: null } };
  }

  // What the red threat chevron points at, if anything: the villain while he
  // winds up an attack out of your view, else a bomb in flight out of it.
  // visible(p): is world point p on the screen. Returns { x, y, z, kind:
  // 'villain' | 'bomb' } or null.
  function threat(f, visible) {
    if (!f || f.mode !== 'playing' || !f.at) return null;
    var mid = { x: f.at.x, y: f.at.y + 1.2, z: f.at.z };
    if (f.attack && f.attack.phase === 'telegraph' && !visible(mid)) { mid.kind = 'villain'; return mid; }
    var bombs = f.bombs || [];
    for (var i = 0; i < bombs.length; i++) {
      var b = bombs[i];
      if (b.popAt === null && !visible(b)) return { x: b.x, y: b.y, z: b.z, kind: 'bomb' };
    }
    return null;
  }

  var api = { toMap: toMap, edge: edge, range: range, pointer: pointer, onScreen: onScreen, segments: segments, status: status, threat: threat, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Hud = api;
})(typeof window === 'undefined' ? globalThis : window);

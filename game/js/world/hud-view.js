(function (root) {
  'use strict';
  // The 3D game's HUD, drawn: the first clip's thin cyan look. Top left, who
  // you're up against and a segmented health bar (a segment a hit); top
  // right, the objective, the clock and a bar of the time left; bottom left,
  // a square minimap that turns with you, with the city's blocks, you, and
  // where the fights are - or, in one, where the villain is; and at the edge
  // of the view an arrow toward the villain when he is out of it. The sums
  // are Hud's (hud.js); this only draws. The minimap is a picture of the
  // whole city drawn once, then cut out, turned and marked each frame.

  var T = root.THREE, $ = function (id) { return document.getElementById(id); };
  var CYAN = '#5fe3ff', PX = 1.2;         // the base map: pixels per metre

  // --- the city, from above, once -------------------------------------------------
  function baseMap(city) {
    var pm = city.promenade, B = city.bounds, pad = 260;
    var x0 = pm.x0 - pad, x1 = B.x1 + pad, z0 = B.z0 - pad, z1 = B.z1 + pad;
    var c = document.createElement('canvas');
    c.width = Math.ceil((x1 - x0) * PX); c.height = Math.ceil((z1 - z0) * PX);
    var g = c.getContext('2d');
    function rect(r, fill) { g.fillStyle = fill; g.fillRect((r.x0 - x0) * PX, (r.z0 - z0) * PX, (r.x1 - r.x0) * PX, (r.z1 - r.z0) * PX); }
    g.fillStyle = '#061c25'; g.fillRect(0, 0, c.width, c.height);                // streets
    rect({ x0: x0, x1: pm.x0, z0: z0, z1: z1 }, '#0a3346');                        // the river
    rect(pm, '#11414f');                                                           // the promenade
    // Backdrop buildings past the edge, dim; then the blocks' pavements.
    city.filler.forEach(function (b) { rect(b.tiers[0], 'rgba(95,227,255,.10)'); });
    city.blocks.forEach(function (b) { rect(b, '#0e3a47'); });
    var P = City.PARK_RECT, pk = city.park;
    rect(P, '#0e3a47'); rect(pk.grass, '#145346');
    g.fillStyle = '#0a3346'; g.beginPath();
    g.ellipse((pk.pond.x - x0) * PX, (pk.pond.z - z0) * PX, pk.pond.rx * PX, pk.pond.rz * PX, 0, 0, Math.PI * 2); g.fill();
    rect(city.site.ground, '#2b4a4f');
    // Buildings: brighter the taller, so the skyline reads from above.
    city.buildings.forEach(function (b) {
      b.tiers.forEach(function (t, i) {
        var k = Math.min(1, t.y1 / 220);
        rect(t, 'rgba(95,227,255,' + (.16 + .5 * k).toFixed(3) + ')');
        if (i === 0) { g.strokeStyle = 'rgba(159,240,255,.35)'; g.lineWidth = 1; g.strokeRect((t.x0 - x0) * PX + .5, (t.z0 - z0) * PX + .5, (t.x1 - t.x0) * PX - 1, (t.z1 - t.z0) * PX - 1); }
      });
    });
    return { canvas: c, x0: x0, z0: z0 };
  }

  function create(city, spots, colors) {
    var mapCanvas = $('wh-map'), mc = mapCanvas.getContext('2d'), base = baseMap(city), cache = {}, segEls = [];
    var cam = new T.Vector3();

    function show(el, on) { el.classList.toggle('is-hidden', !on); }
    function put(id, text) { if (cache[id] !== text) { cache[id] = text; $(id).textContent = text; } }
    function flag(id, cls, on) { var k = id + '.' + cls; if (cache[k] !== on) { cache[k] = on; $(id).classList.toggle(cls, on); } }
    function width(id, frac) {
      var w = Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10 + '%';
      if (cache[id + '.w'] !== w) { cache[id + '.w'] = w; $(id).style.width = w; }
    }

    // The text and bars, from Hud.status.
    function update(s) {
      put('wh-sub', s.left.sub); put('wh-title', s.left.title);
      var hp = s.left.segments;
      flag('wh-health', 'is-hidden', !hp);
      if (hp) {
        if (segEls.length !== hp.count) {
          var box = $('wh-segs'); box.textContent = ''; segEls = [];
          for (var i = 0; i < hp.count; i++) { var el = document.createElement('i'); box.appendChild(el); segEls.push(el); }
          cache.lit = -1;
        }
        if (cache.lit !== hp.lit) { cache.lit = hp.lit; segEls.forEach(function (el, i) { el.classList.toggle('is-lit', i < hp.lit); }); }
        put('wh-hp', String(s.left.value));
      }
      put('wh-objtitle', s.right.title); put('wh-objtext', s.right.text);
      flag('wh-clockbar', 'is-hidden', s.right.frac === null);
      if (s.right.frac !== null) width('wh-clockfill', s.right.frac);
      put('world-timer', s.right.timer); flag('world-timer', 'is-low', !!s.right.low);
      flag('wh-clockbar', 'is-low', !!s.right.low);
    }

    // --- the minimap ---
    // eye, yaw: you. marks: [{ x, z, color, kind: 'fight'|'villain'|'target' }].
    function drawMap(eye, yaw, marks, now) {
      var r = window.devicePixelRatio || 1, css = mapCanvas.clientWidth || 180, size = Math.round(css * r);
      if (mapCanvas.width !== size) { mapCanvas.width = size; mapCanvas.height = size; }
      var half = size / 2, scale = half / Hud.range(eye.y);       // device pixels per metre
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.clearRect(0, 0, size, size);
      mc.save();
      mc.translate(half, half); mc.rotate(yaw); mc.scale(scale / PX, scale / PX);
      mc.translate(-(eye.x - base.x0) * PX, -(eye.z - base.z0) * PX);
      mc.imageSmoothingEnabled = true;
      mc.drawImage(base.canvas, 0, 0);
      mc.restore();
      // North, on the rim.
      var n = Hud.edge(Hud.toMap({ x: eye.x, z: eye.z - 1e4 }, eye, yaw, 1), half - 9 * r);
      mc.fillStyle = 'rgba(159,240,255,.85)'; mc.font = '800 ' + Math.round(9 * r) + 'px Arial,sans-serif'; mc.textAlign = 'center'; mc.textBaseline = 'middle';
      mc.fillText('N', half + n.x, half + n.y);
      // The marks: fights (diamonds in their beacon colour), the villain (a
      // pulsing dot), the training target.
      marks.forEach(function (m) {
        var p = Hud.edge(Hud.toMap(m, eye, yaw, scale), half - 7 * r), x = half + p.x, y = half + p.y;
        mc.save(); mc.translate(x, y);
        mc.shadowColor = m.color; mc.shadowBlur = 6 * r;
        mc.fillStyle = m.color; mc.strokeStyle = '#021016'; mc.lineWidth = 1.5 * r;
        if (m.kind === 'fight') {
          var d = 5.5 * r; mc.beginPath(); mc.moveTo(0, -d); mc.lineTo(d, 0); mc.lineTo(0, d); mc.lineTo(-d, 0); mc.closePath(); mc.fill(); mc.stroke();
        } else {
          var k = m.kind === 'villain' ? 4.5 + Math.sin(now / 160) * 1.2 : 3.5;
          mc.beginPath(); mc.arc(0, 0, k * r, 0, Math.PI * 2); mc.fill(); mc.stroke();
        }
        mc.restore();
      });
      // You: an arrow in the middle, pointing up (the way you face).
      mc.save(); mc.translate(half, half);
      mc.fillStyle = '#e8fbff'; mc.strokeStyle = CYAN; mc.lineWidth = 1.5 * r; mc.shadowColor = CYAN; mc.shadowBlur = 8 * r;
      mc.beginPath(); mc.moveTo(0, -8 * r); mc.lineTo(6 * r, 7 * r); mc.lineTo(0, 3.5 * r); mc.lineTo(-6 * r, 7 * r); mc.closePath(); mc.fill(); mc.stroke();
      mc.restore();
    }

    // --- the off-screen arrow ---
    // On the overlay canvas g (CSS pixels w x h): an arrow at the edge of the
    // view toward `goal` when it is out of the view, with how far it is.
    function drawPointer(g, w, h, camera, project, goal, eye, color) {
      if (!goal || Hud.onScreen(project(goal))) return;
      cam.set(goal.x, goal.y, goal.z).applyMatrix4(camera.matrixWorldInverse);
      var p = Hud.pointer(cam, w, h, { t: Math.min(200, h * .22), r: 46, b: Math.min(120, h * .14), l: 46 }), dist = Math.hypot(goal.x - eye.x, goal.y - eye.y, goal.z - eye.z);
      g.save(); g.translate(p.x, p.y);
      g.save(); g.rotate(p.angle);
      g.shadowColor = CYAN; g.shadowBlur = 10;
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = CYAN; g.fillStyle = color || 'rgba(4,18,26,.8)';
      // A chevron, and a second, fainter one behind it.
      g.beginPath(); g.moveTo(18, 0); g.lineTo(-6, -15); g.lineTo(0, 0); g.lineTo(-6, 15); g.closePath(); g.fill(); g.stroke();
      g.globalAlpha = .55; g.beginPath(); g.moveTo(-2, 0); g.lineTo(-18, -11); g.moveTo(-2, 0); g.lineTo(-18, 11); g.stroke();
      g.restore();
      // The distance, inside the arrow's side of the screen.
      g.font = '800 11px Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#9ff0ff'; g.shadowColor = '#000'; g.shadowBlur = 3;
      g.fillText(Math.round(dist) + ' M', -Math.cos(p.angle) * 34, -Math.sin(p.angle) * 30);
      g.restore();
    }

    return { update: update, drawMap: drawMap, drawPointer: drawPointer };
  }

  root.WorldHud = { create: create };
})(window);

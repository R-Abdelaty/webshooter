(function () {
  'use strict';
  // A debug viewer for the character models, over the 3D city: press M (or
  // open the page with ?viewer) and every model in characters.json stands in
  // a row in front of you at its real size, facing you. Pick one and step
  // through its clips by name; draw the weak spots and body capsules the
  // manifest hangs on its bones. Session C2 tunes the weak spots with it.
  //
  //   M        open / close (it re-forms in front of you each time)
  //   [ ]      previous / next model
  //   , .      previous / next clip of that model (one-shots repeat)
  //   H        an additive hit on top of whatever it is doing
  //   L        walk/run by speed: stop, walk, between, run, faster
  //   O        overlays: weak spots, wrists and capsules, weak spots and wrists only, none
  //   V        first-person arms (spiderman_arms, built in camera space) on the
  //            game camera, as the player will see them; again to put them back
  //   /        freeze the clips
  //
  // You can still walk round them (WASD) and look with the mouse or wrist.

  var T = THREE;
  var ORDER = ['goblin', 'glider', 'bomb', 'rhino', 'venom', 'spiderman', 'spiderman_arms'];
  var GAP = 3, AHEAD = 10, REPEAT_GAP = .6;
  var SPOT_COLORS = { CHEST: '#ff4b4b', HEAD: '#ffd23f', SHOULDER: '#5fe3ff' };
  var WRIST_COLOR = '#ff9d2e', WRIST_R = .025;
  var pov = null;                // the camera-space item on the camera, if any
  var open = false, auto = /(^|[?&#])viewer\b/.test(location.search + location.hash);
  var group = null, building = null, items = [], sel = 0, frozen = false, overlays = 2, panel = null, shownAt = 0;
  var sphere = null, tube = null;

  function mat(color, opacity) {
    return new T.MeshBasicMaterial({ color: color, wireframe: true, transparent: true, opacity: opacity, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  }
  function mark(geo, m) { var o = new T.Mesh(geo, m); o.renderOrder = 10; o.frustumCulled = false; group.add(o); return o; }

  function make(id, rig) {
    var it = { id: id, rig: rig, clips: rig ? rig.clipNames.slice().sort() : [], clip: -1, repeat: null, again: 0, speedK: 0,
      spots: [], caps: [], wrists: [], ride: null, measured: null, spin: id === 'bomb', camera: false };
    if (!rig) return it;
    group.add(rig.root);
    var e = rig.entry;
    it.camera = e.space === 'camera';
    (e.weakSpots || []).forEach(function (w) { it.spots.push(mark(sphere, mat(SPOT_COLORS[w.name] || '#fff', .9))); });
    Object.keys(e.wrists || {}).forEach(function (k) {
      it.wrists.push({ bone: rig.bone(e.wrists[k].bone), offset: new T.Vector3().fromArray(e.wrists[k].offset), mark: mark(sphere, mat(WRIST_COLOR, .95)) });
    });
    (e.body || []).forEach(function () {
      var m = mat('#9dff8a', .22);
      it.caps.push({ tube: mark(tube, m), a: mark(sphere, m), b: mark(sphere, m) });
    });
    rig.apply();
    it.measured = rig.height();
    return it;
  }

  function build() {
    if (building) return building;
    group = new T.Group(); group.name = 'model-viewer';
    WorldGame.world.scene.add(group);
    WorldModels.setRenderer(WorldGame.world.renderer);
    sphere = new T.SphereGeometry(1, 14, 10);
    tube = new T.CylinderGeometry(1, 1, 1, 14, 1, true);
    say('LOADING MODELS…');
    building = Promise.all(ORDER.map(function (id) {
      return WorldModels.create(id).then(function (r) { return r; }, function () { return null; });
    })).then(function (rigs) {
      items = rigs.map(function (r, i) { return make(ORDER[i], r); });
      // The goblin rides a glider of his own, at the same origin.
      var gob = byId('goblin');
      if (gob && gob.rig) return WorldModels.create('glider').then(function (g) { gob.ride = g; gob.rig.root.add(g.root); }, function () {});
    }).then(function () { layout(); });
    return building;
  }
  function byId(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }

  // The floor under a point, near height y: what a ray straight down from
  // just above it meets first, or null if that is far below (a roof edge).
  function floorAt(x, z, y) {
    var h = WorldGame.world.raycast({ x: x, y: y + 3, z: z }, { x: 0, y: -1, z: 0 }, 40);
    return h ? h.point.y : null;
  }
  // The row's slots for a view direction: across the view, AHEAD metres out.
  function slots(p, yaw, ahead) {
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw), n = items.length;
    return items.map(function (it, i) {
      var k = (i - (n - 1) / 2) * GAP;
      return { x: p.x + fx * ahead + rx * k, z: p.z + fz * ahead + rz * k };
    });
  }
  // In a row in front of you, across your view, facing you. If there isn't
  // level floor for the whole row that way (the spawn roof's edge, a wall),
  // try the other ways round, and turn you to face the first that fits.
  function layout() {
    var p = WorldGame.player; if (!p) return;
    // The floor you stand on (you may still be dropping onto it).
    var y0 = floorAt(p.x, p.z, p.y), eye = Player.eye(p), best = null;
    if (y0 === null) y0 = p.y;
    for (var a = 0; a < 8 && !best; a++) {
      var yaw = p.yaw + Math.PI / 4 * (a % 2 ? (a + 1) / 2 : -a / 2);
      [AHEAD, 6].some(function (ahead) {
        var fx = -Math.sin(yaw), fz = -Math.cos(yaw), wall = WorldGame.world.raycast(eye, { x: fx, y: 0, z: fz }, ahead + 2);
        if (wall) return false;
        var s = slots(p, yaw, ahead);
        if (!s.every(function (q) { var g = floorAt(q.x, q.z, y0); return g !== null && Math.abs(g - y0) < .35; })) return false;
        best = { yaw: yaw, at: s };
        return true;
      });
    }
    if (best) { p.yaw = best.yaw; p.pitch = -.12; }
    var yawNow = best ? best.yaw : p.yaw, at = best ? best.at : slots(p, p.yaw, AHEAD);
    items.forEach(function (it, i) {
      if (!it.rig) return;
      var g = floorAt(at[i].x, at[i].z, y0);
      // Lift what hangs below its origin (the glider's wings) clear of the floor.
      // A camera-space model's origin is the eye: stand it at the eye height
      // of the body it was cut from, turned round (it looks down -Z) to face you.
      var low = Math.min(it.measured.bottom, it.ride ? it.ride.height().bottom : 0), floor = g === null ? y0 : g;
      if (it === pov) return;
      if (it.camera) {
        it.rig.root.position.set(at[i].x, floor + eyeHeight(), at[i].z);
        it.rig.root.rotation.set(0, yawNow + Math.PI, 0);
        return;
      }
      it.rig.root.position.set(at[i].x, floor + (it.spin ? 1.2 : Math.max(0, -low)), at[i].z);
      it.rig.root.rotation.set(0, yawNow, 0);
    });
  }

  function eyeHeight() { var b = WorldModels.entry('spiderman'); return b && b.eye ? b.eye[1] : 1.7; }

  // The selected camera-space model onto the game camera, or back into the row.
  function firstPerson() {
    var it = current();
    if (pov) { pov = null; layout(); return; }
    if (!it || !it.rig || !it.camera) { it = items.filter(function (x) { return x.camera && x.rig; })[0]; }
    if (!it) return;
    pov = it; sel = items.indexOf(it);
  }

  function toggle() {
    if (!WorldGame.active() || !WorldGame.world) return;
    open = !open;
    if (!panel) {
      panel = document.createElement('pre');
      panel.id = 'model-viewer'; panel.className = 'world-perf model-viewer';
      document.getElementById('world').appendChild(panel);
    }
    panel.classList.toggle('is-hidden', !open);
    if (!open) { if (group) group.visible = false; pov = null; return; }
    build().then(function () { group.visible = open; layout(); });
  }

  function current() { return items[sel] || null; }
  function pick(d) { if (items.length) { sel = (sel + d + items.length) % items.length; } }

  // Play the clip k steps along the selected model's list.
  function clip(d) {
    var it = current(); if (!it || !it.rig || !it.clips.length) return;
    it.clip = it.clip < 0 && d < 0 ? it.clips.length - 1 : (it.clip + d + it.clips.length) % it.clips.length;
    playClip(it, it.clips[it.clip]);
  }
  function playClip(it, name) {
    var loops = it.rig.entry.loops || [];
    it.speedK = 0; it.again = 0;
    it.rig.play(name, { restart: true, cut: true });
    it.repeat = loops.indexOf(name) >= 0 ? null : name;
    // The glider keeps flying under him, and spins away when he is beaten.
    if (it.ride) it.ride.play(name === 'defeat' ? 'glider_spin' : 'glider_fly', { restart: name === 'defeat' });
  }
  var SPEED_NAMES = ['stopped', 'walk', 'between', 'run', 'faster'];
  function speeds(it) {
    var s = it.rig.entry.speeds || { walk: 1.5, run: 5 };
    return [0, s.walk, (s.walk + s.run) / 2, s.run, s.run * 1.3];
  }
  function loco() {
    var it = current(); if (!it || !it.rig) return;
    it.speedK = (it.speedK + 1) % 5; it.repeat = null; it.clip = -1;
    it.rig.play('loco', { cut: true }); it.rig.setSpeed(speeds(it)[it.speedK]);
  }

  function frame(dt, now, paused) {
    if (auto && !open && WorldGame.world && WorldGame.player && !paused) { auto = false; toggle(); }
    if (!open || !items.length) return;
    var step = frozen ? 0 : dt, eye = WorldGame.world.camera.position;
    var cam = WorldGame.world.camera;
    items.forEach(function (it) {
      if (!it.rig) return;
      if (it === pov) { it.rig.root.position.copy(cam.position); it.rig.root.quaternion.copy(cam.quaternion); }
      if (it.spin) it.rig.root.rotation.y += step * .8;
      var ev = it.rig.update(step, eye.distanceTo(it.rig.root.position), true);
      if (it.ride) it.ride.update(step);
      ev.forEach(function (e) { if (e.type === 'end' && e.clip === it.repeat) it.again = REPEAT_GAP; });
      if (it.again > 0 && (it.again -= step) <= 0) playClip(it, it.repeat);
      draw(it);
    });
    if (now - shownAt > 100) { shownAt = now; hud(); }
  }

  var up = new T.Vector3(0, 1, 0), dir = new T.Vector3(), wq = new T.Quaternion();
  function draw(it) {
    var show = overlays > 0 && (it.spots.length || it.caps.length || it.wrists.length) && it !== pov;
    it.spots.forEach(function (m) { m.visible = false; });
    it.caps.forEach(function (c) { c.tube.visible = c.a.visible = c.b.visible = false; });
    it.wrists.forEach(function (w) { w.mark.visible = false; });
    if (!show) return;
    // Where the webs leave: the offset is metres along the bone's own axes
    // (rotation only - the armature node is scaled).
    it.wrists.forEach(function (w) {
      if (!w.bone) return;
      w.bone.getWorldPosition(w.mark.position); w.bone.getWorldQuaternion(wq);
      w.mark.position.add(dir.copy(w.offset).applyQuaternion(wq));
      w.mark.scale.setScalar(WRIST_R); w.mark.visible = true;
    });
    var s = it.rig.sample(), e = it.rig.entry;
    s.spots.forEach(function (p) {
      var k = e.weakSpots.map(function (w) { return w.name; }).indexOf(p.name), m = it.spots[k];
      if (!m) return;
      m.visible = true; m.position.set(p.x, p.y, p.z); m.scale.setScalar(p.r);
    });
    s.capsules.forEach(function (c, i) {
      var o = it.caps[i]; if (!o || overlays < 2) return;
      dir.set(c.b.x - c.a.x, c.b.y - c.a.y, c.b.z - c.a.z);
      var len = dir.length();
      o.tube.visible = o.a.visible = o.b.visible = true;
      o.tube.position.set((c.a.x + c.b.x) / 2, (c.a.y + c.b.y) / 2, (c.a.z + c.b.z) / 2);
      o.tube.quaternion.setFromUnitVectors(up, len > 1e-6 ? dir.divideScalar(len) : up);
      o.tube.scale.set(c.r, Math.max(1e-3, len), c.r);
      o.a.position.set(c.a.x, c.a.y, c.a.z); o.a.scale.setScalar(c.r);
      o.b.position.set(c.b.x, c.b.y, c.b.z); o.b.scale.setScalar(c.r);
    });
  }

  function say(text) { if (panel) panel.textContent = text; }
  function hud() {
    var lines = ['MODEL VIEWER   [ ] model   , . clip   H hit   L walk/run   V first person' + (pov ? ' (ON)' : '') + '   O overlays: ' + ['none', 'spots', 'all'][overlays] +
      '   / ' + (frozen ? 'FROZEN' : 'freeze') + '   M close'];
    items.forEach(function (it, i) {
      var head = (i === sel ? '> ' : '  ') + it.id.toUpperCase();
      if (!it.rig) { lines.push(head + '   (missing: see the console)'); return; }
      var e = it.rig.entry, h = e.height ? e.height.toFixed(2) + ' m' : '', st = it.rig.state();
      var line = head + '   ' + (h ? h + ' (stands ' + it.measured.height.toFixed(2) + ')' : 'size ' + it.measured.height.toFixed(2) + ' m') +
        '   ' + it.clips.length + ' clips';
      if (i === sel) {
        var p = Rig.pose(it.rig.machine).filter(function (x) { return !x.additive; }).sort(function (a, b) { return b.w - a.w; })[0];
        line += '\n     ' + (it.clip >= 0 ? 'clip ' + (it.clip + 1) + '/' + it.clips.length + ' ' + it.clips[it.clip] :
          it.speedK ? 'walk/run: ' + SPEED_NAMES[it.speedK] + ' ' + speeds(it)[it.speedK].toFixed(1) + ' m/s' : 'clip -') +
          (p ? '   ' + p.clip + ' ' + p.t.toFixed(2) + ' / ' + (it.rig.machine.clips[p.clip] || 0).toFixed(2) + ' s' : '') +
          '   base ' + st.base + (st.shot ? ' · shot ' + st.shot : '') + (st.additive.length ? ' · +' + st.additive.join('+') : '') +
          '\n     ' + it.clips.join(' ');
      }
      lines.push(line);
    });
    say(lines.join('\n'));
  }

  window.addEventListener('keydown', function (e) {
    if (!WorldGame.active() || WorldGame.paused()) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'KeyM') { toggle(); return; }
    if (!open) return;
    var it = current();
    // By key, or by key position for layouts where these are shifted.
    var key = e.key, code = e.code;
    if (key === '[' || code === 'BracketLeft') pick(-1);
    else if (key === ']' || code === 'BracketRight') pick(1);
    else if (key === ',' || code === 'Comma') clip(-1);
    else if (key === '.' || code === 'Period') clip(1);
    else if (e.code === 'KeyH' && it && it.rig) it.rig.play('hit');
    else if (e.code === 'KeyL') loco();
    else if (e.code === 'KeyO') overlays = (overlays + 2) % 3;
    else if (e.code === 'KeyV') firstPerson();
    else if (key === '/' || code === 'Slash') { frozen = !frozen; e.preventDefault(); }
    else return;
    hud();
  });

  WorldGame.onFrame(frame);
  // ?viewer: straight into the city with the viewer open.
  document.addEventListener('webshooter:ready', function () { if (auto && !WorldGame.active()) WorldGame.start(); });

  window.ModelViewer = {
    toggle: toggle, isOpen: function () { return open; }, get items() { return items; },
    select: function (id) { var i = ORDER.indexOf(id); if (i >= 0) sel = i; hud(); },
    play: function (name) { var it = current(); if (it && it.rig) { it.clip = it.clips.indexOf(name); playClip(it, name); } },
    loco: loco, layout: layout, firstPerson: firstPerson, pov: function () { return pov ? pov.id : null; }, ready: function () { return building || Promise.resolve(); }
  };
})();

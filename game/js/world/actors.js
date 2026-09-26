(function (root) {
  'use strict';
  // Draws what fight.js and training3d.js describe: glowing markers on the
  // villain's weak spots, the masked thugs, the training target, and the
  // light columns that mark where each fight starts when you are roaming. A
  // handful of draw calls in all. The villains themselves are animated models
  // (villain-view.js); only if one can't be loaded is it drawn here, as the
  // old sprite that turns to face you - whose pictures (villain-sprites.js,
  // 1.7 MB) are only fetched then.

  var T = root.THREE;
  var BEACON_H = 260;
  var BEACON_COLORS = { goblin: '#8dff6a', rhino: '#ffb347', venom: '#c78bff', training: '#5fe3ff' };

  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c) { var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; }

  // The target mark, as in the 2D game: a white ring with a red cross, and a
  // glow round it. The ring is RING of the texture's half-width, so a sprite
  // of size r / RING shows a ring of radius r.
  var RING = .62;
  // A marker's ring is at least this wide on screen (radians of radius), so a
  // weak spot the size of a head still shows at the Rhino's 25 metres.
  var MIN_MARK = .6 * Math.PI / 180;
  function markTexture(kind) {
    var S = 128, c = canvas(S, S), g = c.getContext('2d'), m = S / 2, r = m * RING;
    if (kind === 'current') {
      g.shadowColor = 'rgba(255,60,60,.9)'; g.shadowBlur = 14;
      g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.stroke();
      g.shadowBlur = 0; g.strokeStyle = '#e3262e'; g.lineWidth = 6; g.beginPath();
      g.moveTo(m - r, m); g.lineTo(m + r, m); g.moveTo(m, m - r); g.lineTo(m, m + r); g.stroke();
    } else if (kind === 'other') {
      g.strokeStyle = 'rgba(159,240,255,.75)'; g.lineWidth = 4; g.setLineDash([9, 7]);
      g.beginPath(); g.arc(m, m, r * .8, 0, Math.PI * 2); g.stroke();
    } else {                          // the pulse ring round a training target
      g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(m, m, r * 1.45, 0, Math.PI * 2); g.stroke();
    }
    return tex(c);
  }
  function sprite(map, order) {
    var s = new T.Sprite(new T.SpriteMaterial({ map: map, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    s.renderOrder = order || 3; s.visible = false;
    return s;
  }

  // A faint vertical glow, brightest at the foot.
  function beaconTexture() {
    var c = canvas(4, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.7, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,.9)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    return tex(c);
  }

  // --- the thugs ------------------------------------------------------------------
  // Black suits, white shirts, white masks with black eyes, as in the first
  // clip. Every part of every thug is one instance of three meshes (suit, white,
  // black), placed each frame from the thug's own transform.
  var PARTS = {
    suit: [[.2, .85, .22, -.12, .425, 0], [.2, .85, .22, .12, .425, 0], [.5, .62, .28, 0, 1.16, 0],
      [.14, .62, .16, -.33, 1.13, 0], [.14, .62, .16, .33, 1.13, 0]],
    white: [[.16, .5, .02, 0, 1.2, .145], [.24, .28, .25, 0, 1.64, 0], [.1, .1, .1, -.33, .78, 0], [.1, .1, .1, .33, .78, 0]],
    black: [[.07, .05, .02, -.055, 1.68, .13], [.07, .05, .02, .055, 1.68, .13], [.05, .32, .02, 0, 1.22, .16]]
  };
  var COLORS = { suit: 0x17181b, white: 0xe9e6df, black: 0x050505 };
  var MAX_THUGS = 12;

  // The sprite pictures, fetched the first time a sprite is needed.
  var spritesLoading = null;
  function spritePictures() {
    if (root.VillainSprites) return Promise.resolve(root.VillainSprites);
    if (!spritesLoading) spritesLoading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'js/world/villain-sprites.js';
      s.onload = function () { resolve(root.VillainSprites || {}); };
      s.onerror = function () { resolve({}); };
      document.head.appendChild(s);
    });
    return spritesLoading;
  }

  function create(scene, spots) {
    var group = new T.Group(); scene.add(group);
    var loader = new T.TextureLoader();
    var plane = new T.PlaneGeometry(1, 1); plane.translate(0, .5, 0);

    // The fallback: one sprite per villain, made the first time it is needed;
    // only the one being fought is shown. The group turns to face you and is
    // what webs stick to; the scaled mesh inside it is the picture.
    var villains = (root.VILLAINS || []).map(function (v) {
      var mat = new T.MeshBasicMaterial({ transparent: true, alphaTest: .4, side: T.DoubleSide, toneMapped: false, visible: false });
      var mesh = new T.Mesh(plane, mat), g = new T.Group();
      mesh.scale.set(v.height * v.aspect, v.height, 1); mesh.renderOrder = 1;
      g.rotation.order = 'YXZ'; g.add(mesh); g.visible = false; group.add(g);
      return { group: g, mesh: mesh, mat: mat, data: v, asked: false };
    });
    function picture(v) {
      if (v.asked) return;
      v.asked = true;
      spritePictures().then(function (pics) {
        var map = loader.load(pics[v.data.id] || v.data.sprite); map.colorSpace = T.SRGBColorSpace;
        v.mat.map = map; v.mat.visible = true; v.mat.needsUpdate = true;
      });
    }
    var shown = null, flashAt = -1e9;
    var toEye = new T.Vector3();

    var texCurrent = markTexture('current'), texOther = markTexture('other'), texPulse = markTexture('pulse');
    var marks = [0, 1, 2].map(function () { var s = sprite(texOther); group.add(s); return s; });
    // The training target sits half a metre off a wall; drawn over it, so a
    // big far one isn't cut by the wall it is mounted on. It is only ever
    // placed where there is a clear line to it from the training roof.
    var target = sprite(texCurrent, 4), pulse = sprite(texPulse, 4); group.add(target); group.add(pulse);
    target.material = target.material.clone(); target.material.depthTest = false;
    pulse.material.depthTest = false;

    // Thugs.
    var box = new T.BoxGeometry(1, 1, 1), parts = {};
    Object.keys(PARTS).forEach(function (k) {
      var m = new T.InstancedMesh(box, new T.MeshLambertMaterial({ color: COLORS[k] }), PARTS[k].length * MAX_THUGS);
      m.castShadow = true; m.count = 0; m.frustumCulled = false;
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      parts[k] = m; group.add(m);
    });
    var anchors = [];
    for (var i = 0; i < MAX_THUGS; i++) { var a = new T.Object3D(); a.rotation.order = 'YXZ'; group.add(a); anchors.push(a); }
    var local = new T.Matrix4(), M = new T.Matrix4(), q0 = new T.Quaternion(), one = new T.Vector3(1, 1, 1), off = new T.Vector3(), sc = new T.Vector3();

    // Beacons: a light column at each street trigger.
    var beamTex = beaconTexture(), beamGeo = new T.CylinderGeometry(1.6, 1.6, BEACON_H, 16, 1, true);
    beamGeo.translate(0, BEACON_H / 2, 0);
    var beacons = spots.map(function (s) {
      var m = new T.Mesh(beamGeo, new T.MeshBasicMaterial({ map: beamTex, color: BEACON_COLORS[s.id] || '#5fe3ff', transparent: true,
        opacity: .32, blending: T.AdditiveBlending, depthWrite: false, fog: false, side: T.DoubleSide }));
      m.position.set(s.trigger.x, s.trigger.y, s.trigger.z); m.renderOrder = 5; m.visible = false; group.add(m);
      return m;
    });

    // --- per frame ---
    // fight: a Fight state (or null); eye: where you are; now: ms. model: the
    // villain is drawn as its model (villain-view.js), so only its weak-spot
    // markers are drawn here; otherwise it is the sprite, faded by `fade`.
    function drawFight(fight, villainsData, eye, now, fade, model) {
      var here = fight && fight.at && (fight.phase === 'villain' || fight.phase === 'arrive');
      var id = here && !model ? fight.villain : null;
      villains.forEach(function (v, k) { v.group.visible = k === id; });
      shown = id;
      marks.forEach(function (m) { m.visible = false; });
      if (id !== null) {
        var bb = root.Fight.billboard(fight, villainsData, eye), v = villains[id];
        picture(v);
        v.group.position.set(bb.at.x, bb.at.y, bb.at.z);
        v.group.rotation.set(-bb.tilt, Math.atan2(bb.normal.x, bb.normal.z), 0);
        // A hit flashes it bright; defeat fades it out.
        var f = Math.max(0, 1 - (now - flashAt) / 180);
        v.mat.color.setRGB(1 + f * 1.6, 1 + f * .5, 1 + f * .5);
        v.mat.opacity = fade === undefined ? 1 : fade;
      }
      if (here && fight.mode === 'playing') root.Fight.weakSpots(fight, villainsData, eye).forEach(function (w, k) {
        var m = marks[k], pulseK = w.current ? 1 + .1 * Math.sin(now / 120) : 1;
        // On the side of the sphere facing you - on a model, its surface -
        // and never so small on screen that it can't be seen.
        toEye.set(eye.x - w.x, eye.y - w.y, eye.z - w.z);
        var d = toEye.length(), r = Math.max(w.r, d * MIN_MARK);
        toEye.multiplyScalar((model ? w.r * 1.25 + .05 : .08) / (d || 1));
        m.material.map = w.current ? texCurrent : texOther;
        m.position.set(w.x + toEye.x, w.y + toEye.y, w.z + toEye.z);
        m.scale.setScalar(r / RING * pulseK * (w.current ? 1 : .9));
        m.renderOrder = w.current ? 4 : 3;
        m.visible = true;
      });
      drawThugs(fight ? fight.thugs : [], eye, fight ? fight.time : 0);
    }

    function drawThugs(list, eye, t) {
      var counts = { suit: 0, white: 0, black: 0 };
      list.forEach(function (th, n) {
        if (n >= MAX_THUGS) return;
        var a = anchors[n];
        a.position.set(th.x, th.y, th.z);
        a.rotation.y = th.down ? a.rotation.y : Math.atan2(eye.x - th.x, eye.z - th.z);
        // Knocked down: topple backwards over half a second. Hit but still
        // up: rock back for a moment.
        var fall = th.down ? Math.min(1, (t - th.downAt) / .5) : 0, rock = th.hitAt >= 0 ? Math.max(0, 1 - (t - th.hitAt) / .3) : 0;
        a.rotation.x = -(fall * fall) * Math.PI / 2 * .96 - rock * .35;
        a.updateMatrixWorld(true);
        Object.keys(PARTS).forEach(function (k) {
          PARTS[k].forEach(function (p) {
            local.compose(off.set(p[3], p[4], p[5]), q0, sc.set(p[0], p[1], p[2]));
            M.multiplyMatrices(a.matrixWorld, local);
            parts[k].setMatrixAt(counts[k]++, M);
          });
        });
      });
      Object.keys(parts).forEach(function (k) { parts[k].count = counts[k]; parts[k].instanceMatrix.needsUpdate = true; });
    }

    // The training target: the mark, with a pulsing ring round it.
    function drawTarget(t, now) {
      target.visible = pulse.visible = !!t;
      if (!t) return;
      target.material.map = texCurrent;
      target.position.set(t.x, t.y, t.z); target.scale.setScalar(t.r / RING);
      pulse.position.copy(target.position); pulse.scale.setScalar(t.r / RING * (1 + .06 * Math.sin(now / 170)));
    }

    function showBeacons(on) { beacons.forEach(function (b) { b.visible = on; }); }
    function flash(now) { flashAt = now; }
    function villainAnchor() { return shown === null ? null : villains[shown].group; }
    function thugAnchor(n) { return anchors[n] || null; }
    function clear() { drawFight(null, null, { x: 0, y: 0, z: 0 }, 0); drawTarget(null); showBeacons(false); }

    return { drawFight: drawFight, drawTarget: drawTarget, showBeacons: showBeacons, flash: flash,
      villainAnchor: villainAnchor, thugAnchor: thugAnchor, clear: clear };
  }

  root.WorldActors = { create: create, BEACON_COLORS: BEACON_COLORS };
})(window);

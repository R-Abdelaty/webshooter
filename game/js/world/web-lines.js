(function (root) {
  'use strict';
  // The webs in flight, drawn (web-shot.js is their shape and timing). Each
  // is one mesh of fibre ribbons rebuilt every frame, from where the wrist
  // was at the snap (the hand you see) to its target now, so it follows a
  // villain it is stuck to. It is in the world, depth-tested: his arm and
  // body hide the part of it behind them, so it never seems to come out of
  // his chest. Soft-edged, translucent and unlit, like fine silk in the sun.

  var T = root.THREE;
  var MAX = 6;

  function edgeTexture() {
    var c = document.createElement('canvas'); c.width = 4; c.height = 32;
    var g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.3, 'rgba(255,255,255,.85)');
    gr.addColorStop(.5, 'rgba(255,255,255,1)'); gr.addColorStop(.7, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 32);
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  function create(scene) {
    var group = new T.Group(); group.name = 'web-lines'; scene.add(group);
    var mat = new T.MeshBasicMaterial({ map: edgeTexture(), vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide });
    var index = WebShot.indices(), n = WebShot.size(), pool = [], live = [];
    var eye = new T.Vector3();

    function make() {
      var g = new T.BufferGeometry();
      var pos = new T.BufferAttribute(new Float32Array(n * 3), 3), col = new T.BufferAttribute(new Float32Array(n * 4), 4), uv = new T.BufferAttribute(new Float32Array(n * 2), 2);
      [pos, col, uv].forEach(function (a) { a.setUsage(T.DynamicDrawUsage); });
      g.setAttribute('position', pos); g.setAttribute('color', col); g.setAttribute('uv', uv); g.setIndex(index);
      var m = new T.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 3; m.visible = false; group.add(m);
      return { mesh: m, out: { pos: pos.array, col: col.array, uv: uv.array } };
    }

    // from, to: functions returning a point now (the wrist; the target, which
    // may move with a villain) or plain points.
    function add(shot, from, to) {
      if (live.length >= MAX) { live[0].slot.mesh.visible = false; pool.push(live.shift().slot); }
      live.push({ shot: shot, from: from, to: to, slot: pool.pop() || make() });
    }
    function at(p) { return typeof p === 'function' ? p() : p; }

    // camera: the game camera; height: the canvas height in pixels.
    function update(now, camera, height) {
      camera.getWorldPosition(eye);
      var pxPerM = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, height);
      live = live.filter(function (w) {
        // The web leaves the wrist where the wrist is at the snap, and is free of it after.
        if (now >= w.shot.launch && !w.left) w.left = at(w.from);
        var ok = now < w.shot.done && !!w.left && WebShot.build(w.shot, w.left, at(w.to), now, eye, pxPerM, w.slot.out);
        var m = w.slot.mesh, g = m.geometry;
        m.visible = !!ok;
        if (ok) { g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.uv.needsUpdate = true; }
        if (now >= w.shot.done) { m.visible = false; pool.push(w.slot); return false; }
        return true;
      });
    }
    function clear() { live.forEach(function (w) { w.slot.mesh.visible = false; pool.push(w.slot); }); live = []; }

    return { add: add, update: update, clear: clear, get group() { return group; }, count: function () { return live.length; } };
  }

  root.WorldWebLines = { create: create };
})(window);

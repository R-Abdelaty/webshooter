(function (root) {
  'use strict';
  // Web splats stuck to the city where shots land. Each is a flat quad with an
  // orb-web texture, laid on the surface that was hit and pushed a few
  // centimetres off it. Like the 2D game, a web pops in, stays, fades near the
  // end of its life, and the oldest goes once there are too many.

  var T = root.THREE;
  var LIFE = 6000, FADE = 1200, POP = 150, MAX = 24;
  // A web's size grows with distance so a far one still reads: about 2.3
  // degrees across, but never smaller than SIZE_MIN or bigger than SIZE_MAX
  // metres.
  var SIZE_PER_M = .04, SIZE_MIN = .7, SIZE_MAX = 14, LIFT = .03;

  function create(scene) {
    var textures = [1, 2, 3, 4].map(function (k) { return WorldTextures.web(97 + k * 31); });
    var geo = new T.PlaneGeometry(1, 1), pool = [], n = 0;
    var Z = new T.Vector3(0, 0, 1), q = new T.Quaternion(), spin = new T.Quaternion();

    function make() {
      var mat = new T.MeshBasicMaterial({ map: textures[pool.length % textures.length], transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: T.DoubleSide });
      var m = new T.Mesh(geo, mat);
      m.renderOrder = 2; m.visible = false; m.matrixAutoUpdate = true;
      scene.add(m);
      return { mesh: m, born: 0, size: 1 };
    }

    // point and normal are THREE.Vector3s; distance is from the shooter.
    function add(point, normal, distance, now) {
      var w = pool.length < MAX ? (pool.push(make()), pool[pool.length - 1]) : pool[n++ % MAX];
      w.born = now; w.size = Math.max(SIZE_MIN, Math.min(SIZE_MAX, distance * SIZE_PER_M));
      w.mesh.position.copy(point).addScaledVector(normal, LIFT);
      q.setFromUnitVectors(Z, normal);
      spin.setFromAxisAngle(Z, Math.random() * Math.PI * 2);
      w.mesh.quaternion.copy(q).multiply(spin);
      w.mesh.visible = true;
      update(now);
    }

    function update(now) {
      pool.forEach(function (w) {
        if (!w.mesh.visible) return;
        var age = now - w.born;
        if (age >= LIFE) { w.mesh.visible = false; return; }
        var pop = Math.min(1, age / POP), grow = 1 - Math.pow(1 - pop, 3);
        w.mesh.scale.setScalar(w.size * Math.max(.05, grow));
        w.mesh.material.opacity = age < LIFE - FADE ? 1 : (LIFE - age) / FADE;
      });
    }

    function clear() { pool.forEach(function (w) { w.mesh.visible = false; }); }

    return { add: add, update: update, clear: clear, count: function () { return pool.filter(function (w) { return w.mesh.visible; }).length; } };
  }

  root.WorldWebs = { create: create };
})(window);

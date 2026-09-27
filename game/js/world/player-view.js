(function (root) {
  'use strict';
  // The player as Spider-Man, on screen (docs/PLAYER_PLAN.md, Session P2).
  // PlayerAnim says what to play; this plays it on the two models and puts
  // them where the player and the camera are. It never moves the player.
  //
  // FIRST PERSON: the arms (spiderman_arms, built in camera space: its origin
  // is the eye) ride a camera of their own that copies the game camera each
  // frame, at the field of view their poses were framed for (the manifest's
  // fov, 75), so a wide FOV setting doesn't shrink them. They are on their
  // own layer (World3D.OVER) and drawn after the city with a cleared depth
  // buffer (world.renderOver), so they never go into a wall, lit by the same
  // sun and sky and graded the same. The full body stays in the world,
  // unseen (its materials write nothing), so on MED it still casts your
  // shadow; on LOW it is hidden.
  //
  // THIRD PERSON: the full body (spiderman) stands at the player's feet,
  // turned the way PlayerAnim.face says, with the villains' look - their
  // rim light and the reflection of the fight's street (WorldVillains.patch).
  // It is hidden when the camera is pulled in too close to it.
  //
  // wrist(hand) is where a web leaves: the visible wrist, in world space. In
  // first person that is the point in the world that shows on screen where
  // the arms' camera draws the wrist, so a strand drawn from it starts on
  // the hand you see.

  var T = root.THREE;

  function create(world) {
    var group = new T.Group(); group.name = 'player'; world.scene.add(group);
    var bodyRig = null, armsRig = null, armsCam = null, loading = null;
    var bodyMats = [], ghost = null, u = null, env = null, mode = 'first', cast = true, ready = false;
    var v3 = new T.Vector3(), q = new T.Quaternion(), off = new T.Vector3();

    function load() {
      if (loading) return loading;
      WorldModels.setRenderer(world.renderer);
      loading = Promise.all([WorldModels.create('spiderman'), WorldModels.create('spiderman_arms', { base: 'fp_idle' })]).then(function (r) {
        bodyRig = r[0]; armsRig = r[1];
        group.add(bodyRig.root);
        // The body's own materials, with the villains' rim and reflections.
        u = WorldVillains.uniforms('spiderman');
        bodyRig.model.traverse(function (o) {
          if (!o.isMesh) return;
          o.receiveShadow = true;
          o.material = [].concat(o.material).map(function (m) {
            var c = m.clone();
            if (c.isMeshStandardMaterial) WorldVillains.patch(c, u);
            bodyMats.push({ mesh: o, m: c });
            return c;
          });
          if (o.material.length === 1) o.material = o.material[0];
          o.userData.own = o.material;
        });
        // First person: draws nothing, but the shadow pass still sees it.
        ghost = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        armsCam = new T.PerspectiveCamera(armsRig.entry.fov || 75, 16 / 9, .03, 10);
        armsCam.layers.set(World3D.OVER);
        armsCam.add(armsRig.root);
        world.scene.add(armsCam);
        armsRig.model.traverse(function (o) {
          if (!o.isMesh) return;
          o.layers.set(World3D.OVER); o.castShadow = false; o.receiveShadow = true;
        });
        ready = true;
        setMode(mode); setEnvironment(env);
      }, function () { ready = false; });
      return loading;
    }

    function setMode(m) {
      mode = m === 'third' ? 'third' : 'first';
      if (!ready) return;
      bodyMats.forEach(function (x) { x.mesh.material = mode === 'third' ? x.mesh.userData.own : ghost; });
      armsCam.visible = mode === 'first';
      shadows();
    }
    function shadows() {
      if (!ready) return;
      bodyRig.model.traverse(function (o) { if (o.isMesh) o.castShadow = cast; });
    }
    function setCast(on) { cast = !!on; shadows(); }
    // A PMREM texture of the city to reflect (the fight's), or null for the
    // neutral studio one. The caller owns it (villain-view.js disposes it).
    function setEnvironment(tex) {
      env = tex || null;
      if (!ready) return;
      var e = env || WorldModels.studio();
      bodyMats.forEach(function (x) {
        if (x.m.isMeshStandardMaterial) { x.m.envMap = e; x.m.envMapIntensity = env ? WorldVillains.ENV_INTENSITY : 1; x.m.needsUpdate = true; }
      });
    }

    // Each frame, after the camera is placed (and shaken). f: {
    //   player, face (the body's yaw), anim (PlayerAnim.step's out), shots
    //   (PlayerAnim.shoot outs this frame), dt, hide (third person: the camera
    //   is inside him) }.
    function update(f) {
      if (!ready) return [];
      var p = f.player, a = f.anim, ev = [];
      a.body.forEach(function (c) { bodyRig.play(c[0], c[1]); });
      a.arms.forEach(function (c) { armsRig.play(c[0], c[1]); });
      (f.shots || []).forEach(function (s) {
        s.body.forEach(function (c) { bodyRig.play(c[0], c[1]); });
        s.arms.forEach(function (c) { armsRig.play(c[0], c[1]); });
      });
      bodyRig.setSpeed(a.speed);
      if (armsRig.state().base === 'fp_run') armsRig.play('fp_run', { speed: a.armSpeed });

      var third = mode === 'third';
      bodyRig.root.position.set(p.x, p.y, p.z);
      bodyRig.root.rotation.set(0, f.face + Math.PI, 0);   // the model faces +z; yaw 0 looks -z
      bodyRig.root.visible = third ? !f.hide : cast;
      // Hidden and not casting: nothing needs his pose worked out every frame.
      ev = ev.concat(bodyRig.update(f.dt, third ? 0 : 50, bodyRig.root.visible));
      if (!third) {
        var cam = world.camera;
        armsCam.position.copy(cam.position); armsCam.quaternion.copy(cam.quaternion);
        if (armsCam.aspect !== cam.aspect) { armsCam.aspect = cam.aspect; armsCam.updateProjectionMatrix(); }
        armsCam.updateMatrixWorld(true);
        ev = ev.concat(armsRig.update(f.dt));
      }
      return ev;
    }

    // The arms, over the picture (first person only).
    function render() { if (ready && mode === 'first') world.renderOver(armsCam); }

    // Where the web leaves hand 'l' or 'r', in world space - see the top.
    function wrist(hand) {
      if (!ready) return null;
      var rig = mode === 'third' ? bodyRig : armsRig, w = rig.entry.wrists[hand === 'l' ? 'l' : 'r'], b = rig.bone(w.bone);
      if (!b) return null;
      rig.root.updateMatrixWorld(true);
      b.getWorldPosition(v3); b.getWorldQuaternion(q);
      v3.add(off.fromArray(w.offset).applyQuaternion(q));
      if (mode === 'first') {
        // In the arms' camera's view, then out through the game camera at the
        // same depth, so both show it on the same pixel.
        var cam = world.camera;
        v3.applyMatrix4(armsCam.matrixWorldInverse);
        var k = Math.tan(cam.fov * Math.PI / 360) / Math.tan(armsCam.fov * Math.PI / 360);
        v3.x *= k; v3.y *= k;
        v3.applyMatrix4(cam.matrixWorld);
      }
      return { x: v3.x, y: v3.y, z: v3.z };
    }

    // The player's body capsules in the world (third person's pose), for
    // villain attacks later (P4); null until loaded.
    function sample() { return ready ? bodyRig.sample() : null; }

    return {
      load: load, update: update, render: render, wrist: wrist, sample: sample, setMode: setMode, setCast: setCast,
      setEnvironment: setEnvironment, get group() { return group; }, get ready() { return ready; }, get mode() { return mode; },
      get body() { return bodyRig; }, get arms() { return armsRig; }, get armsCamera() { return armsCam; }
    };
  }

  root.WorldPlayer = { create: create };
})(window);

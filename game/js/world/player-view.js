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
  //
  // SWINGING (P3): the hand on the line reaches for its anchor - two-bone IK
  // on that arm, after the clip has posed it, in first person in the arms'
  // own camera space (the anchor put where the arms' camera would show it).
  // In third person the body also hangs along the line: turned about the
  // hands so its up runs up the line, the legs trailing a little with speed,
  // never more than TILT_MAX from upright (no flips).
  //
  // ALIVE (P9): over whatever clip the arms play, ArmMotion's layer - the
  // arms lag the view's turn and your acceleration on a spring, dip on a
  // landing, flutter in the wind, breathe when still, and the free arm swings
  // against the pendulum. It turns and moves the arms about the eye (their
  // root), pushes the free hand with the same IK, and rolls the forearms and
  // curls the fingers; held back so no hand comes near the crosshair
  // (ArmMotion.keepClear), and toned down by CAMERA MOTION: REDUCED. In third
  // person the body mixes its jump and fall by how fast he climbs (the 'air'
  // blend) and leans into the way he flies, pivoting about his middle.

  var T = root.THREE;
  var TILT_MAX = 1.05, TRAIL = .35, TRAIL_V = 30, TILT_EASE = 9, IK_EASE = 12, REACH = .97, HANG = 2.15;
  // First person: the hand never reaches nearer the middle of the view than
  // FP_OFF radians, nor further than FP_CROSS across to the other hand's side,
  // so the arm stays up at its own edge and the line runs out across the view.
  var FP_OFF = .72, FP_CROSS = .25;
  // The air lean turns the body about this height (m); a line's hang turns it
  // about the hands (HANG); between the two the pivot eases.
  var LEAN_PIVOT = 1, PIVOT_EASE = 6;
  var FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'], SIDE = { l: 'mixamorig:Left', r: 'mixamorig:Right' };
  var ARM = { l: ['mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand'], r: ['mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand'] };

  // Two-bone IK: turn the upper and lower bones so the end of `names`
  // reaches `target` (world), keeping the elbow's bend on the side the clip
  // put it, blended in by w (0..1). Works on the local rotations the clip set.
  var va = new T.Vector3(), vb = new T.Vector3(), vc = new T.Vector3(), vt = new T.Vector3(), ve = new T.Vector3(), vx = new T.Vector3(), vy = new T.Vector3();
  var qw = new T.Quaternion(), qp = new T.Quaternion(), qd = new T.Quaternion(), ql = new T.Quaternion();
  function turn(bone, from, to, w) {
    if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
    qd.setFromUnitVectors(from.normalize(), to.normalize());
    bone.getWorldQuaternion(qw); bone.parent.getWorldQuaternion(qp);
    ql.copy(qp).invert().multiply(qd.multiply(qw));
    bone.quaternion.slerp(ql, w);
    bone.updateMatrixWorld(true);
  }
  function ik(rig, names, target, w) {
    var A = rig.bone(names[0]), B = rig.bone(names[1]), C = rig.bone(names[2]);
    if (!A || !B || !C || !(w > 0)) return;
    A.getWorldPosition(va); B.getWorldPosition(vb); C.getWorldPosition(vc);
    var l1 = va.distanceTo(vb), l2 = vb.distanceTo(vc);
    vt.copy(target).sub(va);
    var d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min((l1 + l2) * .999, vt.length()));
    vx.copy(vt).normalize();
    // The bend: where the clip has the elbow, square to the reach.
    vy.copy(vb).sub(va); vy.addScaledVector(vx, -vy.dot(vx));
    if (vy.lengthSq() < 1e-10) vy.set(0, -1, 0).addScaledVector(vx, vx.y);
    vy.normalize();
    var a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    ve.copy(va).addScaledVector(vx, a).addScaledVector(vy, h);
    turn(A, vb.clone().sub(va), ve.clone().sub(va), w);
    B.getWorldPosition(vb); C.getWorldPosition(vc);
    turn(B, vc.clone().sub(vb), va.clone().addScaledVector(vx, d).sub(vb), w);
  }

  function create(world) {
    var group = new T.Group(); group.name = 'player'; world.scene.add(group);
    var bodyRig = null, armsRig = null, armsCam = null, loading = null;
    var bodyMats = [], ghost = null, u = null, env = null, mode = 'first', cast = true, ready = false;
    var v3 = new T.Vector3(), q = new T.Quaternion(), off = new T.Vector3();
    var tilt = new T.Quaternion(), tiltWant = new T.Quaternion(), qy = new T.Quaternion(), UP = new T.Vector3(0, 1, 0), lineUp = new T.Vector3(), aim = new T.Vector3();
    var ikW = { l: 0, r: 0 }, last = { l: null, r: null };
    var motion = ArmMotion.create(), motionMode = 'full', wasGrounded = true, lastVy = 0, pivot = HANG, saved = [];
    var qa = new T.Quaternion(), AX = new T.Vector3(1, 0, 0), AY = new T.Vector3(0, 1, 0), hands = { l: null, r: null };

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

    // m: CAMERA ('first' / 'third'); cm: CAMERA MOTION ('full' / 'reduced'), if given.
    function setMode(m, cm) {
      mode = m === 'third' ? 'third' : 'first';
      if (cm !== undefined) motionMode = cm === 'reduced' ? 'reduced' : 'full';
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
    //   is inside him), line: { anchor, hand, grip (the line's end on the
    //   player, world) } while on a swing line, else null }.
    function update(f) {
      if (!ready) return [];
      var p = f.player, a = f.anim, ev = [];
      // Last frame's flutter off the fingers and forearms, before the clips pose them again.
      saved.forEach(function (x) { x.bone.quaternion.copy(x.q); }); saved = [];
      a.body.forEach(function (c) { bodyRig.play(c[0], c[1]); });
      a.arms.forEach(function (c) { armsRig.play(c[0], c[1]); });
      (f.shots || []).forEach(function (s) {
        s.body.forEach(function (c) { bodyRig.play(c[0], c[1]); });
        s.arms.forEach(function (c) { armsRig.play(c[0], c[1]); });
      });
      bodyRig.setSpeed(a.speed);
      if (a.rise !== undefined) bodyRig.setBlend('air', a.rise);
      if (armsRig.state().base === 'fp_run') armsRig.play('fp_run', { speed: a.armSpeed });

      var third = mode === 'third', L = f.line, dt = f.dt > 0 ? f.dt : 0;
      // Hanging along the line (third person), eased in and out.
      tiltWant.identity();
      if (L && L.anchor && L.grip) {
        lineUp.set(L.anchor.x - L.grip.x, L.anchor.y - L.grip.y, L.anchor.z - L.grip.z).normalize();
        var sp = Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0);
        if (sp > 1e-3) lineUp.addScaledVector(v3.set(p.vx, p.vy, p.vz).normalize(), TRAIL * Math.min(1, sp / TRAIL_V)).normalize();
        var ang = Math.acos(Math.max(-1, Math.min(1, lineUp.y)));
        if (ang > TILT_MAX) { var hz = Math.hypot(lineUp.x, lineUp.z) || 1; lineUp.set(lineUp.x / hz * Math.sin(TILT_MAX), Math.cos(TILT_MAX), lineUp.z / hz * Math.sin(TILT_MAX)); }
        tiltWant.setFromUnitVectors(UP, lineUp);
      } else if (a.lean && (a.lean.x || a.lean.z)) {
        // Off a line, leaning into the way he flies (PlayerAnim's lean, radians toward x and z).
        var lz = Math.hypot(a.lean.x, a.lean.z);
        lineUp.set(a.lean.x / lz * Math.sin(lz), Math.cos(lz), a.lean.z / lz * Math.sin(lz));
        tiltWant.setFromUnitVectors(UP, lineUp);
      }
      tilt.slerp(tiltWant, 1 - Math.exp(-TILT_EASE * dt));
      qy.setFromAxisAngle(UP, f.face + Math.PI);          // the model faces +z; yaw 0 looks -z
      bodyRig.root.quaternion.copy(tilt).multiply(qy);
      // Turned about the hands on a line, about his middle in a lean.
      pivot += ((L ? HANG : LEAN_PIVOT) - pivot) * (1 - Math.exp(-PIVOT_EASE * dt));
      v3.set(0, -pivot, 0).applyQuaternion(tilt);
      bodyRig.root.position.set(p.x + v3.x, p.y + pivot + v3.y, p.z + v3.z);
      bodyRig.root.visible = third ? !f.hide : cast;
      // Hidden and not casting: nothing needs his pose worked out every frame.
      ev = ev.concat(bodyRig.update(f.dt, third ? 0 : 50, bodyRig.root.visible));
      ['l', 'r'].forEach(function (h) { ikW[h] += ((L && L.hand === h ? 1 : 0) - ikW[h]) * (1 - Math.exp(-IK_EASE * dt)); if (ikW[h] < .005) ikW[h] = 0; });
      if (L) last[L.hand] = { x: L.anchor.x, y: L.anchor.y, z: L.anchor.z };
      if (third && bodyRig.root.visible && L) {
        bodyRig.root.updateMatrixWorld(true);
        ik(bodyRig, ARM[L.hand], aim.set(L.anchor.x, L.anchor.y, L.anchor.z), ikW[L.hand]);
      }
      // The alive layer's springs run in both views, so switching view doesn't jolt them.
      var land = !wasGrounded && p.grounded ? Math.max(0, -lastVy) : 0;
      if (dt > 0) { wasGrounded = !!p.grounded; lastVy = p.vy || 0; }
      var alive = ArmMotion.step(motion, { yaw: p.yaw, pitch: p.pitch, vel: { x: p.vx || 0, y: p.vy || 0, z: p.vz || 0 }, land: dt > 0 ? land : 0,
        idle: a.state === 'idle' || a.state === 'perch', line: L, motion: motionMode }, dt);
      if (!third) {
        var cam = world.camera;
        armsCam.position.copy(cam.position); armsCam.quaternion.copy(cam.quaternion);
        if (armsCam.aspect !== cam.aspect) { armsCam.aspect = cam.aspect; armsCam.updateProjectionMatrix(); }
        armsRig.root.position.set(0, 0, 0); armsRig.root.rotation.set(0, 0, 0);
        armsCam.updateMatrixWorld(true);
        ev = ev.concat(armsRig.update(f.dt));
        // The hand on the line (or letting go of it, easing back to its clip).
        var hand = L ? L.hand : ikW.l > ikW.r ? 'l' : 'r', A = last[hand];
        if (ikW[hand] > 0 && A) {
          armsRig.root.updateMatrixWorld(true);
          // The anchor where the arms' camera shows what the game camera shows
          // there (the inverse of wrist()), and the hand reached toward it.
          aim.set(A.x, A.y, A.z).applyMatrix4(cam.matrixWorldInverse);
          var k = Math.tan(cam.fov * Math.PI / 360) / Math.tan(armsCam.fov * Math.PI / 360);
          aim.x /= k; aim.y /= k;
          aim.applyMatrix4(armsCam.matrixWorld);
          var sh = armsRig.bone(ARM[hand][0]), fa = armsRig.bone(ARM[hand][1]), hd = armsRig.bone(ARM[hand][2]);
          if (sh && fa && hd) {
            sh.getWorldPosition(va); fa.getWorldPosition(vb); hd.getWorldPosition(vc);
            var reach = (va.distanceTo(vb) + vb.distanceTo(vc)) * REACH;
            // Toward the anchor, as the arms' camera sees it, kept to the hand's edge of the view.
            aim.sub(va).normalize().transformDirection(armsCam.matrixWorldInverse);
            var sgn = hand === 'l' ? -1 : 1, off = Math.acos(Math.max(-1, Math.min(1, -aim.z)));
            var sx = aim.x, sy = aim.y, sl = Math.hypot(sx, sy);
            if (sl < 1e-4) { sx = sgn * .6; sy = .8; sl = 1; }
            sx /= sl; sy /= sl;
            if (sgn * sx < -FP_CROSS) { sx = -sgn * FP_CROSS; sy = Math.sqrt(1 - sx * sx) * (sy < 0 ? -1 : 1); }
            off = Math.max(off, FP_OFF);
            aim.set(sx * Math.sin(off), sy * Math.sin(off), -Math.cos(off)).transformDirection(armsCam.matrixWorld);
            aim.multiplyScalar(reach).add(va);
            ik(armsRig, ARM[hand], aim, ikW[hand]);
          }
        }
        liven(alive);
      }
      return ev;
    }

    // The alive layer on the arms (first person), after the clip and the line's IK.
    function liven(o) {
      // Where the clip has put each hand, in the arms' camera space; the layer
      // is held back if it would bring one near the crosshair.
      armsRig.root.updateMatrixWorld(true);
      ['l', 'r'].forEach(function (h) {
        var b = armsRig.bone(ARM[h][2]);
        hands[h] = b ? armsCam.worldToLocal(b.getWorldPosition(v3)).toArray() : null;
      });
      o = ArmMotion.keepClear(o, hands);
      armsRig.root.position.fromArray(o.pos);
      armsRig.root.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
      armsRig.root.updateMatrixWorld(true);
      ['l', 'r'].forEach(function (h) {
        var d = o.hands[h], hb = armsRig.bone(ARM[h][2]);
        // The free hand's counter-swing: its own offset, reached with the arm's IK.
        if (hb && Math.hypot(d[0], d[1], d[2]) > 1e-4) {
          hb.getWorldPosition(aim).add(v3.fromArray(d).applyQuaternion(armsCam.quaternion));
          ik(armsRig, ARM[h], aim, 1);
        }
        // The wind: the forearm rolls about its length, the fingers curl and open.
        var fl = o.flutter[h], fa = armsRig.bone(ARM[h][1]);
        if (!(Math.abs(fl.fore) > 1e-5 || Math.abs(fl.fingers) > 1e-5)) return;
        if (fa) { saved.push({ bone: fa, q: fa.quaternion.clone() }); fa.quaternion.multiply(qa.setFromAxisAngle(AY, fl.fore)); }
        FINGERS.forEach(function (fn, i) {
          [1, 2].forEach(function (k) {
            var fb = armsRig.bone(SIDE[h] + 'Hand' + fn + k);
            if (!fb) return;
            saved.push({ bone: fb, q: fb.quaternion.clone() });
            fb.quaternion.multiply(qa.setFromAxisAngle(AX, fl.fingers * (k === 1 ? 1 : .6) * (1 - .15 * i)));
          });
        });
      });
      armsRig.root.updateMatrixWorld(true);
    }

    // A new life (place() in world-game.js: a RETRY, a new fight, roaming):
    // both models back on their base at once. Without this a held death
    // (Rig: a held one-shot stays until a new base is asked for) carried
    // over - the body lay on the floor and the arms stayed slumped out of
    // view until the next fight's first step. The hang's tilt and the
    // line's IK go too.
    function reset() {
      tilt.identity(); ikW.l = ikW.r = 0; last.l = last.r = null; pivot = HANG;
      ArmMotion.reset(motion); wasGrounded = true; lastVy = 0;
      saved.forEach(function (x) { x.bone.quaternion.copy(x.q); }); saved = [];
      if (armsRig) { armsRig.root.position.set(0, 0, 0); armsRig.root.rotation.set(0, 0, 0); }
      if (!ready) return;
      bodyRig.reset(PlayerAnim.BASE.body); armsRig.reset(PlayerAnim.BASE.arms);
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
      load: load, update: update, reset: reset, render: render, wrist: wrist, sample: sample, setMode: setMode, setCast: setCast,
      setEnvironment: setEnvironment, get group() { return group; }, get ready() { return ready; }, get mode() { return mode; },
      get body() { return bodyRig; }, get arms() { return armsRig; }, get armsCamera() { return armsCam; }
    };
  }

  root.WorldPlayer = { create: create };
})(window);

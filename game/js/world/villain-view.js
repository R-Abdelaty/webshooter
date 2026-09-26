(function (root) {
  'use strict';
  // The villains as animated models in the fights. world/fight.js says where
  // the villain is and which way it faces; villain-anim.js says which clips to
  // play; this places the model, plays them, and each frame samples its bones
  // into plain body capsules (fight.body), which is what shots are judged
  // against - a hit anywhere on him counts - and what a snapshot keeps for
  // lag compensation.
  //
  // Each villain stands in a `craft` group that carries its position, facing
  // and (for the Goblin, who rides his glider) bank. Inside it:
  //  - each clip squares the chest its own way (Venom's idle stands 53
  //    degrees to his right; the turn clips turn the body by themselves);
  //    that is measured once per clip from the shoulders and taken back out
  //    of the craft's yaw, so the villain faces exactly where fight.js says
  //    while the clip supplies the footwork;
  //  - Venom's jump clips lift his feet off the ground in the clip itself; the
  //    model is lowered so his feet follow the arc fight.js moves him along;
  //  - on defeat the Goblin tumbles off and keeps falling, and his glider
  //    spins away on its own.
  //
  // If a villain's model can't be loaded, `shown` stays false for it and
  // actors.js draws the old billboard instead (one warning is logged by
  // WorldModels).

  var T = root.THREE;
  var IDS = ['goblin', 'rhino', 'venom'];
  var CURVE_N = 16;
  var FLASH_MS = 180, BOB = .06;
  var GLIDER_OFF = { speed: 9, up: 2.5, drag: .4, life: 4 };   // the glider leaving after his defeat
  var FALL_G = 9.8, FALL_OUT = 40;                           // the goblin falling after it

  function create(scene, world) {
    var group = new T.Group(); group.name = 'villains'; scene.add(group);
    var items = {}, loading = null, fightRef = null, active = null;
    var flashAt = -1e9, defeat = null;
    var v3 = new T.Vector3(), v3b = new T.Vector3();

    function preload() {
      if (loading) return loading;
      WorldModels.setRenderer(world.renderer);
      loading = Promise.all(IDS.map(function (id) {
        return WorldModels.create(id).then(function (rig) { items[id] = make(id, rig); }, function () { items[id] = null; });
      })).then(function () {
        if (!items.goblin) return null;
        return WorldModels.create('glider').then(function (g) {
          var it = items.goblin;
          it.glider = g; it.craft.add(g.root);
        }, function () {});
      });
      return loading;
    }
    // Loaded (true), failed (false), or still loading (undefined).
    function state(id) { return id in items ? !!items[id] : undefined; }
    function ready(id) { return preload().then(function () { return !!items[id]; }); }

    function make(id, rig) {
      var craft = new T.Group(); craft.name = 'craft:' + id; craft.rotation.order = 'YXZ'; craft.visible = false;
      craft.add(rig.root); group.add(craft);
      // Its own materials, so a hit can flash this one without touching the
      // model viewer's copy.
      var mats = [];
      rig.model.traverse(function (o) {
        if (!o.isMesh) return;
        o.material = [].concat(o.material).map(function (m) { var c = m.clone(); mats.push({ m: c, color: c.color.clone(), glow: !c.emissiveMap }); return c; });
        if (o.material.length === 1) o.material = o.material[0];
      });
      var e = rig.entry, durs = {};
      rig.clipNames.forEach(function (n) { durs[n] = rig.machine.clips[n]; });
      return { id: id, rig: rig, craft: craft, mats: mats, clips: durs, curves: e.shoulders ? curves(rig, e.shoulders) : {},
        air: e.airborne || null, kind: null, glider: null };
    }

    // Which way each clip squares the chest, sampled through it (VillainAnim.curve).
    function curves(rig, sh) {
      var out = {}, inv = new T.Matrix4(), a = new T.Vector3(), b = new T.Vector3(), L = rig.bone(sh[0]), R = rig.bone(sh[1]);
      if (!L || !R) return out;
      rig.clipNames.forEach(function (c) {
        var act = rig.actions[c], d = rig.machine.clips[c], samples = [];
        for (var i = 0; i < CURVE_N; i++) {
          rig.clipNames.forEach(function (n) { rig.actions[n].enabled = false; });
          Object.keys(rig.addActions).forEach(function (n) { rig.addActions[n].enabled = false; });
          act.enabled = true; act.weight = 1; act.time = d * i / (CURVE_N - 1);
          rig.mixer.update(0); rig.root.updateMatrixWorld(true); inv.copy(rig.root.matrixWorld).invert();
          a.setFromMatrixPosition(L.matrixWorld).applyMatrix4(inv);
          b.setFromMatrixPosition(R.matrixWorld).applyMatrix4(inv);
          // The model faces +z with its left towards +x: the shoulder line's yaw.
          samples.push(Math.atan2(-(a.z - b.z), a.x - b.x));
        }
        out[c] = VillainAnim.curve(samples, d);
      });
      rig.apply();
      return out;
    }

    // A new fight (or none): start its villain fresh.
    function reset(f) {
      fightRef = f; defeat = null; active = null;
      IDS.forEach(function (id) { if (items[id]) items[id].craft.visible = false; });
      if (!f) return;
      var it = items[VILLAINS[f.villain].id];
      if (!it) return;
      it.kind = f.kind; it.anim = VillainAnim.create(f.kind, it.clips);
      it.rig.play(f.kind === 'glider' ? 'fly' : 'idle', { cut: true, restart: true, fade: 0 });
      if (it.glider) {
        if (it.glider.root.parent !== it.craft) it.craft.add(it.glider.root);
        it.glider.root.position.set(0, 0, 0); it.glider.root.rotation.set(0, 0, 0);
        it.glider.root.visible = true; it.glider.play('glider_fly', { restart: true, cut: true, fade: 0 });
      }
      it.rig.root.position.set(0, 0, 0);
      active = it;
    }

    // Each frame, before the camera is recorded. dt is how far the clips
    // move on (0 while a PAUSED or INTRO card holds the fight). Returns
    // whether a model is drawn for this fight's villain.
    function update(f, dt, eye, now) {
      if (f !== fightRef || (f && !active && items[VILLAINS[f.villain].id])) reset(f);
      var it = active;
      if (!f || !it) { if (f) f.body = null; return false; }
      // The rhino drops in as his entrance starts: nothing to see before GO.
      var show = !!f.at && f.phase !== 'thugs' && !(f.kind === 'charge' && f.mode === 'intro');
      it.craft.visible = show;
      if (!show) { f.body = null; return true; }

      var out = VillainAnim.step(it.anim, f, dt);
      out.play.forEach(function (p) { it.rig.play(p[0], p[1]); });
      if (out.speed !== null) it.rig.setSpeed(out.speed);
      var d = Math.hypot(eye.x - f.at.x, eye.y - f.at.y, eye.z - f.at.z), onScreen = world.project(f.at).front;
      it.rig.update(dt, d, onScreen);

      var c = it.craft, pose = Rig.pose(it.rig.machine);
      c.position.set(f.at.x, f.at.y, f.at.z);
      c.rotation.set(out.pitch || 0, f.face - VillainAnim.bodyYaw(pose, it.curves), out.roll || 0);
      if (f.mode === 'won' && !defeat) beaten(it, f, now);
      if (it.glider) glide(it, f, dt, now);
      if (defeat && defeat.fall) falling(it, dt);
      if (it.air) {
        c.updateMatrixWorld(true);
        var low = Infinity;
        it.air.feet.forEach(function (b) { var bone = it.rig.bone(b); if (bone) low = Math.min(low, v3.setFromMatrixPosition(bone.matrixWorld).y - c.position.y); });
        if (low < Infinity) c.position.y += VillainAnim.lift(pose, it.air.clips, low, it.air.ankle);
      }
      flash(it, now);
      c.updateMatrixWorld(true);
      f.body = it.rig.sample();
      return true;
    }

    // The goblin's glider flutters under him; when he is beaten it spins away.
    function glide(it, f, dt, now) {
      var g = it.glider;
      if (!defeat) bob(it, f);
      else if (defeat.glider) {
        var q = defeat.glider;
        q.v.y -= 3 * dt; q.v.multiplyScalar(Math.max(0, 1 - GLIDER_OFF.drag * dt));
        g.root.position.addScaledVector(q.v, dt);
        q.age += dt;
        if (q.age > GLIDER_OFF.life) g.root.visible = false;
      }
      g.update(dt);
    }
    // A slow bob, as if riding the air, on the fight's own clock (so a pause
    // holds it too).
    function bob(it, f) { it.craft.position.y += Math.sin(f.time * 1.8) * BOB; }
    function beaten(it, f, now) {
      defeat = { at: now, fall: null, glider: null };
      if (it.id !== 'goblin') return;
      // Knocked off: he tumbles (the defeat clip), then keeps falling to
      // whatever is below; the glider flies on without him.
      var below = world.raycast({ x: f.at.x, y: f.at.y + .5, z: f.at.z }, { x: 0, y: -1, z: 0 }, 400);
      defeat.fall = { t: 0, v: 0, y: 0, floor: below ? below.point.y : f.at.y - FALL_OUT, after: it.clips.defeat || 1.5 };
      if (it.glider) {
        group.attach(it.glider.root);
        var fw = v3b.set(Math.sin(f.face), 0, Math.cos(f.face));
        defeat.glider = { v: fw.multiplyScalar(GLIDER_OFF.speed).add(v3.set(0, GLIDER_OFF.up, 0)).clone(), age: 0 };
        it.glider.play('glider_spin', { restart: true, cut: true, fade: .05 });
      }
    }
    function falling(it, dt) {
      var q = defeat.fall;
      q.t += dt;
      if (q.t > q.after) { q.v += FALL_G * dt; q.y -= q.v * dt; }
      it.rig.root.position.y = q.y;
      // Gone once he reaches whatever he falls onto (the clip ends him 2 m
      // below where he stood), or far enough below to be out of the fight.
      if (it.craft.position.y + q.y - 2 < q.floor || q.y < -FALL_OUT) it.craft.visible = false;
    }

    function flash(it, now) {
      var k = Math.max(0, 1 - (now - flashAt) / FLASH_MS);
      it.mats.forEach(function (x) {
        x.m.color.copy(x.color).multiplyScalar(1 + k * 1.2);
        if (x.glow && x.m.emissive) x.m.emissive.setRGB(k * .55, k * .2, k * .2);
      });
    }

    // Where a web should stick on the model as it is drawn now, and to which
    // bone, for a shot that met body capsule `i` `t` of the way along it: on
    // the surface facing the shooter.
    function stickBody(f, i, t, from) {
      var it = active, c = f && f.body && f.body.capsules[i];
      if (!it || !c) return null;
      var p = { x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t, z: c.a.z + (c.b.z - c.a.z) * t };
      var ax = unit(c.b.x - c.a.x, c.b.y - c.a.y, c.b.z - c.a.z), to = { x: from.x - p.x, y: from.y - p.y, z: from.z - p.z };
      var k = to.x * ax.x + to.y * ax.y + to.z * ax.z, n = unit(to.x - ax.x * k, to.y - ax.y * k, to.z - ax.z * k);
      return { point: { x: p.x + n.x * c.r, y: p.y + n.y * c.r, z: p.z + n.z * c.r }, normal: n,
        parent: it.rig.bone(c.bones[t < .5 ? 0 : 1]), size: Math.max(.35, c.r * 2.4) };
    }
    function unit(x, y, z) { var l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; }

    return {
      preload: preload, ready: ready, state: state, update: update,
      flash: function (now) { flashAt = now; },
      stickBody: stickBody,
      shown: function () { return !!(active && active.craft.visible); },
      clear: function () { reset(null); },
      get items() { return items; }
    };
  }

  root.WorldVillains = { create: create };
})(window);

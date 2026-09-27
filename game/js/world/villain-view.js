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
  //
  // The look (Session C4): each villain's materials are its own copies,
  // patched with a rim light - a fresnel edge in his own colour, strongest
  // on the upward faces, so a dark figure separates from a busy street or
  // a bright sky - and the defeat dissolve (hitfx.js), which eats him away
  // along a noise pattern with a glowing web-white edge. They reflect the
  // city as seen from the fight (setEnvironment), and cast into the
  // following shadow except on LOW (setCast).

  var T = root.THREE;
  var IDS = ['goblin', 'rhino', 'venom'];
  var CURVE_N = 16;
  var FLASH_MS = 180, BOB = .06;
  var GLIDER_OFF = { speed: 9, up: 2.5, drag: .4, life: 4 };   // the glider leaving after his defeat
  var FALL_G = 9.8, FALL_OUT = 40;                           // the goblin falling after it
  // Rim light per villain: colour (linear, added as light), strength and
  // how tight to the silhouette (a higher power is a thinner rim).
  var RIM = {
    goblin: { color: '#ffe0b0', strength: .45, power: 3 },
    rhino: { color: '#bcd6ee', strength: .7, power: 2.6 },
    venom: { color: '#aab8ff', strength: .75, power: 2.5 },
    // The player's body in third person (player-view.js) gets the same look.
    spiderman: { color: '#d8e4ff', strength: .22, power: 3.5 }
  };
  var EDGE = [3.5, 4.2, 5];      // the dissolve's glowing edge (linear; it blooms)
  var NOISE = 3.2;               // dissolve pattern: cells per metre
  var ENV_INTENSITY = 1.1;       // how strongly they reflect the city

  var SHADER_HEAD = [
    'uniform vec3 uRim; uniform float uRimPow, uDissolve, uNoise; uniform vec3 uEdge;',
    'varying vec3 vDisPos;',
    'float disHash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
    'float disNoise(vec3 x) {',
    '  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);',
    '  return mix(mix(mix(disHash(i), disHash(i + vec3(1, 0, 0)), f.x), mix(disHash(i + vec3(0, 1, 0)), disHash(i + vec3(1, 1, 0)), f.x), f.y),',
    '    mix(mix(disHash(i + vec3(0, 0, 1)), disHash(i + vec3(1, 0, 1)), f.x), mix(disHash(i + vec3(0, 1, 1)), disHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);',
    '}',
    ''
  ].join('\n');
  // Patch a (cloned) standard material with the rim and the dissolve; u is
  // the villain's shared uniforms.
  function patch(m, u) {
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uRim = u.rim; sh.uniforms.uRimPow = u.rimPow; sh.uniforms.uDissolve = u.dissolve;
      sh.uniforms.uNoise = u.noise; sh.uniforms.uEdge = u.edge; sh.uniforms.uOrigin = u.origin;
      sh.vertexShader = 'uniform vec3 uOrigin;\nvarying vec3 vDisPos;\n' + sh.vertexShader.replace('#include <skinning_vertex>',
        '#include <skinning_vertex>\n  vDisPos = (modelMatrix * vec4(transformed, 1.)).xyz - uOrigin;');
      sh.fragmentShader = SHADER_HEAD + sh.fragmentShader
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' +
          '  float disN = disNoise(vDisPos * uNoise) * .65 + disNoise(vDisPos * uNoise * 2.7) * .35;\n' +
          '  if (uDissolve > 0. && disN < uDissolve * 1.05) discard;')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' +
          '  float rimF = pow(1. - clamp(dot(normal, normalize(vViewPosition)), 0., 1.), uRimPow);\n' +
          '  totalEmissiveRadiance += uRim * rimF * (.35 + .65 * clamp(normal.y * .5 + .5, 0., 1.));\n' +
          '  if (uDissolve > 0.) totalEmissiveRadiance += uEdge * smoothstep(uDissolve * 1.05 + .08, uDissolve * 1.05, disN);');
    };
    m.customProgramCacheKey = function () { return 'villain-look'; };
    m.needsUpdate = true;
  }
  function uniforms(id) {
    var r = RIM[id] || RIM.goblin, c = new T.Color(r.color).multiplyScalar(r.strength);
    return { rim: { value: c }, rimPow: { value: r.power }, dissolve: { value: 0 }, noise: { value: NOISE },
      edge: { value: new T.Vector3().fromArray(EDGE) }, origin: { value: new T.Vector3() } };
  }

  function create(scene, world) {
    var group = new T.Group(); group.name = 'villains'; scene.add(group);
    var items = {}, loading = null, fightRef = null, active = null;
    var flashAt = -1e9, defeat = null, env = null, cast = true, onWrap = null;
    // What the villain was told to play this frame (VillainAnim.step's out),
    // for the sounds he makes (SoundCues).
    var heard = { play: [], speed: null }, NONE = { play: [], speed: null };
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
          // The glider is his: his rim, his reflections, his own materials -
          // but it flies off on its own rather than dissolving with him.
          own(g.model, uniforms('goblin'), it.mats);
          lookOf(it);
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
      // Its own materials, so a hit can flash this one - and the rim and the
      // dissolve patch it - without touching the model viewer's copy.
      var mats = [], u = uniforms(id);
      own(rig.model, u, mats);
      var e = rig.entry, durs = {};
      rig.clipNames.forEach(function (n) { durs[n] = rig.machine.clips[n]; });
      var it = { id: id, rig: rig, craft: craft, mats: mats, u: u, clips: durs, curves: e.shoulders ? curves(rig, e.shoulders) : {},
        air: e.airborne || null, kind: null, glider: null };
      lookOf(it);
      return it;
    }
    function own(model, u, mats) {
      model.traverse(function (o) {
        if (!o.isMesh) return;
        // In a building's shadow he is in shade too, not lit by the sun.
        o.receiveShadow = true;
        o.material = [].concat(o.material).map(function (m) {
          var c = m.clone();
          if (c.isMeshStandardMaterial) patch(c, u);
          mats.push({ m: c, color: c.color.clone(), glow: !c.emissiveMap });
          return c;
        });
        if (o.material.length === 1) o.material = o.material[0];
      });
    }
    // The environment and shadow settings in force, onto one villain.
    function lookOf(it) {
      it.mats.forEach(function (x) {
        if (!x.m.isMeshStandardMaterial) return;
        if (env) { x.m.envMap = env; x.m.envMapIntensity = ENV_INTENSITY; }
      });
      castOf(it, cast);
    }
    function castOf(it, on) {
      it.craft.traverse(function (o) { if (o.isMesh) o.castShadow = on; });
      if (it.glider) it.glider.root.traverse(function (o) { if (o.isMesh) o.castShadow = on; });
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
      IDS.forEach(function (id) { var x = items[id]; if (x) { x.craft.visible = false; x.u.dissolve.value = 0; castOf(x, cast); } });
      if (!f) return;
      var it = items[VILLAINS[f.villain].id];
      if (!it) return;
      it.kind = f.kind; it.anim = VillainAnim.create(f.kind, it.clips, it.rig.entry.events);
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
      heard = NONE;
      if (!f || !it) { if (f) f.body = null; return false; }
      // The rhino drops in as his entrance starts: nothing to see before GO.
      var show = !!f.at && f.phase !== 'thugs' && !(f.kind === 'charge' && f.mode === 'intro');
      it.craft.visible = show;
      if (!show) { f.body = null; return true; }

      var out = heard = VillainAnim.step(it.anim, f, dt);
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
      if (defeat) dissolving(it, f, dt);
      it.u.origin.value.copy(c.position);
      if (it.air) {
        c.updateMatrixWorld(true);
        var low = Infinity;
        it.air.feet.forEach(function (b) { var bone = it.rig.bone(b); if (bone) low = Math.min(low, v3.setFromMatrixPosition(bone.matrixWorld).y - c.position.y); });
        if (low < Infinity) c.position.y += VillainAnim.lift(pose, it.air.clips, low, it.air.ankle);
      }
      flash(it, now);
      c.updateMatrixWorld(true);
      f.body = it.rig.sample();
      f.body.points = attackPoints(it);
      return true;
    }
    // Where his attacks leave from, from the manifest's `attacks` (P4): the
    // bomb from his hand, the guns' rounds from the glider's guns. Plain
    // points, for fight.js.
    function attackPoints(it) {
      var A = it.rig.entry.attacks, out = {};
      if (!A) return out;
      function at(bone) { v3.setFromMatrixPosition(bone.matrixWorld); return { x: v3.x, y: v3.y, z: v3.z }; }
      var hand = A.bomb && A.bomb.bone && it.rig.bone(A.bomb.bone);
      if (hand) out.hand = at(hand);
      var prop = A.guns && (A.guns.prop === 'glider' ? it.glider : null);
      if (prop && prop.root.visible) {
        var guns = A.guns.bones.map(function (n) { return prop.bone(n); }).filter(Boolean).map(at);
        if (guns.length) out.guns = guns;
      }
      return out;
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
      defeat = { at: now, t: 0, wrapped: false, fall: null, glider: null };
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

    // Once his defeat has played a moment he dissolves, as webs wrap him.
    function dissolving(it, f, dt) {
      defeat.t += dt;
      var k = HitFx.dissolve(defeat.t);
      it.u.dissolve.value = k;
      if (k > 0 && !defeat.wrapped) {
        defeat.wrapped = true;
        castOf(it, false);                 // the shadow map would keep the whole of him
        if (onWrap && f.body) onWrap(f.body.capsules);
      }
    }

    function flash(it, now) {
      var k = Math.max(0, 1 - (now - flashAt) / FLASH_MS);
      it.mats.forEach(function (x) {
        // A light lift over the whole of him; the impact flash (fx.js) at the
        // point the shot met him is what says where it landed.
        x.m.color.copy(x.color).multiplyScalar(1 + k * .5);
        if (x.glow && x.m.emissive) x.m.emissive.setScalar(k * .06);
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

    // The city's reflection for the villains (World3D.environment), replacing
    // the one before; and whether they cast into the shadow map.
    function setEnvironment(tex) {
      var old = env;
      env = tex;
      IDS.forEach(function (id) { if (items[id]) lookOf(items[id]); });
      if (old && old !== tex) old.dispose();
    }
    function setCast(on) {
      cast = !!on;
      IDS.forEach(function (id) { if (items[id] && !(defeat && defeat.wrapped && active === items[id])) castOf(items[id], cast); });
    }

    return {
      preload: preload, ready: ready, state: state, update: update, setEnvironment: setEnvironment, setCast: setCast,
      set onWrap(fn) { onWrap = fn; }, get group() { return group; },
      flash: function (now) { flashAt = now; },
      heard: function () { return heard; },
      stickBody: stickBody,
      shown: function () { return !!(active && active.craft.visible); },
      clear: function () { reset(null); },
      get items() { return items; }
    };
  }

  // patch/uniforms are the look, for the player's body too (player-view.js).
  root.WorldVillains = { create: create, patch: patch, uniforms: uniforms, ENV_INTENSITY: ENV_INTENSITY };
})(window);

(function (root) {
  'use strict';
  // The villains' attacks, drawn (docs/PLAYER_PLAN.md, P4). fight.js and
  // attacks.js say where everything is; this only shows it, each frame:
  //
  //  - pumpkin bombs in flight: the Goblin's bomb model (bomb.glb), tumbling,
  //    its light blinking faster as the fuse runs down, with an orange glow
  //    round it so you can find it against the sky - and shoot it down;
  //  - the glider guns' wind-up: a red laser from each gun (the manifest's
  //    gun bones, which villain-view.js samples) to the point it is locked
  //    on, flickering faster as it's about to fire, with a red dot there;
  //  - the rounds: bright tracer streaks down the line.
  //
  // And the Rhino's and Venom's (P5):
  //  - a red ring where an attack will land - on the roof the Rhino is about
  //    to ram (the quake's reach), under where Venom will come down - pulsing
  //    faster as it comes;
  //  - Venom's tentacle: a black, glistening lash from his hand out along
  //    its line, and back.
  //
  // The blasts, muzzle flashes, dust and sounds are fx.js's and
  // attack-audio.js's, started by world-game.js from the fight's events.

  var T = root.THREE;
  var POOL = 4;                    // bombs in flight at once, at most
  var SPIN = 7;                    // radians a second a bomb tumbles
  // Colours here are painted over the picture (normal blending), not added
  // to it: added to a bright sky, red and orange both come out white.
  var GLOW = { size: 1.3, color: [1.6, .62, .12], opacity: .8 };
  // The laser: a thin red beam tapering from the gun (FAR, metres of radius)
  // to NEAR where it stops, SHORT metres before the point it's locked on
  // (so it never runs past the camera), and a red dot there.
  var LASER = { far: .022, near: .003, short: 1.2, color: [1.5, .06, .04], opacity: .85, dot: .2 };
  var TRACER = { length: 4, color: [7, 4.2, 1.6], max: 16 };
  // The ring: its line's width (share of the radius), colour and opacity.
  var RING = { width: .06, color: [1.4, .08, .05], opacity: .75, fill: .12 };
  // The tentacle: metres of radius at his hand and at its tip, its colour,
  // and a faint blue-violet sheen so the black reads against dark steel.
  var LASH = { base: .15, tip: .05, color: [.02, .02, .03], sheen: [.05, .045, .12] };

  function glowTex() {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  function create(scene) {
    var group = new T.Group(); group.name = 'attacks'; scene.add(group);
    var tex = glowTex(), bombs = [], ready = false;
    var v1 = new T.Vector3(), v2 = new T.Vector3(), UP = new T.Vector3(0, 1, 0);

    // --- bombs ---
    WorldModels.load('bomb').then(function (t) {
      for (var i = 0; i < POOL; i++) {
        var m = t.scene.clone(true), lights = [];
        m.traverse(function (o) {
          if (!o.isMesh) return;
          o.castShadow = false;
          o.material = [].concat(o.material).map(function (x) {
            var c = x.clone();
            if (/light/i.test(c.name) && c.emissive) lights.push(c);
            return c;
          });
          if (o.material.length === 1) o.material = o.material[0];
        });
        var glow = new T.Sprite(new T.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false, opacity: GLOW.opacity }));
        glow.material.color.setRGB(GLOW.color[0], GLOW.color[1], GLOW.color[2]);
        var holder = new T.Group(); holder.add(m); holder.add(glow); holder.visible = false; group.add(holder);
        bombs.push({ holder: holder, model: m, glow: glow, lights: lights, spin: new T.Vector3(Math.random(), Math.random(), Math.random()).normalize() });
      }
      ready = true;
    }, function () {});

    // --- the lasers ---
    function beam() {
      // Radius 1 at the gun (y 0), NEAR/FAR of that at the other end (y 1).
      var g = new T.CylinderGeometry(LASER.near / LASER.far, 1, 1, 6, 1, true); g.translate(0, .5, 0);
      var m = new T.Mesh(g, new T.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false }));
      m.material.color.setRGB(LASER.color[0], LASER.color[1], LASER.color[2]);
      m.frustumCulled = false; m.visible = false; m.renderOrder = 5; group.add(m);
      return m;
    }
    var beams = [beam(), beam()];
    var dot = new T.Sprite(new T.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
    dot.material.color.setRGB(LASER.color[0] * 1.3, LASER.color[1] * 3, LASER.color[2] * 3); dot.visible = false; group.add(dot);
    // A beam from a to b (world), `w` thick.
    function stretch(m, a, b, w) {
      v1.set(b.x - a.x, b.y - a.y, b.z - a.z);
      var l = v1.length();
      m.position.set(a.x, a.y, a.z);
      m.quaternion.setFromUnitVectors(UP, v1.normalize());
      m.scale.set(w, l, w);
    }

    // --- tracers ---
    var tg = new T.BufferGeometry(), tPos = new Float32Array(TRACER.max * 6), tCol = new Float32Array(TRACER.max * 6);
    tg.setAttribute('position', new T.BufferAttribute(tPos, 3).setUsage(T.DynamicDrawUsage));
    tg.setAttribute('color', new T.BufferAttribute(tCol, 3).setUsage(T.DynamicDrawUsage));
    var tracers = new T.LineSegments(tg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    tracers.frustumCulled = false; tracers.visible = false; tracers.renderOrder = 6; group.add(tracers);

    // --- the ring where an attack will land ---
    var ringGeo = new T.RingGeometry(1 - RING.width, 1, 64, 1); ringGeo.rotateX(-Math.PI / 2);
    var fillGeo = new T.CircleGeometry(1 - RING.width, 48); fillGeo.rotateX(-Math.PI / 2);
    // Drawn only inside `clip` (x0, z0, x1, z1: the roof it's on), so a
    // ram's ring stops at the building's edge rather than hanging in the air.
    function flat(geo, op) {
      var mat = new T.ShaderMaterial({
        uniforms: { color: { value: new T.Color(RING.color[0], RING.color[1], RING.color[2]) }, opacity: { value: op },
          clip: { value: new T.Vector4(-1e9, -1e9, 1e9, 1e9) } },
        vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: ['uniform vec3 color; uniform float opacity; uniform vec4 clip; varying vec3 vW;',
          'void main() {',
          '  if (vW.x < clip.x || vW.z < clip.y || vW.x > clip.z || vW.z > clip.w) discard;',
          '  gl_FragColor = vec4(color, opacity);',
          '  #include <tonemapping_fragment>',
          '  #include <colorspace_fragment>',
          '}'].join('\n'),
        transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      });
      var m = new T.Mesh(geo, mat);
      m.renderOrder = 4; m.visible = false; m.frustumCulled = false; group.add(m);
      return m;
    }
    var ring = flat(ringGeo, RING.opacity), fill = flat(fillGeo, RING.fill);

    // --- venom's tentacle ---
    var lashGeo = new T.CylinderGeometry(LASH.tip / LASH.base, 1, 1, 7, 1, true); lashGeo.translate(0, .5, 0);
    var lash = new T.Mesh(lashGeo, new T.MeshStandardMaterial({ roughness: .25, metalness: .1 }));
    lash.material.color.setRGB(LASH.color[0], LASH.color[1], LASH.color[2]);
    lash.material.emissive.setRGB(LASH.sheen[0], LASH.sheen[1], LASH.sheen[2]);
    lash.frustumCulled = false; lash.visible = false; lash.castShadow = false; group.add(lash);

    // Each frame. f: the fight (or null); t: the fight's time; now: ms.
    function update(f, now) {
      var live = f && (f.mode === 'playing' || f.mode === 'paused') ? f : null, i;
      // Bombs.
      var list = live ? live.bombs : [];
      for (i = 0; i < bombs.length; i++) {
        var b = bombs[i], q = list[i];
        b.holder.visible = ready && !!q;
        if (!b.holder.visible) continue;
        b.holder.position.set(q.x, q.y, q.z);
        b.model.quaternion.setFromAxisAngle(b.spin, q.t * SPIN);
        // The fuse: a blink that quickens as it runs down.
        var left = Math.max(0, Attacks.constants.FUSE - q.t), rate = 3 + 14 * (1 - left / Attacks.constants.FUSE);
        var on = Math.sin(q.t * rate * Math.PI * 2) > 0 ? 1 : .25;
        b.lights.forEach(function (m) { m.emissive.setRGB(3 * on, 1.2 * on, .2 * on); });
        b.glow.scale.setScalar(GLOW.size * (.8 + .4 * on));
      }
      // The lasers, while he winds up the guns.
      var a = live && live.attack, lasing = !!(a && a.phase === 'telegraph' && a.move === 'guns' && a.aim && live.at);
      beams.forEach(function (m) { m.visible = false; });
      dot.visible = lasing;
      if (lasing) {
        var guns = (live.body && live.body.points && live.body.points.guns) || [{ x: live.at.x, y: live.at.y + .1, z: live.at.z }];
        var k = Math.min(1, a.t / a.d.telegraph), flick = .55 + .45 * Math.abs(Math.sin(now / 1000 * (8 + 30 * k) * Math.PI));
        guns.slice(0, 2).forEach(function (g, n) {
          var d = v2.set(a.aim.x - g.x, a.aim.y - g.y, a.aim.z - g.z), l = d.length() || 1, e = Math.max(.5, l - LASER.short);
          var end = { x: g.x + d.x / l * e, y: g.y + d.y / l * e, z: g.z + d.z / l * e };
          stretch(beams[n], g, end, LASER.far * (1 + .6 * k));
          beams[n].material.opacity = LASER.opacity * flick; beams[n].visible = true;
        });
        dot.position.set(a.aim.x, a.aim.y, a.aim.z); dot.scale.setScalar(LASER.dot * (1 + k)); dot.material.opacity = flick;
      }
      // The rounds in flight.
      var n = 0, R = live ? live.rounds : [];
      for (i = 0; i < R.length && n < TRACER.max; i++) {
        var r = R[i];
        if (!r.fired || r.s <= 0) continue;
        var s0 = Math.max(0, r.s - TRACER.length), o = n * 6;
        tPos[o] = r.from.x + r.dir.x * r.s; tPos[o + 1] = r.from.y + r.dir.y * r.s; tPos[o + 2] = r.from.z + r.dir.z * r.s;
        tPos[o + 3] = r.from.x + r.dir.x * s0; tPos[o + 4] = r.from.y + r.dir.y * s0; tPos[o + 5] = r.from.z + r.dir.z * s0;
        tCol[o] = TRACER.color[0]; tCol[o + 1] = TRACER.color[1]; tCol[o + 2] = TRACER.color[2];
        tCol[o + 3] = TRACER.color[0] * .1; tCol[o + 4] = TRACER.color[1] * .1; tCol[o + 5] = TRACER.color[2] * .1;
        n++;
      }
      tracers.visible = n > 0;
      if (n) { tg.setDrawRange(0, n * 2); tg.attributes.position.needsUpdate = true; tg.attributes.color.needsUpdate = true; }

      // The ring, through the wind-up (and a pounce's flight), pulsing
      // faster as the attack comes.
      var z = a && a.zone && (a.phase === 'telegraph' || a.phase === 'active') ? a.zone : null;
      ring.visible = fill.visible = !!z;
      if (z) {
        var u = a.phase === 'telegraph' ? Math.min(1, a.t / a.d.telegraph) : 1, pulse = .6 + .4 * Math.abs(Math.sin(now / 1000 * (3 + 9 * u) * Math.PI));
        ring.position.set(z.x, z.y + .06, z.z); fill.position.copy(ring.position);
        ring.scale.setScalar(z.r); fill.scale.setScalar(Math.max(.01, z.r * (a.phase === 'telegraph' ? u : 1)));
        ring.material.uniforms.opacity.value = RING.opacity * pulse; fill.material.uniforms.opacity.value = RING.fill * (.5 + .5 * u);
        var c = z.clip;
        [ring, fill].forEach(function (m) { if (c) m.material.uniforms.clip.value.set(c.x0, c.z0, c.x1, c.z1); else m.material.uniforms.clip.value.set(-1e9, -1e9, 1e9, 1e9); });
      }
      // The tentacle, out and back.
      var L = a && a.lash;
      lash.visible = !!(L && L.s > .05);
      if (lash.visible) {
        var tip = { x: L.from.x + L.dir.x * L.s, y: L.from.y + L.dir.y * L.s, z: L.from.z + L.dir.z * L.s };
        stretch(lash, L.from, tip, LASH.base);
      }
    }

    return { group: group, update: update, get ready() { return ready; } };
  }

  root.WorldAttacks = { create: create };
})(window);

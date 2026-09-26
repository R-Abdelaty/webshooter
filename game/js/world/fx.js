(function (root) {
  'use strict';
  // Draws what hitfx.js describes: the particles a web throws off where it
  // lands (web strands, the Rhino's sparks, Venom's symbiote), the impact
  // flash where a shot met a villain, and - on LOW, where villains cast no
  // real shadow - a soft blob shadow under the villain's feet.
  //
  // Three pools, drawn only while something is in them: soft round points
  // for web and symbiote, line streaks for sparks, and a few flash sprites.
  // The sparks and flashes are brighter than white (linear, above the bloom
  // threshold in world.js), so on MED and HIGH they glow.

  var T = root.THREE;
  var MAX_POINTS = 600, MAX_SPARKS = 200, MAX_FLASH = 4;
  var FLASH_MS = 160, FLASH_GAIN = 2;          // how long a flash lasts; how far over white it is
  var SPARK_COLOR = [6, 3.2, 1.1], WEB_COLOR = [1.35, 1.35, 1.3], SYMBIOTE_COLOR = [.018, .018, .024];
  var BLOB = { SIZE: 1.9, FADE_H: 3.5, OPACITY: .55 };  // metres across per metre of villain; fades out by this height

  function canvasTex(size, draw) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function radial(stops) {
    return canvasTex(64, function (g, s) {
      var gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      stops.forEach(function (st) { gr.addColorStop(st[0], st[1]); });
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
  }

  // Round, soft points with a size in metres (so they shrink with distance),
  // a colour each and an alpha each. A glint on the symbiote so black blobs
  // still read as wet.
  function pointsMaterial() {
    return new T.ShaderMaterial({
      uniforms: { scale: { value: 800 } },
      vertexShader: [
        'attribute float size; attribute vec4 tint;',
        'uniform float scale;',
        'varying vec4 vTint;',
        'void main() {',
        '  vTint = tint;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.);',
        '  gl_PointSize = max(1.5, size * scale / -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec4 vTint;',
        'void main() {',
        '  vec2 d = gl_PointCoord - .5;',
        '  float r = length(d) * 2.;',
        '  if (r > 1.) discard;',
        '  float a = vTint.a * smoothstep(1., .55, r);',
        '  vec3 c = vTint.rgb;',
        // A dark particle (the symbiote) gets a small highlight up and left.
        '  float dark = step(dot(c, vec3(1.)), .2);',
        '  c += dark * vec3(.35) * smoothstep(.35, 0., length(d - vec2(-.15, -.15)));',
        '  gl_FragColor = vec4(c, a);',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false
    });
  }

  function create(scene) {
    var group = new T.Group(); group.name = 'fx'; scene.add(group);
    var list = [], scale = 1;

    // Web and symbiote.
    var pg = new T.BufferGeometry();
    var pPos = new Float32Array(MAX_POINTS * 3), pSize = new Float32Array(MAX_POINTS), pTint = new Float32Array(MAX_POINTS * 4);
    pg.setAttribute('position', new T.BufferAttribute(pPos, 3).setUsage(T.DynamicDrawUsage));
    pg.setAttribute('size', new T.BufferAttribute(pSize, 1).setUsage(T.DynamicDrawUsage));
    pg.setAttribute('tint', new T.BufferAttribute(pTint, 4).setUsage(T.DynamicDrawUsage));
    var pmat = pointsMaterial(), points = new T.Points(pg, pmat);
    points.frustumCulled = false; points.renderOrder = 6; points.visible = false; group.add(points);

    // Sparks: a streak each, from where it is back along its motion.
    var sg = new T.BufferGeometry(), sPos = new Float32Array(MAX_SPARKS * 6), sCol = new Float32Array(MAX_SPARKS * 6);
    sg.setAttribute('position', new T.BufferAttribute(sPos, 3).setUsage(T.DynamicDrawUsage));
    sg.setAttribute('color', new T.BufferAttribute(sCol, 3).setUsage(T.DynamicDrawUsage));
    var sparks = new T.LineSegments(sg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    sparks.frustumCulled = false; sparks.renderOrder = 6; sparks.visible = false; group.add(sparks);

    // Impact flashes.
    var flashTex = radial([[0, 'rgba(255,255,255,1)'], [.25, 'rgba(255,255,255,.85)'], [.6, 'rgba(255,255,255,.18)'], [1, 'rgba(255,255,255,0)']]);
    var flashes = [];
    for (var i = 0; i < MAX_FLASH; i++) {
      var sp = new T.Sprite(new T.SpriteMaterial({ map: flashTex, blending: T.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false }));
      sp.visible = false; sp.renderOrder = 7; group.add(sp);
      flashes.push({ sprite: sp, born: -1e9, size: 1, color: [1, 1, 1] });
    }
    var nextFlash = 0;

    // The blob shadow.
    var blobTex = radial([[0, 'rgba(0,0,0,1)'], [.45, 'rgba(0,0,0,.7)'], [1, 'rgba(0,0,0,0)']]);
    var blobGeo = new T.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
    var blob = new T.Mesh(blobGeo, new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true }));
    blob.renderOrder = 1; blob.visible = false; group.add(blob);

    // --- adding ---
    function add(ps) { list = list.concat(ps); if (list.length > MAX_POINTS + MAX_SPARKS) list = list.slice(-(MAX_POINTS + MAX_SPARKS)); }
    // A web landing on the city.
    function web(point, normal) { add(HitFx.burst('web', point, normal, { scale: scale })); }
    // A hit on a villain: his particles and a flash, at the point on him the
    // shot met.
    function hit(id, point, normal, now) {
      add(HitFx.hit(id, point, normal, { scale: scale }));
      var st = HitFx.style(id), f = flashes[nextFlash++ % MAX_FLASH];
      f.born = now; f.size = st.size; f.color = st.flash;
      f.sprite.position.set(point.x + normal.x * .05, point.y + normal.y * .05, point.z + normal.z * .05);
    }
    // The web wrapping a beaten villain: from each of his body capsules.
    function wrap(capsules, from) {
      (capsules || []).forEach(function (c, k) {
        if (k % 2) return;
        var m = { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2, z: (c.a.z + c.b.z) / 2 };
        var n = { x: from.x - m.x, y: 1, z: from.z - m.z };
        add(HitFx.burst('wrap', m, n, { scale: scale * .35 }));
      });
    }

    // --- per frame ---
    // dt: seconds the particles move on (0 during the hit-stop); now: ms;
    // camera: to size the points; heightPx: the canvas height in pixels.
    function update(dt, now, camera, heightPx) {
      list = HitFx.step(list, dt);
      var np = 0, ns = 0;
      for (var i = 0; i < list.length; i++) {
        var p = list[i], a = HitFx.alpha(p), c;
        if (p.kind === 'sparks') {
          if (ns >= MAX_SPARKS) continue;
          var k = HitFx.KINDS.sparks.streak, o = ns * 6;
          sPos[o] = p.x; sPos[o + 1] = p.y; sPos[o + 2] = p.z;
          sPos[o + 3] = p.x - p.vx * k; sPos[o + 4] = p.y - p.vy * k; sPos[o + 5] = p.z - p.vz * k;
          for (var j = 0; j < 2; j++) { var b = a * (j ? .15 : 1) * p.shade; sCol[o + j * 3] = SPARK_COLOR[0] * b; sCol[o + j * 3 + 1] = SPARK_COLOR[1] * b; sCol[o + j * 3 + 2] = SPARK_COLOR[2] * b; }
          ns++;
        } else {
          if (np >= MAX_POINTS) continue;
          c = p.kind === 'symbiote' ? SYMBIOTE_COLOR : WEB_COLOR;
          pPos[np * 3] = p.x; pPos[np * 3 + 1] = p.y; pPos[np * 3 + 2] = p.z;
          pSize[np] = p.size;
          pTint[np * 4] = c[0] * p.shade; pTint[np * 4 + 1] = c[1] * p.shade; pTint[np * 4 + 2] = c[2] * p.shade; pTint[np * 4 + 3] = a;
          np++;
        }
      }
      points.visible = np > 0; sparks.visible = ns > 0;
      if (np) {
        pg.setDrawRange(0, np);
        ['position', 'size', 'tint'].forEach(function (n) { pg.attributes[n].needsUpdate = true; });
        pmat.uniforms.scale.value = heightPx / (2 * Math.tan(camera.fov * Math.PI / 360));
      }
      if (ns) { sg.setDrawRange(0, ns * 2); sg.attributes.position.needsUpdate = true; sg.attributes.color.needsUpdate = true; }

      flashes.forEach(function (f) {
        var u = (now - f.born) / FLASH_MS;
        f.sprite.visible = u >= 0 && u < 1;
        if (!f.sprite.visible) return;
        var e = 1 - u;
        f.sprite.scale.setScalar(f.size * (.45 + .75 * Math.sqrt(u)));
        f.sprite.material.color.setRGB(f.color[0] * FLASH_GAIN * e * e, f.color[1] * FLASH_GAIN * e * e, f.color[2] * FLASH_GAIN * e * e);
      });
    }

    // The blob under the villain (LOW only): at the floor y under his feet at
    // (x, z), `h` metres tall, fading as he rises off it. Null hides it.
    function setBlob(at, floor, h) {
      if (!at || floor === null || floor === undefined) { blob.visible = false; return; }
      var up = Math.max(0, at.y - floor), k = Math.max(0, 1 - up / BLOB.FADE_H);
      blob.visible = k > .02;
      if (!blob.visible) return;
      blob.position.set(at.x, floor + .02, at.z);
      blob.scale.setScalar(BLOB.SIZE * h * .5 * (1 + up * .15));
      blob.material.opacity = BLOB.OPACITY * k;
    }

    function clear() { list = []; points.visible = sparks.visible = blob.visible = false; flashes.forEach(function (f) { f.born = -1e9; f.sprite.visible = false; }); }

    return { group: group, web: web, hit: hit, wrap: wrap, update: update, setBlob: setBlob, clear: clear,
      setScale: function (s) { scale = s; }, count: function () { return list.length; } };
  }

  root.WorldFx = { create: create, FLASH_MS: FLASH_MS, BLOB: BLOB };
})(window);

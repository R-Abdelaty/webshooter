(function (root) {
  'use strict';
  // The scene around the city: renderer, camera, a gradient sky with a sun,
  // cumulus sprites, the haze (fog) that swallows the far city, and the one
  // shadow-casting light, whose small shadow box follows the player - or, in
  // a fight, sits on the villain's stretch of the city (Gfx.shadowBox).
  //
  // The colour grade - towards the first clip's warm sun and cool shadows -
  // is part of the tone mapping itself (three's CustomToneMapping: ACES, then
  // the grade), so every material gets it with no extra pass. The picture is
  // rendered straight to the canvas with its own MSAA; there is no post
  // chain. (Session C4 had one, on a HIGH setting - SSAO, bloom, SMAA - and
  // the user removed it as too slow: on this laptop's integrated GPU it ran
  // at 20 fps. It is in git at b2c83db.)

  var T = root.THREE;

  // Toward the sun: afternoon light from the south-west, so facing north-east
  // from the spawn roof you look across sunlit faces.
  var SUN_DIR = new T.Vector3(-.58, .62, .52).normalize();
  var ZENITH = new T.Color('#3f7fcf'), HORIZON = new T.Color('#c9dbe9'), HAZE = new T.Color('#b9cad8');
  var SHADOW_HALF = 90, SHADOW_SIZE = 2048;
  // The layer drawn over the picture by renderOver: the first-person arms.
  var OVER = 1;
  // The grade, in display terms after ACES: shadows lean cool and highlights
  // warm, a touch less saturation than the raw textures, a little contrast.
  var GRADE = { shadow: [.92, .98, 1.08], high: [1.06, 1, .9], saturation: .88, contrast: 1.07 };

  // GLSL for ACES (three's fit, from tonemapping_pars_fragment) followed by
  // the grade, as a function `name`(linear colour) -> linear colour, reading
  // the exposure from `exposure`. Its own copy of ACES, as the chunk's
  // function is replaced by it.
  function glf(n) { return Number.isInteger(n) ? n + '.' : String(n); }
  function glv(a) { return 'vec3(' + a.map(glf).join(', ') + ')'; }
  function gradeGLSL(name, exposure) {
    return [
      'vec3 ' + name + 'Fit(vec3 v) { vec3 a = v * (v + .0245786) - .000090537; vec3 b = v * (.983729 * v + .4329510) + .238081; return a / b; }',
      'vec3 ' + name + '(vec3 c) {',
      '  const mat3 inM = mat3(vec3(.59719, .07600, .02840), vec3(.35458, .90834, .13383), vec3(.04823, .01566, .83777));',
      '  const mat3 outM = mat3(vec3(1.60475, -.10208, -.00327), vec3(-.53108, 1.10813, -.07276), vec3(-.07367, -.00605, 1.07602));',
      '  c = clamp(outM * ' + name + 'Fit(inM * (c * ' + exposure + ' / .6)), 0., 1.);',
      '  vec3 g = pow(c, vec3(1. / 2.2));',
      '  float l = dot(g, vec3(.2126, .7152, .0722));',
      '  g *= mix(' + glv(GRADE.shadow) + ', ' + glv(GRADE.high) + ', smoothstep(.08, .8, l));',
      '  g = mix(vec3(l), g, ' + glf(GRADE.saturation) + ');',
      '  g = (g - .5) * ' + glf(GRADE.contrast) + ' + .5;',
      '  return pow(clamp(g, 0., 1.), vec3(2.2));',
      '}'
    ].join('\n');
  }
  // Every material's tone mapping, when the renderer's is CustomToneMapping.
  var CUSTOM = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  var graded = T.ShaderChunk.tonemapping_pars_fragment.indexOf(CUSTOM) >= 0;
  if (graded) T.ShaderChunk.tonemapping_pars_fragment = T.ShaderChunk.tonemapping_pars_fragment.replace(CUSTOM,
    gradeGLSL('gradeTone', 'toneMappingExposure') + '\nvec3 CustomToneMapping( vec3 color ) { return gradeTone( color ); }');
  else console.warn('Web Shooter: this three.js has no CustomToneMapping hook; plain ACES, no colour grade');

  function sky() {
    var mat = new T.ShaderMaterial({
      uniforms: { zenith: { value: ZENITH }, horizon: { value: HORIZON }, haze: { value: HAZE },
        sunDir: { value: SUN_DIR }, sunColor: { value: new T.Color('#fff4e0') } },
      vertexShader: [
        'varying vec3 vDir;',
        'void main() {',
        '  vDir = (modelMatrix * vec4(position, 1.)).xyz - cameraPosition;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);',
        '  gl_Position.z = gl_Position.w;',     // pinned to the far plane
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 zenith, horizon, haze, sunDir, sunColor;',
        'varying vec3 vDir;',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  float h = d.y;',
        '  vec3 col = mix(horizon, zenith, pow(clamp(h, 0., 1.), .5));',
        '  col = mix(col, haze, smoothstep(.02, -.06, h));',
        '  float s = max(dot(d, sunDir), 0.);',
        '  col += sunColor * (pow(s, 1200.) * 8. + pow(s, 60.) * .35 + pow(s, 6.) * .12);',
        '  gl_FragColor = vec4(col, 1.);',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '}'
      ].join('\n'),
      side: T.BackSide, depthWrite: false, fog: false
    });
    var mesh = new T.Mesh(new T.SphereGeometry(1000, 32, 16), mat);
    mesh.frustumCulled = false; mesh.renderOrder = -1;
    return mesh;
  }

  // Cumulus sprites in a field round you that each drift on the wind at
  // their own speed, wrapping round the field and fading in and out at its
  // edge (and away from right overhead, where a sprite would look flat).
  // They keep 90% of your movement, so they read as far off.
  var CLOUDS = { N: 34, R0: 520, R1: 2900, H0: 420, H1: 800, WIND: [2, 5.5], DRIFT_Z: 1.2 };
  function clouds(seed) {
    var group = new T.Group(), rnd = City.mulberry32(seed), textures = [0, 1, 2].map(function (k) { return WorldTextures.cloud(seed + k * 7); });
    for (var i = 0; i < CLOUDS.N; i++) {
      var mat = new T.SpriteMaterial({ map: textures[i % 3], fog: false, depthWrite: false, transparent: true, opacity: 0 });
      var s = new T.Sprite(mat), w = 500 + rnd() * 700;
      s.userData = { x: (rnd() * 2 - 1) * CLOUDS.R1, z: (rnd() * 2 - 1) * CLOUDS.R1, y: CLOUDS.H0 + rnd() * (CLOUDS.H1 - CLOUDS.H0),
        w: w, vx: CLOUDS.WIND[0] + rnd() * (CLOUDS.WIND[1] - CLOUDS.WIND[0]), vz: (rnd() - .5) * CLOUDS.DRIFT_Z, op: .75 + rnd() * .25 };
      group.add(s);
    }
    return group;
  }
  function wrap(v, half) { return ((v + half) % (2 * half) + 2 * half) % (2 * half) - half; }
  function smooth(e0, e1, x) { var t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  // scale: less than 1 when the far plane is nearer (LOW), so the clouds
  // come in with it and look the same size.
  function driftClouds(group, cam, time, scale) {
    group.position.set(cam.x * .9, 0, cam.z * .9);
    group.children.forEach(function (s) {
      var u = s.userData, x = wrap(u.x + u.vx * time, CLOUDS.R1), z = wrap(u.z + u.vz * time, CLOUDS.R1), d = Math.hypot(x, z);
      s.position.set(x * scale, u.y * scale, z * scale);
      s.scale.set(u.w * scale, u.w * .5 * scale, 1);
      s.material.opacity = u.op * smooth(CLOUDS.R1, CLOUDS.R1 * .82, d) * smooth(CLOUDS.R0 * .7, CLOUDS.R0, d);
      s.visible = s.material.opacity > .01;
    });
  }

  function create(canvas, city) {
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    var scene = new T.Scene();
    scene.background = HAZE.clone();
    // Exponential haze: clear nearby, about half gone at a kilometre, the edge
    // of the backdrop city fully swallowed.
    scene.fog = new T.FogExp2(HAZE.clone(), .00068);

    var camera = new T.PerspectiveCamera(75, 16 / 9, .1, 3200);
    camera.rotation.order = 'YXZ';

    var skyMesh = sky(); scene.add(skyMesh);
    var cloudGroup = clouds(city.seed); scene.add(cloudGroup);

    var hemi = new T.HemisphereLight(0xcfe0f2, 0x8c7c68, 1.35);
    scene.add(hemi);
    var sun = new T.DirectionalLight(0xfff0da, 2.7);
    // They light layer OVER too: the first-person arms (renderOver).
    hemi.layers.enable(OVER); sun.layers.enable(OVER);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    var sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
    sc.near = 1; sc.far = 1800;
    sun.shadow.bias = -.0004; sun.shadow.normalBias = .04;
    scene.add(sun); scene.add(sun.target);

    var built = CityMesh.build(city, { anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
    scene.add(built.group);

    // The graphics setting in force.
    var tier = Gfx.tier(Gfx.DEFAULT);
    // The draw-call readout counts the shadow pass too (three resets its
    // counts after drawing the shadow map, so they used to leave it out).
    renderer.info.autoReset = false;

    // Snap the shadow box to its own texel grid as it follows you, so shadow
    // edges don't crawl when you walk. focus: the fight's (Encounters.focus),
    // or null to follow the player.
    var lightRot = new T.Matrix4().lookAt(SUN_DIR, new T.Vector3(), new T.Vector3(0, 1, 0));
    var inv = lightRot.clone().invert(), tmp = new T.Vector3(), shadowFocus = null, shadowHalf = SHADOW_HALF;
    function followShadow(p) {
      var box = Gfx.shadowBox(p, shadowFocus);
      if (box.half !== shadowHalf) {
        shadowHalf = box.half;
        sc.left = -shadowHalf; sc.right = shadowHalf; sc.top = shadowHalf; sc.bottom = -shadowHalf; sc.updateProjectionMatrix();
      }
      var texel = shadowHalf * 2 / sun.shadow.mapSize.x;
      tmp.set(box.x, box.y, box.z).applyMatrix4(inv);
      tmp.x = Math.round(tmp.x / texel) * texel; tmp.y = Math.round(tmp.y / texel) * texel;
      tmp.applyMatrix4(lightRot);
      sun.target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(SUN_DIR, 900);
      sun.target.updateMatrixWorld();
    }
    function setShadowFocus(f) { shadowFocus = f || null; }

    var time = 0, cloudScale = 1;
    function update(dt, eye, yaw, pitch) {
      time += dt;
      camera.position.set(eye.x, eye.y, eye.z);
      camera.rotation.set(pitch, yaw, 0);
      skyMesh.position.copy(camera.position);
      driftClouds(cloudGroup, camera.position, time, cloudScale);
      built.water.offset.set(time * .012, time * .007);
      built.waterTime.value = time;
      followShadow(eye);
    }

    function resize() {
      var w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      // Render at most the tier's worth of pixels (1080p on MED); a HiDPI
      // laptop screen would otherwise ask an integrated GPU for twice that.
      var ratio = Gfx.pixelRatio(tier, w, window.devicePixelRatio || 1);
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }

    // A graphics tier (Gfx.tier): the shadow map, the pixel count, and how
    // far you see - the far plane and the haze that hides it, with the
    // clouds brought in to match. Villains' shadows, blobs, particles and
    // the traffic are world-game's.
    function setTier(t) {
      tier = t;
      if (camera.far !== t.far) { camera.far = t.far; camera.updateProjectionMatrix(); }
      scene.fog.density = t.fog;
      cloudScale = Math.min(1, t.far / 3200);
      if (sun.shadow.mapSize.x !== t.shadow) {
        sun.shadow.mapSize.set(t.shadow, t.shadow);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      renderer.toneMapping = t.grade && graded ? T.CustomToneMapping : T.ACESFilmicToneMapping;
      resize();
    }

    function render() {
      renderer.info.reset();
      renderer.render(scene, camera);
    }
    // What is on layer OVER, seen through `cam` (its layers set to OVER), drawn
    // over the picture with a depth buffer of its own - the first-person arms,
    // which so never go into a wall. Same lights, fog, shadow map and grade;
    // no second shadow pass and no second sky.
    function renderOver(cam) {
      var bg = scene.background, clear = renderer.autoClear, shadows = renderer.shadowMap.autoUpdate;
      scene.background = null; renderer.autoClear = false; renderer.shadowMap.autoUpdate = false;
      renderer.clearDepth();
      renderer.render(scene, cam);
      scene.background = bg; renderer.autoClear = clear; renderer.shadowMap.autoUpdate = shadows;
    }

    // The city as seen from `at`, blurred for image-based lighting: what the
    // villains' metal and armour reflect. `hide` is what must not be in it
    // (the villains themselves, webs, effects). Returns a PMREM texture; the
    // caller disposes the one it replaces.
    function environment(at, size, hide) {
      var was = (hide || []).map(function (o) { var v = o.visible; o.visible = false; return v; });
      var rt = new T.WebGLCubeRenderTarget(size || 128, { type: T.HalfFloatType });
      var cube = new T.CubeCamera(.5, 2400, rt);
      cube.position.set(at.x, at.y, at.z); cube.updateMatrixWorld();
      skyMesh.position.copy(cube.position);
      cube.update(renderer, scene);
      skyMesh.position.copy(camera.position);
      (hide || []).forEach(function (o, i) { o.visible = was[i]; });
      var pm = new T.PMREMGenerator(renderer), tex = pm.fromCubemap(rt.texture).texture;
      pm.dispose(); rt.dispose();
      return tex;
    }

    // The field of view is vertical, in degrees (Settings -> FOV).
    function setFov(deg) {
      if (!(deg > 0) || camera.fov === deg) return;
      camera.fov = deg; camera.updateProjectionMatrix();
    }

    // The first surface of the city along a ray: buildings, ground, props,
    // trees, water. The sky and clouds are not in the city group, so a shot
    // into the sky finds nothing. Returns { point, normal, distance }.
    var caster = new T.Raycaster(), rayO = new T.Vector3(), rayD = new T.Vector3(), nm = new T.Matrix3(), im = new T.Matrix4();
    function raycast(origin, dir, far) {
      rayO.set(origin.x, origin.y, origin.z); rayD.set(dir.x, dir.y, dir.z).normalize();
      caster.set(rayO, rayD); caster.near = .05; caster.far = far || 1500;
      var h = caster.intersectObject(built.group, true)[0];
      if (!h) return null;
      var n = h.face ? h.face.normal.clone() : new T.Vector3(0, 1, 0);
      // The face normal is in the geometry's own space: carry it through the
      // instance's matrix, then the object's.
      if (h.instanceId !== undefined && h.object.isInstancedMesh) {
        h.object.getMatrixAt(h.instanceId, im);
        n.applyMatrix3(nm.getNormalMatrix(im));
      }
      n.applyMatrix3(nm.getNormalMatrix(h.object.matrixWorld)).normalize();
      if (n.dot(rayD) > 0) n.negate();          // a face seen from behind: face the shooter
      return { point: h.point.clone(), normal: n, distance: h.distance, object: h.object.name || h.object.type };
    }

    // A world point on the view, as fractions 0..1 from the top left, and
    // whether it is in front of the camera.
    var pv = new T.Vector3();
    function project(p) {
      pv.set(p.x, p.y, p.z).project(camera);
      return { x: (pv.x + 1) / 2, y: (1 - pv.y) / 2, front: pv.z < 1 };
    }

    resize();
    return { renderer: renderer, scene: scene, camera: camera, sun: sun, update: update, resize: resize, render: render, renderOver: renderOver,
      setFov: setFov, raycast: raycast, project: project, info: renderer.info, setTier: setTier, setShadowFocus: setShadowFocus,
      environment: environment, get tier() { return tier; } };
  }

  root.World3D = { create: create, SUN_DIR: SUN_DIR, GRADE: GRADE, graded: graded, OVER: OVER };
})(window);

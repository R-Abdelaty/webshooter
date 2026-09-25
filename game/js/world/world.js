(function (root) {
  'use strict';
  // The scene around the city: renderer, camera, a gradient sky with a sun,
  // cumulus sprites, the haze (fog) that swallows the far city, and the one
  // shadow-casting light, whose small shadow box follows the player.

  var T = root.THREE;

  // Toward the sun: afternoon light from the south-west, so facing north-east
  // from the spawn roof you look across sunlit faces.
  var SUN_DIR = new T.Vector3(-.58, .62, .52).normalize();
  var ZENITH = new T.Color('#3f7fcf'), HORIZON = new T.Color('#c9dbe9'), HAZE = new T.Color('#b9cad8');
  var SHADOW_HALF = 90, SHADOW_SIZE = 2048;

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

  function clouds(seed) {
    var group = new T.Group(), rnd = City.mulberry32(seed), textures = [0, 1, 2].map(function (k) { return WorldTextures.cloud(seed + k * 7); });
    for (var i = 0; i < 26; i++) {
      var mat = new T.SpriteMaterial({ map: textures[i % 3], fog: false, depthWrite: false, transparent: true,
        opacity: .75 + rnd() * .25 });
      var s = new T.Sprite(mat), ang = rnd() * Math.PI * 2, dist = 700 + rnd() * 2200, w = 500 + rnd() * 700;
      s.position.set(Math.cos(ang) * dist, 420 + rnd() * 380, Math.sin(ang) * dist);
      s.scale.set(w, w * .5, 1);
      group.add(s);
    }
    return group;
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

    scene.add(new T.HemisphereLight(0xcfe0f2, 0x8c7c68, 1.35));
    var sun = new T.DirectionalLight(0xfff0da, 2.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    var sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
    sc.near = 1; sc.far = 1800;
    sun.shadow.bias = -.0004; sun.shadow.normalBias = .04;
    scene.add(sun); scene.add(sun.target);

    var built = CityMesh.build(city, { anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
    scene.add(built.group);

    // Snap the shadow box to its own texel grid as it follows you, so shadow
    // edges don't crawl when you walk.
    var texel = SHADOW_HALF * 2 / SHADOW_SIZE, lightRot = new T.Matrix4().lookAt(SUN_DIR, new T.Vector3(), new T.Vector3(0, 1, 0));
    var inv = lightRot.clone().invert(), tmp = new T.Vector3();
    function followShadow(p) {
      tmp.set(p.x, p.y, p.z).applyMatrix4(inv);
      tmp.x = Math.round(tmp.x / texel) * texel; tmp.y = Math.round(tmp.y / texel) * texel;
      tmp.applyMatrix4(lightRot);
      sun.target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(SUN_DIR, 900);
      sun.target.updateMatrixWorld();
    }

    var time = 0;
    function update(dt, eye, yaw, pitch) {
      time += dt;
      camera.position.set(eye.x, eye.y, eye.z);
      camera.rotation.set(pitch, yaw, 0);
      skyMesh.position.copy(camera.position);
      cloudGroup.position.set(camera.position.x * .9 + time * 2.5, 0, camera.position.z * .9);
      built.water.offset.set(time * .012, time * .007);
      followShadow(eye);
    }

    function resize() {
      var w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      // Render at most about 1080p worth of pixels; a HiDPI laptop screen would
      // otherwise ask an integrated GPU for twice that.
      var ratio = Math.min(window.devicePixelRatio || 1, Math.max(1, 1920 / w));
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }

    function render() { renderer.render(scene, camera); }

    resize();
    return { renderer: renderer, scene: scene, camera: camera, sun: sun, update: update, resize: resize, render: render,
      info: renderer.info };
  }

  root.World3D = { create: create, SUN_DIR: SUN_DIR };
})(window);

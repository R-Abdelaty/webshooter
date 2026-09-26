(function (root) {
  'use strict';
  // The city's life, drawn: the cars, yellow cabs and pedestrians near you,
  // from Traffic. Three InstancedMeshes, so three draw calls however many
  // there are (and three more for their shadows on MED).
  //
  // Nothing is uploaded per frame. Where a car or walker is, is a pure
  // function of time (Traffic), so the vertex shader moves each one round
  // its loop from a clock uniform; every second or so the CPU picks the
  // nearest ones again - as many as the graphics setting allows, as far as it
  // reaches - and writes their loops into the instances (Traffic.slot). On
  // this laptop's Intel GPU, rewriting the instances every frame cost 2 ms.
  //
  // Every model is a handful of boxes with colours baked into the vertices.
  // `aPaint` says which part takes which of the instance's colours: the
  // body's paint, or a walker's shirt, trousers and skin. A walker's legs and
  // arms swing from the stride phase (`aLimb` says which limb a vertex is on).

  var T = root.THREE;

  // --- models ---------------------------------------------------------------------
  // A box w x h x d whose bottom sits at y0, centred on (x, z), with a colour
  // and the paint and limb it belongs to.
  function part(w, h, d, x, y0, z, color, paint, limb) {
    var g = new T.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y0 + h / 2, z);
    var n = g.attributes.position.count, c = new Float32Array(n * 3), p = new Float32Array(n), l = new Float32Array(n), i;
    var col = new T.Color().setRGB(color[0], color[1], color[2], T.SRGBColorSpace);
    for (i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; p[i] = paint || 0; l[i] = limb || 0; }
    g.setAttribute('color', new T.BufferAttribute(c, 3));
    g.setAttribute('aPaint', new T.BufferAttribute(p, 1));
    g.setAttribute('aLimb', new T.BufferAttribute(l, 1));
    return g;
  }
  // The parts as one geometry.
  function merge(parts) {
    var out = new T.BufferGeometry(), names = ['position', 'normal', 'color', 'aPaint', 'aLimb'];
    names.forEach(function (k) {
      var size = parts[0].attributes[k].itemSize, total = 0, at = 0;
      parts.forEach(function (g) { total += g.attributes[k].array.length; });
      var arr = new Float32Array(total);
      parts.forEach(function (g) { arr.set(g.attributes[k].array, at); at += g.attributes[k].array.length; });
      out.setAttribute(k, new T.BufferAttribute(arr, size));
    });
    parts.forEach(function (g) { g.dispose(); });
    out.computeBoundingSphere();
    return out;
  }

  var WHITE = [1, 1, 1], GLASS = [.1, .12, .15], TYRE = [.05, .05, .055], HEAD = [1, .98, .9], TAIL = [.62, .04, .04];
  // A car facing -z (yaw 0 faces north, as everything else does).
  function carGeometry(cab) {
    var p = [
      part(1.84, .6, 4.4, 0, .3, 0, WHITE, 1),                // body
      part(1.66, .5, 2.2, 0, .9, .25, GLASS, 0),               // glass house
      part(1.6, .07, 1.9, 0, 1.4, .25, WHITE, 1),              // roof
      part(1.2, .03, 1.4, 0, .9, -1.3, WHITE, 1),              // bonnet crease
      part(.3, .14, .05, .62, .72, -2.21, HEAD, 0), part(.3, .14, .05, -.62, .72, -2.21, HEAD, 0),
      part(.3, .12, .05, .64, .74, 2.21, TAIL, 0), part(.3, .12, .05, -.64, .74, 2.21, TAIL, 0),
      part(1.9, .16, .12, 0, .3, -2.24, [.18, .18, .19], 0), part(1.9, .16, .12, 0, .3, 2.24, [.18, .18, .19], 0)
    ];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) { p.push(part(.26, .66, .66, s[0] * .86, 0, s[1] * 1.38, TYRE, 0)); });
    if (cab) {
      p.push(part(.72, .24, .28, 0, 1.47, .25, [.98, .94, .78], 0));   // the roof light
      p.push(part(1.86, .08, 2.6, 0, .66, .2, [.08, .08, .08], 0));    // the checker band, near enough
    }
    return merge(p);
  }
  // A walker 1.75 m tall facing -z. Limbs: legs -1/1, arms -2/2.
  var SHOE = [.07, .06, .06], HAIR = [.14, .1, .07];
  function personGeometry() {
    return merge([
      part(.16, .8, .2, -.1, .1, 0, WHITE, 2, -1), part(.16, .8, .2, .1, .1, 0, WHITE, 2, 1),
      part(.17, .1, .27, -.1, 0, -.03, SHOE, 0, -1), part(.17, .1, .27, .1, 0, -.03, SHOE, 0, 1),
      part(.42, .6, .24, 0, .9, 0, WHITE, 1),
      part(.11, .56, .13, -.28, .9, 0, WHITE, 1, -2), part(.11, .56, .13, .28, .9, 0, WHITE, 1, 2),
      part(.09, .1, .1, -.28, .8, 0, WHITE, 3, -2), part(.09, .1, .1, .28, .8, 0, WHITE, 3, 2),
      part(.1, .06, .1, 0, 1.5, 0, WHITE, 3),
      part(.21, .24, .23, 0, 1.54, 0, WHITE, 3),
      part(.23, .07, .25, 0, 1.73, .01, HAIR, 0)
    ]);
  }

  // --- the shader: moving round a loop ----------------------------------------------
  // Traffic.pointOn in GLSL: the point s metres round the loop L (x0, x1, z0,
  // z1) with corners of radius r, clockwise from above, and the way it
  // faces there, as (x, z, dx, dz). back: the other way round.
  var LOOP_GLSL = [
    'uniform float lifeTime;',
    'attribute vec4 aLoop;',            // x0, x1, z0, z1
    'attribute vec4 aMove;',            // r, s at the clock's zero, speed, back (0/1)
    'attribute vec2 aLift;',            // height it moves at, stride phase at the clock's zero (m)
    'vec4 lifeAt(vec4 L, float r, float s, float back) {',
    '  float a = L.y - L.x - 2. * r, b = L.w - L.z - 2. * r, q = 1.5707963 * r, len = 2. * a + 2. * b + 4. * q;',
    '  s = mod(s, len);',
    '  if (back > .5) s = len - s;',
    '  vec4 p;',
    '  float th;',
    '  if (s <= a) p = vec4(L.x + r + s, L.z, 1., 0.);',
    '  else if ((s -= a) <= q) { th = -1.5707963 + s / r; p = vec4(L.y - r + r * cos(th), L.z + r + r * sin(th), -sin(th), cos(th)); }',
    '  else if ((s -= q) <= b) p = vec4(L.y, L.z + r + s, 0., 1.);',
    '  else if ((s -= b) <= q) { th = s / r; p = vec4(L.y - r + r * cos(th), L.w - r + r * sin(th), -sin(th), cos(th)); }',
    '  else if ((s -= q) <= a) p = vec4(L.y - r - s, L.w, -1., 0.);',
    '  else if ((s -= a) <= q) { th = 1.5707963 + s / r; p = vec4(L.x + r + r * cos(th), L.w - r + r * sin(th), -sin(th), cos(th)); }',
    '  else if ((s -= q) <= b) p = vec4(L.x, L.w - r - s, 0., -1.);',
    '  else { s -= b; th = 3.1415927 + s / r; p = vec4(L.x + r + r * cos(th), L.z + r + r * sin(th), -sin(th), cos(th)); }',
    '  if (back > .5) p.zw = -p.zw;',
    '  return p;',
    '}',
    // A model faces -z; turn it to face (dx, dz): yaw with sin = -dx, cos = -dz.
    'vec3 lifeTurn(vec3 v, vec2 d) { return vec3(-d.y * v.x - d.x * v.z, v.y, d.x * v.x - d.y * v.z); }',
    'vec4 lifePos() { return lifeAt(aLoop, aMove.x, aMove.y + aMove.z * lifeTime, aMove.w); }'
  ].join('\n');
  var LEG = { hip: .9, shoulder: 1.46, legSwing: .5, armSwing: .4, bob: .035 };
  function walkGLSL() {
    return [
      'attribute float aLimb;',
      'attribute vec3 aLower;',
      'attribute vec3 aSkin;',
      'float lifePhase() { return fract((aLift.y + aMove.z * lifeTime) / ' + Traffic.constants.STRIDE.toFixed(3) + '); }',
      // How far a vertex's limb swings (radians): legs against arms.
      'float lifeLimb() {',
      '  float arm = step(1.5, abs(aLimb)), leg = step(.5, abs(aLimb)) * (1. - arm);',
      '  float swing = sin(lifePhase() * 6.2831853) * sign(aLimb);',
      '  return leg * swing * ' + LEG.legSwing.toFixed(2) + ' - arm * swing * ' + LEG.armSwing.toFixed(2) + ';',
      '}',
      'vec3 lifeSwing(vec3 v, float ang, float pivot) {',
      '  float y = v.y - pivot;',
      '  return vec3(v.x, pivot + y * cos(ang) - v.z * sin(ang), y * sin(ang) + v.z * cos(ang));',
      '}',
      'float lifePivot() { return abs(aLimb) > 1.5 ? ' + LEG.shoulder.toFixed(2) + ' : ' + LEG.hip.toFixed(2) + '; }'
    ].join('\n');
  }

  // Patch a material (Lambert, or the shadow pass's depth material) so each
  // instance moves round its loop. walker: limbs, and a bob at each step.
  // lit: the Lambert one, which also turns normals and takes the colours.
  function moving(m, walker, clock, lit) {
    m.onBeforeCompile = function (sh) {
      sh.uniforms.lifeTime = clock;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPaint;\n' + LOOP_GLSL + '\n' + (walker ? walkGLSL() : ''))
        .replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          walker ? 'transformed = lifeSwing(transformed, lifeLimb(), lifePivot());' : '',
          '{ vec4 lp = lifePos();',
          '  transformed = lifeTurn(transformed, lp.zw) + vec3(lp.x, aLift.x, lp.y);',
          walker ? '  transformed.y += abs(sin(lifePhase() * 6.2831853)) * ' + LEG.bob.toFixed(3) + ';' : '',
          '}'
        ].join('\n'));
      if (!lit) return;
      sh.vertexShader = sh.vertexShader
        .replace('#include <beginnormal_vertex>', [
          '#include <beginnormal_vertex>',
          walker ? 'objectNormal = lifeSwing(objectNormal, lifeLimb(), 0.);' : '',
          'objectNormal = lifeTurn(objectNormal, lifePos().zw);'
        ].join('\n'))
        .replace('#include <color_vertex>', [
          'vColor = vec3(1.0);',
          '#ifdef USE_COLOR',
          '  vColor *= color;',
          '#endif',
          '#ifdef USE_INSTANCING_COLOR',
          walker ? '  vColor *= aPaint < .5 ? vec3(1.) : aPaint < 1.5 ? instanceColor : aPaint < 2.5 ? aLower : aSkin;'
                 : '  vColor *= mix(vec3(1.), instanceColor, aPaint);',
          '#endif'
        ].join('\n'));
    };
    m.customProgramCacheKey = function () { return 'life-' + (walker ? 'walker' : 'car') + (lit ? '' : '-depth'); };
    return m;
  }

  function instanced(geo, walker, clock, max) {
    var mesh = new T.InstancedMesh(geo, moving(new T.MeshLambertMaterial({ vertexColors: true }), walker, clock, true), max);
    mesh.customDepthMaterial = moving(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }), walker, clock, false);
    mesh.count = 0;
    // The instances are all over the city, and move in the shader; their
    // matrices stay as they are (identity).
    mesh.frustumCulled = false;
    mesh.setColorAt(0, new T.Color(1, 1, 1));
    var attrs = [['aLoop', 4], ['aMove', 4], ['aLift', 2]].concat(walker ? [['aLower', 3], ['aSkin', 3]] : []);
    attrs.forEach(function (e) { geo.setAttribute(e[0], new T.InstancedBufferAttribute(new Float32Array(max * e[1]), e[1])); });
    mesh.receiveShadow = true;
    return mesh;
  }

  // --- the life -----------------------------------------------------------------------
  // sim: Traffic.create(city). The most instances any tier asks for.
  var MAX_CARS = 260, MAX_PEOPLE = 180;
  // How often (seconds) the nearest are picked again, and how far you may
  // go (metres) before they are picked sooner.
  var RESELECT = 1.2, MOVED = 25;
  function create(scene, sim) {
    var group = new T.Group(), clock = { value: 0 };
    group.name = 'life';
    var cars = instanced(carGeometry(false), false, clock, MAX_CARS);
    var cabs = instanced(carGeometry(true), false, clock, MAX_CARS);
    var people = instanced(personGeometry(), true, clock, MAX_PEOPLE);
    group.add(cars); group.add(cabs); group.add(people);
    scene.add(group);

    var nearCars = [], nearPeople = [], col = new T.Color(), sl = {};
    var time = 0, base = 0, at = null, key = null, hiddenRef = null;
    function rgb(arr, i, v) { col.setRGB(v[0], v[1], v[2], T.SRGBColorSpace); arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    // Write item `it` into instance i of mesh, re-based to the clock's zero.
    function write(mesh, i, kind, it) {
      Traffic.slot(sim, kind, it, base, sl);
      var g = mesh.geometry.attributes, lp = g.aLoop.array, mv = g.aMove.array, lf = g.aLift.array;
      lp[i * 4] = sl.x0; lp[i * 4 + 1] = sl.x1; lp[i * 4 + 2] = sl.z0; lp[i * 4 + 3] = sl.z1;
      mv[i * 4] = sl.r; mv[i * 4 + 1] = sl.s; mv[i * 4 + 2] = sl.speed; mv[i * 4 + 3] = sl.back;
      lf[i * 2] = sl.y; lf[i * 2 + 1] = sl.phase;
      if (kind === 'cars') rgb(mesh.instanceColor.array, i, it.color);
      else { rgb(mesh.instanceColor.array, i, it.shirt); rgb(g.aLower.array, i, it.lower); rgb(g.aSkin.array, i, it.skin); }
    }
    function upload(mesh) {
      var g = mesh.geometry.attributes, n = mesh.count;
      mesh.visible = n > 0;
      [g.aLoop, g.aMove, g.aLift, mesh.instanceColor, g.aLower, g.aSkin].forEach(function (a) {
        if (!a) return;
        a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n) * a.itemSize); a.needsUpdate = true;
      });
    }
    // A tier's traffic, held to what the instances have room for.
    function cap(t, max) { return { range: t.range, density: t.density, max: Math.min(t.max, max) }; }
    // Pick the nearest again, from where you are now.
    function pick(eye, tier) {
      base = time; clock.value = 0; at = { x: eye.x, z: eye.z }; hiddenRef = sim.hidden; key = tier.name;
      var nc = Traffic.near(sim, 'cars', eye, cap(tier.cars, MAX_CARS), time, nearCars), a = 0, b = 0, i;
      for (i = 0; i < nc; i++) { var it = nearCars[i].item; if (it.cab) write(cabs, b++, 'cars', it); else write(cars, a++, 'cars', it); }
      cars.count = a; cabs.count = b;
      var np = Traffic.near(sim, 'people', eye, cap(tier.people, MAX_PEOPLE), time, nearPeople);
      for (i = 0; i < np; i++) write(people, i, 'people', nearPeople[i].item);
      people.count = np;
      upload(cars); upload(cabs); upload(people);
    }

    // dt: seconds of city time to move on (0 holds everyone still); eye: the
    // camera; tier: Gfx.tier (its cars and people). Returns the cars picked,
    // nearest first, as they were when picked ({ x, z, d, item }).
    function update(dt, eye, tier) {
      time += dt;
      clock.value = time - base;
      if (!at || clock.value > RESELECT || Math.hypot(eye.x - at.x, eye.z - at.z) > MOVED || key !== tier.name || hiddenRef !== sim.hidden) pick(eye, tier);
      return nearCars;
    }
    function setCast(on) { cars.castShadow = cabs.castShadow = people.castShadow = !!on; }
    // Where car n of the last pick is now.
    function carNow(n) { return nearCars[n] ? Traffic.carAt(sim, nearCars[n].item, time) : null; }

    return { group: group, update: update, setCast: setCast, carNow: carNow, get time() { return time; },
      counts: function () { return { cars: cars.count, cabs: cabs.count, people: people.count }; } };
  }

  root.WorldLife = { create: create, MAX_CARS: MAX_CARS, MAX_PEOPLE: MAX_PEOPLE, RESELECT: RESELECT };
})(window);


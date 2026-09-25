(function (root) {
  'use strict';
  // Turns City.generate()'s data into meshes. Everything that repeats is one
  // InstancedMesh (all brick tiers are one draw call, all parapets another,
  // every tree canopy another), which is what keeps the whole city to a few
  // dozen draw calls.
  //
  // Instanced boxes are stretched per building, so ordinary UVs would stretch
  // the windows with them. Instead the materials are patched to map textures
  // in world space: a window is always one bay wide and one floor tall,
  // whatever the size of the box it's on.

  var T = root.THREE, TX = root.WorldTextures;

  // --- world-space texturing ----------------------------------------------------
  var VERT_DECL = '#include <common>\nvarying vec3 vWsPos;\nvarying vec3 vWsN;\nvarying vec3 vTint;\n';
  var VERT_BODY = [
    '#include <begin_vertex>',
    'vec4 wsP = vec4(transformed, 1.0);',
    'vec3 wsN = objectNormal;',
    '#ifdef USE_INSTANCING',
    '  wsP = instanceMatrix * wsP;',
    '  wsN = mat3(instanceMatrix) * wsN;',
    '#endif',
    'wsP = modelMatrix * wsP;',
    'vWsPos = wsP.xyz;',
    'vWsN = normalize(mat3(modelMatrix) * wsN);',
    '#ifdef USE_INSTANCING_COLOR',
    '  vTint = instanceColor;',
    '#else',
    '  vTint = vec3(1.0);',
    '#endif'
  ].join('\n');
  function patchVertex(shader) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_DECL)
      .replace('#include <begin_vertex>', VERT_BODY);
  }

  // Plain world-space mapping: tops take x/z, walls take their horizontal axis
  // and height. `tile` is metres per texture repeat.
  function worldMapped(mat, tile) {
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.tileSize = { value: tile };
      patchVertex(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWsPos;\nvarying vec3 vWsN;\nvarying vec3 vTint;\nuniform float tileSize;\n')
        .replace('#include <map_fragment>', [
          'vec3 an = abs(vWsN);',
          'vec2 wuv = an.y > .5 ? vWsPos.xz : (an.x > .5 ? vec2(vWsPos.z, vWsPos.y) : vec2(vWsPos.x, vWsPos.y));',
          'diffuseColor *= texture2D(map, wuv / tileSize);'
        ].join('\n'));
    };
    mat.customProgramCacheKey = function () { return 'world-mapped'; };
    return mat;
  }

  // Facades: windows from the type's atlas, shop fronts on the ground floor, a
  // gravel roof on top. The building's colour tints the wall (the atlas' alpha
  // says which texels are wall) - or, for glass towers, the glass.
  var SHOP_HEIGHT = 4.4, SHOP_WIDTH = 24;
  function facadeMaterial(type, cfg, shop) {
    var params = { map: TX.facade(type, cfg.seed) };
    var mat = type === 'glass'
      ? new T.MeshPhongMaterial(Object.assign(params, { specular: 0x6c7680, shininess: 70 }))
      : new T.MeshLambertMaterial(params);
    var tile = new T.Vector2(cfg.bay * 8, cfg.floor * 8);
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.tile = { value: tile };
      shader.uniforms.shopMap = { value: shop };
      shader.uniforms.tintGlass = { value: type === 'glass' ? 1 : 0 };
      shader.uniforms.roofColor = { value: new T.Color(cfg.roof) };
      patchVertex(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWsPos;\nvarying vec3 vWsN;\nvarying vec3 vTint;\n' +
          'uniform vec2 tile;\nuniform sampler2D shopMap;\nuniform float tintGlass;\nuniform vec3 roofColor;\n')
        .replace('#include <map_fragment>', [
          'vec3 an = abs(vWsN);',
          'if (an.y > .5) {',
          '  float n = fract(sin(dot(floor(vWsPos.xz * 5.), vec2(12.9898, 78.233))) * 43758.5453);',
          '  diffuseColor.rgb *= roofColor * (.95 + .05 * n);',
          '} else {',
          '  float h = an.x > .5 ? vWsPos.z : vWsPos.x;',
          '  vec4 t;',
          '  vec3 wallTint = tintGlass > .5 ? vec3(1.) : vTint, glassTint = tintGlass > .5 ? vTint : vec3(1.);',
          '  if (vWsPos.y < ' + SHOP_HEIGHT.toFixed(2) + ' && tintGlass < .5) {',
          '    t = texture2D(shopMap, vec2(h / ' + SHOP_WIDTH.toFixed(1) + ', vWsPos.y / ' + SHOP_HEIGHT.toFixed(2) + '));',
          '  } else {',
          '    t = texture2D(map, vec2(h, vWsPos.y) / tile);',
          '  }',
          '  diffuseColor.rgb *= mix(t.rgb * glassTint, t.rgb * wallTint, t.a);',
          '}'
        ].join('\n'))
        .replace('#include <color_fragment>', '');
    };
    mat.customProgramCacheKey = function () { return 'facade'; };
    return mat;
  }

  // --- helpers ------------------------------------------------------------------
  var M = new T.Matrix4(), Q = new T.Quaternion(), P = new T.Vector3(), S = new T.Vector3(), E = new T.Euler(), C = new T.Color();

  function unitBox() { var g = new T.BoxGeometry(1, 1, 1); g.translate(0, .5, 0); return g; }

  // One InstancedMesh of boxes. `items` have x0..x1, y0..y1, z0..z1; color(item)
  // may return a THREE.Color or [r, g, b].
  function boxes(items, material, opts) {
    opts = opts || {};
    var mesh = new T.InstancedMesh(opts.geometry || unitBox(), material, Math.max(1, items.length));
    mesh.count = items.length;
    items.forEach(function (b, i) {
      P.set((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2);
      S.set(Math.max(.01, b.x1 - b.x0), Math.max(.01, b.y1 - b.y0), Math.max(.01, b.z1 - b.z0));
      if (b.rx || b.rz || b.ry) Q.setFromEuler(E.set(b.rx || 0, b.ry || 0, b.rz || 0)); else Q.identity();
      mesh.setMatrixAt(i, M.compose(P, Q, S));
      if (opts.color) {
        var c = opts.color(b, i);
        mesh.setColorAt(i, Array.isArray(c) ? C.setRGB(c[0], c[1], c[2], T.SRGBColorSpace) : c);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!opts.cast; mesh.receiveShadow = opts.receive !== false;
    mesh.computeBoundingSphere();
    return mesh;
  }

  function lambert(color, extra) { return new T.MeshLambertMaterial(Object.assign({ color: color }, extra || {})); }
  function jitter(rnd, hex, amount) {
    var c = new T.Color(hex), k = 1 + (rnd() - .5) * amount;
    return c.setRGB(Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k));
  }

  var AUTUMN = ['#c8662a', '#b23c24', '#d9a032', '#8a9a3c', '#a8552a', '#e0b845'];

  // --- the build ----------------------------------------------------------------
  function build(city, opts) {
    opts = opts || {};
    var group = new T.Group(), rnd = City.mulberry32(city.seed ^ 0x5bd1e995), L = city.layout;
    var aniso = opts.anisotropy || 4;
    group.name = 'city';

    // Ground: asphalt everywhere on this side of the river, and the far bank.
    var asphalt = TX.asphalt(); asphalt.anisotropy = aniso;
    var ground = new T.Mesh(new T.PlaneGeometry(1, 1), worldMapped(lambert(0xffffff, { map: asphalt }), 7));
    ground.rotation.x = -Math.PI / 2;
    var gx0 = city.promenade.x0, gx1 = city.bounds.x1 + L.FILLER + 400, gz0 = city.bounds.z0 - L.FILLER - 400, gz1 = city.bounds.z1 + L.FILLER + 400;
    ground.scale.set(gx1 - gx0, gz1 - gz0, 1); ground.position.set((gx0 + gx1) / 2, 0, (gz0 + gz1) / 2);
    ground.receiveShadow = true;
    group.add(ground);
    var bankX = city.promenade.x0 - L.RIVER;
    var bank = new T.Mesh(new T.PlaneGeometry(1, 1), ground.material);
    bank.rotation.x = -Math.PI / 2; bank.scale.set(1400, gz1 - gz0, 1); bank.position.set(bankX - 700, 0, (gz0 + gz1) / 2);
    group.add(bank);

    // Sidewalks: each block is a kerb-high slab of paving.
    var pave = TX.paving(); pave.anisotropy = aniso;
    var paveMat = worldMapped(lambert(0xffffff, { map: pave }), 4);
    group.add(boxes(city.blocks.map(function (b) { return { x0: b.x0, x1: b.x1, y0: 0, y1: L.CURB, z0: b.z0, z1: b.z1 }; }), paveMat));
    // The park's pavement ring (its inside is grass).
    var pr = city.park.rect;
    group.add(boxes([
      { x0: pr.x0, x1: pr.x1, y0: 0, y1: L.CURB, z0: pr.z0, z1: pr.z0 + L.SIDEWALK },
      { x0: pr.x0, x1: pr.x1, y0: 0, y1: L.CURB, z0: pr.z1 - L.SIDEWALK, z1: pr.z1 },
      { x0: pr.x0, x1: pr.x0 + L.SIDEWALK, y0: 0, y1: L.CURB, z0: pr.z0 + L.SIDEWALK, z1: pr.z1 - L.SIDEWALK },
      { x0: pr.x1 - L.SIDEWALK, x1: pr.x1, y0: 0, y1: L.CURB, z0: pr.z0 + L.SIDEWALK, z1: pr.z1 - L.SIDEWALK }
    ], paveMat));

    // Lane markings: flat quads a hair above the road.
    var markGeo = new T.PlaneGeometry(1, 1); markGeo.rotateX(-Math.PI / 2);
    var markMat = lambert(0xffffff, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    var yellow = new T.Color('#e2b93b'), white = new T.Color('#e8e6df');
    group.add(boxes(city.markings.map(function (m) {
      return { x0: m.x - m.w / 2, x1: m.x + m.w / 2, y0: .015, y1: .016, z0: m.z - m.d / 2, z1: m.z + m.d / 2, c: m.c };
    }), markMat, { geometry: markGeo, color: function (m) { return m.c === 'y' ? yellow : white; } }));

    // Buildings: one instanced mesh per facade type, plus one per type for the
    // far backdrop (which casts no shadows - it's never near the player).
    var shop = TX.shopfront(21);
    var cfgs = {
      brick: { seed: 31, roof: '#6f6a64' }, sandstone: { seed: 32, roof: '#7a756d' },
      office: { seed: 33, roof: '#8a8984' }, glass: { seed: 34, roof: '#9a9a96' }
    };
    var materials = {};
    Object.keys(cfgs).forEach(function (type) {
      var cfg = Object.assign({}, cfgs[type], City.TYPES[type]);
      var mat = materials[type] = facadeMaterial(type, cfg, shop);
      mat.map.anisotropy = aniso;
      var tiers = [], far = [];
      city.buildings.forEach(function (b) { if (b.type === type) b.tiers.forEach(function (t) { tiers.push({ b: b, t: t }); }); });
      city.filler.forEach(function (b) { if (b.type === type) b.tiers.forEach(function (t) { far.push({ b: b, t: t }); }); });
      var near = boxes(tiers.map(function (e) { var t = e.t; return { x0: t.x0, x1: t.x1, y0: 0, y1: t.y1, z0: t.z0, z1: t.z1, b: e.b }; }),
        mat, { color: function (x) { return x.b.tint; }, cast: true });
      near.name = 'buildings-' + type;
      group.add(near);
      var back = boxes(far.map(function (e) { var t = e.t; return { x0: t.x0, x1: t.x1, y0: 0, y1: t.y1, z0: t.z0, z1: t.z1, b: e.b }; }),
        mat, { color: function (x) { return x.b.tint; }, receive: false });
      back.name = 'backdrop-' + type;
      group.add(back);
    });

    // Parapets: stone copings, a little variation so they don't look stamped.
    group.add(boxes(city.parapets, lambert(0xffffff), { color: function () { return jitter(rnd, '#b3aca0', .25); }, cast: true }));

    // Roof props.
    var tanks = city.props.filter(function (p) { return p.kind === 'tank'; });
    var legs = [], tankBodies = [], tankCaps = [];
    tanks.forEach(function (t) {
      var cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2, r = (t.x1 - t.x0) / 2, top = t.y1, base = t.y0 + t.legs;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
        var lx = cx + s[0] * r * .6, lz = cz + s[1] * r * .6;
        legs.push({ x0: lx - .12, x1: lx + .12, y0: t.y0, y1: base, z0: lz - .12, z1: lz + .12 });
      });
      tankBodies.push({ x0: cx - r, x1: cx + r, y0: base, y1: top - r * .45, z0: cz - r, z1: cz + r });
      tankCaps.push({ x0: cx - r * 1.05, x1: cx + r * 1.05, y0: top - r * .45, y1: top, z0: cz - r * 1.05, z1: cz + r * 1.05 });
    });
    var steelDark = lambert(0x3a3c3f);
    group.add(boxes(legs, steelDark, { cast: true }));
    var cyl = new T.CylinderGeometry(.5, .5, 1, 14); cyl.translate(0, .5, 0);
    group.add(boxes(tankBodies, lambert(0xffffff), { geometry: cyl, cast: true, color: function () { return jitter(rnd, '#7b6450', .3); } }));
    var cone = new T.ConeGeometry(.5, 1, 14); cone.translate(0, .5, 0);
    group.add(boxes(tankCaps, lambert(0x4d4a46), { geometry: cone, cast: true }));
    var roofBoxes = city.props.filter(function (p) { return p.kind === 'ac' || p.kind === 'bulkhead' || p.kind === 'mech'; });
    group.add(boxes(roofBoxes, lambert(0xffffff), { cast: true, color: function (p) {
      return p.kind === 'bulkhead' ? jitter(rnd, '#a58f78', .2) : p.kind === 'mech' ? jitter(rnd, '#8d9196', .15) : jitter(rnd, '#c4c7c9', .12);
    } }));
    var spires = city.props.filter(function (p) { return p.kind === 'spire'; });
    var spireGeo = new T.ConeGeometry(.5, 1, 10); spireGeo.translate(0, .5, 0);
    group.add(boxes(spires, lambert(0xd9dde0), { geometry: spireGeo, cast: true }));

    // --- park ---
    var pk = city.park, gr = pk.grass;
    var grassTex = TX.grass(); grassTex.anisotropy = aniso;
    var lawn = new T.Mesh(new T.PlaneGeometry(1, 1), worldMapped(lambert(0xffffff, { map: grassTex }), 6));
    lawn.rotation.x = -Math.PI / 2; lawn.scale.set(gr.x1 - gr.x0, gr.z1 - gr.z0, 1);
    lawn.position.set((gr.x0 + gr.x1) / 2, L.CURB, (gr.z0 + gr.z1) / 2); lawn.receiveShadow = true;
    group.add(lawn);
    group.add(boxes(pk.paths.map(function (p) {
      var len = Math.hypot(p.x1 - p.x0, p.z1 - p.z0), cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      return { x0: cx - p.width / 2, x1: cx + p.width / 2, y0: L.CURB, y1: L.CURB + .03, z0: cz - len / 2, z1: cz + len / 2,
        ry: Math.atan2(p.x1 - p.x0, p.z1 - p.z0) };
    }), lambert(0xc9bfa9)));

    var trees = pk.trees.concat(city.promenade.trees.map(function (t) { return Object.assign({ y: city.promenade.top }, t); }));
    var trunkGeo = new T.CylinderGeometry(.14, .26, 1, 6); trunkGeo.translate(0, .5, 0);
    group.add(boxes(trees.map(function (t) {
      var y = t.y || L.CURB;
      return { x0: t.x - .5, x1: t.x + .5, y0: y, y1: y + t.h * .62, z0: t.z - .5, z1: t.z + .5 };
    }), lambert(0x4a3a2c), { geometry: trunkGeo, cast: true }));
    var crownGeo = new T.IcosahedronGeometry(.5, 1);
    var crowns = new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    group.add(boxes(trees.map(function (t) {
      var y = (t.y || L.CURB) + t.h * .45, r = t.bare ? t.r * .75 : t.r;
      return { x0: t.x - r, x1: t.x + r, y0: y, y1: y + t.h * .6, z0: t.z - r, z1: t.z + r, t: t, ry: rnd() * 6 };
    }), crowns, { geometry: crownGeo, cast: true, color: function (e) {
      return e.t.bare ? jitter(rnd, '#6d5b4a', .25) : jitter(rnd, AUTUMN[e.t.color % AUTUMN.length], .25);
    } }));

    // Shared water: a phong surface whose normal map scrolls, so the sun glints move.
    var normals = TX.waterNormals();
    normals.repeat.set(1 / 28, 1 / 28);
    var water = new T.MeshPhongMaterial({ color: 0x2b4c66, specular: 0xb8c8d8, shininess: 90, normalMap: normals,
      normalScale: new T.Vector2(.55, .55) });
    // A plane's UVs span it once; the normal map should repeat every ~28 m, so
    // scale UVs to metres here and let the repeat bring them back down.
    function waterPlane(w, d) {
      var g = new T.PlaneGeometry(w, d), uv = g.attributes.uv, i;
      for (i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
      return g;
    }
    var pondShore = new T.Mesh(new T.CircleGeometry(1, 48), lambert(0x5b5040));
    pondShore.rotation.x = -Math.PI / 2; pondShore.scale.set(pk.pond.rx + 2.5, pk.pond.rz + 2.5, 1);
    pondShore.position.set(pk.pond.x, L.CURB + .01, pk.pond.z);
    group.add(pondShore);
    var pondGeo = new T.CircleGeometry(1, 48), puv = pondGeo.attributes.uv;
    for (var q = 0; q < puv.count; q++) puv.setXY(q, puv.getX(q) * pk.pond.rx * 2, puv.getY(q) * pk.pond.rz * 2);
    var pond = new T.Mesh(pondGeo, water);
    pond.rotation.x = -Math.PI / 2; pond.scale.set(pk.pond.rx, pk.pond.rz, 1);
    pond.position.set(pk.pond.x, L.CURB + .03, pk.pond.z);
    group.add(pond);

    // --- waterfront ---
    var pm = city.promenade;
    group.add(boxes([{ x0: pm.x0, x1: pm.x1, y0: -3, y1: pm.top, z0: city.bounds.z0 - L.FILLER, z1: city.bounds.z1 + L.FILLER }],
      worldMapped(lambert(0xffffff, { map: pave }), 4)));
    // The railing collides as one solid box (city.js); here it's drawn as
    // posts and two rails so you can see the water through it.
    var rails = [], rz0 = city.bounds.z0 - L.FILLER, rz1 = city.bounds.z1 + L.FILLER;
    pm.railing.forEach(function (r) {
      var cx = (r.x0 + r.x1) / 2, zz;
      rails.push({ x0: cx - .05, x1: cx + .05, y0: r.y1 - .08, y1: r.y1, z0: rz0, z1: rz1 });
      rails.push({ x0: cx - .03, x1: cx + .03, y0: r.y0 + .5, y1: r.y0 + .55, z0: rz0, z1: rz1 });
      for (zz = city.bounds.z0 - 200; zz < city.bounds.z1 + 200; zz += 2.5)
        rails.push({ x0: cx - .04, x1: cx + .04, y0: r.y0, y1: r.y1, z0: zz - .04, z1: zz + .04 });
    });
    group.add(boxes(rails, lambert(0x2f3a33)));
    var w = city.water, river = new T.Mesh(waterPlane(w.x1 - w.x0, w.z1 - w.z0), water);
    river.rotation.x = -Math.PI / 2; river.position.set((w.x0 + w.x1) / 2, w.y, (w.z0 + w.z1) / 2);
    river.receiveShadow = true;
    group.add(river);

    // --- construction site ---
    var byKind = {};
    city.site.parts.forEach(function (p) { (byKind[p.kind] = byKind[p.kind] || []).push(p); });
    var brickTex = TX.bricks(), ply = TX.plywood(), conc = TX.concrete();
    // Packed dirt over the site's paving, inside the hoarding.
    var sg = city.site.ground, dirt = TX.dirt(); dirt.anisotropy = aniso;
    group.add(boxes([{ x0: sg.x0, x1: sg.x1, y0: L.CURB, y1: L.CURB + .02, z0: sg.z0, z1: sg.z1 }],
      worldMapped(lambert(0xffffff, { map: dirt }), 5)));
    var siteMats = {
      steel: lambert(0x55606b), slab: worldMapped(lambert(0xffffff, { map: conc }), 3),
      fence: worldMapped(lambert(0xffffff, { map: ply }), 2.4), pallet: lambert(0x8f6f45), plank: lambert(0x9a7a4e),
      brick: worldMapped(lambert(0xffffff, { map: brickTex }), 1.2), scaffold: lambert(0x9aa1a7),
      crane: lambert(0xd9a91e), counterweight: lambert(0x8d8c88), cabin: lambert(0xd9692b),
      tarp: lambert(0xffffff, { side: T.DoubleSide })
    };
    var tarpColors = ['#2f5f9e', '#3a78b8', '#c4652b'];
    Object.keys(byKind).forEach(function (kind) {
      group.add(boxes(byKind[kind], siteMats[kind] || steelDark, {
        cast: true, color: kind === 'tarp' ? function (p) { return new T.Color(tarpColors[p.color % 3]); } : null
      }));
    });

    return { group: group, water: normals, materials: materials };
  }

  root.CityMesh = { build: build, facadeMaterial: facadeMaterial, worldMapped: worldMapped };
})(window);

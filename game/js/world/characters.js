(function (root) {
  'use strict';
  // The animated characters, on the Three.js side (rig.js is the logic).
  //
  // WorldModels loads a model by id (goblin, glider, bomb, rhino, venom): its
  // GLB is base64 in js/world/models/<id>.js (tools/embed-models.cjs), because
  // a file:// page can't fetch files. That script is only added to the page
  // the first time the model is asked for. The GLB is parsed once into a
  // template; WorldModels.create clones it (SkeletonUtils) into a
  // CharacterRig, as many times as needed.
  //
  // CharacterRig holds the clone, its AnimationMixer and a Rig state machine.
  // Each frame it steps the machine and copies the pose it asks for (clip,
  // time, weight) into the mixer's actions; it never lets the mixer keep time
  // itself. sample() reads the weak spots and body capsules off the bones as
  // plain data, for the fight logic.
  //
  // A model that fails to load logs one warning and rejects, so the caller
  // can keep its billboard or primitive.

  var T = root.THREE;
  var DIR = 'js/world/models/';
  var data = {}, templates = {}, loading = {}, warned = {};
  var loader = null, env = null;
  // The villains' materials are PBR metal (metalness 1 times a map): lit only
  // by the sun and the sky's hemisphere light they come out nearly black, so
  // they get a neutral studio environment to reflect. Only theirs - the city
  // is left as it is. This is what the model viewer shows; in a fight,
  // villain-view.js gives the villain the city itself to reflect instead
  // (World3D.environment, taken from where the fight is).
  var ENV_INTENSITY = 1;

  function warnOnce(key, msg) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('Web Shooter: ' + msg);
  }
  function manifest() { return root.CharacterManifest || { villains: {} }; }
  // The manifest entry for a villain or a prop.
  function entry(id) {
    var v = manifest().villains;
    if (v[id]) return v[id];
    for (var k in v) if (v[k].props && v[k].props[id]) return v[k].props[id];
    return null;
  }
  function ids() {
    var v = manifest().villains, out = [];
    Object.keys(v).forEach(function (k) { out.push(k); Object.keys(v[k].props || {}).forEach(function (p) { out.push(p); }); });
    return out;
  }

  // The renderer to build the environment map with (World3D's), once.
  function setRenderer(renderer) {
    if (env || !renderer || !T.RoomEnvironment) return;
    var pm = new T.PMREMGenerator(renderer);
    env = pm.fromScene(new T.RoomEnvironment(), .04).texture;
    pm.dispose();
    Object.keys(templates).forEach(function (id) { lit(templates[id].scene); });
  }
  function lit(scene) {
    if (!env) return;
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      [].concat(o.material).forEach(function (m) { if (m.isMeshStandardMaterial) { m.envMap = env; m.envMapIntensity = ENV_INTENSITY; m.needsUpdate = true; } });
    });
  }

  // Called by each js/world/models/<id>.js.
  function register(id, base64) { data[id] = base64; }

  function addScript(id) {
    return new Promise(function (resolve, reject) {
      if (data[id]) return resolve();
      var s = document.createElement('script');
      s.src = DIR + id + '.js';
      s.onload = function () { data[id] ? resolve() : reject(new Error(s.src + ' did not register ' + id)); };
      s.onerror = function () { reject(new Error('no ' + s.src)); };
      document.head.appendChild(s);
    });
  }

  var B64 = (function () {
    var t = new Uint8Array(128), a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (var i = 0; i < a.length; i++) t[a.charCodeAt(i)] = i;
    return t;
  })();
  function decode(s) {
    var n = s.length, pad = s[n - 1] === '=' ? (s[n - 2] === '=' ? 2 : 1) : 0;
    var out = new Uint8Array(n * 3 / 4 - pad), j = 0;
    for (var i = 0; i < n; i += 4) {
      var v = B64[s.charCodeAt(i)] << 18 | B64[s.charCodeAt(i + 1)] << 12 | B64[s.charCodeAt(i + 2)] << 6 | B64[s.charCodeAt(i + 3)];
      out[j++] = v >> 16 & 255;
      if (j < out.length) out[j++] = v >> 8 & 255;
      if (j < out.length) out[j++] = v & 255;
    }
    return out.buffer;
  }

  function gltfLoader() {
    if (loader) return loader;
    if (!T.GLTFLoader || !T.MeshoptDecoder) throw new Error('vendor/three-addons.js is not loaded');
    loader = new T.GLTFLoader();
    loader.setMeshoptDecoder(T.MeshoptDecoder);
    return loader;
  }

  // The parsed model, once: { id, entry, scene, clips: { name: AnimationClip },
  // additive: { name: AnimationClip }, bones: [names as in the file] }.
  function load(id) {
    if (templates[id]) return Promise.resolve(templates[id]);
    if (loading[id]) return loading[id];
    var e = entry(id);
    loading[id] = (e ? addScript(id) : Promise.reject(new Error('not in characters.json')))
      .then(function () { return T.MeshoptDecoder.ready; })
      .then(function () {
        var buf = decode(data[id]);
        data[id] = null;                       // the string is no longer needed
        return new Promise(function (resolve, reject) { gltfLoader().parse(buf, '', resolve, reject); });
      })
      .then(function (gltf) {
        var clips = {}, additive = {};
        gltf.animations.forEach(function (c) { clips[c.name] = c; });
        // A hit is layered over whatever is playing: its change from its own
        // first frame, added on top.
        Rig.ADDITIVE.forEach(function (n) {
          if (clips[n]) additive[n] = T.AnimationUtils.makeClipAdditive(clips[n].clone(), 0);
        });
        gltf.scene.traverse(function (o) {
          if (!o.isMesh) return;
          o.castShadow = true;
          // Skinned bounds are the bind pose's; animation moves the body away
          // from them, so don't let the camera cull it by them.
          o.frustumCulled = false;
        });
        lit(gltf.scene);
        var names = [], json = gltf.parser.json;
        (json.nodes || []).forEach(function (n) { if (n.name) names.push(n.name); });
        var tpl = { id: id, entry: e, scene: gltf.scene, clips: clips, additive: additive, bones: names };
        var warn = Rig.check(e, names, Object.keys(clips));
        if (warn.length) warnOnce(id + ':check', 'model ' + id + ': ' + warn.join('; '));
        templates[id] = tpl;
        return tpl;
      })
      .catch(function (err) {
        delete loading[id];
        warnOnce(id, 'model ' + id + ' could not be loaded (' + err.message + '); keeping the fallback');
        throw err;
      });
    return loading[id];
  }

  function create(id, opts) { return load(id).then(function (tpl) { return new CharacterRig(tpl, opts); }); }

  // --- one animated character ----------------------------------------------------
  function sane(name) { return T.PropertyBinding.sanitizeNodeName(name); }

  function CharacterRig(tpl, opts) {
    opts = opts || {};
    var e = tpl.entry;
    this.id = tpl.id; this.entry = e;
    this.root = new T.Group(); this.root.name = 'character:' + tpl.id;
    this.model = T.SkeletonUtils.clone(tpl.scene);
    this.model.scale.setScalar(e.scale || 1);
    this.root.add(this.model);
    // GLTFLoader sanitises node names ("mixamorig:Head" -> "mixamorigHead");
    // the manifest uses the file's names, so bones are looked up sanitised.
    var bones = this.bones = {};
    this.model.traverse(function (o) { if (o.name && !bones[o.name]) bones[o.name] = o; });
    this.mixer = new T.AnimationMixer(this.model);
    this.actions = {}; this.addActions = {};
    var durs = {}, self = this;
    Object.keys(tpl.clips).forEach(function (n) {
      durs[n] = tpl.clips[n].duration;
      var a = self.actions[n] = self.mixer.clipAction(tpl.clips[n]);
      a.play(); a.enabled = false;
    });
    Object.keys(tpl.additive).forEach(function (n) {
      var a = self.addActions[n] = self.mixer.clipAction(tpl.additive[n]);
      a.play(); a.enabled = false;
    });
    this.clipNames = Object.keys(tpl.clips);
    this.machine = Rig.machine({ clips: durs, loops: e.loops, speeds: e.speeds, events: e.events, base: opts.base });
    this.frame = 0; this.every = 1; this.onScreen = true;
    this.apply();
  }
  CharacterRig.prototype.bone = function (name) { return this.bones[sane(name)] || null; };
  // See Rig.play. Returns the clip used, or null (logged once) if the model
  // has nothing for it.
  CharacterRig.prototype.play = function (name, opts) {
    var got = Rig.play(this.machine, name, opts);
    if (!got) warnOnce(this.id + ':' + name, 'model ' + this.id + ' has no clip for ' + name);
    return got;
  };
  CharacterRig.prototype.setSpeed = function (v) { Rig.setSpeed(this.machine, v); };
  CharacterRig.prototype.state = function () { return Rig.state(this.machine); };
  // Step the clips by dt seconds; returns the machine's events ('end',
  // 'release'). distance (metres from the camera) and onScreen let a far or
  // hidden character work its pose out less often; its timing stays exact.
  CharacterRig.prototype.update = function (dt, distance, onScreen) {
    var ev = Rig.step(this.machine, dt);
    this.every = distance === undefined ? 1 : Rig.updateEvery(distance, onScreen !== false);
    if (this.frame++ % this.every === 0) this.apply();
    return ev;
  };
  // Copy the machine's pose into the mixer.
  CharacterRig.prototype.apply = function () {
    var self = this;
    this.clipNames.forEach(function (n) { self.actions[n].enabled = false; });
    Object.keys(this.addActions).forEach(function (n) { self.addActions[n].enabled = false; });
    Rig.pose(this.machine).forEach(function (p) {
      var a = p.additive ? self.addActions[p.clip] : self.actions[p.clip];
      if (!a) return;
      a.enabled = true; a.time = p.t; a.weight = p.w;
    });
    this.mixer.update(0);
  };
  // The weak spots and body capsules in world space, as plain data (Rig.sample).
  CharacterRig.prototype.sample = function () {
    this.root.updateMatrixWorld(true);
    var self = this;
    return Rig.sample(this.entry, function (name) { var b = self.bone(name); return b ? b.matrixWorld.elements : null; });
  };
  // Measured height of the current pose, in metres (for the viewer).
  CharacterRig.prototype.height = function () {
    this.root.updateMatrixWorld(true);
    var box = new T.Box3(), b = new T.Box3();
    this.model.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); b.copy(o.boundingBox).applyMatrix4(o.matrixWorld); }
      else { o.geometry.computeBoundingBox(); b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); }
      box.union(b);
    });
    return { height: box.max.y - box.min.y, bottom: box.min.y };
  };
  CharacterRig.prototype.dispose = function () {
    this.mixer.stopAllAction();
    if (this.root.parent) this.root.parent.remove(this.root);
  };

  root.WorldModels = {
    register: register, load: load, create: create, entry: entry, ids: ids, manifest: manifest, setRenderer: setRenderer,
    loaded: function (id) { return !!templates[id]; }
  };
  root.CharacterRig = CharacterRig;
})(window);

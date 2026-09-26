// Builds the character models the page loads, in one command:
//
//   node game/tools/build-models.cjs              compress + embed the GLBs in assets/models/
//   node game/tools/build-models.cjs --blender    first rebuild those GLBs from assets-src/ in Blender
//   node game/tools/build-models.cjs --sheets     also re-render docs/reference/clips/<id>.png
//   node game/tools/build-models.cjs --only venom just one character (and its props)
//
// 1. (--blender) runs game/tools/blender/<id>.py headless, which writes
//    assets/models/<id>.glb. Blender is looked for in BLENDER_PATH, then on
//    PATH, then in C:\Program Files\Blender Foundation\Blender *\.
// 2. Compresses each GLB with glTF-Transform - drop channels on bones that
//    move no vertex, one time grid per clip, prune, dedup, meshopt
//    (EXT_meshopt_compression, decoded by the WASM inlined in
//    vendor/three-addons.js) - into assets/models/dist/. WebP textures are
//    kept as they are. Draco and KTX2 are not allowed: they would need a
//    separate decoder file, which a file:// page can't fetch.
// 3. Runs embed-models.cjs, which turns dist/*.glb into js/world/models/*.js.
//
// Needs the dev dependencies: npm install (once).
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const embed = require('./embed-models.cjs');
const inspect = require('./inspect-glb.cjs');

const REPO = path.join(__dirname, '..', '..');
const MODELS = path.join(REPO, 'game', 'assets', 'models');
const DIST = path.join(MODELS, 'dist');
const BLENDER_DIR = path.join(__dirname, 'blender');
const manifest = require(path.join(MODELS, 'characters.json'));

// Which Blender script writes which files, in build order (rhino.py borrows
// clips from Venom's source rig, not from venom.glb, so order is only tidy).
const SCRIPTS = [
  { script: 'goblin.py', writes: ['goblin', 'glider', 'bomb'] },
  { script: 'venom.py', writes: ['venom'] },
  { script: 'rhino.py', writes: ['rhino'] }
];

function args(argv) {
  const a = { blender: false, sheets: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--blender') a.blender = true;
    else if (argv[i] === '--sheets') a.sheets = true;
    else if (argv[i] === '--only') a.only = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 17).join('\n')); process.exit(0); }
    else throw new Error('unknown option ' + argv[i]);
  }
  return a;
}

// Every model file the manifest names: villains and their props.
function modelIds() {
  const ids = [];
  Object.keys(manifest.villains).forEach(id => {
    ids.push(id);
    Object.keys(manifest.villains[id].props || {}).forEach(p => ids.push(p));
  });
  return ids;
}
function idsFor(only) {
  if (!only) return modelIds();
  const v = manifest.villains[only];
  if (!v) throw new Error('--only ' + only + ': not a villain in characters.json (' + Object.keys(manifest.villains).join(', ') + ')');
  return [only].concat(Object.keys(v.props || {}));
}

// The bones the runtime reads for a model: weak spots and body capsules.
function bonesOf(id) {
  const v = manifest.villains[id], out = new Set();
  if (!v) return out;
  (v.weakSpots || []).forEach(w => out.add(w.bone));
  (v.body || []).forEach(c => { out.add(c[0]); out.add(c[1]); });
  return out;
}

function findBlender() {
  const exe = process.platform === 'win32' ? 'blender.exe' : 'blender';
  const tried = [];
  if (process.env.BLENDER_PATH) {
    const p = process.env.BLENDER_PATH, f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, exe) : p;
    if (fs.existsSync(f)) return f;
    tried.push('BLENDER_PATH=' + p);
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  tried.push('PATH');
  const base = 'C:\\Program Files\\Blender Foundation';
  if (fs.existsSync(base)) {
    // The newest "Blender x.y" folder first.
    const vers = fs.readdirSync(base).filter(d => /^Blender /.test(d) && fs.existsSync(path.join(base, d, exe)))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (vers.length) return path.join(base, vers[0], exe);
  }
  tried.push(base + '\\Blender *');
  throw new Error('Blender not found (looked in ' + tried.join(', ') + ').\n' +
    'Install Blender 4.2 LTS or newer, or set BLENDER_PATH to blender.exe or its folder.');
}

function runBlender(blender, script, extra) {
  const argv = ['--background', '--factory-startup', '--python', path.join(BLENDER_DIR, script)].concat(extra ? ['--'].concat(extra) : []);
  console.log('> blender ' + argv.slice(3).join(' '));
  const r = cp.spawnSync(blender, argv, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 });
  // Blender prints a lot; keep the build scripts' own lines, and any error.
  (r.stdout || '').split(/\r?\n/).filter(l => /^\[build\]|Error|Traceback/.test(l)).forEach(l => console.log('  ' + l));
  if (r.status !== 0 || /Traceback|Error:/.test(r.stdout + r.stderr)) {
    console.error((r.stderr || '').slice(-4000));
    throw new Error('blender ' + script + ' failed (exit ' + r.status + ')');
  }
}

// --- animation passes ---------------------------------------------------------
// Venom's clips animate ~350 bones each, so the file is ~10,000 tiny channels
// and the glTF JSON describing them outweighs the key data. These cut the
// JSON without touching what any clip looks like.

// A channel on a joint that no vertex depends on (IK targets, weapon sockets)
// moves nothing you can see: drop it with its sampler. Bones named in `keep`
// (the manifest's weak spots and capsules) stay live whatever their weights.
function dropDeadChannels(doc, keep) {
  const root = doc.getRoot(), live = new Set();
  const mark = n => { for (; n && !live.has(n); n = n.getParentNode()) live.add(n); };
  root.listNodes().forEach(n => { if (keep.has(n.getName())) mark(n); });
  root.listSkins().forEach(skin => {
    const joints = skin.listJoints();
    root.listMeshes().forEach(m => m.listPrimitives().forEach(p => {
      for (let set = 0; ; set++) {
        const J = p.getAttribute('JOINTS_' + set), W = p.getAttribute('WEIGHTS_' + set);
        if (!J || !W) break;
        const j = [], w = [];
        for (let i = 0; i < J.getCount(); i++) {
          J.getElement(i, j); W.getElement(i, w);
          for (let k = 0; k < j.length; k++) {
            // A weighted joint and every joint above it carry the pose.
            if (w[k] > 0) mark(joints[j[k]]);
          }
        }
      }
    }));
  });
  const inSkin = new Set(); root.listSkins().forEach(s => s.listJoints().forEach(j => inSkin.add(j)));
  let n = 0;
  root.listAnimations().forEach(a => a.listChannels().forEach(c => {
    const t = c.getTargetNode();
    if (!t || !inSkin.has(t) || live.has(t)) return;
    const s = c.getSampler(); c.dispose(); n++;
    // Its sampler too, unless another channel still reads it.
    if (s && !s.listParents().some(p => p.propertyType === 'AnimationChannel')) s.dispose();
  }));
  return n;
}

// Sample a LINEAR track at time t (slerp for rotations).
function sampleAt(times, values, k, t, rot, out) {
  const last = times.length - 1;
  let i = 0;
  if (t <= times[0]) i = -1; else if (t >= times[last]) i = last;
  else while (times[i + 1] < t) i++;
  if (i < 0 || i === last) { const o = i < 0 ? 0 : last * k; for (let q = 0; q < k; q++) out[q] = values[o + q]; return; }
  const u = (t - times[i]) / (times[i + 1] - times[i]), a = i * k, b = a + k;
  if (!rot) { for (let q = 0; q < k; q++) out[q] = values[a + q] + (values[b + q] - values[a + q]) * u; return; }
  let d = 0; for (let q = 0; q < 4; q++) d += values[a + q] * values[b + q];
  const sgn = d < 0 ? -1 : 1; d *= sgn;
  let wa = 1 - u, wb = u * sgn;
  if (d < .9995) { const th = Math.acos(d), s = Math.sin(th); wa = Math.sin((1 - u) * th) / s; wb = Math.sin(u * th) / s * sgn; }
  let len = 0;
  for (let q = 0; q < 4; q++) { out[q] = values[a + q] * wa + values[b + q] * wb; len += out[q] * out[q]; }
  len = Math.sqrt(len); for (let q = 0; q < 4; q++) out[q] /= len;
}

// Blender thins each channel's keys separately, so every channel has its own
// time accessor. Put every LINEAR channel of a clip on one shared time grid
// (the union of their key times, which is the clip's frames) instead: a third
// fewer accessors, and meshopt packs the denser, regular keys well.
// STEP and CUBICSPLINE (the Goblin's eased clips) are left as they are.
function shareClipTimes(doc) {
  const root = doc.getRoot(), buffer = root.listBuffers()[0];
  root.listAnimations().forEach(a => {
    const lin = a.listChannels().filter(c => c.getSampler() && c.getSampler().getInterpolation() === 'LINEAR');
    if (lin.length < 2) return;
    const set = new Set();
    lin.forEach(c => c.getSampler().getInput().getArray().forEach(t => set.add(Math.round(t * 1e5) / 1e5)));
    const grid = Float32Array.from([...set].sort((x, y) => x - y));
    const input = doc.createAccessor(a.getName() + '_time').setType('SCALAR').setArray(grid).setBuffer(buffer);
    lin.forEach(c => {
      const s = c.getSampler(), times = s.getInput().getArray(), outAcc = s.getOutput(), values = outAcc.getArray();
      const k = outAcc.getElementSize(), rot = c.getTargetPath() === 'rotation', v = new Float32Array(grid.length * k), tmp = new Array(k);
      for (let g = 0; g < grid.length; g++) { sampleAt(times, values, k, grid[g], rot, tmp); v.set(tmp, g * k); }
      // A fresh output: the old one may be shared with another sampler.
      s.setInput(input).setOutput(doc.createAccessor().setType(outAcc.getType()).setArray(v).setBuffer(buffer));
    });
  });
}

// glTF-Transform writes default values out in full ("normalized":false,
// "byteOffset":0, "interpolation":"LINEAR") on each of ~10,000 accessors
// and samplers. Leave them out: GLTFLoader assumes the defaults.
function slimJson(glb) {
  const b = Buffer.from(glb), jlen = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jlen).toString());
  (j.accessors || []).forEach(a => { if (a.normalized === false) delete a.normalized; if (a.byteOffset === 0) delete a.byteOffset; });
  (j.bufferViews || []).forEach(v => { if (v.byteOffset === 0) delete v.byteOffset; });
  (j.animations || []).forEach(a => a.samplers.forEach(s => { if (s.interpolation === 'LINEAR') delete s.interpolation; }));
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const rest = b.slice(20 + jlen), head = Buffer.alloc(20);
  head.write('glTF', 0, 'ascii'); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12); head.write('JSON', 16, 'ascii');
  return Buffer.concat([head, json, rest]);
}

async function compressor() {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { prune, dedup, meshopt } = await import('@gltf-transform/functions');
  const { MeshoptEncoder, MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  return async function compress(src, dst, keep) {
    const doc = await io.read(src);
    const used = doc.getRoot().listExtensionsUsed().map(e => e.extensionName);
    const banned = used.filter(n => /draco|basisu|ktx/i.test(n));
    if (banned.length) throw new Error(path.basename(src) + ' uses ' + banned.join(', ') + ': only meshopt and WebP are allowed');
    const dead = dropDeadChannels(doc, keep || new Set());
    shareClipTimes(doc);
    await doc.transform(
      // keepLeaves: a bone that is only an end joint is still part of the skin.
      prune({ keepLeaves: true, keepAttributes: true }),
      dedup(),
      // 'high' quantizes: 14-bit positions, 8-bit normals, and 16-bit
      // rotations through meshopt's quaternion filter.
      meshopt({ encoder: MeshoptEncoder, level: 'high' })
    );
    fs.writeFileSync(dst, slimJson(await io.writeBinary(doc)));
    return { dead };
  };
}

async function main() {
  const a = args(process.argv.slice(2));
  const ids = idsFor(a.only);
  if (a.blender || a.sheets) {
    const blender = findBlender();
    console.log('Blender: ' + blender);
    if (a.blender) SCRIPTS.filter(s => s.writes.some(w => ids.includes(w))).forEach(s => runBlender(blender, s.script));
    if (a.sheets) Object.keys(manifest.villains).filter(v => ids.includes(v)).forEach(v => {
      const props = Object.keys(manifest.villains[v].props || {}).filter(p => p !== 'bomb');
      runBlender(blender, 'sheet.py', [v, String(manifest.villains[v].height / (manifest.villains[v].scale || 1))].concat(props));
    });
  }

  let compress;
  try { compress = await compressor(); } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') throw new Error('glTF-Transform is missing: run npm install in the repo root first');
    throw e;
  }
  fs.mkdirSync(DIST, { recursive: true });
  for (const id of ids) {
    const src = path.join(MODELS, id + '.glb'), dst = path.join(DIST, id + '.glb');
    if (!fs.existsSync(src)) throw new Error('missing ' + path.relative(REPO, src) + ' (run with --blender)');
    const r = await compress(src, dst, bonesOf(id));
    const before = inspect(src), after = inspect(dst);
    const json = fs.readFileSync(dst).readUInt32LE(12) / 1e6;
    console.log(id.padEnd(7) + before.mb.toFixed(2).padStart(6) + ' MB -> ' + after.mb.toFixed(2).padStart(5) + ' MB  (JSON ' +
      json.toFixed(2) + ' MB, ' + after.triangles + ' tris, ' + after.clips.length + ' clips' +
      (r.dead ? ', ' + r.dead + ' dead channels dropped' : '') + ')');
    if (after.clips.length !== before.clips.length) throw new Error(id + ': compression lost clips');
  }
  embed.run(ids);
}

if (require.main === module) main().catch(e => { console.error('build-models: ' + e.message); process.exit(1); });
module.exports = { findBlender, modelIds };

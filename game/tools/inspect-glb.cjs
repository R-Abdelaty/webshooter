#!/usr/bin/env node
// Summarise a .glb: meshes, skin, clips (name, length, channels) and where the bytes go.
//   node game/tools/inspect-glb.cjs game/assets/models/venom.glb
'use strict';
const fs = require('fs');

function inspect(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error(file + ' is not a GLB');
  const jlen = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + jlen).toString());
  const acc = j.accessors || [], views = j.bufferViews || [];
  const accBytes = i => { const a = acc[i]; return a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]) * ({ 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[a.componentType]); };
  let tris = 0, meshBytes = 0;
  const seen = new Set();
  (j.meshes || []).forEach(m => m.primitives.forEach(p => {
    const n = p.indices != null ? acc[p.indices].count : acc[p.attributes.POSITION].count; tris += n / 3;
    [p.indices, ...Object.values(p.attributes)].forEach(k => { if (k != null && !seen.has(k)) { seen.add(k); meshBytes += accBytes(k); } });
  }));
  let animBytes = 0;
  const clips = (j.animations || []).map(a => {
    let len = 0; const ks = new Set();
    a.samplers.forEach(s => { len = Math.max(len, acc[s.input].max ? acc[s.input].max[0] : 0); [s.input, s.output].forEach(k => ks.add(k)); });
    ks.forEach(k => { if (!seen.has(k)) { seen.add(k); animBytes += accBytes(k); } });
    return { name: a.name, seconds: +len.toFixed(2), channels: a.channels.length };
  });
  const imgBytes = (j.images || []).reduce((s, im) => s + (im.bufferView != null ? views[im.bufferView].byteLength : 0), 0);
  const px = im => {
    if (im.bufferView == null) return '?';
    const v = views[im.bufferView], o = 20 + jlen + 8 + (v.byteOffset || 0);
    if (im.mimeType === 'image/png') return b.readUInt32BE(o + 16) + 'x' + b.readUInt32BE(o + 20);
    if (im.mimeType === 'image/webp' && b.toString('ascii', o + 12, o + 16) === 'VP8X') return (1 + b.readUIntLE(o + 24, 3)) + 'x' + (1 + b.readUIntLE(o + 27, 3));
    if (im.mimeType === 'image/webp' && b.toString('ascii', o + 12, o + 16) === 'VP8 ') return (b.readUInt16LE(o + 26) & 0x3fff) + 'x' + (b.readUInt16LE(o + 28) & 0x3fff);
    if (im.mimeType === 'image/webp' && b.toString('ascii', o + 12, o + 16) === 'VP8L') { const x = b.readUInt32LE(o + 21); return ((x & 0x3fff) + 1) + 'x' + (((x >> 14) & 0x3fff) + 1); }
    return im.mimeType;
  };
  return {
    file, mb: +(b.length / 1e6).toFixed(2),
    triangles: Math.round(tris), meshMB: +(meshBytes / 1e6).toFixed(2),
    joints: (j.skins || []).map(s => s.joints.length),
    materials: (j.materials || []).map(m => m.name + ' [' + [m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture && 'color', m.pbrMetallicRoughness && m.pbrMetallicRoughness.metallicRoughnessTexture && 'mr', m.normalTexture && 'normal', m.occlusionTexture && 'ao', m.emissiveTexture && 'emissive'].filter(Boolean).join(',') + ']'),
    images: (j.images || []).map(im => (im.name || '') + ' ' + px(im) + ' ' + ((views[im.bufferView] || {}).byteLength / 1e6 || 0).toFixed(2) + 'MB'),
    imageMB: +(imgBytes / 1e6).toFixed(2), animMB: +(animBytes / 1e6).toFixed(2),
    extensions: j.extensionsUsed || [],
    clips,
  };
}

if (require.main === module) {
  for (const f of process.argv.slice(2)) console.log(JSON.stringify(inspect(f), null, 1));
}
module.exports = inspect;

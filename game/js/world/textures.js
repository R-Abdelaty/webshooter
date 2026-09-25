(function (root) {
  'use strict';
  // Every texture in the city is drawn here on a canvas at load time: facades
  // with windows, shop fronts, paving, asphalt, grass, bricks, a water normal
  // map and cloud puffs. Nothing is downloaded.
  //
  // Facades and shop fronts carry a mask in their alpha channel - 1 for wall,
  // 0 for glass - so the facade shader can tint the wall with the building's
  // colour and leave the windows alone (or, for glass towers, the reverse).
  // Canvas alpha is premultiplied and would wipe the colour of fully
  // transparent pixels, so those are packed into a DataTexture instead.

  var T = root.THREE;

  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function c(v) { return Math.max(0, Math.min(255, Math.round(v * k))); }
    return 'rgb(' + c(r) + ',' + c(g) + ',' + c(b) + ')';
  }

  // A colour canvas and a mask canvas drawn in step; wall() and glass() paint
  // both at once.
  function painter(w, h) {
    var col = canvas(w, h), msk = canvas(w, h), c = col.getContext('2d'), m = msk.getContext('2d');
    m.fillStyle = '#fff'; m.fillRect(0, 0, w, h);
    return {
      c: c, w: w, h: h,
      wall: function (x, y, ww, hh, color) { c.fillStyle = color; c.fillRect(x, y, ww, hh); m.fillStyle = '#fff'; m.fillRect(x, y, ww, hh); },
      glass: function (x, y, ww, hh, color) { c.fillStyle = color; c.fillRect(x, y, ww, hh); m.fillStyle = '#000'; m.fillRect(x, y, ww, hh); },
      // Pack colour + mask, flipping rows so v=0 is the bottom of the drawing.
      texture: function () {
        var a = c.getImageData(0, 0, w, h).data, b = m.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 4), y, x, s, d;
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          s = ((h - 1 - y) * w + x) * 4; d = (y * w + x) * 4;
          out[d] = a[s]; out[d + 1] = a[s + 1]; out[d + 2] = a[s + 2]; out[d + 3] = b[s];
        }
        var t = new T.DataTexture(out, w, h, T.RGBAFormat);
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true;
        t.colorSpace = T.SRGBColorSpace; t.needsUpdate = true;
        return t;
      }
    };
  }

  function canvasTexture(c, repeat) {
    var t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    if (repeat) t.repeat.set(repeat, repeat);
    return t;
  }

  function glassColor(r, base) {
    var k = .75 + r() * .5;
    return shade(base || '#4a5c70', k);
  }

  // 8 bays by 8 floors, 64 px per cell. The shader maps one tile to
  // 8 x bay metres wide and 8 x floor metres tall for the building type.
  var CELL = 64, N = 8;
  function facade(type, seed) {
    var p = painter(CELL * N, CELL * N), r = rng(seed), c = p.c, i, j, x, y;
    if (type === 'brick') {
      p.wall(0, 0, p.w, p.h, '#d9cfc6');
      // Brick courses: a few px each, mortar between, bricks varying a little.
      for (y = 0; y < p.h; y += 4) for (x = (y / 4) % 2 ? -6 : 0; x < p.w; x += 12) {
        c.fillStyle = shade('#ddd2c8', .86 + r() * .22); c.fillRect(x, y, 11, 3);
      }
      for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
        x = i * CELL; y = j * CELL;
        p.glass(x + 20, y + 6, 24, 3, '#e9e4dc');                  // stone lintel
        p.glass(x + 21, y + 11, 22, 38, '#f2efe8');                // white frame
        var g = glassColor(r);
        p.glass(x + 23, y + 13, 18, 16, g); p.glass(x + 23, y + 31, 18, 16, shade('#4a5c70', .8 + r() * .4));
        if (r() < .3) p.glass(x + 23, y + 13, 18, 6 + r() * 10, shade('#d9cdb4', .8 + r() * .3));   // blinds
        if (r() < .08) p.glass(x + 24, y + 40, 16, 8, '#c9cbc8');   // a window AC unit
        p.glass(x + 19, y + 49, 26, 3, '#e3ded4');                 // sill
      }
    } else if (type === 'sandstone') {
      p.wall(0, 0, p.w, p.h, '#ece5d8');
      for (y = 0; y < p.h; y += 8) { c.fillStyle = 'rgba(120,100,70,.10)'; c.fillRect(0, y, p.w, 1); }
      for (j = 0; j < N; j++) {
        c.fillStyle = 'rgba(90,70,40,.18)'; c.fillRect(0, j * CELL + 58, p.w, 3);   // a cornice line per floor
        for (i = 0; i < N; i++) {
          x = i * CELL; y = j * CELL;
          p.glass(x + 16, y + 10, 32, 42, shade('#8b8375', 1));
          p.glass(x + 18, y + 12, 13, 38, glassColor(r, '#44566a'));
          p.glass(x + 33, y + 12, 13, 38, glassColor(r, '#44566a'));
          if (r() < .25) p.glass(x + 18, y + 12, 28, 8 + r() * 12, shade('#e6dcc4', .85 + r() * .2));
        }
      }
    } else if (type === 'office') {
      p.wall(0, 0, p.w, p.h, '#dedcd8');
      for (j = 0; j < N; j++) {
        y = j * CELL;
        for (i = 0; i < N; i++) {
          x = i * CELL;
          p.glass(x + 7, y + 16, 50, 40, glassColor(r, '#3f5266'));
          c.fillStyle = 'rgba(255,255,255,.10)'; c.fillRect(x + 7, y + 16, 50, 8);
          p.glass(x + 31, y + 16, 2, 40, '#6d747a');
        }
      }
    } else {
      // Curtain wall: glass everywhere, thin mullions, a darker spandrel per
      // floor. The glass itself carries the tower's tint.
      p.wall(0, 0, p.w, p.h, '#3a3f45');
      for (j = 0; j < N; j++) for (i = 0; i < N * 2; i++) {
        x = i * 32; y = j * CELL;
        var k = .8 + r() * .35, grad = c.createLinearGradient(0, y, 0, y + CELL);
        grad.addColorStop(0, shade('#d4e0ea', k)); grad.addColorStop(1, shade('#8ea3b6', k));
        p.glass(x + 1, y + 1, 30, 46, grad);
        p.glass(x + 1, y + 49, 30, 13, shade('#5d6d7c', .9 + r() * .2));
      }
    }
    return p.texture();
  }

  // The ground floor: shops, glass fronts, signs, and piers in the wall colour.
  // 512 x 64 px across 24 m, so the pattern repeats every 24 m.
  function shopfront(seed) {
    var p = painter(512, 64), r = rng(seed), x = 0, signs = ['#b23a2e', '#23553b', '#1f3b63', '#1b1b1b', '#7a4b2a', '#c79a2a'];
    p.wall(0, 0, 512, 64, '#cfc8bd');
    while (x < 512) {
      var w = 96 + Math.floor(r() * 64); if (512 - (x + w) < 60) w = 512 - x;
      p.wall(x, 0, 8, 64, '#cfc8bd');
      p.glass(x + 8, 4, w - 16, 12, signs[Math.floor(r() * signs.length)]);   // sign band
      p.glass(x + 8, 18, w - 16, 46, '#2a3440');
      p.c.fillStyle = 'rgba(255,255,255,.12)'; p.c.fillRect(x + 8, 18, w - 16, 10);
      p.glass(x + 8 + (w - 16) / 2 - 7, 30, 14, 34, '#1a1f26');             // door
      x += w;
    }
    return p.texture();
  }

  function noiseCanvas(size, base, spread, seed, speckle) {
    var c = canvas(size, size), g = c.getContext('2d'), r = rng(seed), i;
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    for (i = 0; i < size * size / (speckle || 6); i++) {
      g.fillStyle = shade(base, 1 + (r() - .5) * spread);
      g.fillRect(Math.floor(r() * size), Math.floor(r() * size), 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2));
    }
    return c;
  }

  function asphalt() { return canvasTexture(noiseCanvas(256, '#6a6b6d', .3, 11, 3)); }
  function dirt() { return canvasTexture(noiseCanvas(256, '#8a7658', .35, 17, 3)); }

  function paving() {
    var c = noiseCanvas(256, '#b9b4ab', .18, 12, 4), g = c.getContext('2d');
    g.fillStyle = 'rgba(60,55,50,.35)';
    for (var i = 0; i < 256; i += 64) { g.fillRect(i, 0, 2, 256); g.fillRect(0, i, 256, 2); }
    return canvasTexture(c);
  }

  function grass() {
    var c = canvas(256, 256), g = c.getContext('2d'), r = rng(13), i;
    g.fillStyle = '#6f7f3a'; g.fillRect(0, 0, 256, 256);
    var tones = ['#5f7132', '#7d8c42', '#8c8a3e', '#66763a', '#9a8a44'];
    for (i = 0; i < 9000; i++) { g.fillStyle = tones[Math.floor(r() * tones.length)]; g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 2); }
    // A scatter of fallen leaves.
    var leaves = ['#c8732a', '#b5432a', '#d9a531'];
    for (i = 0; i < 500; i++) { g.fillStyle = leaves[Math.floor(r() * 3)]; g.fillRect(r() * 256, r() * 256, 2, 2); }
    return canvasTexture(c);
  }

  function bricks() {
    var c = canvas(128, 128), g = c.getContext('2d'), r = rng(14), x, y;
    g.fillStyle = '#9a8a7c'; g.fillRect(0, 0, 128, 128);
    for (y = 0; y < 128; y += 8) for (x = (y / 8) % 2 ? -8 : 0; x < 128; x += 16) {
      g.fillStyle = shade('#a8452f', .8 + r() * .35); g.fillRect(x + 1, y + 1, 15, 6);
    }
    return canvasTexture(c);
  }

  function plywood() {
    var c = noiseCanvas(128, '#bf9f6c', .2, 15, 5), g = c.getContext('2d');
    g.fillStyle = 'rgba(80,60,30,.35)'; for (var x = 0; x < 128; x += 64) g.fillRect(x, 0, 2, 128);
    return canvasTexture(c);
  }

  function concrete() { return canvasTexture(noiseCanvas(128, '#a9a8a3', .22, 16, 4)); }

  // A tileable normal map from a sum of sines with whole-number frequencies,
  // so its edges meet.
  function waterNormals() {
    var S = 256, c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), x, y, TAU = Math.PI * 2;
    var waves = [[3, 1, .9, 0], [1, 4, .7, 1.3], [5, -2, .5, 2.1], [-4, 6, .35, .4], [9, 3, .2, 1.7], [2, -11, .15, 2.9]];
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var dx = 0, dy = 0;
      waves.forEach(function (w) {
        var ph = TAU * (w[0] * x / S + w[1] * y / S) + w[3], k = Math.cos(ph) * w[2] * TAU;
        dx += k * w[0]; dy += k * w[1];
      });
      var nx = -dx * .02, ny = -dy * .02, nz = 1, l = Math.sqrt(nx * nx + ny * ny + nz * nz), o = (y * S + x) * 4;
      img.data[o] = (nx / l * .5 + .5) * 255; img.data[o + 1] = (ny / l * .5 + .5) * 255;
      img.data[o + 2] = (nz / l * .5 + .5) * 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }

  // A cumulus puff: a cluster of soft discs, flatter on the bottom.
  function cloud(seed) {
    var c = canvas(256, 128), g = c.getContext('2d'), r = rng(seed), i;
    for (i = 0; i < 22; i++) {
      var x = 40 + r() * 176, y = 50 + r() * 40 - (Math.abs(x - 128) < 50 ? r() * 25 : 0), rad = 18 + r() * 26;
      var grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,.9)'); grad.addColorStop(.6, 'rgba(248,250,252,.55)'); grad.addColorStop(1, 'rgba(240,244,248,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    // Shade the underside a touch so it reads as a volume.
    g.globalCompositeOperation = 'source-atop';
    var under = g.createLinearGradient(0, 40, 0, 110);
    under.addColorStop(0, 'rgba(0,0,0,0)'); under.addColorStop(1, 'rgba(90,105,125,.35)');
    g.fillStyle = under; g.fillRect(0, 0, 256, 128);
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  root.WorldTextures = { facade: facade, shopfront: shopfront, asphalt: asphalt, dirt: dirt, paving: paving, grass: grass,
    bricks: bricks, plywood: plywood, concrete: concrete, waterNormals: waterNormals, cloud: cloud };
})(window);

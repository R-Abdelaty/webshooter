(function (root) {
  'use strict';
  // The graphics setting (Settings -> GRAPHICS): what each of LOW, MED and
  // HIGH turns on, and the sums that go with it. No Three.js; world.js and
  // world-game.js apply it.
  //
  //   LOW   no post chain (the canvas's own antialiasing), about 720p worth of
  //         pixels, a small shadow map the villains don't cast into - a blob
  //         under them instead - and half the hit particles. For integrated
  //         GPUs.
  //   MED   the default. The post chain: bloom (glowing eyes, sparks, impact
  //         flashes and the sun), the colour grade, FXAA. 1080p worth of
  //         pixels, villains cast real shadows.
  //   HIGH  MED plus SSAO, SMAA instead of FXAA, the screen's full pixel
  //         density (up to 1440p worth) and a bigger shadow map.

  var TIERS = {
    low: { name: 'low', pixels: 1280, shadow: 1024, post: false, bloom: false, grade: false, ssao: false, aa: 'msaa',
      cast: false, blob: true, env: 64, particles: .5 },
    med: { name: 'med', pixels: 1920, shadow: 2048, post: true, bloom: true, grade: true, ssao: false, aa: 'fxaa',
      cast: true, blob: false, env: 128, particles: 1 },
    high: { name: 'high', pixels: 2560, shadow: 4096, post: true, bloom: true, grade: true, ssao: true, aa: 'smaa',
      cast: true, blob: false, env: 256, particles: 1 }
  };
  var DEFAULT = 'med';
  var MIN_RATIO = .5;          // never render at less than half the CSS pixels

  // The settings for a tier by name (anything unknown is MED), as a copy.
  function tier(name) {
    var t = TIERS[String(name || '').toLowerCase()] || TIERS[DEFAULT];
    return Object.assign({}, t);
  }

  // The pixel ratio to render at for a canvas `cssWidth` CSS pixels wide on a
  // screen of device pixel ratio `dpr`: at most the tier's pixel width, and
  // never more than the screen has.
  function pixelRatio(t, cssWidth, dpr) {
    var d = dpr > 0 ? dpr : 1, w = cssWidth > 0 ? cssWidth : 1;
    return Math.max(Math.min(MIN_RATIO, d), Math.min(d, t.pixels / w));
  }

  // The following shadow's box: centred on the player while roaming; in a
  // fight, on the villain's stretch of the city (Encounters.focus), sized to
  // fit it, so his shadow gets the map's texels rather than the whole block.
  var SHADOW = { ROAM: 90, MIN: 24, MAX: 90, PAD: 8 };
  function shadowBox(eye, focus) {
    if (!focus) return { x: eye.x, y: eye.y, z: eye.z, half: SHADOW.ROAM };
    var half = Math.max(SHADOW.MIN, Math.min(SHADOW.MAX, focus.r + SHADOW.PAD));
    return { x: focus.x, y: focus.y, z: focus.z, half: half };
  }
  // Metres per shadow texel for a box and a tier.
  function texel(box, t) { return box.half * 2 / t.shadow; }

  var api = { TIERS: TIERS, DEFAULT: DEFAULT, SHADOW: SHADOW, tier: tier, pixelRatio: pixelRatio, shadowBox: shadowBox, texel: texel,
    names: function () { return Object.keys(TIERS); } };
  if (typeof module !== 'undefined') module.exports = api;
  root.Gfx = api;
})(typeof window === 'undefined' ? globalThis : window);

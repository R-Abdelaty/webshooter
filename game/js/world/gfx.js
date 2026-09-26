(function (root) {
  'use strict';
  // The graphics setting (Settings -> GRAPHICS): what LOW and MED each turn
  // on, and the sums that go with it. No Three.js; world.js and
  // world-game.js apply it.
  //
  //   LOW   about 720p worth of pixels, a small shadow map the villains
  //         don't cast into - a blob under them instead - and half the hit
  //         particles. The city ends at 1.5 km in a thicker haze, and there
  //         are half the cars and walkers, drawn nearer. For a weak
  //         integrated GPU, or a big screen.
  //   MED   the default, for an integrated GPU at 1080p: 1080p worth of
  //         pixels, villains cast real shadows, the city reaches 3.2 km.
  //
  // Both have the colour grade (it is part of the tone mapping, so it is
  // free) and the canvas's own MSAA. There is no post chain: Session C4's
  // HIGH setting (SSAO, bloom, SMAA) ran at 20 fps on this laptop's
  // integrated GPU and the user removed it.
  //
  //   far, fog      the camera's far plane (m) and the haze's density; the
  //                 haze hides the far plane
  //   cars, people  how many of the city's cars and walkers exist (a share,
  //                 Traffic's rank), how far away they are drawn (m) and at
  //                 most how many at once; the traffic casts shadows where
  //                 `cast` is on

  var TIERS = {
    low: { name: 'low', pixels: 1280, shadow: 1024, grade: true, cast: false, blob: true, env: 64, particles: .5,
      far: 1500, fog: .00125,
      cars: { density: .5, range: 260, max: 110 }, people: { density: .5, range: 110, max: 70 } },
    med: { name: 'med', pixels: 1920, shadow: 2048, grade: true, cast: true, blob: false, env: 128, particles: 1,
      far: 3200, fog: .00068,
      cars: { density: 1, range: 380, max: 240 }, people: { density: 1, range: 170, max: 170 } }
  };
  var DEFAULT = 'med';
  var MIN_RATIO = .5;          // never render at less than half the CSS pixels

  // The settings for a tier by name (anything unknown - including a HIGH
  // saved before it was removed - is MED), as a copy.
  function tier(name) {
    var t = TIERS[String(name || '').toLowerCase()] || TIERS[DEFAULT];
    return JSON.parse(JSON.stringify(t));
  }
  // How much of what is at distance d the haze lets through (1 clear, 0
  // gone), for FogExp2 of density `fog`.
  function clarity(d, fog) { return Math.exp(-Math.pow(fog * d, 2)); }

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

  var api = { TIERS: TIERS, DEFAULT: DEFAULT, SHADOW: SHADOW, tier: tier, pixelRatio: pixelRatio, shadowBox: shadowBox, texel: texel, clarity: clarity,
    names: function () { return Object.keys(TIERS); } };
  if (typeof module !== 'undefined') module.exports = api;
  root.Gfx = api;
})(typeof window === 'undefined' ? globalThis : window);

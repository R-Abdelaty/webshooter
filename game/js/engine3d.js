/* engine3d.js - a small 3D renderer that draws onto a 2D canvas.
 *
 * There is no WebGL and no library here, because none is needed. All that
 * "3D" really means is:
 *
 *   1. Every point has an x, y and z. z is how far away it is.
 *   2. To put a 3D point on a flat screen you divide x and y by z. Things
 *      far away have a big z, so they shrink. That is perspective, and it
 *      is the whole trick (see project() below).
 *   3. Draw the far things first and the near things last, so near things
 *      cover far ones. That is the painter's algorithm.
 *
 * Steps 1-3 give you correct 3D that still looks flat. What actually sells
 * solidity is the shading, and there are four cues here doing that work:
 *
 *   diffuse   a surface turned away from the light is darker
 *   gradient  each panel is filled with a gradient running along the light
 *             direction, so even one flat face has a sense of curve
 *   specular  surfaces angled between you and the light get a hot highlight
 *   fog       distant things fade toward the haze colour of the sky, which
 *             is the strongest depth cue the eye has
 *
 * Coordinates: +x right, +y up, +z into the screen (away from you).
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------ vectors

  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scl(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return scl(a, 1 / l); }

  function matVec(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
  }

  function matMul(a, b) {
    var o = new Array(9);
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
      }
    }
    return o;
  }

  function ident() { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }

  // ------------------------------------------------------------ colour

  function clamp255(n) { return n < 0 ? 0 : n > 255 ? 255 : n | 0; }

  function css(rgb) {
    return 'rgb(' + clamp255(rgb[0]) + ',' + clamp255(rgb[1]) + ',' + clamp255(rgb[2]) + ')';
  }

  function mul(rgb, k) { return [rgb[0] * k, rgb[1] * k, rgb[2] * k]; }

  function lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  // The sun: a direction, not a place.
  var LIGHT = norm([-0.48, 0.74, -0.47]);
  var VIEW = [0, 0, -1];                       // towards the camera
  var HALF = norm(add(LIGHT, VIEW));           // for the specular highlight
  var AMBIENT = 0.34;

  // ------------------------------------------------------------ scene

  function Scene(ctx, w, h, cam) {
    this.ctx = ctx;
    this.w = w;
    this.h = h;
    this.cam = cam || { yaw: 0, pitch: 0, fov: 620, pos: [0, 0, 0] };
    this.cy = this.cam.cy != null ? this.cam.cy : h / 2;
    this.items = [];
    this.fog = null;

    // Rotating the world by the negative of the camera angles is the same as
    // rotating the camera, and much easier to write.
    this.view = matMul(rotX(-this.cam.pitch), rotY(-this.cam.yaw));

    // Which way the light runs across the screen. Panel gradients follow it,
    // so every surface is lit consistently.
    var lv = matVec(this.view, LIGHT);
    var l2 = Math.hypot(lv[0], lv[1]) || 1;
    this.lightScreen = [lv[0] / l2, -lv[1] / l2];
  }

  /* Distant things fade into the haze. near = untouched, far = fully hazed. */
  Scene.prototype.setFog = function (rgb, near, far) {
    this.fog = { rgb: rgb, near: near, far: far };
    return this;
  };

  Scene.prototype.fogMix = function (rgb, z) {
    if (!this.fog) return rgb;
    var t = (z - this.fog.near) / (this.fog.far - this.fog.near);
    if (t <= 0) return rgb;
    return lerp(rgb, this.fog.rgb, t > 1 ? 1 : t);
  };

  /* World point -> screen point. Returns null if it is behind the camera. */
  Scene.prototype.project = function (p) {
    var q = matVec(this.view, sub(p, this.cam.pos));
    if (q[2] < 0.25) return null;
    var s = this.cam.fov / q[2];
    return { x: this.w / 2 + q[0] * s, y: this.cy - q[1] * s, s: s, z: q[2] };
  };

  Scene.prototype.push = function (depth, fn) { this.items.push({ z: depth, fn: fn }); };

  /* How lit a surface with this normal is, and how hot its highlight. */
  function lighting(n) {
    var d = dot(n, LIGHT);
    var k = AMBIENT + (1 - AMBIENT) * (d > 0 ? d : 0);
    var s = dot(n, HALF);
    return { k: k, spec: s > 0 ? Math.pow(s, 22) : 0 };
  }

  /* Shared filler for flat polygons: builds the path, then paints it with a
     gradient running along the screen light direction plus a specular hit. */
  Scene.prototype.fillPoly = function (pts, rgb, opt) {
    var ctx = this.ctx, i;
    var cx = 0, cy = 0;
    for (i = 0; i < pts.length; i++) { cx += pts[i].x; cy += pts[i].y; }
    cx /= pts.length; cy /= pts.length;

    var rad = 0;
    for (i = 0; i < pts.length; i++) {
      var d = Math.hypot(pts[i].x - cx, pts[i].y - cy);
      if (d > rad) rad = d;
    }
    rad = Math.max(rad, 0.6);

    var lit = lighting(opt.normal || [0, 0, -1]);
    var k = opt.emissive ? 1 : lit.k * (opt.tint || 1);
    var base = this.fogMix(rgb, opt.depth);

    var lx = this.lightScreen[0], ly = this.lightScreen[1];
    var g = null;
    if (!opt.flat && rad > 2.5) {
      g = ctx.createLinearGradient(cx + lx * rad, cy + ly * rad,
                                   cx - lx * rad, cy - ly * rad);
      g.addColorStop(0, css(mul(base, k * 1.22)));
      g.addColorStop(0.55, css(mul(base, k)));
      g.addColorStop(1, css(mul(base, k * 0.7)));
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();

    if (opt.glow) { ctx.shadowColor = css(mul(base, 1.2)); ctx.shadowBlur = opt.glow; }
    ctx.fillStyle = opt.css || g || css(mul(base, k));
    ctx.fill();
    ctx.shadowBlur = 0;

    // specular: a soft white wash on the lit side
    if (!opt.emissive && lit.spec > 0.02 && rad > 3) {
      var sg = ctx.createLinearGradient(cx + lx * rad, cy + ly * rad, cx, cy);
      sg.addColorStop(0, 'rgba(255,255,255,' + (lit.spec * 0.5).toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fill();
    }

    if (opt.edge) {
      ctx.strokeStyle = opt.edge;
      ctx.lineWidth = Math.max(0.4, (opt.edgeWidth || 1) * (rad / 26));
      ctx.stroke();
    }
  };

  Scene.prototype.quad = function (p0, p1, p2, p3, rgb, opt) {
    opt = opt || {};
    var a = this.project(p0), b = this.project(p1),
        c = this.project(p2), d = this.project(p3);
    if (!a || !b || !c || !d) return;

    var area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    // Projection flips Y, so outward-facing polygons have positive area.
    if (!opt.twoSided && area <= 0) return;

    var depth = (a.z + b.z + c.z + d.z) / 4;
    var o = Object.create(opt);
    o.depth = depth;
    if (opt.twoSided && area < 0 && opt.normal) o.normal = scl(opt.normal, -1);

    var self = this, pts = [a, b, c, d];
    this.push(depth, function () { self.fillPoly(pts, rgb, o); });
  };

  /* Triangles, for horns, claws, wings and anything that tapers to a point. */
  Scene.prototype.tri = function (p0, p1, p2, rgb, opt) {
    opt = opt || {};
    var a = this.project(p0), b = this.project(p1), c = this.project(p2);
    if (!a || !b || !c) return;

    var area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (!opt.twoSided && area <= 0) return;

    var depth = (a.z + b.z + c.z) / 3;
    var o = Object.create(opt);
    o.depth = depth;
    if (opt.twoSided && area < 0 && opt.normal) o.normal = scl(opt.normal, -1);

    var self = this, pts = [a, b, c];
    this.push(depth, function () { self.fillPoly(pts, rgb, o); });
  };

  /* A solid box: six panels with their outward normals, so it shades itself
     correctly however it is turned. */
  Scene.prototype.box = function (center, size, rot, rgb, opt) {
    opt = opt || {};
    var hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
    var R = rot || ident();

    var c = [];
    for (var i = 0; i < 8; i++) {
      c.push(add(center, matVec(R, [(i & 1) ? hx : -hx, (i & 2) ? hy : -hy, (i & 4) ? hz : -hz])));
    }

    var faces = [
      [0, 2, 3, 1, [0, 0, -1]],
      [4, 5, 7, 6, [0, 0, 1]],
      [0, 4, 6, 2, [-1, 0, 0]],
      [1, 3, 7, 5, [1, 0, 0]],
      [0, 1, 5, 4, [0, -1, 0]],
      [2, 6, 7, 3, [0, 1, 0]]
    ];

    for (var f = 0; f < 6; f++) {
      var q = faces[f];
      this.quad(c[q[0]], c[q[1]], c[q[2]], c[q[3]], rgb, {
        normal: matVec(R, q[4]),
        edge: opt.edge, edgeWidth: opt.edgeWidth,
        tint: opt.tint, glow: opt.glow, emissive: opt.emissive, flat: opt.flat
      });
    }
  };

  /* A ball. A radial gradient with the highlight offset towards the light
     reads as a sphere at any size we need, for a fraction of the cost of
     an actual mesh. */
  Scene.prototype.sphere = function (center, r, rgb, opt) {
    opt = opt || {};
    var p = this.project(center);
    if (!p) return;
    var rad = r * p.s;
    if (rad < 0.4) return;

    var ctx = this.ctx;
    var base = this.fogMix(rgb, p.z);
    var lx = this.lightScreen[0], ly = this.lightScreen[1];
    var hi = css(mul(base, opt.emissive ? 1.45 : 1.5));
    var mid = css(mul(base, opt.emissive ? 1.05 : 0.9));
    var lo = css(mul(base, opt.emissive ? 0.8 : AMBIENT * 0.75));

    this.push(p.z, function () {
      var g = ctx.createRadialGradient(
        p.x + lx * rad * 0.42, p.y + ly * rad * 0.42, rad * 0.05,
        p.x, p.y, rad);
      g.addColorStop(0, hi);
      g.addColorStop(0.45, mid);
      g.addColorStop(1, lo);
      if (opt.glow) { ctx.shadowColor = hi; ctx.shadowBlur = opt.glow; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  };

  /* A tapering limb between two points. */
  Scene.prototype.rod = function (a, b, wa, wb, rgb, opt) {
    opt = opt || {};
    var pa = this.project(a), pb = this.project(b);
    if (!pa || !pb) return;
    var ctx = this.ctx;
    var base = this.fogMix(rgb, (pa.z + pb.z) / 2);
    var lx = this.lightScreen[0], ly = this.lightScreen[1];

    var dx = pb.x - pa.x, dy = pb.y - pa.y;
    var l = Math.hypot(dx, dy) || 1;
    var nx = -dy / l, ny = dx / l;
    var ra = Math.max(0.5, wa * pa.s), rb = Math.max(0.5, wb * pb.s);

    // Light the limb by how its cross-section faces the light, which makes
    // it read as round rather than as a flat ribbon.
    var side = nx * lx + ny * ly;

    this.push((pa.z + pb.z) / 2, function () {
      ctx.beginPath();
      ctx.moveTo(pa.x + nx * ra, pa.y + ny * ra);
      ctx.lineTo(pb.x + nx * rb, pb.y + ny * rb);
      ctx.lineTo(pb.x - nx * rb, pb.y - ny * rb);
      ctx.lineTo(pa.x - nx * ra, pa.y - ny * ra);
      ctx.closePath();

      var g = ctx.createLinearGradient(
        pa.x + nx * ra * side, pa.y + ny * ra * side,
        pa.x - nx * ra * side, pa.y - ny * ra * side);
      g.addColorStop(0, css(mul(base, 1.3)));
      g.addColorStop(0.5, css(mul(base, 0.92)));
      g.addColorStop(1, css(mul(base, 0.55)));

      if (opt.glow) { ctx.shadowColor = css(mul(base, 1.2)); ctx.shadowBlur = opt.glow; }
      ctx.fillStyle = opt.css || (ra > 1.5 ? g : css(mul(base, 0.95)));
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  };

  /* Soft blob for glows, smoke and contact shadows. */
  Scene.prototype.blob = function (center, r, cssColor, depthBias) {
    var p = this.project(center);
    if (!p) return;
    var rad = r * p.s;
    var ctx = this.ctx;
    this.push(p.z + (depthBias || 0), function () {
      var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
      g.addColorStop(0, cssColor);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    });
  };

  /* Far things first, near things last. */
  Scene.prototype.flush = function () {
    this.items.sort(function (a, b) { return b.z - a.z; });
    for (var i = 0; i < this.items.length; i++) this.items[i].fn();
    this.items.length = 0;
  };

  global.E3 = {
    Scene: Scene,
    add: add, sub: sub, scl: scl, dot: dot, len: len, norm: norm,
    ident: ident, rotX: rotX, rotY: rotY, rotZ: rotZ,
    matMul: matMul, matVec: matVec, css: css, mul: mul, lerp: lerp
  };
})(window);

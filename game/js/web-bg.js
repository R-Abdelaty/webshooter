/* web-bg.js - draws the spider web.
 *
 * A real orb web is just two things: straight spokes out from the centre, and
 * a spiral of silk strung between them that sags inward under its own weight.
 * That is all this does - and because it is SVG it stays razor sharp at any
 * screen size, and the same function can stamp little webs on the screen when
 * the wrist unit fires.
 */
(function (global) {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function polar(cx, cy, r, a) {
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  /* Build one web as an <svg> element.
   *
   *   spokes  how many straight radials
   *   rings   how many strands of spiral
   *   growth  each ring is this much further out than the last (a real web
   *           spaces them wider as it goes, which is why >1 looks right)
   *   sag     0.9 means the strand between two spokes dips to 90% of the
   *           ring radius at its midpoint
   */
  function makeWeb(o) {
    o = o || {};
    var w = o.w || 1600,
        h = o.h || 1000,
        cx = o.cx != null ? o.cx : w / 2,
        cy = o.cy != null ? o.cy : h / 2,
        spokes = o.spokes || 18,
        rings = o.rings || 15,
        r0 = o.r0 || 5,
        growth = o.growth || 1.45,
        sag = o.sag != null ? o.sag : 0.9,
        color = o.color || '#ffffff',
        swScale = o.swScale != null ? o.swScale : 0.021,
        swMin = o.swMin != null ? o.swMin : 0.7,
        swMax = o.swMax != null ? o.swMax : 14,
        rot = o.rot != null ? o.rot : -Math.PI / 2,
        gaps = o.gaps || 0;          // 0..1, chance a strand is missing

    var svg = el('svg', {
      viewBox: '0 0 ' + w + ' ' + h,
      preserveAspectRatio: o.slice === false ? 'xMidYMid meet' : 'xMidYMid slice'
    });

    var step = (Math.PI * 2) / spokes;
    var outer = r0 * Math.pow(growth, rings);

    var g = el('g', {
      fill: 'none',
      stroke: color,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    });

    // spokes
    for (var i = 0; i < spokes; i++) {
      var a = rot + i * step;
      var p = polar(cx, cy, outer, a);
      g.appendChild(el('line', {
        x1: cx, y1: cy, x2: p[0], y2: p[1],
        'stroke-width': Math.min(swMax, Math.max(swMin, outer * swScale * 0.55))
      }));
    }

    // spiral strands, ring by ring
    for (var k = 1; k <= rings; k++) {
      var r = r0 * Math.pow(growth, k);
      var sw = Math.min(swMax, Math.max(swMin, r * swScale));
      var half = step / 2;

      // A quadratic curve sits at 0.25*p0 + 0.5*ctrl + 0.25*p1 when halfway
      // along, so to make the midpoint land at radius r*sag the control point
      // has to sit further out than that. This is that solved for rc.
      var rc = r * (2 * sag - Math.cos(half));

      for (var j = 0; j < spokes; j++) {
        if (gaps && Math.random() < gaps) continue;

        var a0 = rot + j * step,
            a1 = a0 + step,
            am = a0 + half;

        var p0 = polar(cx, cy, r, a0),
            p1 = polar(cx, cy, r, a1),
            pc = polar(cx, cy, rc, am);

        g.appendChild(el('path', {
          d: 'M' + p0[0].toFixed(1) + ',' + p0[1].toFixed(1) +
             'Q' + pc[0].toFixed(1) + ',' + pc[1].toFixed(1) +
             ' ' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1),
          'stroke-width': sw.toFixed(2)
        }));
      }
    }

    svg.appendChild(g);
    return svg;
  }

  /* Faint honeycomb, the texture sitting under the strands in the artwork. */
  function honeycomb(w, h) {
    var svg = el('svg', { viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'none' });
    var defs = el('defs', {});
    var R = 16, tw = Math.sqrt(3) * R, th = 3 * R;

    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = (-90 + i * 60) * Math.PI / 180;
      pts.push((R * Math.cos(a)).toFixed(2) + ',' + (R * Math.sin(a)).toFixed(2));
    }
    var hex = pts.join(' ');

    var pat = el('pattern', {
      id: 'hive', width: tw, height: th, patternUnits: 'userSpaceOnUse'
    });
    [[tw / 2, R / 2], [0, R * 2], [tw, R * 2]].forEach(function (c) {
      pat.appendChild(el('polygon', {
        points: hex,
        transform: 'translate(' + c[0].toFixed(2) + ',' + c[1].toFixed(2) + ')',
        fill: 'none',
        stroke: '#000',
        'stroke-width': 2,
        opacity: 0.16
      }));
    });

    defs.appendChild(pat);
    svg.appendChild(defs);
    svg.appendChild(el('rect', { width: w, height: h, fill: 'url(#hive)' }));
    return svg;
  }

  /* Fill #bg. If the user dropped their own artwork at assets/web-bg.png we
     use that instead and skip the drawing entirely. */
  function mount(nodeId) {
    var host = document.getElementById(nodeId || 'bg');
    if (!host) return;

    var probe = new Image();
    probe.onload = function () { host.appendChild(probe); };
    probe.onerror = function () {
      host.appendChild(honeycomb(1600, 1000));
      host.appendChild(makeWeb({ w: 1600, h: 1000, spokes: 18, rings: 15 }));
    };
    probe.src = 'assets/web-bg.png';
  }

  global.WebBG = { makeWeb: makeWeb, mount: mount };
})(window);

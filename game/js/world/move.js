(function (root) {
  'use strict';
  // Movement for the 3D world goes through this one interface, so the game
  // never asks *where* movement came from. Today the only source is the
  // keyboard, for testing at a desk; the analog stick on the shooter will be a
  // second source added with addSource(), without the game changing at all.
  //
  //   vector()  -> { x, z }  strafe (right +) and forward (+), length <= 1
  //   buttons() -> { jump, sprint }
  //
  // A source is any object with vector() and, optionally, buttons(). Sources
  // are summed and the sum is clamped to length 1, so two sources pushing the
  // same way cannot make you faster than one pushing all the way.

  function clampLength(v) {
    var len = Math.sqrt(v.x * v.x + v.z * v.z);
    if (len > 1) return { x: v.x / len, z: v.z / len };
    return { x: v.x, z: v.z };
  }

  function create() {
    var sources = [];
    var api = {
      addSource: function (s) { if (sources.indexOf(s) < 0) sources.push(s); return s; },
      removeSource: function (s) { var i = sources.indexOf(s); if (i >= 0) sources.splice(i, 1); },
      sources: function () { return sources.slice(); },
      vector: function () {
        var sum = { x: 0, z: 0 };
        sources.forEach(function (s) {
          var v = s.vector && s.vector();
          if (!v) return;
          if (Number.isFinite(v.x)) sum.x += v.x;
          if (Number.isFinite(v.z)) sum.z += v.z;
        });
        return clampLength(sum);
      },
      buttons: function () {
        var out = { jump: false, sprint: false };
        sources.forEach(function (s) {
          var b = s.buttons && s.buttons();
          if (!b) return;
          out.jump = out.jump || !!b.jump;
          out.sprint = out.sprint || !!b.sprint;
        });
        return out;
      }
    };
    return api;
  }

  // WASD or the arrow keys, Shift to sprint, Space to jump. Keys are tracked by
  // event.code so the layout doesn't matter. Everything is released when the
  // window loses focus, otherwise a key held while alt-tabbing stays held.
  var KEYS = {
    KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'jump'
  };

  function keyboard(target) {
    var held = {};
    var src = {
      enabled: true,
      press: function (code, down) {
        var k = KEYS[code];
        if (!k) return false;
        if (down) held[code] = k; else delete held[code];
        return true;
      },
      release: function () { held = {}; },
      has: function (name) {
        for (var c in held) if (held[c] === name) return true;
        return false;
      },
      vector: function () {
        if (!src.enabled) return { x: 0, z: 0 };
        return { x: (src.has('right') ? 1 : 0) - (src.has('left') ? 1 : 0),
                 z: (src.has('fwd') ? 1 : 0) - (src.has('back') ? 1 : 0) };
      },
      buttons: function () {
        if (!src.enabled) return { jump: false, sprint: false };
        return { jump: src.has('jump'), sprint: src.has('sprint') };
      }
    };
    if (target && target.addEventListener) {
      var typing = function (e) {
        var t = e.target, tag = t && t.tagName;
        return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      };
      target.addEventListener('keydown', function (e) { if (!typing(e)) src.press(e.code, true); });
      target.addEventListener('keyup', function (e) { src.press(e.code, false); });
      target.addEventListener('blur', function () { src.release(); });
    }
    return src;
  }

  var api = { create: create, keyboard: keyboard, clampLength: clampLength, KEYS: KEYS };
  // In the page there is one shared Move, with the keyboard already plugged in.
  if (typeof window !== 'undefined' && root === window) {
    var shared = create();
    shared.keyboardSource = shared.addSource(keyboard(window));
    shared.create = create; shared.keyboard = keyboard; shared.clampLength = clampLength;
    root.Move = shared;
  } else {
    root.Move = api;
  }
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);

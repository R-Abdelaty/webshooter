(function (root) {
  'use strict';
  // The sounds of the villains' attacks and of you being hit (docs/
  // PLAYER_PLAN.md, P4): the guns' charging whine, a bomb's fuse beeping as
  // it flies at you, its blast, the rounds, and your hits and going down.
  // Each is placed where it happens, heard from the camera (an HRTF
  // PannerNode each), so a wind-up behind you is heard behind you.
  // audio.js is shared with CLASSIC, which is frozen, so these run on an
  // audio context of their own (as swing-audio.js does), at the SFX volume
  // and mute from Settings, which world-game.js passes in each frame.
  //
  //   AttackAudio.frame(eye, yaw, pitch, volume)   the listener and volume
  //   AttackAudio.warn(at, move, secs)  a wind-up this long: 'guns' charges, 'bomb' fizzes,
  //                                     'volley' both, 'dive' a rush of wind building
  //   AttackAudio.fuse(at)          one beep of a bomb's fuse
  //   AttackAudio.boom(at, big)     a bomb going off
  //   AttackAudio.round(at)         one round from a glider gun
  //   AttackAudio.hurt(damage)      you're hit (not placed: it's you)
  //   AttackAudio.down()            you go down
  //   AttackAudio.stop()            silence (pause, quit)
  // And the Rhino's and Venom's (P5):
  //   warn(at, 'charge' | 'ram', secs)   his rumbling build-up
  //   warn(at, 'combo' | 'lash' | 'pounce', secs)   a wet hiss
  //   AttackAudio.quake(at)         a ram hitting a building: a deep boom and rumble
  //   AttackAudio.crash(at)         running into a wall
  //   AttackAudio.swipe(at)         a claw cutting the air
  //   AttackAudio.lash(at)          the tentacle's crack

  var K = { REF: 6, WARN: .5, FUSE: .16, BOOM: 1, ROUND: .28, HURT: .7, DOWN: .6, TELEGRAPH: .9, QUAKE: 1.1, CRASH: .8, SWIPE: .45, LASH: .55 };
  var ctx = null, bus = null, noiseBuf = null, dead = false, vol = 0;

  function init() {
    if (ctx || dead) return !!ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { dead = true; return false; }
    try { ctx = new AC(); } catch (_) { dead = true; return false; }
    bus = ctx.createGain(); bus.gain.value = vol; bus.connect(ctx.destination);
    var n = Math.floor(ctx.sampleRate), d;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate); d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function live() {
    if (!init() || !(vol > 0)) return false;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
    return true;
  }
  // A node that puts what goes into it at `at` (or straight out, unplaced).
  function out(at, ref) {
    if (!at) return bus;
    var p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref || K.REF; p.rolloffFactor = 1;
    if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; } else p.setPosition(at.x, at.y, at.z);
    p.connect(bus);
    return p;
  }
  function env(g, t, peak, a, d) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); }
  function noise(dest, t, dur, type, f0, f1, peak, q) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, peak, .005, dur);
    s.connect(f).connect(g).connect(dest); s.start(t); s.stop(t + dur + .05);
  }
  function tone(dest, t, dur, type, f0, f1, peak, a) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, peak, a || .005, dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + .05);
  }

  function frame(eye, yaw, pitch, volume) {
    vol = Math.max(0, Math.min(1, volume || 0));
    if (!ctx) return;
    var t = ctx.currentTime, L = ctx.listener;
    bus.gain.setTargetAtTime(vol, t, .05);
    if (!eye) return;
    var fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    if (L.positionX) {
      L.positionX.value = eye.x; L.positionY.value = eye.y; L.positionZ.value = eye.z;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(eye.x, eye.y, eye.z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
  }
  // The wind-up, as long as it is.
  function warn(at, move, secs) {
    if (!live()) return;
    var t = ctx.currentTime, o = out(at, 10), T = secs > 0 ? secs : K.TELEGRAPH;
    if (move === 'volley') {
      // The fizz of the first bomb, and the guns starting to charge.
      warn(at, 'bomb', secs); warn(at, 'guns', T + ((root.Attacks && root.Attacks.constants.VOLLEY_CHARGE) || .9));
      return;
    }
    if (move === 'dive') {
      // He tips over: a rush of wind building, and the glider's engine rising.
      noise(o, t, T + .5, 'bandpass', 300, 2200, K.WARN * .6, 1.2);
      tone(o, t, T + .4, 'sawtooth', 70, 190, K.WARN * .3, T * .6);
      return;
    }
    if (move === 'guns') {
      // Charging: a whine rising to the lock, with a warble that quickens.
      var osc = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(260, t); osc.frequency.exponentialRampToValueAtTime(1500, t + T);
      lfo.frequency.setValueAtTime(8, t); lfo.frequency.linearRampToValueAtTime(34, t + T); lg.gain.value = 40;
      lfo.connect(lg).connect(osc.frequency);
      var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.4;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(K.WARN * .5, t + T * .8); g.gain.linearRampToValueAtTime(0, t + T + .05);
      osc.connect(f).connect(g).connect(o); osc.start(t); osc.stop(t + T + .1); lfo.start(t); lfo.stop(t + T + .1);
      // The lock: the moment the laser steadies - change what you're doing.
      tone(o, t + Math.max(0, T - ((root.Attacks && root.Attacks.constants.GUN_LOCK) || .15)), .08, 'square', 2400, 2400, K.WARN * .35);
    } else if (move === 'charge' || move === 'ram') {
      // The Rhino building up: a low growl rising, and his hooves scraping.
      tone(o, t, T, 'sawtooth', 48, 90, K.WARN * .55, T * .7);
      noise(o, t + T * .3, T * .7, 'lowpass', 500, 1400, K.WARN * .35, .8);
    } else if (move === 'combo' || move === 'lash' || move === 'pounce') {
      // Venom: a wet, rising hiss.
      noise(o, t, T * .95, 'bandpass', 2500, move === 'pounce' ? 1200 : 4200, K.WARN * .45, 2.5);
      tone(o, t, T * .8, 'sawtooth', 110, move === 'pounce' ? 70 : 150, K.WARN * .2, T * .5);
    } else {
      // A bomb's fuse lit: a fizz as he reaches for it.
      noise(o, t, T, 'highpass', 3500, 6000, K.WARN * .5, .7);
      tone(o, t + .05, .12, 'triangle', 1300, 1700, K.WARN * .3);
    }
  }
  function fuse(at) { if (live()) tone(out(at, 4), ctx.currentTime, .06, 'square', 1900, 1900, K.FUSE); }
  function boom(at, big) {
    if (!live()) return;
    var t = ctx.currentTime, o = out(at, 14), k = big ? 1 : .8;
    tone(o, t, .7, 'sine', 90, 28, K.BOOM * k, .004);                // the thump
    noise(o, t, 1.1, 'lowpass', 2200, 120, K.BOOM * .8 * k, .8);      // the roar of it
    noise(o, t, .25, 'bandpass', 3000, 900, K.BOOM * .5 * k, 1.2);    // the crack
  }
  function round(at) {
    if (!live()) return;
    var t = ctx.currentTime, o = out(at, 8);
    noise(o, t, .07, 'bandpass', 2200, 700, K.ROUND, 2);
    tone(o, t, .05, 'square', 420, 160, K.ROUND * .5);
  }
  function hurt(damage) {
    if (!live()) return;
    var t = ctx.currentTime, k = Math.min(1, .5 + (damage || 0) / 60);
    tone(bus, t, .22, 'sine', 120, 55, K.HURT * k, .003);
    noise(bus, t, .16, 'lowpass', 900, 200, K.HURT * .6 * k, .7);
  }
  function down() {
    if (!live()) return;
    var t = ctx.currentTime;
    tone(bus, t, 1.4, 'triangle', 220, 55, K.DOWN, .02);
    tone(bus, t + .05, 1.3, 'sine', 330, 82, K.DOWN * .5, .02);
    noise(bus, t, .5, 'lowpass', 600, 80, K.DOWN * .5, .7);
  }
  function quake(at) {
    if (!live()) return;
    var t = ctx.currentTime, o = out(at, 18);
    tone(o, t, 1.1, 'sine', 70, 24, K.QUAKE, .006);                 // the thump
    noise(o, t, 1.6, 'lowpass', 900, 60, K.QUAKE * .7, .7);          // the rumble through the building
    noise(o, t + .02, .35, 'bandpass', 1800, 500, K.QUAKE * .4, 1.3); // the crack of it
  }
  function crash(at) {
    if (!live()) return;
    var t = ctx.currentTime, o = out(at, 10);
    tone(o, t, .45, 'sine', 95, 40, K.CRASH, .004);
    noise(o, t, .5, 'lowpass', 1600, 150, K.CRASH * .6, .8);
  }
  function swipe(at) {
    if (!live()) return;
    var t = ctx.currentTime;
    noise(out(at, 5), t, .16, 'bandpass', 900, 3800, K.SWIPE, 1.6);
  }
  function lash(at) {
    if (!live()) return;
    var t = ctx.currentTime, o = out(at, 7);
    noise(o, t, .12, 'bandpass', 1200, 5200, K.LASH * .7, 1.8);       // out it goes
    noise(o, t + .13, .06, 'highpass', 3000, 6000, K.LASH, .8);       // the crack
  }
  function stop() { if (ctx) bus.gain.setTargetAtTime(0, ctx.currentTime, .03); vol = 0; }

  root.AttackAudio = { frame: frame, warn: warn, fuse: fuse, boom: boom, round: round, hurt: hurt, down: down, stop: stop,
    quake: quake, crash: crash, swipe: swipe, lash: lash, constants: K };
})(window);

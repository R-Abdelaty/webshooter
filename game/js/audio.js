/* audio.js - music and sound effects, built from scratch with Web Audio.
 *
 * Two ways to get music:
 *
 *   1. Drop an audio file at  assets/theme.mp3  and it plays that on loop.
 *   2. If there is no such file, this synthesises an original heroic theme
 *      live in the browser - no download, no file, nothing to install.
 *
 * Why synthesise at all? Because every oscillator, filter and envelope here is
 * the same idea as the buzzer on your wrist: make a waveform, shape how loud it
 * is over time, and it becomes a sound. Same physics, nicer speakers.
 *
 * Browsers will not make noise until the user has clicked something, so
 * nothing starts until init() is called from a real click or keypress.
 */
(function (global) {
  'use strict';

  var ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
  var fileEl = null, usingFile = false;
  var musicVol = 0.6, sfxVol = 0.8, muted = false;
  var running = false, timer = null, nextLoopAt = 0;

  // ------------------------------------------------------------ the tune
  //
  // 8 bars in D minor at 132 BPM. Beats are counted from 0, so beat 4 is the
  // top of bar 2. Notes are MIDI numbers: 60 is middle C, +12 is an octave up.

  var BPM = 132, BEAT = 60 / BPM, LOOP_BEATS = 32;

  // [midi, startBeat, lengthBeats]
  var MELODY = [
    [69, 0, .5], [74, .5, .5], [77, 1, 1], [76, 2, .5], [74, 2.5, .5], [69, 3, 1],
    [70, 4, .5], [74, 4.5, .5], [77, 5, 1], [79, 6, 1.5], [77, 7.5, .5],
    [81, 8, 1], [79, 9, .5], [77, 9.5, .5], [76, 10, 1], [72, 11, 1],
    [67, 12, .5], [72, 12.5, .5], [76, 13, 1], [79, 14, 2],
    [74, 16, .5], [77, 16.5, .5], [81, 17, 1], [79, 18, .5], [77, 18.5, .5], [76, 19, 1],
    [74, 20, 1], [77, 21, 1], [82, 22, 2],
    [81, 24, 1], [79, 25, 1], [74, 26, 1], [79, 27, 1],
    [76, 28, 1], [73, 29, 1], [76, 30, .5], [81, 30.5, 1.5]
  ];

  // one chord per bar: Dm  Bb  F  C  Dm  Bb  Gm  A
  var CHORDS = [
    [50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55],
    [50, 53, 57], [46, 50, 53], [55, 58, 62], [57, 61, 64]
  ];

  // bass root per bar, then a driving eighth-note figure over it
  var BASS_ROOTS = [38, 34, 41, 36, 38, 34, 43, 45];
  var BASS_FIGURE = [0, 0, 12, 0, 0, 7, 0, 12];   // semitone offsets, one per eighth

  // ------------------------------------------------------------ helpers

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function makeNoise() {
    var n = Math.floor(ctx.sampleRate * 1.2);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function noise(t, dur, type, cutoff, gain, bus) {
    var s = ctx.createBufferSource(); s.buffer = noiseBuf;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = cutoff;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus || musicBus);
    s.start(t); s.stop(t + dur + .02);
  }

  // ------------------------------------------------------------ voices

  // Lead line. Two detuned saws through a filter that opens on the attack -
  // that sudden brightness is what makes a sound read as "brass".
  function brass(t, midi, beats, vel) {
    var dur = beats * BEAT, f = mtof(midi);
    var g = ctx.createGain();
    var flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 6;
    flt.frequency.setValueAtTime(600, t);
    flt.frequency.linearRampToValueAtTime(f * 6 + 1200, t + .06);
    flt.frequency.exponentialRampToValueAtTime(Math.max(700, f * 2.4), t + dur);

    [-7, 7].forEach(function (cents) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(flt);
      o.start(t); o.stop(t + dur + .12);
    });

    var peak = .16 * (vel || 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + .03);
    g.gain.exponentialRampToValueAtTime(peak * .72, t + Math.min(.22, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + .1);

    flt.connect(g).connect(musicBus);
  }

  function bass(t, midi, beats, vel) {
    var dur = beats * BEAT;
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    var flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 420; flt.Q.value = 4;
    var g = ctx.createGain();
    var peak = .26 * (vel || 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + .012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * .95);
    o.connect(flt).connect(g).connect(musicBus);
    o.start(t); o.stop(t + dur + .04);
  }

  function pad(t, midis, beats) {
    var dur = beats * BEAT;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(.05, t + .25);
    g.gain.setValueAtTime(.05, t + dur - .3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 1500;
    midis.forEach(function (m) {
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(m);
      o.connect(flt);
      o.start(t); o.stop(t + dur + .05);
    });
    flt.connect(g).connect(musicBus);
  }

  // A kick is just a sine whose pitch falls off a cliff in under a tenth of
  // a second. Your ear hears the drop as "thump" rather than as a pitch.
  function kick(t) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + .09);
    g.gain.setValueAtTime(.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .3);
    o.connect(g).connect(musicBus);
    o.start(t); o.stop(t + .32);
  }

  function snare(t) {
    noise(t, .17, 'bandpass', 1900, .22);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = 185;
    g.gain.setValueAtTime(.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .09);
    o.connect(g).connect(musicBus);
    o.start(t); o.stop(t + .1);
  }

  function hat(t)   { noise(t, .035, 'highpass', 8000, .055); }
  function crash(t) { noise(t, 1.4, 'highpass', 5200, .085); }

  // ------------------------------------------------------------ sequencer

  // Queue one whole 8-bar pass. Web Audio plays anything scheduled ahead of
  // time on its own clock, so the music never stutters when JavaScript is busy.
  function scheduleLoop(t0) {
    MELODY.forEach(function (n) { brass(t0 + n[1] * BEAT, n[0], n[2], 1); });

    for (var bar = 0; bar < 8; bar++) {
      var bt = t0 + bar * 4 * BEAT;

      pad(bt, CHORDS[bar], 4);

      for (var e = 0; e < 8; e++) {
        bass(bt + e * .5 * BEAT, BASS_ROOTS[bar] + BASS_FIGURE[e], .45, 1);
        hat(bt + e * .5 * BEAT);
      }

      kick(bt);
      kick(bt + 2 * BEAT);
      snare(bt + 1 * BEAT);
      snare(bt + 3 * BEAT);
      if (bar === 3 || bar === 7) snare(bt + 3.5 * BEAT);   // little turnaround
      if (bar === 0 || bar === 4) crash(bt);
    }
  }

  function tick() {
    if (!running || usingFile) return;
    if (nextLoopAt - ctx.currentTime < 0.7) {
      scheduleLoop(nextLoopAt);
      nextLoopAt += LOOP_BEATS * BEAT;
    }
  }

  // ------------------------------------------------------------ plumbing

  function applyVolume() {
    if (!ctx) return;
    var m = muted ? 0 : musicVol * musicVol;   // squared tracks how ears hear it
    var s = muted ? 0 : sfxVol * sfxVol;
    musicBus.gain.setTargetAtTime(m * 0.9, ctx.currentTime, .03);
    sfxBus.gain.setTargetAtTime(s, ctx.currentTime, .03);
    if (fileEl) fileEl.volume = Math.min(1, muted ? 0 : musicVol * musicVol);
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }

    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus.connect(comp);
    sfxBus.connect(comp);
    comp.connect(master).connect(ctx.destination);

    noiseBuf = makeNoise();
    applyVolume();
    if (ctx.state === 'suspended') ctx.resume();
  }

  function startMusic() {
    if (!ctx || running) return;
    running = true;

    // Prefer a real audio file if the user supplied one.
    var probe = new global.Audio('assets/theme.mp3');
    probe.loop = true;
    probe.preload = 'auto';

    probe.addEventListener('canplaythrough', function () {
      if (usingFile) return;
      usingFile = true;
      fileEl = probe;
      applyVolume();
      probe.play().catch(function () { usingFile = false; fileEl = null; beginSynth(); });
      if (onTrack) onTrack('assets/theme.mp3');
    }, { once: true });

    probe.addEventListener('error', function () {
      if (!usingFile) beginSynth();
    }, { once: true });

    // If the file is slow or missing, do not sit in silence waiting for it.
    setTimeout(function () { if (!usingFile && !timer) beginSynth(); }, 1200);
  }

  function beginSynth() {
    if (timer || usingFile) return;
    nextLoopAt = ctx.currentTime + .18;
    scheduleLoop(nextLoopAt);
    nextLoopAt += LOOP_BEATS * BEAT;
    timer = setInterval(tick, 250);
    if (onTrack) onTrack(null);
  }

  var onTrack = null;

  function stopMusic() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (fileEl) { fileEl.pause(); }
  }

  // ------------------------------------------------------------ effects

  // The thwip: a fast downward pitch sweep with a hiss of air over it.
  function thwip(strength) {
    if (!ctx) return;
    var t = ctx.currentTime, s = Math.max(.5, Math.min(1.6, strength || 1));
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(2600 * s, t);
    o.frequency.exponentialRampToValueAtTime(420, t + .16);
    var flt = ctx.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.value = 1400; flt.Q.value = 1.6;
    g.gain.setValueAtTime(.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .19);
    o.connect(flt).connect(g).connect(sfxBus);
    o.start(t); o.stop(t + .2);
    noise(t, .13, 'highpass', 3000, .12, sfxBus);
  }

  function blip() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(760, t);
    o.frequency.exponentialRampToValueAtTime(1180, t + .05);
    g.gain.setValueAtTime(.055, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .08);
    o.connect(g).connect(sfxBus);
    o.start(t); o.stop(t + .09);
  }

  function thunk() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(120, t + .12);
    g.gain.setValueAtTime(.13, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .15);
    o.connect(g).connect(sfxBus);
    o.start(t); o.stop(t + .16);
  }

  // A clean centre-mass hit: short, bright, satisfying.
  function crunch() {
    if (!ctx) return;
    var t = ctx.currentTime;
    noise(t, .1, 'bandpass', 900, .3, sfxBus);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(70, t + .1);
    g.gain.setValueAtTime(.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .13);
    o.connect(g).connect(sfxBus);
    o.start(t); o.stop(t + .14);
  }

  // He reached you. A body blow you feel in the low end.
  function impact() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(32, t + .35);
    g.gain.setValueAtTime(.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .55);
    o.connect(g).connect(sfxBus);
    o.start(t); o.stop(t + .56);
    noise(t, .34, 'lowpass', 700, .34, sfxBus);
  }

  // Level cleared: a rising three-note flourish over the beat.
  function fanfare() {
    if (!ctx) return;
    var t = ctx.currentTime;
    [[69, 0], [74, .13], [81, .26]].forEach(function (n) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = mtof(n[0]);
      var flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 4200;
      g.gain.setValueAtTime(0.0001, t + n[1]);
      g.gain.exponentialRampToValueAtTime(.22, t + n[1] + .02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + .55);
      o.connect(flt).connect(g).connect(sfxBus);
      o.start(t + n[1]); o.stop(t + n[1] + .6);
    });
  }

  // Failed: the same idea, falling instead of rising.
  function fail() {
    if (!ctx) return;
    var t = ctx.currentTime;
    [[62, 0], [57, .16], [50, .32]].forEach(function (n) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = mtof(n[0]);
      var flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 1300;
      g.gain.setValueAtTime(0.0001, t + n[1]);
      g.gain.exponentialRampToValueAtTime(.2, t + n[1] + .03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + .7);
      o.connect(flt).connect(g).connect(sfxBus);
      o.start(t + n[1]); o.stop(t + n[1] + .75);
    });
  }

  global.WSAudio = {
    init: init,
    startMusic: startMusic,
    stopMusic: stopMusic,
    thwip: thwip,
    blip: blip,
    thunk: thunk,
    crunch: crunch,
    impact: impact,
    fanfare: fanfare,
    fail: fail,
    setMusicVolume: function (v) { musicVol = v; applyVolume(); },
    setSfxVolume:   function (v) { sfxVol = v; applyVolume(); },
    setMuted:       function (m) { muted = !!m; applyVolume(); },
    onTrack:        function (fn) { onTrack = fn; }
  };
})(window);

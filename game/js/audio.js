/* audio.js - music and sound effects, built from scratch with Web Audio.
 *
 * Two ways to get music:
 *
 *   1. Drop an audio file at  assets/theme.mp3  and it plays that on loop.
 *   2. If there is no such file, this synthesises an original heroic theme
 *      live in the browser - no download, no file, nothing to install.
 *
 * Why synthesise at all? Because every oscillator, filter and envelope here is
 * a waveform, shaped for how loud it
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

  function thunk(at) {
    if (!ctx) return;
    var t = ctx.currentTime, bus = place(at, 16);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(120, t + .12);
    g.gain.setValueAtTime(.13, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .15);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + .16);
  }

  // A clean centre-mass hit: short, bright, satisfying. `at`: where in the
  // 3D world it landed (see "in the world" below), or nothing for the 2D game.
  function crunch(at) {
    if (!ctx) return;
    var t = ctx.currentTime, bus = place(at, 24);
    noise(t, .1, 'bandpass', 900, .3, bus);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(70, t + .1);
    g.gain.setValueAtTime(.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .13);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + .14);
  }

  // He reached you. A body blow you feel in the low end.
  function impact(at) {
    if (!ctx) return;
    var t = ctx.currentTime, bus = place(at, 16);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(32, t + .35);
    g.gain.setValueAtTime(.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + .55);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + .56);
    noise(t, .34, 'lowpass', 700, .34, bus);
  }

  // ------------------------------------------------------------ in the world
  //
  // The 3D game places sounds where they happen: each one goes through its
  // own PannerNode at that point, and the listener is the camera, so a roar
  // behind you comes from behind and a distant one is quieter. `ref` is the
  // distance (metres) inside which a sound is at full volume; past it, it
  // falls off with distance.

  function setParam(p, v, t) { if (p && p.setValueAtTime) p.setValueAtTime(v, t); }
  function pan(p, at) {
    var t = ctx.currentTime;
    if (p.positionX) { setParam(p.positionX, at.x, t); setParam(p.positionY, at.y, t); setParam(p.positionZ, at.z, t); }
    else p.setPosition(at.x, at.y, at.z);
  }
  function place(at, ref) {
    if (!at || !ctx || !Number.isFinite(at.x)) return sfxBus;
    var p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref || 10; p.rolloffFactor = 1; p.maxDistance = 3000;
    pan(p, at);
    p.connect(sfxBus);
    return p;
  }
  // The listener: at `eye`, facing yaw/pitch (yaw 0 faces -z and positive
  // yaw turns left, as the 3D game's camera does).
  function setListener(eye, yaw, pitch) {
    if (!ctx) return;
    var L = ctx.listener, t = ctx.currentTime, cp = Math.cos(pitch);
    var fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
    var ux = Math.sin(yaw) * fy, uy = cp, uz = Math.cos(yaw) * fy;
    if (L.positionX) {
      setParam(L.positionX, eye.x, t); setParam(L.positionY, eye.y, t); setParam(L.positionZ, eye.z, t);
      setParam(L.forwardX, fx, t); setParam(L.forwardY, fy, t); setParam(L.forwardZ, fz, t);
      setParam(L.upX, ux, t); setParam(L.upY, uy, t); setParam(L.upZ, uz, t);
    } else { L.setPosition(eye.x, eye.y, eye.z); L.setOrientation(fx, fy, fz, ux, uy, uz); }
  }

  // One voice: an oscillator through a filter, with a pitch sweep and an
  // attack/decay, into `bus` at time t.
  function voice(bus, t, type, f0, f1, dur, peak, filter, q) {
    var o = ctx.createOscillator(), g = ctx.createGain(), flt = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    flt.type = 'lowpass'; flt.frequency.value = filter || 1200; flt.Q.value = q || 1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(.05, dur * .2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt).connect(g).connect(bus);
    o.start(t); o.stop(t + dur + .02);
    return o;
  }
  function wobble(o, t, dur, rate, depth) {
    var l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = rate; lg.gain.value = depth;
    l.connect(lg).connect(o.frequency);
    l.start(t); l.stop(t + dur + .02);
  }

  // The villains' voices. who: 'glider' (the Goblin), 'charge' (the Rhino)
  // or 'leap' (Venom).
  function roar(at, who, gain, delay) {
    if (!ctx) return;
    var t = ctx.currentTime + (delay || 0), bus = place(at, 18), k = gain || 1;
    if (who === 'glider') {
      // A cackle: quick nasal bursts, climbing.
      for (var i = 0; i < 6; i++) voice(bus, t + i * .11, 'square', 380 + i * 22, 300 + i * 20, .09, .12 * k, 1800, 5);
    } else if (who === 'charge') {
      var o = voice(bus, t, 'sawtooth', 95, 60, 1.1, .5 * k, 520, 3);
      wobble(o, t, 1.1, 23, 9);
      voice(bus, t, 'sawtooth', 190, 120, 1, .18 * k, 800, 2);
      noise(t, .9, 'lowpass', 500, .25 * k, bus);
    } else {
      var v = voice(bus, t, 'sawtooth', 140, 75, 1.2, .35 * k, 900, 6);
      wobble(v, t, 1.2, 31, 14);
      noise(t, 1.1, 'bandpass', 2400, .3 * k, bus);
    }
  }
  function grunt(at, who, gain) {
    if (!ctx) return;
    var t = ctx.currentTime, bus = place(at, 18), f = who === 'charge' ? 110 : who === 'glider' ? 260 : 150;
    voice(bus, t, 'sawtooth', f, f * .7, .2, .3 * (gain || 1), 900, 4);
  }
  function groan(at, who) {
    if (!ctx) return;
    var t = ctx.currentTime, bus = place(at, 18), f = who === 'charge' ? 120 : who === 'glider' ? 330 : 160;
    var o = voice(bus, t, 'sawtooth', f, f * .45, .9, .35, 800, 4);
    wobble(o, t, .9, 7, f * .05);
  }
  function snort(at) {
    if (!ctx) return;
    var t = ctx.currentTime, bus = place(at, 18);
    noise(t, .25, 'lowpass', 900, .5, bus);
    voice(bus, t, 'sawtooth', 80, 55, .3, .3, 400, 2);
  }
  // Something heavy meets the ground: a landing, a drop-in.
  function thud(at, gain, delay) {
    if (!ctx) return;
    var t = ctx.currentTime + (delay || 0), bus = place(at, 20), k = gain || 1;
    voice(bus, t, 'sine', 120, 34, .45, .7 * k, 400);
    noise(t, .3, 'lowpass', 420, .4 * k, bus);
  }
  function step(at, gain) {
    if (!ctx) return;
    var t = ctx.currentTime, bus = place(at, 14), k = gain || 1;
    voice(bus, t, 'sine', 90, 42, .16, .45 * k, 300);
    noise(t, .08, 'lowpass', 260, .2 * k, bus);
  }
  function whoosh(at, gain, delay) {
    if (!ctx) return;
    var t = ctx.currentTime + (delay || 0), bus = place(at, 14), s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(450, t); f.frequency.exponentialRampToValueAtTime(2600, t + .32);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(.35 * (gain || 1), t + .12); g.gain.exponentialRampToValueAtTime(0.0001, t + .36);
    s.connect(f).connect(g).connect(bus); s.start(t); s.stop(t + .4);
  }
  // Feet or armour scraping along the tarmac.
  function skid(at) {
    if (!ctx) return;
    var t = ctx.currentTime, bus = place(at, 16);
    noise(t, .7, 'bandpass', 1300, .35, bus);
    noise(t, .5, 'lowpass', 300, .3, bus);
  }
  // A car horn somewhere in the street.
  function horn(at) {
    if (!ctx) return;
    var t = ctx.currentTime, bus = place(at, 10), d = .25 + Math.random() * .35;
    [392, 494].forEach(function (f) { voice(bus, t, 'square', f, f * .995, d, .07, 1400, 1); });
  }

  // Sounds that go on: the Goblin's glider engine (following him, pitched
  // by his speed) and the street's rumble (louder down among the traffic).
  var humNodes = null, ambNodes = null;
  function hum(at, speed) {
    if (!ctx) return;
    if (!at) { if (humNodes) { humNodes.g.gain.setTargetAtTime(0, ctx.currentTime, .08); } return; }
    if (!humNodes) {
      var p = place(at, 12), g = ctx.createGain(), flt = ctx.createBiquadFilter(), a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = 'sawtooth'; b.type = 'square'; flt.type = 'lowpass'; flt.frequency.value = 700; flt.Q.value = 2;
      g.gain.value = 0;
      a.connect(flt); b.connect(flt); flt.connect(g).connect(p);
      a.start(); b.start();
      humNodes = { p: p, g: g, a: a, b: b };
    }
    var t = ctx.currentTime, f = 62 + Math.min(40, (speed || 0) * 4);
    pan(humNodes.p, at);
    humNodes.a.frequency.setTargetAtTime(f, t, .1); humNodes.b.frequency.setTargetAtTime(f * 2.01, t, .1);
    humNodes.g.gain.setTargetAtTime(.12, t, .15);
  }
  // level: 0..1 (Traffic.noise); 0 or null silences it, as on leaving the city.
  function ambience(level) {
    if (!ctx) return;
    if (!ambNodes) {
      if (!level) return;
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.value = 380; g.gain.value = 0;
      s.connect(f).connect(g).connect(sfxBus); s.start();
      ambNodes = { g: g };
    }
    var v = level > 0 ? .02 + .16 * Math.min(1, level) : 0;
    ambNodes.g.gain.setTargetAtTime(v, ctx.currentTime, level > 0 ? .6 : .3);
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
    // the 3D world's placed sounds (at: {x, y, z} in metres)
    setListener: setListener,
    roar: roar, grunt: grunt, groan: groan, snort: snort, thud: thud, step: step, whoosh: whoosh, skid: skid, horn: horn,
    hum: hum, ambience: ambience,
    setMusicVolume: function (v) { musicVol = v; applyVolume(); },
    setSfxVolume:   function (v) { sfxVol = v; applyVolume(); },
    setMuted:       function (m) { muted = !!m; applyVolume(); },
    onTrack:        function (fn) { onTrack = fn; }
  };
})(window);

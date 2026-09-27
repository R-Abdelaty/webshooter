(function (root) {
  'use strict';
  // The sounds that go on while you swing (docs/PLAYER_PLAN.md, P3): wind
  // rising with your speed, and the line creaking as it takes your weight.
  // The one-off sounds - the thwip of a line, a landing's thud - are
  // WSAudio's. audio.js is shared with CLASSIC, which is frozen, so these two
  // run on an audio context of their own, at the SFX volume (and mute) from
  // Settings, which world-game.js passes in.
  //
  //   SwingAudio.update({ speed, load, taut, on }, volume)   each frame
  //   SwingAudio.stop()                                       silence (pause, quit)

  var K = {
    WIND_V: [6, 34],      // m/s: the wind comes in from the first, full by the second
    WIND_GAIN: .16,
    WIND_HZ: [300, 1400], // its band, low at the slow end, up at the fast
    CREAK_LOAD: [1.1, 2.6], // g on the line: the creak from the first, loudest at the second
    CREAK_GAIN: .05,
    CREAK_HZ: [14, 30],   // the rope's rasp, slower to faster with the load
    EASE: .08             // seconds the levels take to follow
  };

  var ctx = null, bus = null, wind = null, creak = null, dead = false;
  function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  function init() {
    if (ctx || dead) return !!ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { dead = true; return false; }
    try { ctx = new AC(); } catch (_) { dead = true; return false; }
    bus = ctx.createGain(); bus.gain.value = 0; bus.connect(ctx.destination);
    var n = Math.floor(ctx.sampleRate * 2), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0), b = 0;
    for (var i = 0; i < n; i++) { b = b * .96 + (Math.random() * 2 - 1) * .04; d[i] = b * 6 + (Math.random() * 2 - 1) * .15; }
    // Wind: soft noise through a band that opens with speed.
    var src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; src.loop = true; band.type = 'bandpass'; band.Q.value = .7; band.frequency.value = K.WIND_HZ[0]; g.gain.value = 0;
    src.connect(band).connect(g).connect(bus); src.start();
    wind = { band: band, g: g };
    // Creak: a slow sawtooth rasp through a narrow resonant band - a taut fibre.
    var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), cg = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = K.CREAK_HZ[0]; f.type = 'bandpass'; f.frequency.value = 1150; f.Q.value = 9; cg.gain.value = 0;
    o.connect(f).connect(cg).connect(bus); o.start();
    creak = { o: o, g: cg };
    return true;
  }

  // s: { speed (m/s), load (g on the line), taut, on (swinging or flying) };
  // volume: 0..1, 0 when muted.
  function update(s, volume) {
    s = s || {};
    var wantWind = s.on ? smooth(K.WIND_V[0], K.WIND_V[1], s.speed || 0) : 0;
    var wantCreak = s.on && s.taut ? smooth(K.CREAK_LOAD[0], K.CREAK_LOAD[1], s.load || 0) : 0;
    if (!ctx && !(wantWind || wantCreak)) return;
    if (!init()) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
    var t = ctx.currentTime;
    bus.gain.setTargetAtTime(Math.max(0, Math.min(1, volume || 0)), t, .05);
    wind.g.gain.setTargetAtTime(wantWind * K.WIND_GAIN, t, K.EASE);
    wind.band.frequency.setTargetAtTime(K.WIND_HZ[0] + (K.WIND_HZ[1] - K.WIND_HZ[0]) * wantWind, t, K.EASE);
    creak.g.gain.setTargetAtTime(wantCreak * K.CREAK_GAIN, t, K.EASE);
    creak.o.frequency.setTargetAtTime(K.CREAK_HZ[0] + (K.CREAK_HZ[1] - K.CREAK_HZ[0]) * wantCreak, t, K.EASE);
  }
  function stop() { if (ctx) bus.gain.setTargetAtTime(0, ctx.currentTime, .05); }

  root.SwingAudio = { update: update, stop: stop, constants: K };
})(window);

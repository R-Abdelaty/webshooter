(function (root) {
  'use strict';
  // Which sounds a villain makes, and where: turned from the clips his model
  // is told to play (VillainAnim's out.play) and from his fight's state. No
  // audio here - world-game.js hands the cues to WSAudio, which places each
  // one at its point in the world (a PannerNode), so you hear the Goblin
  // circle behind you and the Rhino thunder past below.
  //
  //   var c = SoundCues.create(kind)          'glider' | 'charge' | 'leap'
  //   var out = SoundCues.step(c, fight, plays, speed, dt)
  //   out.cues: [{ name, at: {x, y, z}, delay, gain }]  one-off sounds
  //   out.hum:  { at, speed } while the goblin's glider is flying, else null
  //
  // `plays` is VillainAnim.step's out.play, `speed` its out.speed.

  var K = {
    STRIDE: 2.7,            // metres per footfall at a run (the rhino)
    MIN_STEP: .5,           // slower than this (m/s) there are no footfalls
    ENTRANCE_THUD: .55,     // seconds into the rhino's drop-in that he lands
    DROP_THUD: .1           // ...and into venom's descent_end
  };

  // clip -> [sound, delay (s), gain]
  var CLIPS = {
    roar: ['roar', 0, 1],
    entrance: ['thud', K.ENTRANCE_THUD, 1.3],
    descent_end: ['thud', K.DROP_THUD, 1.1],
    land: ['thud', 0, .7],
    land_heavy: ['thud', .08, 1.3],
    leap_start: ['whoosh', .1, .7],
    dodge_l: ['whoosh', 0, 1], dodge_r: ['whoosh', 0, 1],
    skid: ['skid', 0, 1],
    attack: ['snort', 0, 1],
    stun: ['grunt', .05, 1.2],
    hit_big: ['grunt', 0, 1], hit: ['grunt', 0, .6],
    defeat: ['groan', 0, 1]
  };
  // Clips whose sound isn't the clip's: the Goblin's attack is a throw, not
  // a snort (its wind-up has its own cue, attack-audio.js); Venom's swipes
  // and lash are heard when they strike, from the fight's events
  // (world-game.js), not when their slowed wind-up starts.
  var QUIET = { glider: { attack: 1 }, leap: { attack: 1, attack2: 1, attack3: 1, tentacles: 1 } };

  function create(kind) { return { kind: kind, step: .5 }; }

  function step(c, f, plays, speed, dt) {
    var out = { cues: [], hum: null };
    if (!f || !f.at) return out;
    var at = { x: f.at.x, y: f.at.y + 1.2, z: f.at.z };
    (plays || []).forEach(function (p) {
      var s = CLIPS[p[0]];
      if (QUIET[c.kind] && QUIET[c.kind][p[0]]) return;
      if (s) out.cues.push({ name: s[0], at: at, delay: s[1], gain: s[2], voice: c.kind });
    });
    // The rhino's feet: a footfall every stride while he runs.
    if (c.kind === 'charge' && speed > K.MIN_STEP && dt > 0) {
      c.step += speed * dt / K.STRIDE;
      if (c.step >= 1) { c.step %= 1; out.cues.push({ name: 'step', at: { x: f.at.x, y: f.at.y, z: f.at.z }, delay: 0, gain: Math.min(1.4, speed / 6), voice: c.kind }); }
    } else if (c.kind === 'charge') c.step = .5;
    // The glider's engine, for as long as he rides it.
    if (c.kind === 'glider' && f.mode !== 'won') {
      var v = f.vel ? Math.hypot(f.vel.x, f.vel.y || 0, f.vel.z) : 0;
      out.hum = { at: at, speed: v };
    }
    return out;
  }

  var api = { create: create, step: step, CLIPS: CLIPS, QUIET: QUIET, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.SoundCues = api;
})(typeof window === 'undefined' ? globalThis : window);

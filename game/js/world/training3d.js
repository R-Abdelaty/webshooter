(function (root) {
  'use strict';
  // Target practice in the city: one target at a time on the walls and roofs
  // round the training roof (Encounters.build(city).training), at mixed
  // distances. Hit it and the next one appears at least MIN_DEG away as seen
  // from the vantage - the 3D form of the 2D range's "at least 30% of the
  // screen away" - so each one is a real re-aim. No clock and nothing to lose.
  //
  // Scoring (hits, shots, streak, best, accuracy, the cooldown) is the 2D
  // range's own, from training.js. No Three.js.

  var TrainingRef = root.Training || (typeof require === 'function' ? require('../training.js') : null);
  var Aim = root.AimAssist || (typeof require === 'function' ? require('./aim-assist.js') : null);

  // A target's radius grows with its distance so a far one is still a fair
  // mark: about ANGLE degrees, within MIN_R..MAX_R metres.
  var MIN_DEG = 30, ANGLE = 1.2, MIN_R = .6, MAX_R = 1.6, EYE = 1.7;
  function radius(eye, t) {
    var d = Math.hypot(t.x - eye.x, t.y - eye.y, t.z - eye.z);
    return Math.max(MIN_R, Math.min(MAX_R, d * Math.tan(ANGLE * Math.PI / 180)));
  }

  function rand(s) { s.seed = (s.seed * 1103515245 + 12345) & 0x7fffffff; return s.seed / 0x7fffffff; }
  function eyeOf(range) { var v = range.vantage; return { x: v.x, y: v.y + EYE, z: v.z }; }
  // The angle between two targets as seen from `eye`, in degrees.
  function apart(eye, a, b) {
    var ax = a.x - eye.x, ay = a.y - eye.y, az = a.z - eye.z, bx = b.x - eye.x, by = b.y - eye.y, bz = b.z - eye.z;
    var c = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) || 1);
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }

  // Pick the next target: a random one far enough from the last, or, if none
  // is (only with very few spots), the one furthest from it.
  function next(s) {
    var T = s.range.targets, eye = eyeOf(s.range), last = s.index >= 0 ? T[s.index] : null, i, tries;
    var pick = -1;
    for (tries = 0; tries < 40 && pick < 0; tries++) {
      i = Math.floor(rand(s) * T.length) % T.length;
      if (i !== s.index && (!last || apart(eye, last, T[i]) >= MIN_DEG)) pick = i;
    }
    if (pick < 0) {
      var far = -1;
      for (i = 0; i < T.length; i++) if (i !== s.index && (!last || apart(eye, last, T[i]) > far)) { far = last ? apart(eye, last, T[i]) : 0; pick = i; }
    }
    s.index = pick;
    s.target3 = { x: T[pick].x, y: T[pick].y, z: T[pick].z, r: radius(eye, T[pick]) };
    s.spawnedAt = s.elapsed;
    return s;
  }

  function start(range, seed) {
    var s = TrainingRef.start(Number.isFinite(seed) ? seed : 1);
    s.range = range; s.index = -1; s.target3 = null;
    next(s);
    s.spawnedAt = 0;
    return s;
  }

  function tick(s, dt) { return TrainingRef.tick(s, dt); }

  // shot: { origin, dir, blocked } as in Fight.fire.
  function fire(s, shot) {
    if (s.cooldownRemaining > 0) return { accepted: false };
    var hit = Aim.pick(shot.origin, shot.dir, [s.target3], { blocked: shot.blocked });
    var was = s.target3, r = TrainingRef.score(s, !!hit);
    if (r.hit) { r.point = Aim.closest(shot.origin, shot.dir, was); r.target = was; next(s); }
    return r;
  }

  var api = { MIN_DEG: MIN_DEG, ANGLE: ANGLE, radius: radius, start: start, tick: tick, fire: fire, next: next, apart: apart,
    accuracy: function (s) { return TrainingRef.accuracy(s); }, eye: eyeOf };
  if (typeof module !== 'undefined') module.exports = api;
  root.Training3D = api;
})(typeof window === 'undefined' ? globalThis : window);

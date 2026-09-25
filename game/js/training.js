(function (root) {
  'use strict';
  // Target practice: one target at a time, hit it and the next one appears
  // somewhere else. No villain, no clock, no way to lose - it exists so you can
  // get used to the wrist without a round running out from under you.
  var COOLDOWN = 0.2;

  // Where a target may appear, as a fraction of the screen. Inset so a target
  // never lands under the HUD at the top or the hint bar at the bottom.
  var FIELD = { x0:.10, x1:.90, y0:.20, y1:.80 };

  // Far enough that the next one is a real re-aim rather than a nudge. Measured
  // in the same normalised units, so on a wide screen it is a longer sweep
  // horizontally than vertically - which is what you want to practise.
  var MIN_JUMP = .30;

  function rand(state) {
    state.seed = (state.seed * 1103515245 + 12345) & 0x7fffffff;
    return state.seed / 0x7fffffff;
  }

  function next(state) {
    var previous = state.target, x, y, tries = 0;
    do {
      x = FIELD.x0 + (FIELD.x1 - FIELD.x0) * rand(state);
      y = FIELD.y0 + (FIELD.y1 - FIELD.y0) * rand(state);
      tries++;
    } while (previous && Math.sqrt(Math.pow(x - previous.x, 2) + Math.pow(y - previous.y, 2)) < MIN_JUMP && tries < 20);
    state.target = { x:x, y:y };
    state.spawnedAt = state.elapsed;
    return state;
  }

  function start(seed) {
    var state = { hits:0, shots:0, streak:0, best:0, elapsed:0, spawnedAt:0,
      cooldownRemaining:0, target:null, lastTimeToHit:0,
      seed:Number.isFinite(seed) ? seed : (Date.now() & 0x7fffffff) };
    next(state);
    state.spawnedAt = 0;
    return state;
  }

  function tick(state, deltaSeconds) {
    var delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    state.elapsed += delta;
    state.cooldownRemaining = Math.max(0, state.cooldownRemaining - delta);
    return state;
  }

  // Same signature as Combat.fire so game.js can treat both the same way: the
  // caller does the normalised-to-pixels conversion, we just judge the shot.
  function fire(state, point, target) {
    if (state.cooldownRemaining > 0) return { accepted:false };
    state.cooldownRemaining = COOLDOWN;
    state.shots++;
    var dx = point.x - target.x, dy = point.y - target.y;
    var hit = dx * dx + dy * dy <= target.radius * target.radius;
    if (hit) {
      state.hits++;
      state.streak++;
      if (state.streak > state.best) state.best = state.streak;
      state.lastTimeToHit = state.elapsed - state.spawnedAt;
      next(state);
    } else {
      state.streak = 0;
    }
    return { accepted:true, hit:hit };
  }

  function accuracy(state) { return state.shots ? state.hits / state.shots : 0; }

  var api = { COOLDOWN:COOLDOWN, FIELD:FIELD, MIN_JUMP:MIN_JUMP,
    start:start, tick:tick, fire:fire, next:next, accuracy:accuracy };
  if (typeof module !== 'undefined') module.exports = api;
  root.Training = api;
})(typeof window === 'undefined' ? globalThis : window);

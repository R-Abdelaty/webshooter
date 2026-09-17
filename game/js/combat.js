(function (root) {
  'use strict';
  var DAMAGE = 20, COOLDOWN = 0.35;
  function start(levelIndex, levels) {
    var level = levels[levelIndex];
    return { mode:'intro', levelIndex:levelIndex, health:level.health, maxHealth:level.health,
      approachElapsed:0, approachDuration:level.approachDuration,
      cooldownRemaining:0, targetIndex:0, hits:0, shots:0 };
  }
  function play(state) { if (state.mode === 'intro' || state.mode === 'paused') state.mode = 'playing'; return state; }
  function pause(state) { if (state.mode === 'playing') state.mode = 'paused'; return state; }
  function tick(state, deltaSeconds) {
    if (state.mode !== 'playing') return state;
    var delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    state.cooldownRemaining = Math.max(0, state.cooldownRemaining - delta);
    state.approachElapsed = Math.min(state.approachDuration, state.approachElapsed + delta);
    if (state.approachElapsed >= state.approachDuration) state.mode = 'lost';
    return state;
  }
  function fire(state, point, target) {
    if (state.mode !== 'playing' || state.cooldownRemaining > 0) return { accepted:false };
    state.cooldownRemaining = COOLDOWN; state.shots++;
    var dx = point.x-target.x, dy = point.y-target.y;
    if (dx*dx+dy*dy > target.radius*target.radius) return { accepted:true, hit:false };
    state.health = Math.max(0, state.health-DAMAGE); state.hits++;
    if (state.health === 0) state.mode = 'won'; else state.targetIndex++;
    return { accepted:true, hit:true };
  }
  var api = { DAMAGE:DAMAGE, COOLDOWN:COOLDOWN, start:start, play:play, pause:pause, tick:tick, fire:fire };
  if (typeof module !== 'undefined') module.exports = api;
  root.Combat = api;
})(typeof window === 'undefined' ? globalThis : window);

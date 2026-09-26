(function (root) {
  'use strict';
  var DAMAGE = 20, COOLDOWN = 0.35;

  // Where the villain is allowed to be, in normalised arena coordinates, as the
  // centre of its sprite. Pulled in from the edges so a dodge never parks it
  // half off-screen - game.js sizes the sprite to fit inside this box.
  var BOX = { x0:.23, x1:.77, y0:.30, y1:.72 };

  // How long it keeps sprinting after you shoot at it. Long enough to read as
  // "it saw that coming", short enough that it isn't permanently uncatchable.
  var DODGE_SECONDS = 0.6;

  // Its own generator rather than Math.random: a fixed seed per encounter makes
  // the movement reproducible, which is the difference between a test that can
  // assert where it went and one that can only assert that it moved.
  function rand(state) {
    state.seed = (state.seed * 1103515245 + 12345) & 0x7fffffff;
    return state.seed / 0x7fffffff;
  }

  function newWaypoint(state) {
    var x = BOX.x0 + (BOX.x1 - BOX.x0) * rand(state);
    var y = BOX.y0 + (BOX.y1 - BOX.y0) * rand(state);
    // A waypoint on top of where it already stands reads as the villain
    // freezing. If we drew one, bounce it to the opposite side instead.
    if (Math.abs(x - state.pos.x) + Math.abs(y - state.pos.y) < .28) {
      x = BOX.x0 + BOX.x1 - x;
      y = BOX.y0 + BOX.y1 - y;
    }
    state.way.x = x;
    state.way.y = y;
    return state;
  }

  function move(state, delta) {
    state.dodgeRemaining = Math.max(0, state.dodgeRemaining - delta);
    var speed = state.dodgeRemaining > 0 ? state.dodgeSpeed : state.moveSpeed;
    var dx = state.way.x - state.pos.x, dy = state.way.y - state.pos.y;
    var dist = Math.sqrt(dx * dx + dy * dy), step = speed * delta;
    if (dist <= step || dist < 1e-6) {       // arrived: stand on it, pick another
      state.pos.x = state.way.x;
      state.pos.y = state.way.y;
      newWaypoint(state);
    } else {
      state.pos.x += dx / dist * step;
      state.pos.y += dy / dist * step;
    }
    return state;
  }

  function start(levelIndex, levels) {
    var level = levels[levelIndex];
    var state = { mode:'intro', levelIndex:levelIndex, health:level.health, maxHealth:level.health,
      elapsed:0, timeLimit:level.timeLimit,
      cooldownRemaining:0, targetIndex:0, hits:0, shots:0,
      moveSpeed:level.moveSpeed, dodgeSpeed:level.dodgeSpeed,
      seed:(levelIndex + 1) * 7919, dodgeRemaining:0,
      pos:{ x:(BOX.x0 + BOX.x1) / 2, y:(BOX.y0 + BOX.y1) / 2 }, way:{ x:0, y:0 } };
    newWaypoint(state);
    return state;
  }

  function play(state) { if (state.mode === 'intro' || state.mode === 'paused') state.mode = 'playing'; return state; }
  function pause(state) { if (state.mode === 'playing') state.mode = 'paused'; return state; }

  // The clock and the cooldown, without moving the villain. The 3D game moves
  // its villain itself (world/fight.js) and runs only this.
  function clock(state, deltaSeconds) {
    if (state.mode !== 'playing') return state;
    var delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    state.cooldownRemaining = Math.max(0, state.cooldownRemaining - delta);
    state.elapsed = Math.min(state.timeLimit, state.elapsed + delta);
    if (state.elapsed >= state.timeLimit) state.mode = 'lost';
    return state;
  }

  function tick(state, deltaSeconds) {
    if (state.mode !== 'playing') return state;
    clock(state, deltaSeconds);
    if (state.mode === 'playing') move(state, Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0);
    return state;
  }

  // The rules of a shot, given whether it hit the current weak spot: the
  // cooldown, 20 damage, the next weak spot, the win, and the dodge. Both games
  // use this; they differ only in how they decide `hit` and where the villain
  // runs to.
  function judge(state, hit) {
    if (state.mode !== 'playing' || state.cooldownRemaining > 0) return { accepted:false };
    state.cooldownRemaining = COOLDOWN; state.shots++;
    if (hit) {
      state.health = Math.max(0, state.health-DAMAGE); state.hits++;
      if (state.health === 0) state.mode = 'won'; else state.targetIndex++;
    }
    // Break for new cover whether or not that one landed - it is reacting to
    // being shot at, not to being hurt.
    if (state.mode === 'playing') state.dodgeRemaining = DODGE_SECONDS;
    return { accepted:true, hit:!!hit };
  }

  function fire(state, point, target) {
    if (state.mode !== 'playing' || state.cooldownRemaining > 0) return { accepted:false };
    var dx = point.x-target.x, dy = point.y-target.y;
    var r = judge(state, dx*dx+dy*dy <= target.radius*target.radius);
    if (state.mode === 'playing') newWaypoint(state);
    return r;
  }

  var api = { DAMAGE:DAMAGE, COOLDOWN:COOLDOWN, BOX:BOX, DODGE_SECONDS:DODGE_SECONDS,
    start:start, play:play, pause:pause, tick:tick, clock:clock, judge:judge, fire:fire };
  if (typeof module !== 'undefined') module.exports = api;
  root.Combat = api;
})(typeof window === 'undefined' ? globalThis : window);

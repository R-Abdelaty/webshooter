(function (root) {
  'use strict';
  // How hard the 3D fights are (docs/PLAYER_PLAN.md, Session P4). There is
  // one level, HARD, the same for all three villains (the user's decision),
  // and everything that sets it is here, so it can be tuned in one place.
  // No Three.js; fight.js applies it to a fight and attacks.js times the
  // villains' attacks from it. CLASSIC keeps its own rules (levels.js,
  // combat.js) and is not touched by any of this.
  //
  // There is no clock in the 3D fights: a fight ends when the villain or the
  // player reaches 0.

  var HARD = {
    name: 'HARD',
    villainHp: 300,          // every villain: 15 of your hits
    shotDamage: 20,          // what one of your webs does (Combat.DAMAGE)
    playerHp: 100,
    cadence: [3, 5],         // seconds from the start of one attack to the start of the next
    damage: [15, 30],        // what an attack does, from a graze to a direct hit
    big: 25,                 // an attack doing this much or more is a heavy hit (hit_big)
    knockOff: 22,            // ...and this much or more knocks you off a swing line
    telegraph: .9,           // seconds of wind-up (clip, sound, laser, chevron) before it lands
    recover: .8,             // seconds after it when he is open
    invulnerable: .6,        // seconds after you're hit when nothing else can hurt you
    firstAttack: 1.5         // seconds after his entrance before his first wind-up
  };

  function copy(d) { return JSON.parse(JSON.stringify(d)); }
  // A level by name; HARD is the only one, and anything unknown is HARD.
  function get(name) { return copy(HARD); }
  // Somewhere between a and b ([a, b]) by u in 0..1.
  function span(r, u) { return r[0] + (r[1] - r[0]) * Math.max(0, Math.min(1, u)); }

  var api = { HARD: HARD, get: get, span: span };
  if (typeof module !== 'undefined') module.exports = api;
  root.Difficulty = api;
})(typeof window === 'undefined' ? globalThis : window);

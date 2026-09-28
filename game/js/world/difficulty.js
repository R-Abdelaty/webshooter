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
  // player reaches 0. Each attack's own share of `damage` (how hard a charge
  // hits, next to a swipe) is in attacks.js's constants.
  //
  // P7 (the user: "not hard enough - they don't seem to be trying to kill
  // me"): a quicker cadence with next to no breather, a shorter wind-up (but
  // always one), attacks from off the screen (with a longer wind-up), a
  // director that never lets 4 s go by without one, and a stagger that takes
  // 4 hits - more than the web's cooldown lets you land in an on-screen
  // wind-up.

  var HARD = {
    name: 'HARD',
    villainHp: 300,          // every villain: 15 of your hits
    shotDamage: 20,          // what one of your webs does (Combat.DAMAGE)
    playerHp: 100,
    cadence: [1.6, 2.8],     // seconds from the start of one attack to the start of the next
    damage: [15, 30],        // what an attack does, from a graze to a direct hit
    big: 25,                 // an attack doing this much or more is a heavy hit (hit_big)
    knockOff: 22,            // ...and this much or more knocks you off a swing line
    telegraph: .65,          // seconds of wind-up (clip, sound, laser, chevron) before it lands...
    offScreen: .5,           // ...and this much longer when he starts it out of your view (P7)
    recover: .6,             // seconds after it when he is open
    invulnerable: .4,        // seconds after you're hit when nothing else can hurt you
    firstAttack: 1.2,        // seconds after his entrance before his first wind-up
    breather: .2,            // at least this long after one attack's recovery before the next wind-up (P5)
    director: 4,             // seconds with nothing coming at you before the next attack starts at once (P7)
    range: { glider: 80, charge: 60, leap: 80 },  // metres: further off he closes in rather than attacking (P7)
    stagger: 4,              // this many of your hits during one wind-up stagger him and call it off (P5)
    dazed: 2.5,              // seconds the Rhino is dazed after a ram or running into a wall (P5)...
    dazedDamage: 2           // ...when each of your hits does this many times its damage
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

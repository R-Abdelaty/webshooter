(function (global) {
  'use strict';
  // timeLimit is the whole encounter: 30 seconds to bring the villain down.
  // The villain no longer closes in, so difficulty comes from health and from
  // how fast it moves - moveSpeed is its normal drift between waypoints and
  // dodgeSpeed the burst it puts on right after you take a shot at it. Both are
  // fractions of the arena per second.
  // The dodge used to be about three times the drift, which read as a teleport
  // rather than a dodge - by the time you had followed it, it had stopped. It
  // is now a little under twice, so the burst is still visible as a reaction to
  // your shot but stays trackable.
  var levels = [
    { n:1, villain:0, health:100, timeLimit:30, moveSpeed:.085, dodgeSpeed:.15 },
    { n:2, villain:1, health:140, timeLimit:30, moveSpeed:.115, dodgeSpeed:.20 },
    { n:3, villain:2, health:180, timeLimit:30, moveSpeed:.150, dodgeSpeed:.27 }
  ];
  global.LEVELS = levels;
  if (typeof module !== 'undefined') module.exports = levels;
})(typeof window === 'undefined' ? globalThis : window);

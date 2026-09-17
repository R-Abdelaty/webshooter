(function (global) {
  'use strict';
  var levels = [
    { n:1, villain:0, health:100, approachDuration:8, lungeDuration:.38 },
    { n:2, villain:1, health:140, approachDuration:6.5, lungeDuration:.34 },
    { n:3, villain:2, health:180, approachDuration:5.5, lungeDuration:.3 }
  ];
  global.LEVELS = levels;
  if (typeof module !== 'undefined') module.exports = levels;
})(typeof window === 'undefined' ? globalThis : window);

(function (root) {
  'use strict';
  // What the player's two models play (docs/PLAYER_PLAN.md, Session P2): the
  // full body (spiderman, third person) and the arms on the camera
  // (spiderman_arms, first person), from what the player is doing. No
  // Three.js: player-view.js hands the commands to the two CharacterRigs.
  //
  //   var a = PlayerAnim.create()
  //   var out = PlayerAnim.step(a, player, dt, extra)
  //     player: Player's state (grounded, vx/vy/vz, speed)
  //     extra:  what Player doesn't know yet - { perched, zip, swing: 'l'|'r'
  //             (the hand on the line), hits (a count), big (the last hit was
  //             heavy), dead } - all optional; P3 and P4 fill them in
  //   out.state  idle / walk / run / jump / fall / land / perch / swing / zip / dead
  //   out.body, out.arms  [[clip, opts], ...] for CharacterRig.play, in order
  //   out.speed          ground speed for the body's 'loco' (idle/run by speed)
  //   out.armSpeed       how fast the arms' run cycle turns (1 = its own pace)
  //
  //   var s = PlayerAnim.shoot(a)   a web shot: which hand, and the clips
  //     s.hand  'l' or 'r'. Shots alternate hands, unless one hand is holding
  //             a swing line: then the free one shoots.
  //     s.body, s.arms  [[clip, opts], ...] - layer clips (Rig.layer), so a
  //             shot plays over a run or a jump without stopping it
  //
  //   PlayerAnim.face(a, player, aimYaw, dt)  which way the third-person body
  //     faces: where you're going on the ground, where you aim for a moment
  //     after each shot. Radians, in Player's yaw (0 looks north, -z).
  //
  // The models only show the player: animation never moves him (fixed
  // decision 7). Every clip here is in place.

  var K = {
    IDLE_V: .3,            // m/s: slower than this on the ground is standing
    WALK_V: 3,             // ...and below this is a walk (the manifest's speeds.walk)
    RUN_V: 5.7,            // the body's run clip's own ground speed (speeds.run)
    ARMS_RUN_V: 2.5,       // the arms pump from here up
    ARMS_RATE: [.7, 1.6],  // the arms' run cycle, as a multiple of its own pace
    AIR_MIN: .2,           // seconds off the ground before it counts as falling (a kerb doesn't)
    JUMP_VY: 3,            // leaving the ground this fast upward is a jump
    LAND_AIR: .45,         // seconds in the air, or...
    LAND_VY: 7,            // ...a drop this fast, and touching down is a landing
    LAND_T: .35,           // how long a landing holds the state
    JUMP_FROM: .35,        // the jump clip's crouch is 0.6 s before take-off: start it this far in
    // The body's shoot clip is Mixamo's 2.3 s one-armed cast. Only the end of
    // its sweep is used, sped up: from 1.3 s, the arm straight out ahead at
    // 1.45 s (the snap, `events.shoot` in characters.json, when the web
    // leaves), done by 1.95 s.
    SHOOT: { from: 1.3, to: 1.95, speed: 2, fade: .05, fadeOut: .12 }, SHOOT_SNAP: 1.45,
    // The arms' shot starts a little in, so the snap comes 60 ms after the
    // flick instead of 133.
    FP_SHOOT: { from: .05, speed: 1.4, fade: .03, fadeOut: .08 }, FP_SNAP: .133,
    AIM_HOLD: .6,          // seconds the body keeps facing the aim after a shot
    TURN: 10,              // how fast the body turns to face (per second, eased)
    TURN_AIM: 40,          // ...and to face a shot, so the casting arm points where the web goes
    FACE_V: .8             // m/s: slower than this he keeps facing where he was
  };

  function create() {
    return { state: 'idle', body: null, arms: null, next: 'r', air: 0, jumped: false, landT: 0, fallVy: 0,
      grounded: true, swing: null, hits: 0, dead: false, face: null, aimT: 0, aimYaw: 0 };
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ground(v) { return v < K.IDLE_V ? 'idle' : v < K.WALK_V ? 'walk' : 'run'; }

  // What the player is doing now.
  function classify(a, p, dt, x) {
    var v = Math.hypot(p.vx || 0, p.vz || 0);
    if (x.dead) return 'dead';
    if (x.zip) return 'zip';
    if (x.swing) return 'swing';
    if (x.perched) return 'perch';
    if (!p.grounded) {
      if (a.grounded && (p.vy || 0) > K.JUMP_VY) a.jumped = true;
      a.air += dt; a.fallVy = Math.min(a.fallVy, p.vy || 0);
      if (a.jumped) return 'jump';
      return a.air >= K.AIR_MIN ? 'fall' : (a.state === 'land' ? 'land' : ground(v));
    }
    var landed = !a.grounded && (a.air >= K.LAND_AIR || -a.fallVy >= K.LAND_VY);
    a.air = 0; a.jumped = false; a.fallVy = 0;
    if (landed) a.landT = K.LAND_T;
    if (a.landT > 0) { a.landT -= dt; return 'land'; }
    return ground(v);
  }

  function step(a, p, dt, extra) {
    var x = extra || {}, out = { state: a.state, body: [], arms: [], speed: 0, armSpeed: 1 };
    dt = dt > 0 ? dt : 0;
    var was = a.state, st = classify(a, p, dt, x), v = Math.hypot(p.vx || 0, p.vz || 0);
    a.grounded = !!p.grounded;
    a.state = out.state = st;
    function body(c, o) { out.body.push([c, o || {}]); }
    function arms(c, o) { out.arms.push([c, o || {}]); }
    function bodyBase(c, o) { if (a.body !== c) { a.body = c; body(c, o); } }
    function armsBase(c, o) { if (a.arms !== c) { a.arms = c; arms(c, o); } }

    // Letting go of a line: that hand opens and drops back.
    if (a.swing && x.swing !== a.swing) arms('fp_release_' + a.swing);
    a.swing = x.swing || null;

    if (st === 'dead') {
      if (!a.dead) { a.dead = true; a.body = a.arms = null; body('death', { hold: true, fade: .15 }); arms('fp_death', { hold: true, fade: .1 }); }
      return out;
    }
    if (a.dead) { a.dead = false; a.body = a.arms = null; }

    if (st === 'idle' || st === 'walk' || st === 'run') {
      bodyBase('loco', { fade: .2 }); out.speed = v;
      if (v >= K.ARMS_RUN_V) { armsBase('fp_run', { fade: .2 }); out.armSpeed = clamp(v / K.RUN_V, K.ARMS_RATE[0], K.ARMS_RATE[1]); }
      else armsBase('fp_idle', { fade: .3 });
    } else if (st === 'jump') {
      if (was !== 'jump') { bodyBase('fall', { fade: .3 }); body('jump', { from: K.JUMP_FROM, fade: .05 }); }
      armsBase('fp_idle', { fade: .25 });
    } else if (st === 'fall') {
      bodyBase('fall', { fade: .25 }); armsBase('fp_idle', { fade: .25 });
    } else if (st === 'land') {
      if (was !== 'land') {
        // Running on out of it, the landing is only a dip.
        bodyBase('loco', { fade: .1 });
        body('land', v > K.WALK_V ? { from: .1, speed: 2, fade: .04 } : { fade: .04 });
      }
      out.speed = v;
      armsBase(v >= K.ARMS_RUN_V ? 'fp_run' : 'fp_idle', { fade: .2 });
    } else if (st === 'perch') {
      bodyBase('perch', { fade: .2 }); armsBase('fp_idle', { fade: .25 });
    } else if (st === 'swing') {
      bodyBase('hang', { fade: .15 }); armsBase('fp_swing_hold_' + x.swing, { fade: .1 });
    } else if (st === 'zip') {
      bodyBase('fall', { fade: .15 });
      if (was !== 'zip') { a.arms = 'fp_zip'; arms('fp_zip', { hold: true, fade: .08 }); }
    }

    // Hit: a flinch over whatever he's doing (the body's hit is additive; the
    // arms come up before the face).
    var hits = x.hits || 0;
    if (hits > a.hits) { body(x.big ? 'hit_big' : 'hit'); arms('fp_hit', { fade: .05 }); }
    a.hits = hits;
    return out;
  }

  // Send the clips for the state again on the next step (models that have
  // just loaded missed them).
  function resync(a) { a.body = a.arms = null; a.dead = false; }

  // Which hand shoots next, without taking the shot.
  function hand(a) {
    if (a.swing) return a.swing === 'l' ? 'r' : 'l';
    return a.next;
  }
  function shoot(a) {
    var h = hand(a);
    if (!a.swing) a.next = h === 'r' ? 'l' : 'r';
    a.aimT = K.AIM_HOLD;
    var S = K.SHOOT, F = K.FP_SHOOT;
    return {
      hand: h,
      body: [[h === 'r' ? 'shoot' : 'shoot_l', { from: S.from, to: S.to, speed: S.speed, fade: S.fade, fadeOut: S.fadeOut }]],
      arms: [['fp_shoot_' + h, { from: F.from, speed: F.speed, fade: F.fade, fadeOut: F.fadeOut }]]
    };
  }

  // The body's facing (third person): the aim's for a moment after a shot,
  // else the way he's moving, else where it was; turned there eased, the
  // short way round.
  function face(a, p, aimYaw, dt) {
    dt = dt > 0 ? dt : 0;
    if (a.face === null) a.face = p.yaw || 0;
    a.aimT = Math.max(0, a.aimT - dt);
    var v = Math.hypot(p.vx || 0, p.vz || 0), want = a.face;
    if (a.aimT > 0) want = aimYaw;
    else if (a.swing || a.state === 'perch') want = aimYaw;
    else if (v > K.FACE_V) want = Math.atan2(-(p.vx || 0), -(p.vz || 0));
    var d = wrap(want - a.face);
    a.face = wrap(a.face + d * (1 - Math.exp(-(a.aimT > 0 ? K.TURN_AIM : K.TURN) * dt)));
    return a.face;
  }
  function wrap(x) { return Math.atan2(Math.sin(x), Math.cos(x)); }

  var api = { create: create, step: step, resync: resync, shoot: shoot, hand: hand, face: face, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.PlayerAnim = api;
})(typeof window === 'undefined' ? globalThis : window);

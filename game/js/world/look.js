(function (root) {
  'use strict';
  // How the wrist looks around the 3D city. No Three.js: world-game.js feeds
  // this the controller's smoothed position each frame and applies what comes
  // back to the player's yaw and pitch.
  //
  // A wrist turns about +/-80 degrees sideways and -40..+60 up and down, and
  // its yaw is only relative, so it cannot be mapped 1:1 onto a camera that
  // must turn all the way round. Two answers, chosen under Settings -> LOOK:
  //
  //   EDGE TURN  The crosshair moves over the screen with the wrist. Inside the
  //              turn box the view holds still and you aim; past the box edge
  //              the view turns that way, faster the further past you are.
  //              Unlimited turning from a limited wrist, precise aim inside.
  //   DIRECT     The crosshair stays in the middle. Wrist yaw turns the view
  //              with a gain; wrist pitch IS the view's pitch.
  //
  // The mouse (pointer lock) always looks directly with a centred crosshair.
  //
  // Screen positions are fractions of the view, 0..1 from the top left, the
  // same units as Controller.pos. Yaw is positive to the left and pitch
  // positive upward, as on the Three.js camera and in player.js.

  var Ctl = root.Controller || (typeof require === 'function' ? require('../controller.js') : null);
  var DEG = Math.PI / 180;

  var K = {
    // The turn box, as the half-size of its sides from the centre of the view:
    // .3 is a box 60% of the screen wide and high.
    BOX_X: .3, BOX_Y: .3,
    // How far past the box edge the turn reaches full speed. .2 puts full
    // speed at the screen edge, so the crosshair is still on screen at full
    // turn.
    RAMP_X: .2, RAMP_Y: .2,
    // Shape of the rise from zero at the box edge to full speed: 2 starts very
    // gently, so hovering just outside the box is a slow, fine turn.
    CURVE: 2,
    // Full turn speed at TURN SPEED 1, degrees per second.
    MAX_YAW: 140, MAX_PITCH: 90,
    // The controller maps 250 degrees of wrist to one screen, which is right
    // for the flat 2D game but leaves the box edge 75 degrees away - at the
    // limit of a wrist. The view multiplies the controller's offset from the
    // centre by these, so at sensitivity 1 the box edge is about 37 degrees
    // sideways and 26 up, and full speed about 62 and 43.
    EDGE_GAIN_X: 2, EDGE_GAIN_Y: 1.3,
    // DIRECT: degrees of view per degree of wrist yaw at sensitivity 1, and
    // degrees of view pitch per degree of wrist pitch.
    DIRECT_GAIN: 2, DIRECT_PITCH_GAIN: 1,
    PITCH_LIMIT: 75,
    // The crosshair is kept this far inside the view's edge when the aim has
    // run past it, so you can still see where you are pointing.
    INSET: .02,
    // The shooter places a shot where you were aiming this long before the
    // flick began (PRE_FLICK_MS in web_shooter.ino). The camera is rewound by
    // the same amount.
    PRE_FLICK_MS: 80,
    HISTORY_MS: 1000
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function mode(m) { return m === 'direct' ? 'direct' : 'edge'; }
  function num(v, d) { v = +v; return Number.isFinite(v) && v > 0 ? v : d; }

  function create() { return { lastX: null, lastSource: null, lastMode: null, history: [], crosshair: { x: .5, y: .5 }, turning: false }; }

  // Where the crosshair is drawn, from the controller position. EDGE TURN
  // spreads it with the view's gain; DIRECT and the mouse keep it centred.
  function crosshair(pos, m, wrist) {
    if (!wrist || mode(m) === 'direct' || !pos) return { x: .5, y: .5 };
    var x = .5 + (pos.x - .5) * K.EDGE_GAIN_X, y = .5 + (pos.y - .5) * K.EDGE_GAIN_Y;
    return { x: clamp(x, K.INSET, 1 - K.INSET), y: clamp(y, K.INSET, 1 - K.INSET), rawX: x, rawY: y };
  }

  // 0 inside the box, rising smoothly and without a step to 1 at RAMP past it.
  function ramp(off, box, rampLen) {
    var u = clamp((Math.abs(off) - box) / rampLen, 0, 1);
    return u === 0 ? 0 : Math.pow(u, K.CURVE) * (off < 0 ? -1 : 1);
  }

  // EDGE TURN: degrees per second of yaw and pitch for a crosshair at raw view
  // position (x, y) - raw meaning before it is held on screen, although past
  // the ramp it makes no difference.
  function turnRate(x, y, speed) {
    speed = num(speed, 1);
    return {
      yaw: -ramp(x - .5, K.BOX_X, K.RAMP_X) * K.MAX_YAW * speed || 0,       // right of the box turns right
      pitch: -ramp(y - .5, K.BOX_Y, K.RAMP_Y) * K.MAX_PITCH * speed || 0    // above the box (small y) looks up
    };
  }

  // DIRECT: the view pitch (degrees) for a controller height. The controller
  // puts its y at .5 for the centre pitch and moves it VERTICAL_GAIN times
  // SCREENS_PER_DEG per degree (times sensitivity), so this undoes that - and
  // keeps the sensitivity, which scales both axes alike.
  function directPitch(y) {
    var deg = (.5 - y) / (Ctl.SCREENS_PER_DEG * Ctl.VERTICAL_GAIN) * K.DIRECT_PITCH_GAIN;
    return clamp(deg, -K.PITCH_LIMIT, K.PITCH_LIMIT);
  }

  // One frame. input:
  //   pos     Controller.display() - the smoothed wrist aim
  //   wrist   the wrist is driving (source 'wrist' and the centre is set)
  //   mode    'edge' or 'direct'
  //   speed   TURN SPEED multiplier
  //   pitch   the camera's current pitch, radians (DIRECT sets pitch outright)
  //   frozen  a flick is in progress: nothing may move the camera
  //   hold    paused, or something is covering the view: take the wrist's
  //           position as it is now and turn nothing
  //   rebase  the aim was just recentred: its jump is not a turn
  // Returns { dyaw, dpitch } in radians, for Player.look, plus the crosshair.
  function step(s, input, dt) {
    var m = mode(input.mode), wrist = !!input.wrist, pos = input.pos || { x: .5, y: .5 };
    var out = { dyaw: 0, dpitch: 0, crosshair: crosshair(pos, m, wrist), turning: false };
    s.crosshair = out.crosshair; s.turning = false;
    // Starting over: a different driver or mode, or a recentre, or a hold.
    var fresh = !wrist || input.hold || input.rebase || s.lastSource !== 'wrist' || s.lastMode !== m || s.lastX === null;
    s.lastSource = wrist ? 'wrist' : 'other'; s.lastMode = m;
    if (!wrist) { s.lastX = null; return out; }
    if (input.frozen) return out;             // lastX is kept: DIRECT resumes as a function of position
    if (input.hold) { s.lastX = pos.x; return out; }
    if (!(dt > 0)) dt = 0;

    if (m === 'edge') {
      s.lastX = pos.x;
      var r = turnRate(out.crosshair.rawX, out.crosshair.rawY, input.speed);
      out.dyaw = r.yaw * dt * DEG; out.dpitch = r.pitch * dt * DEG;
      out.turning = s.turning = r.yaw !== 0 || r.pitch !== 0;
      return out;
    }

    // DIRECT. Yaw follows the change in position (the controller's x is an
    // absolute function of the wrist's yaw, so summing its changes cannot
    // drift), and pitch is set outright from the wrist's pitch.
    if (!fresh && pos.x !== s.lastX) out.dyaw = -(pos.x - s.lastX) / Ctl.SCREENS_PER_DEG * K.DIRECT_GAIN * DEG;
    s.lastX = pos.x;
    out.dpitch = directPitch(pos.y) * DEG - (input.pitch || 0);
    return out;
  }

  // --- where the camera was --------------------------------------------------
  // The shot is placed where the crosshair was just before the flick, so the
  // camera has to be the one from that moment too - in EDGE TURN it may have
  // kept turning since. Each frame is recorded against the device clock time
  // whose aim it displayed (see Controller.display), so the camera for a
  // flick is found by the same clock the shooter stamps its shots with.
  function record(s, t, cam) {
    if (!Number.isFinite(t)) return;
    var h = s.history;
    if (h.length && t < h[h.length - 1].t) h.length = 0;     // the clock started again
    h.push({ t: t, cam: cam });
    while (h.length > 1 && t - h[0].t > K.HISTORY_MS) h.shift();
  }
  function forget(s) { s.history.length = 0; }
  // The last camera shown at or before device time t; the oldest one if they
  // are all later; null if there is no history.
  function cameraAt(s, t) {
    var h = s.history, i;
    if (!h.length || !Number.isFinite(t)) return null;
    for (i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i].cam;
    return h[0].cam;
  }
  // The device time a shoot packet's aim was taken at.
  function shotTime(p) { return p && Number.isFinite(p.ms) ? p.ms - K.PRE_FLICK_MS : NaN; }

  // The world direction through view point (x, y) for a camera with yaw and
  // pitch (radians, rotation order YXZ as on the Three.js camera), a vertical
  // field of view in degrees and an aspect ratio. Unit length.
  function ray(cam, view, fov, aspect) {
    var tv = Math.tan(fov * DEG / 2), th = tv * aspect;
    var x = (view.x * 2 - 1) * th, y = (1 - view.y * 2) * tv, z = -1;
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    var y1 = y * cp - z * sp, z1 = y * sp + z * cp;                  // pitch, about x
    var x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;               // then yaw, about y
    var n = Math.hypot(x2, y1, z2);
    return { x: x2 / n, y: y1 / n, z: z2 / n };
  }

  var api = { create: create, step: step, crosshair: crosshair, turnRate: turnRate, directPitch: directPitch,
    record: record, forget: forget, cameraAt: cameraAt, shotTime: shotTime, ray: ray, mode: mode, constants: K };
  if (typeof module !== 'undefined') module.exports = api;
  root.Look = api;
})(typeof window === 'undefined' ? globalThis : window);

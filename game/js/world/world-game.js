(function () {
  'use strict';
  // START's 3D world: builds the city the first time, drops you on the spawn
  // roof, and runs the loop - Move for walking, the wrist or the mouse for
  // looking (Look decides how), a flick or a click to shoot a web, Esc to
  // pause. The 2D game is untouched and still reachable as CLASSIC.

  var $ = function (id) { return document.getElementById(id); };
  var SEED = 20180907;             // one fixed city; change it for a different one
  var MOUSE_SENS = .0022;          // radians per pixel of mouse movement
  var RANGE = 1500;                // metres a web can reach
  var STRAND_MS = 220;             // how long the strand from the wrist to the hit shows
  var canvas = $('world-canvas'), fx = $('world-fx'), fxc = fx.getContext('2d'), cross = $('world-crosshair');
  var world = null, city = null, player = null, webs = null, look = Look.create(), strands = [];
  var running = false, paused = false, locked = false, leaving = false, rebase = false, last = 0, perf = false, perfAt = 0, frames = 0, lastLook = null;

  function show(el, on) { el.classList.toggle('is-hidden', !on); }
  function ctl() { return window.WebShooterGame ? WebShooterGame.getController() : null; }
  function settings() { var c = ctl(); return (c && c.settings) || {}; }
  function fov() { var f = +settings().fov; return Number.isFinite(f) ? Math.max(60, Math.min(100, f)) : 75; }
  // The wrist is looking: it has the aim, and there is a centre to measure from.
  function wristLooks(c) { return !!c && c.calibrated && c.source === 'wrist'; }

  function build() {
    city = City.generate(SEED);
    world = World3D.create(canvas, city);
    webs = WorldWebs.create(world.scene);
    window.addEventListener('resize', function () { if (running) layout(); });
  }
  function layout() {
    world.resize();
    var r = window.devicePixelRatio || 1;
    fx.width = Math.round(fx.clientWidth * r); fx.height = Math.round(fx.clientHeight * r);
    fxc.setTransform(r, 0, 0, r, 0, 0);
  }

  function lock() {
    if (locked || !canvas.requestPointerLock) return;
    try {
      var r = canvas.requestPointerLock();
      // A flick on the menu is not a user gesture, so the browser refuses the
      // lock. That's fine: the wrist doesn't need it, and a click takes it.
      if (r && r.catch) r.catch(function () {});
    } catch (_) {}
  }
  function unlock() { if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock(); }

  function start() {
    show($('menu'), false); show($('game'), false); show($('world'), true);
    show($('world-card'), false);
    running = true; paused = false; leaving = false;
    lock();                          // inside the click, while it still counts as a gesture
    if (!world) {
      show($('world-loading'), true);
      // Let the "building" note paint before the work blocks the page.
      requestAnimationFrame(function () { setTimeout(begin, 0); });
    } else begin();
  }
  function begin() {
    if (!world) build();
    show($('world-loading'), false);
    player = Player.create(city.spawn);
    player.pitch = -.22;             // look out and down over the city, not at the sky
    look = Look.create(); strands = []; webs.clear();
    layout();
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function pause() {
    if (!running || paused) return;
    paused = true;
    Move.keyboardSource && Move.keyboardSource.release();
    unlock();
    show($('world-card'), true);
  }
  function resume() {
    if (!running) return;
    paused = false;
    show($('world-card'), false); show($('settings'), false);
    last = performance.now();
    lock();
  }
  function quit() {
    if (!running) return;
    leaving = true; running = false; paused = false;
    unlock();
    show($('world-card'), false); show($('world'), false); show($('menu'), true);
    document.dispatchEvent(new CustomEvent('webshooter:quit'));
  }

  // The time on the shooter's clock whose aim this frame shows. Controller
  // .display() draws the aim a little behind real time, and the camera turns
  // from what it draws, so this is the moment the frame's camera belongs to.
  function deviceTime(c, now) {
    if (!c || c.clockOff === null || c.clockOff === undefined) return NaN;
    return now - c.clockOff - Controller.renderDelay(c);
  }
  function camera() { return { yaw: player.yaw, pitch: player.pitch, eye: Player.eye(player) }; }

  function frame(now) {
    if (!running || !world) return;
    var dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
    var c = ctl(), S = settings(), wrist = wristLooks(c);
    var r = Look.step(look, {
      pos: c ? Controller.display(c, now) : null, wrist: wrist, mode: S.lookMode, speed: S.turnSpeed, pitch: player.pitch,
      // The flick is shooting, not looking: the camera holds still through it.
      frozen: wrist && !!(c.last && c.last.flick),
      hold: paused, rebase: rebase
    }, dt);
    rebase = false; lastLook = r;
    if (!paused) {
      Player.look(player, r.dyaw, r.dpitch);
      Player.step(player, { move: Move.vector(), buttons: Move.buttons() }, dt, city);
    }
    world.setFov(fov());
    world.update(dt, Player.eye(player), player.yaw, player.pitch);
    Look.record(look, deviceTime(c, now), camera());
    cross.style.left = r.crosshair.x * 100 + '%'; cross.style.top = r.crosshair.y * 100 + '%';
    cross.classList.toggle('is-turning', r.turning);
    webs.update(now);
    world.render();
    drawStrands(now);
    if (perf) readout(now, c, S);
    requestAnimationFrame(frame);
  }

  // --- shooting ---------------------------------------------------------------
  // A flick passes the controller's pre-flick aim (Controller.shot) and the
  // shoot packet; the camera is rewound to the frame that showed that aim, so
  // the web goes exactly where the crosshair was, however far the view has
  // turned since. A click has neither and shoots from where things are now.
  function fire(at, p) {
    if (!running || paused || !world || !player) return null;
    var c = ctl(), S = settings(), wrist = wristLooks(c);
    var view = at && p ? Look.crosshair(at, S.lookMode, wrist) : look.crosshair;
    var cam = (p && Look.cameraAt(look, Look.shotTime(p))) || camera();
    var dir = Look.ray(cam, view, world.camera.fov, world.camera.aspect);
    var hit = world.raycast(cam.eye, dir, RANGE), now = performance.now();
    var end = hit ? hit.point : { x: cam.eye.x + dir.x * RANGE, y: cam.eye.y + dir.y * RANGE, z: cam.eye.z + dir.z * RANGE };
    if (hit) webs.add(hit.point, hit.normal, hit.distance, now);
    strands.push({ end: { x: end.x, y: end.y, z: end.z }, time: now });
    WSAudio.thwip(); if (hit) WSAudio.thunk();
    return hit ? { point: hit.point, distance: hit.distance, object: hit.object, view: view } : { point: null, view: view };
  }

  // The strand from the wrist - the bottom right of the view - to where the web
  // landed, only for the instant of the shot, like the 2D game's.
  function drawStrands(now) {
    var w = fx.clientWidth, h = fx.clientHeight;
    strands = strands.filter(function (s) { return now - s.time < STRAND_MS; });
    fxc.clearRect(0, 0, w, h);
    strands.forEach(function (s) {
      var e = world.project(s.end);
      if (!e.front) return;
      var ox = w * .8, oy = h + 4, x = e.x * w, y = e.y * h, mx = (ox + x) / 2, my = (oy + y) / 2 + Math.abs(x - ox) * .06;
      fxc.save(); fxc.globalAlpha = Math.max(0, 1 - (now - s.time) / STRAND_MS);
      fxc.strokeStyle = '#fff'; fxc.lineWidth = 2.5; fxc.lineCap = 'round';
      fxc.shadowColor = 'rgba(0,0,0,.35)'; fxc.shadowBlur = 2;
      fxc.beginPath(); fxc.moveTo(ox, oy); fxc.quadraticCurveTo(mx, my, x, y); fxc.stroke(); fxc.restore();
    });
  }

  // P shows frame rate, draw calls and where you are - the numbers the
  // performance budget in docs/3D_PLAN.md is written in - and what the look
  // is doing, for tuning it.
  function readout(now, c, S) {
    frames++;
    if (now - perfAt < 250) return;
    var fps = frames * 1000 / (now - perfAt), r = world.info.render, dt = (now - perfAt) / 1000 / Math.max(1, frames);
    frames = 0; perfAt = now;
    var src = wristLooks(c) ? 'wrist' : (c && !c.calibrated ? 'no centre yet' : 'mouse');
    var turn = lastLook && dt > 0 ? '  ·  turn ' + (lastLook.dyaw / dt * 180 / Math.PI).toFixed(0) + ' / ' + (lastLook.dpitch / dt * 180 / Math.PI).toFixed(0) + ' °/s' : '';
    $('world-perf').textContent = fps.toFixed(0) + ' fps  ·  ' + r.calls + ' draw calls  ·  ' +
      (r.triangles / 1000).toFixed(0) + 'k tris  ·  x ' + player.x.toFixed(0) + ' y ' + player.y.toFixed(1) + ' z ' + player.z.toFixed(0) +
      '\nlook ' + (Look.mode(S.lookMode) === 'direct' ? 'DIRECT' : 'EDGE TURN') + ' (' + src + ')  ·  crosshair ' +
      look.crosshair.x.toFixed(2) + ', ' + look.crosshair.y.toFixed(2) + turn +
      '  ·  yaw ' + (player.yaw * 180 / Math.PI).toFixed(0) + '° pitch ' + (player.pitch * 180 / Math.PI).toFixed(0) + '°  ·  fov ' + fov();
  }

  // A click shoots once the view has the mouse, or straight away while the
  // wrist is aiming; the first click with the mouse just takes the mouse.
  canvas.addEventListener('mousedown', function (e) {
    if (!running || paused || e.button !== 0) return;
    if (locked || wristLooks(ctl())) fire(null, null);
    if (!locked) lock();
  });
  document.addEventListener('pointerlockchange', function () {
    locked = document.pointerLockElement === canvas;
    document.body.classList.toggle('world-locked', locked);
    // Esc while locked is swallowed by the browser to release the lock, so the
    // lock going away is how a pause arrives.
    if (!locked && running && !paused && !leaving) pause();
  });
  document.addEventListener('mousemove', function (e) {
    if (!locked || paused || !player || !(e.movementX || e.movementY)) return;
    // Moving the mouse takes the look from the wrist, and puts the wrist's aim
    // in the middle, which is where it picks up again when you turn it.
    var c = ctl();
    if (c && c.source !== 'mouse') { c.source = 'mouse'; c.pos = { x: .5, y: .5 }; c.trail = []; }
    Player.look(player, -e.movementX * MOUSE_SENS, -e.movementY * MOUSE_SENS);
  });
  window.addEventListener('keydown', function (e) {
    if (!running) return;
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (e.key === 'Escape' && !paused) pause();
    // menu.js recentres the aim on C; that jump must not turn the view.
    if (e.key === 'c' || e.key === 'C') rebase = true;
    if (e.code === 'KeyP') { perf = !perf; show($('world-perf'), perf); frames = 0; perfAt = performance.now(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });
  $('btn-world-resume').onclick = resume;
  $('btn-world-menu').onclick = quit;
  $('btn-world-quit').onclick = quit;
  $('btn-world-settings').onclick = function () { show($('settings'), true); };

  window.WorldGame = {
    start: start, quit: quit, pause: pause, resume: resume, fire: fire,
    active: function () { return running; },
    paused: function () { return paused; },
    get player() { return player; }, get city() { return city; }, get world() { return world; }, get look() { return look; }
  };
})();

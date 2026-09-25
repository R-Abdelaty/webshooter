(function () {
  'use strict';
  // START's 3D world: builds the city the first time, drops you on the spawn
  // roof, and runs the loop - Move for walking, pointer-lock mouse for looking,
  // Esc to pause. The wrist's look and aim arrive in Session 2; the 2D game is
  // untouched and still reachable as CLASSIC.

  var $ = function (id) { return document.getElementById(id); };
  var SEED = 20180907;             // one fixed city; change it for a different one
  var MOUSE_SENS = .0022;          // radians per pixel of mouse movement
  var canvas = $('world-canvas'), world = null, city = null, player = null;
  var running = false, paused = false, locked = false, leaving = false, last = 0, perf = false, perfAt = 0, frames = 0;

  function show(el, on) { el.classList.toggle('is-hidden', !on); }

  function build() {
    city = City.generate(SEED);
    world = World3D.create(canvas, city);
    window.addEventListener('resize', function () { if (running) world.resize(); });
  }

  function lock() {
    if (locked || !canvas.requestPointerLock) return;
    try {
      var r = canvas.requestPointerLock();
      // A flick on the menu is not a user gesture, so the browser refuses the
      // lock. That's fine: click the view to take it.
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
    world.resize();
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
    show($('world-card'), false);
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

  function frame(now) {
    if (!running || !world) return;
    var dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
    if (!paused) Player.step(player, { move: Move.vector(), buttons: Move.buttons() }, dt, city);
    world.update(dt, Player.eye(player), player.yaw, player.pitch);
    world.render();
    if (perf) readout(now);
    requestAnimationFrame(frame);
  }

  // P shows frame rate, draw calls and where you are - the numbers the
  // performance budget in docs/3D_PLAN.md is written in.
  function readout(now) {
    frames++;
    if (now - perfAt < 500) return;
    var fps = frames * 1000 / (now - perfAt), r = world.info.render;
    frames = 0; perfAt = now;
    $('world-perf').textContent = fps.toFixed(0) + ' fps  ·  ' + r.calls + ' draw calls  ·  ' +
      (r.triangles / 1000).toFixed(0) + 'k tris  ·  x ' + player.x.toFixed(0) + ' y ' + player.y.toFixed(1) + ' z ' + player.z.toFixed(0);
  }

  canvas.addEventListener('click', function () { if (running && !paused) lock(); });
  document.addEventListener('pointerlockchange', function () {
    locked = document.pointerLockElement === canvas;
    document.body.classList.toggle('world-locked', locked);
    // Esc while locked is swallowed by the browser to release the lock, so the
    // lock going away is how a pause arrives.
    if (!locked && running && !paused && !leaving) pause();
  });
  document.addEventListener('mousemove', function (e) {
    if (!locked || paused || !player) return;
    Player.look(player, -e.movementX * MOUSE_SENS, -e.movementY * MOUSE_SENS);
  });
  window.addEventListener('keydown', function (e) {
    if (!running) return;
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (e.key === 'Escape' && !paused) pause();
    if (e.code === 'KeyP') { perf = !perf; show($('world-perf'), perf); frames = 0; perfAt = performance.now(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });
  $('btn-world-resume').onclick = resume;
  $('btn-world-menu').onclick = quit;
  $('btn-world-quit').onclick = quit;

  window.WorldGame = {
    start: start, quit: quit, pause: pause, resume: resume,
    active: function () { return running; },
    paused: function () { return paused; },
    get player() { return player; }, get city() { return city; }, get world() { return world; }
  };
})();

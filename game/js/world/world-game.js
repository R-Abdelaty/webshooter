(function () {
  'use strict';
  // The 3D game: builds the city the first time, and runs it in one of three
  // modes - a fight (Encounters/Fight), the training range (Training3D), or
  // free roam, where light columns on the street mark where each fight
  // starts. Move walks; the wrist or the mouse looks (Look decides how); a
  // flick or a click shoots a web. The cards (INTRO, PAUSED, DEFEAT, VICTORY)
  // hold everything still while they are up. The 2D game is untouched and
  // still reachable as CLASSIC.
  //
  // The graphics setting (Gfx: LOW / MED) is applied from the
  // settings each frame it changes. A villain hit throws its particles and
  // flashes where it landed (fx.js) and freezes the fight for a few frames
  // (the hit-stop); every web that lands throws a puff of strands.
  //
  // The city lives: cars, cabs and walkers (Traffic, drawn by life.js) - the
  // ones in a street-level fight's way are cleared for it. The HUD is
  // hud-view.js's, from Hud.status. Sounds happen where they happen: the
  // villain's voice, feet and glider (SoundCues), the webs' impacts, horns
  // and the street's rumble, with the camera as the listener.
  //
  // You are Spider-Man (docs/PLAYER_PLAN.md, P2): PlayerAnim picks the clips
  // for what you're doing, player-view.js shows them - the arms on the
  // camera in first person, the whole of him over his right shoulder in
  // third (PlayerCamera places that camera and pulls it in off walls).
  // Settings -> CAMERA, or T, switches between them live. Shots are still
  // aimed from the camera through the crosshair, and each one is thrown by
  // a hand - alternately - whose wrist the web leaves from. The web itself
  // is a fan of fibres in the world (web-shot.js, web-lines.js): it leaves
  // at the snap of the hand, flies out, and what it does when it gets there
  // (the splat, the hit's flash and particles, the sound) happens when it
  // gets there. The game's rules take the shot at once.
  //
  // And you swing (P3, swing.js). A flick or a click is judged by
  // Swing.decide: at a villain (or the training target) it is a shot, as
  // above; at a wall in reach it is a line to swing on (let go by flicking at
  // nothing, or Space); at a roof edge or top, a zip up to it and a perch.
  // While swing.js has you - on a line, flying off one, zipping, perched -
  // it moves you and Player doesn't. The line is drawn from the hand that
  // holds it (web-lines.js), which reaches for it (player-view.js); the
  // camera kicks wider with speed and, in first person, rolls into the arc
  // and shows speed lines (CAMERA MOTION: REDUCED tones them down); wind
  // and the line's creak are swing-audio.js's.
  //
  // And the fights are a real fight (P4): one HARD level for all three
  // (difficulty.js), your health as well as his, and no clock - it ends when
  // he goes down or you do. The Goblin hunts you and attacks (attacks.js,
  // run by fight.js): every attack is telegraphed - a wind-up clip, a sound,
  // the guns' red laser, and a red chevron at the screen's edge when he's
  // out of view - and tested against your body where it lands. A web at one
  // of his bombs in flight shoots it down. Hit, the view shakes (capped) and
  // reddens at the edges, the hands or the body flinch, a heavy hit knocks
  // you off a swing line; at 0 you go down, the view slumps, and DEFEAT
  // offers a RETRY. attack-view.js draws the bombs, lasers and tracers;
  // attack-audio.js makes their sounds.
  //
  // The Rhino and Venom fight back too (P5): the Rhino charges you on the
  // street or rams the building you're up on (a red ring on the roof shows
  // the quake's reach; the building shakes under you), and is dazed after;
  // Venom pounces (a red ring where he'll land), claws you up close and
  // whips a tentacle at you from further off. Their dust, sounds and shakes
  // come from the fight's events here.

  var $ = function (id) { return document.getElementById(id); };
  var SEED = 20180907;             // one fixed city; change it for a different one
  var MOUSE_SENS = .0022;          // radians per pixel of mouse movement
  var RANGE = 1500;                // metres a web can reach
  var SHAKE = .012, SHAKE_MS = 260; // a hit's screen shake: radians, and how long it takes to settle
  var SAVE_KEY = 'ws.save3d.v1';
  // How long the defeat (or the villain getting away) plays before its card.
  var END_MS = { won: 1800, lost: 2600 };
  var canvas = $('world-canvas'), overlay = $('world-fx'), fxc = overlay.getContext('2d'), cross = $('world-crosshair');
  var world = null, city = null, spots = null, player = null, webs = null, actors = null, villains = null, look = Look.create(), lines = null, due = [];
  var running = false, paused = false, locked = false, leaving = false, rebase = false, looping = false, last = 0;
  var perf = false, perfAt = 0, frames = 0, lastLook = null, pending = null;
  var mode = 'roam', fight = null, enc = null, range = null, shownEnd = null, endAt = 0, armed = false;
  var shakeAt = -1e9, shakeAmp = 0, hooks = [], modelShown = false, going = false;
  var fx = null, tierName = null, stopUntil = 0;
  var traffic = null, life = null, hudView = null, cues = null, nearCars = [];
  var HORN_EVERY = 16;             // seconds between horns, on average, down among the traffic
  var you = null, anim = PlayerAnim.create(), pcam = PlayerCamera.create(), view = null, shots = [], lastState = 'idle';
  var swing = Swing.create(), held = null, fxv = { fov: 0, roll: 0, lines: 0 };
  var attacksView = null, hurtAt = -1e9, hurtDmg = 0, deadAt = null, shakeMs = SHAKE_MS, beeps = {}, popped = {};

  function show(el, on) { el.classList.toggle('is-hidden', !on); }
  function ctl() { return window.WebShooterGame ? WebShooterGame.getController() : null; }
  function settings() { var c = ctl(); return (c && c.settings) || {}; }
  function fov() { var f = +settings().fov; return Number.isFinite(f) ? Math.max(60, Math.min(100, f)) : 75; }
  // The wrist is looking: it has the aim, and there is a centre to measure from.
  function wristLooks(c) { return !!c && c.calibrated && c.source === 'wrist'; }
  function allSpots() { return spots.fights.concat([spots.training]); }

  function build() {
    city = City.generate(SEED);
    spots = Encounters.build(city);
    world = World3D.create(canvas, city);
    webs = WorldWebs.create(world.scene);
    lines = WorldWebLines.create(world.scene);
    actors = WorldActors.create(world.scene, allSpots());
    // The villains' models, loaded now so each fight's is ready by its GO.
    villains = WorldVillains.create(world.scene, world);
    villains.preload();
    fx = WorldFx.create(world.scene);
    attacksView = WorldAttacks.create(world.scene);
    // A beaten villain dissolves as the web wraps him.
    villains.onWrap = function (caps) { fx.wrap(caps, Player.eye(player)); };
    traffic = Traffic.create(city);
    life = WorldLife.create(world.scene, traffic);
    hudView = WorldHud.create(city, spots);
    // You: loaded now, so he's there by the time the city is.
    you = WorldPlayer.create(world);
    you.load().then(function () { you.setMode(camMode().camera); PlayerAnim.resync(anim); });
    applyTier();
    window.addEventListener('resize', function () { if (running) layout(); });
  }
  function layout() {
    world.resize();
    var r = window.devicePixelRatio || 1;
    overlay.width = Math.round(overlay.clientWidth * r); overlay.height = Math.round(overlay.clientHeight * r);
    fxc.setTransform(r, 0, 0, r, 0, 0);
  }

  // The graphics setting, when it changes (and once at the start).
  function applyTier() {
    var t = Gfx.tier(settings().graphics);
    if (t.name === tierName) return;
    tierName = t.name;
    world.setTier(t);
    villains.setCast(t.cast);
    life.setCast(t.cast);
    you.setCast(t.cast);
    fx.setScale(t.particles);
    if (mode === 'fight' && enc) lightFight();
  }
  // A fight's light: the following shadow sits on the villain's stretch of
  // the city, and the villains reflect the city as seen from there.
  function lightFight() {
    var f = Encounters.focus(enc);
    world.setShadowFocus(f);
    world.update(0, Player.eye(player), player.yaw, player.pitch);
    var env = world.environment(f, world.tier.env, [villains.group, fx.group, life.group, you.group, lines.group, attacksView.group]);
    villains.setEnvironment(env);
    you.setEnvironment(env);
  }

  function lock() {
    if (locked || !canvas.requestPointerLock) return;
    try {
      var r = canvas.requestPointerLock();
      // A flick on a card is not a user gesture, so the browser refuses the
      // lock. That's fine: the wrist doesn't need it, and a click takes it.
      if (r && r.catch) r.catch(function () {});
    } catch (_) {}
  }
  function unlock() { if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock(); }

  // --- starting and leaving ----------------------------------------------------
  // opts: { fight: 0..2 } for a fight's INTRO, { training: true }, or nothing
  // for free roam from the spawn roof.
  function start(opts) {
    pending = opts || {};
    show($('menu'), false); show($('game'), false); show($('world'), true);
    show($('world-card'), false);
    running = true; paused = false; leaving = false;
    // Inside the click, while it still counts as a gesture - unless a fight's
    // INTRO card is coming, which wants the pointer free to press GO.
    if (pending.fight === undefined) lock();
    if (!world) {
      show($('world-loading'), true);
      // Let the "building" note paint before the work blocks the page.
      requestAnimationFrame(function () { setTimeout(begin, 0); });
    } else begin();
  }
  function begin() {
    if (!world) build();
    show($('world-loading'), false);
    layout();
    var o = pending || {};
    if (o.fight !== undefined) enterFight(o.fight);
    else if (o.training) enterTraining();
    else enterRoam(true);
    last = performance.now();
    if (!looping) { looping = true; requestAnimationFrame(frame); }
  }
  function quit() {
    if (!running) return;
    leaving = true; running = false; paused = false;
    unlock();
    WSAudio.hum && WSAudio.hum(null); WSAudio.ambience && WSAudio.ambience(0);
    SwingAudio.stop(); AttackAudio.stop();
    show($('world-card'), false); show($('world'), false); show($('menu'), true);
    document.dispatchEvent(new CustomEvent('webshooter:quit'));
  }

  // Put the player somewhere, facing somewhere, with a fresh view history.
  function place(v) {
    player = Player.create(v);
    player.pitch = v.pitch || 0;
    look = Look.create(); due = []; lines.clear(); webs.clear(); fx.clear(); stopUntil = 0;
    anim = PlayerAnim.create(); anim.face = player.yaw; pcam = PlayerCamera.create(); shots = []; view = null; lastState = 'idle';
    swing = Swing.create(); held = null; fxv = { fov: 0, roll: 0, lines: 0 };
    hurtAt = -1e9; hurtDmg = 0; deadAt = null; beeps = {}; popped = {}; shakeAt = -1e9;
    // The models too: a death held from the last life mustn't carry over (RETRY).
    if (you) you.reset();
    $('world-hurt').style.opacity = '0';
  }
  function enterRoam(fromSpawn) {
    mode = 'roam'; fight = null; enc = null; range = null; cues = null;
    world.setShadowFocus(null);
    you.setEnvironment(null);
    Traffic.clear(traffic, null);
    if (fromSpawn || !player) { place(city.spawn); player.pitch = -.22; }  // out and down over the city
    // Standing in a fight's trigger (a fight you just left, say) doesn't
    // start it again until you have stepped out.
    armed = !Encounters.triggered(allSpots(), player);
    closeCard();
  }
  function enterFight(i) {
    mode = 'fight'; range = null; shownEnd = null;
    enc = spots.fights[i];
    fight = Fight.start(enc, LEVELS);
    cues = SoundCues.create(enc.kind);
    place(enc.vantage);
    // The traffic and walkers in the way of a fight at street level go.
    Traffic.clear(traffic, Encounters.focus(enc));
    lightFight();
    save(i);
    var v = VILLAINS[enc.villain];
    card('intro', 'ENCOUNTER ' + (i + 1), v.name + '. ' + enc.intro, [['GO', 'go'], ['FREE ROAM', 'roam'], ['MENU', 'menu']]);
  }
  function enterTraining() {
    mode = 'train'; fight = null; enc = null; cues = null;
    range = Training3D.start(spots.training, Date.now() & 0x7fffffff);
    place(spots.training.vantage);
    world.setShadowFocus(null);
    you.setEnvironment(null);
    Traffic.clear(traffic, null);
    closeCard();
  }
  function save(i) {
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      localStorage.setItem(SAVE_KEY, JSON.stringify({ chapter: Math.max(s.chapter || 1, i + 1), savedAt: new Date().toISOString() }));
    } catch (_) {}
  }

  // --- cards -------------------------------------------------------------------
  // Everything holds still while one is up; its buttons are pressed with a
  // click or with a flick at the menu reticle (menu-aim.js), and Enter presses
  // the first.
  function card(kind, title, text, buttons) {
    paused = true;
    Move.keyboardSource && Move.keyboardSource.release();
    unlock();
    var inner = $('world-card-inner');
    inner.dataset.kind = kind;
    inner.innerHTML = '<h2></h2><p></p><div class="card-actions"></div>';
    inner.querySelector('h2').textContent = title;
    inner.querySelector('p').textContent = text;
    var row = inner.querySelector('.card-actions');
    row.dataset.count = buttons.length;
    buttons.forEach(function (b) {
      var el = document.createElement('button');
      el.type = 'button'; el.textContent = b[0]; el.dataset.action = b[1];
      el.onclick = function () { act(b[1]); };
      row.appendChild(el);
    });
    show($('world-card'), true);
  }
  function closeCard() {
    paused = false;
    show($('world-card'), false); show($('settings'), false);
    last = performance.now();
    lock();
  }
  function act(a) {
    if (a === 'menu') return quit();
    if (a === 'settings') return show($('settings'), true);
    if (a === 'roam') { webs.clear(); return enterRoam(false); }
    if (a === 'go' && fight) return go();
    if (a === 'go' || a === 'resume') { if (fight) Fight.play(fight); return closeCard(); }
    if (a === 'retry') return enterFight(enc.index);
    if (a === 'next') return enterFight(enc.index < 2 ? enc.index + 1 : 0);
    if (a === 'train') return enterTraining();
    if (a.indexOf('fight') === 0) return enterFight(+a.slice(5));
  }

  // GO: the fight starts once its villain's model is in (it almost always
  // already is); until then the button says so.
  function go() {
    var id = VILLAINS[fight.villain].id, f = fight;
    if (villains.state(id) !== undefined) { Fight.play(fight); return closeCard(); }
    if (going) return;
    going = true;
    var b = document.querySelector('#world-card-inner button[data-action="go"]');
    if (b) b.textContent = 'LOADING…';
    villains.ready(id).then(function () { going = false; if (fight === f && paused) { Fight.play(fight); closeCard(); } });
  }

  function pause() {
    if (!running || paused) return;
    if (fight) Fight.pause(fight);
    var list = [['RESUME', 'resume'], ['SETTINGS', 'settings']];
    if (mode === 'roam') list = list.concat([['GOBLIN', 'fight0'], ['RHINO', 'fight1'], ['VENOM', 'fight2'], ['TRAINING', 'train']]);
    else list.push(['FREE ROAM', 'roam']);
    list.push(['MENU', 'menu']);
    card('paused', 'PAUSED', mode === 'fight' ? 'The fight holds until you resume.' :
      mode === 'roam' ? 'Take a breather - or pick a fight.' : 'Take a breather. The city will wait.', list);
  }
  function resume() { if (running && paused) act('resume'); }

  // --- the frame ---------------------------------------------------------------
  // The time on the shooter's clock whose aim this frame shows. Controller
  // .display() draws the aim a little behind real time, and the camera turns
  // from what it draws, so this is the moment the frame's camera belongs to.
  function deviceTime(c, now) {
    if (!c || c.clockOff === null || c.clockOff === undefined) return NaN;
    return now - c.clockOff - Controller.renderDelay(c);
  }
  // The camera, and in a fight where everything was: a shot taken from this
  // frame is judged against what it showed.
  function camera() {
    return { yaw: player.yaw, pitch: player.pitch, roll: fxv.roll, fov: world.camera.fov, eye: viewEye(), seen: fight ? Fight.snapshot(fight) : null };
  }
  // Where the camera is this frame: at your eye in first person, over your
  // shoulder in third (placed by viewPlace each frame).
  function viewEye() { return view ? view.eye : Player.eye(player); }
  function camMode() { return PlayerCamera.settings(settings()); }
  // The camera for this frame, and which way the body faces.
  function viewPlace(st, dt) {
    var c = camMode(), eye = Player.eye(player);
    if (c.camera === 'third') {
      var t = PlayerCamera.third(pcam, player, city, dt, { moving: Swing.airborne(swing) });
      view = { eye: t.eye, hide: t.hide, face: PlayerAnim.face(anim, player, faceYaw(), dt) };
    } else {
      var landed = st === 'land' && lastState !== 'land';
      pcam.dist = null;                // third person starts from pulled in, next time
      view = { eye: PlayerCamera.first(pcam, player, eye, dt, landed, c.cameraMotion, swing.mode === 'perch'), hide: false, face: player.yaw };
      anim.face = player.yaw;
    }
    lastState = st;
    // The swing's camera effects, for the speed you swing and fly at.
    var g = Swing.grip(player), lat = 0;
    if (swing.mode === 'swing') {
      var ax = swing.anchor.x - g.x, ay = swing.anchor.y - g.y, az = swing.anchor.z - g.z, al = Math.hypot(ax, ay, az) || 1, rt = Player.right(player.yaw);
      lat = (ax * rt.x + az * rt.z) / al;
    }
    fxv = PlayerCamera.swingFx(pcam, { speed: Swing.airborne(swing) ? Swing.speed(player) : 0, swinging: swing.mode === 'swing', lateral: lat,
      first: c.camera !== 'third' }, dt, c.cameraMotion);
  }
  // Which way the third-person body faces while swing.js has him: where he's
  // going through the air, out over the edge on a perch; for a moment after
  // a shot, the aim (PlayerAnim.face holds that).
  function faceYaw() {
    if (anim.aimT > 0) return player.yaw;
    if (swing.mode === 'perch' && swing.perch) return swing.perch.yaw;
    if (Swing.airborne(swing) && Math.hypot(player.vx, player.vz) > 2) return Math.atan2(-player.vx, -player.vz);
    return player.yaw;
  }
  // CAMERA and CAMERA MOTION: kept in the settings menu.js saves (the same
  // object, so neither side undoes the other), and applied live.
  function setCamera(patch) {
    var S = settings(), c = PlayerCamera.save(localStorage, Object.assign(camMode(), patch));
    S.camera = c.camera; S.cameraMotion = c.cameraMotion;
    showCamera();
  }
  function showCamera() {
    var c = camMode();
    if ($('camera-mode')) $('camera-mode').value = c.camera;
    if ($('camera-motion')) $('camera-motion').value = c.cameraMotion;
    if (you) you.setMode(c.camera);
  }

  function frame(now) {
    if (!running || !world) { looping = false; return; }
    var dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
    var c = ctl(), S = settings(), wrist = wristLooks(c);
    applyTier();
    // The hit-stop: for a few frames after a hit the fight and the villain
    // hold still; the view doesn't, so turning never stutters.
    var held = HitFx.stopped(now, stopUntil), fdt = held ? 0 : dt;
    var r = Look.step(look, {
      pos: c ? Controller.display(c, now) : null, wrist: wrist, mode: S.lookMode, speed: S.turnSpeed, pitch: player.pitch,
      // The flick is shooting, not looking: the camera holds still through it.
      frozen: wrist && !!(c.last && c.last.flick),
      hold: paused, rebase: rebase
    }, dt);
    rebase = false; lastLook = r;
    var moves = { state: anim.state, body: [], arms: [], speed: player.speed, armSpeed: 1 }, down = isDown();
    if (!paused) {
      // Down, you don't look, walk or swing any more: the view slumps.
      if (!down) Player.look(player, r.dyaw, r.dpitch);
      // swing.js moves you while it has you; otherwise Player walks you.
      var input = down ? { move: { x: 0, z: 0 }, buttons: {}, yaw: player.yaw } : { move: Move.vector(), buttons: Move.buttons(), yaw: player.yaw };
      var vy0 = player.vy, air0 = !player.grounded;
      var sw = Swing.step(swing, player, input, dt, city);
      if (!sw.active) Player.step(player, input, dt, city);
      swingEvents(sw.events, now);
      if (air0 && player.grounded && !sw.active && vy0 < -9) landed(player, -vy0);
      // The fight, told where you are, what you're doing and whether he's in
      // view; then what his attacks did.
      if (fight) { Fight.tick(fight, fdt, fightCtx()); fightEvents(Fight.drain(fight), now); fuses(fight, now); }
      if (range) Training3D.tick(range, dt);
      if (mode === 'roam') triggers();
      moves = PlayerAnim.step(anim, player, dt, extras());
    }
    SwingAudio.update({ speed: Swing.speed(player), load: swing.load, taut: swing.taut, on: !paused && Swing.airborne(swing) },
      S.muted ? 0 : (Number.isFinite(+S.sfx) ? +S.sfx : 80) / 100);
    viewPlace(moves.state, paused ? 0 : dt);
    // Gone down: the view sinks and tips (PlayerCamera.slump).
    var slump = PlayerCamera.slump(deadAt === null ? null : (now - deadAt) / 1000, camMode().camera === 'third');
    if (slump.drop) view.eye = { x: view.eye.x, y: view.eye.y - slump.drop, z: view.eye.z };
    var eye = view.eye;
    AttackAudio.frame(eye, player.yaw, player.pitch, paused || S.muted ? 0 : (Number.isFinite(+S.sfx) ? +S.sfx : 80) / 100);
    // The villain's model: its clips move on while the fight is played, and
    // through its defeat even once the card is up. Its bones are sampled into
    // the fight now, before the camera below records what this frame shows.
    var animDt = !paused || (fight && (fight.mode === 'won' || fight.mode === 'lost')) ? fdt : 0;
    modelShown = villains.update(fight, animDt, eye, now);
    villainSounds(animDt);
    // LOW: a blob under his feet instead of the shadow he doesn't cast.
    var blobbed = world.tier.blob && fight && modelShown && villains.shown();
    fx.setBlob(blobbed ? fight.at : null, blobbed ? Fight.ground(fight) : null, fight ? VILLAINS[fight.villain].height : 0);
    ending(now);
    // The Goblin hunts you round the city: the fight's shadow goes with him.
    if (fight && fight.hunt) {
      var P = enc.path, H = fight.hunt;
      world.setShadowFocus({ x: H.cx, y: H.y + (P.h0 + P.h1) / 2 + (fight.m.lift || 0), z: H.cz, r: P.r1 + 2 });
    }
    world.setFov(fov() + fxv.fov);
    world.update(dt, eye, player.yaw, player.pitch + slump.pitch);
    world.camera.rotation.z = fxv.roll + slump.roll;
    shake(now);
    world.camera.updateMatrixWorld();
    // You, as the camera now sees you, with the shots taken since last frame.
    you.update({ player: player, face: view.face, anim: moves, shots: shots, dt: paused ? 0 : dt, hide: view.hide,
      line: swing.mode === 'swing' ? { anchor: swing.anchor, hand: swing.hand, grip: Swing.grip(player) } : null });
    shots = [];
    // What the webs in flight do when they land, and the webs themselves.
    if (!paused) due = due.filter(function (d) { if (now < d.at) return true; d.fn(now); return false; });
    lines.update(now, world.camera, canvas.height);
    Look.record(look, deviceTime(c, now), camera());
    // Extras that draw into the world (the model viewer): (dt, now, paused).
    for (var h = 0; h < hooks.length; h++) hooks[h](paused ? 0 : dt, now, paused);
    actors.drawFight(fight, VILLAINS, eye, now, fight && fight.mode === 'won' ? Math.max(0, 1 - (now - endAt) / 800) : 1, modelShown);
    actors.drawTarget(range && range.target3, now);
    actors.showBeacons(mode === 'roam');
    cross.style.left = r.crosshair.x * 100 + '%'; cross.style.top = r.crosshair.y * 100 + '%';
    cross.classList.toggle('is-turning', r.turning);
    webs.update(now);
    attacksView.update(fight, now);
    fx.update(paused && !(fight && (fight.mode === 'won' || fight.mode === 'lost')) ? 0 : fdt, now, world.camera, canvas.height);
    // The traffic and walkers near you, moving on while nothing is paused.
    nearCars = life.update(paused ? 0 : dt, eye, world.tier);
    street(eye, paused ? 0 : dt);
    world.render();
    you.render();
    fxc.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
    speedLines(fxc, overlay.clientWidth, overlay.clientHeight, fxv.lines, now);
    // The arrow to the villain off the view - red, at him or at a bomb, when
    // an attack is coming from out there.
    var threat = fight && !paused ? Hud.threat(fight, visible) : null;
    hudView.drawPointer(fxc, overlay.clientWidth, overlay.clientHeight, world.camera, world.project, threat || goal(), eye, !!threat, now);
    hurtEdge(now);
    drawHud(now, eye);
    if (perf) readout(now, c, S);
    requestAnimationFrame(frame);
  }

  // --- he fights back (P4) --------------------------------------------------------
  // You've gone down in this fight.
  function isDown() { return !!(fight && fight.you && fight.you.hp <= 0); }
  // What the fight needs to know about you this frame: where your feet are
  // and how you're moving, your body (the model's capsules, as it's drawn -
  // hanging from a line, crouched on a perch - or a stand-in until it
  // loads), what you're doing, and whether he's in your view.
  function fightCtx() {
    var b = you && you.ready ? you.sample() : null, caps = b && b.capsules && b.capsules.length ? b.capsules : Attacks.standIn(player, swing.mode === 'perch');
    var mid = fight.at && { x: fight.at.x, y: fight.at.y + 1.2, z: fight.at.z };
    return { you: { x: player.x, y: player.y, z: player.z, vx: player.vx, vy: player.vy, vz: player.vz }, body: caps,
      state: swing.mode === 'none' ? (player.grounded ? 'ground' : 'fly') : swing.mode, onScreen: !!mid && visible(mid), city: city,
      anchor: swing.mode === 'swing' ? swing.anchor : null };
  }
  function visible(p) { return Hud.onScreen(world.project(p)); }
  // What PlayerAnim needs besides Player: the swing's (line, zip, perch) and
  // the fight's (hits taken, the last one heavy, down).
  function extras() {
    var x = Swing.anim(swing), y = fight && fight.you;
    if (y) { x.hits = y.hits; x.big = y.big; x.dead = y.hp <= 0; }
    return x;
  }
  // What his attacks did this frame (Fight.drain): the sounds, flashes and
  // blasts, and what a hit does to you.
  function fightEvents(ev, now) {
    var up = function (p) { return p && { x: p.x, y: p.y + 1.2, z: p.z }; }, motion = camMode().cameraMotion;
    ev.forEach(function (e) {
      if (e.type === 'telegraph') {
        AttackAudio.warn(up(e.at), e.move, fight.rules.telegraph);
        // Reaching for a bomb, he cackles; Venom snarls before he claws or lashes.
        if (e.move === 'bomb' && WSAudio.roar) WSAudio.roar(up(e.at), 'glider', .45);
        if ((e.move === 'combo' || e.move === 'lash') && WSAudio.roar) WSAudio.roar(up(e.at), 'leap', .35);
      } else if (e.type === 'throw') { if (WSAudio.whoosh) WSAudio.whoosh(e.from, .6); }
      // The Rhino (P5): off he goes with a bellow; a ram's quake, a crash into a wall.
      else if (e.type === 'charge') { if (WSAudio.roar) WSAudio.roar(up(e.at), 'charge', .6); }
      else if (e.type === 'quake' || e.type === 'crash') {
        var hitAt = { x: e.at.x, y: e.at.y + .8, z: e.at.z }, qd = dist(hitAt, Player.eye(player));
        fx.dust(e.type, hitAt, null);
        if (e.type === 'quake') { AttackAudio.quake(hitAt); if (WSAudio.thud) WSAudio.thud(hitAt, 1); }
        else AttackAudio.crash(hitAt);
        // The building shakes under you: felt the nearer you are, hurt or not.
        var reach = e.type === 'quake' ? 45 : 20;
        if (qd < reach) kick(now, PlayerCamera.hurtShake((e.type === 'quake' ? 22 : 10) * (1 - qd / reach), motion));
      }
      // Venom (P5): a swipe, the tentacle, a pounce's take-off and landing.
      else if (e.type === 'swipe') AttackAudio.swipe(e.at);
      else if (e.type === 'lash') AttackAudio.lash(e.at);
      else if (e.type === 'pounce') { if (WSAudio.whoosh) WSAudio.whoosh(up(e.at), .9); }
      else if (e.type === 'slam') {
        fx.dust('slam', e.at, null);
        var sd = dist(e.at, Player.eye(player));
        if (sd < 12) kick(now, PlayerCamera.hurtShake(9 * (1 - sd / 12), motion));
      }
      else if (e.type === 'round') { fx.muzzle(e.from, now); AttackAudio.round(e.from); }
      else if (e.type === 'blast') {
        popped[e.id] = e.at;
        fx.blast(e.at, now, view ? view.eye : Player.eye(player));
        AttackAudio.boom(e.at, e.why !== 'shot');
        // Close by, you feel it even when it misses.
        var d = dist(e.at, Player.eye(player));
        if (d < 25 && !e.damage) kick(now, PlayerCamera.hurtShake(12 * (1 - d / 25), motion));
        if (d < 12) flash(.25 * (1 - d / 12));
      } else if (e.type === 'hurt') hurt(e, now, motion);
    });
  }
  // You're hit: the flinch is PlayerAnim's (extras), the rest is here - the
  // red edge, a capped shake, the sound; a heavy one knocks you off your
  // line, and a blast throws you. At 0, down you go.
  function hurt(e, now, motion) {
    hurtAt = now; hurtDmg = e.damage;
    AttackAudio.hurt(e.damage);
    kick(now, PlayerCamera.hurtShake(e.damage, motion));
    if ((e.knock || e.dead) && swing.mode === 'swing') { Swing.release(swing, player); letGo(now); }
    if (e.push && swing.mode !== 'perch' && swing.mode !== 'zip') {
      player.vx += e.push.x; player.vz += e.push.z;
      if (e.push.y > 0) { player.vy = Math.max(player.vy, e.push.y); player.grounded = false; }
    }
    if (e.dead) { deadAt = now; AttackAudio.down(); letGo(now); }
  }
  function kick(now, s) { shakeAt = now; shakeAmp = s.amp; shakeMs = s.ms; }
  // A bomb's fuse beeps as it flies, quicker as it runs down, from where it is.
  function fuses(f, now) {
    var F = Attacks.constants.FUSE, live = {};
    f.bombs.forEach(function (b) {
      live[b.id] = true;
      if (b.popAt !== null) return;
      var every = .08 + .32 * Math.max(0, F - b.t) / F;
      if (beeps[b.id] === undefined || b.t >= beeps[b.id]) { beeps[b.id] = b.t + every; AttackAudio.fuse(b); }
    });
    Object.keys(beeps).forEach(function (k) { if (!live[k]) delete beeps[k]; });
  }
  // The red at the edges of the view: the last hit's, fading, and a tinge
  // while you're low.
  function hurtEdge(now) {
    var y = fight && fight.you, v = y ? PlayerCamera.vignette(hurtDmg, (now - hurtAt) / 1000, y.hp / y.maxHp) : 0;
    v = Math.round(v * 100) / 100;
    if (hurtEdge.last !== v) { hurtEdge.last = v; $('world-hurt').style.opacity = String(v); }
  }

  // Walking into a light column starts its fight (or the range).
  function triggers() {
    var t = Encounters.triggered(allSpots(), player);
    if (!t) { armed = true; return; }
    if (!armed) return;
    armed = false;
    if (t.kind === 'range') enterTraining(); else enterFight(t.index);
  }

  // The end of a fight: its card, once, after the villain's defeat (or his
  // getaway roar) has had a moment to play.
  function ending(now) {
    if (!fight) return;
    if ((fight.mode === 'lost' || fight.mode === 'won') && shownEnd !== fight.mode && shownEnd !== fight.mode + '-card') {
      shownEnd = fight.mode; endAt = now;
      if (fight.mode === 'won') WSAudio.fanfare && WSAudio.fanfare(); else WSAudio.fail && WSAudio.fail();
    }
    if (shownEnd !== fight.mode || now - endAt < END_MS[fight.mode]) return;
    shownEnd = fight.mode + '-card';
    if (fight.mode === 'lost') {
      card('defeat', 'DEFEAT', 'You went down. ' + VILLAINS[enc.villain].name + ' is still out there.', [['RETRY', 'retry'], ['FREE ROAM', 'roam'], ['MENU', 'menu']]);
    }
    if (fight.mode === 'won') {
      var lastOne = enc.index >= 2;
      card(lastOne ? 'city-saved' : 'victory', lastOne ? 'CITY SAVED' : 'VICTORY',
        lastOne ? 'The city is safe!' : 'One villain down. The city still needs you.',
        [[lastOne ? 'REPLAY' : 'NEXT ENCOUNTER', 'next'], ['FREE ROAM', 'roam'], ['MENU', 'menu']]);
    }
  }

  function shake(now) {
    var k = Math.max(0, 1 - (now - shakeAt) / shakeMs);
    if (!k) return;
    var a = shakeAmp * k * k;
    world.camera.rotation.x += (Math.random() - .5) * 2 * a;
    world.camera.rotation.y += (Math.random() - .5) * 2 * a;
  }
  function flash(strength) {
    var el = $('world-flash');
    el.style.transition = 'none'; el.style.opacity = String(strength);
    void el.offsetWidth;
    el.style.transition = 'opacity .3s ease-out'; el.style.opacity = '0';
  }

  // --- shooting ---------------------------------------------------------------
  // A flick passes the controller's pre-flick aim (Controller.shot) and the
  // shoot packet; the camera - and in a fight, where everything was - is
  // rewound to the frame that showed that aim, so the web goes exactly where
  // the crosshair was, however far the view or the villain has moved since.
  // A click has neither and shoots from where things are now.
  function fire(at, p) {
    if (!running || paused || !world || !player || isDown()) return null;
    var c = ctl(), S = settings(), wrist = wristLooks(c);
    var aim = at && p ? Look.crosshair(at, S.lookMode, wrist) : look.crosshair;
    var cam = (p && Look.cameraAt(look, Look.shotTime(p))) || camera();
    var dir = Look.ray(cam, aim, cam.fov || world.camera.fov, world.camera.aspect);
    var hit = world.raycast(cam.eye, dir, RANGE), now = performance.now();
    var shot = { origin: cam.eye, dir: dir, blocked: hit ? hit.distance : Infinity };
    // A shot at him, a line to swing on, a zip, or letting go (swing.js).
    // A bomb in flight near the aim (judged where it was when you aimed) is
    // shot down; else a shot at him, a line to swing on, a zip, or letting go.
    var bomb = fight ? Fight.aimBomb(fight, shot, cam.seen) : null;
    var d = Swing.decide({ bomb: bomb, target: aimed(shot, cam), hit: hit, player: player, city: city, villains: villainCaps() }, swing);
    if (d.act === 'bomb') return shootDown(d.bomb, aim, now);
    if (d.act !== 'shot') return swingAct(d, hit, now);
    // Cooling down, or a fight not being played: the shot doesn't happen.
    if (fight && (fight.mode !== 'playing' || fight.cooldownRemaining > 0)) return null;
    if (range && range.cooldownRemaining > 0) return null;
    var far = { x: cam.eye.x + dir.x * RANGE, y: cam.eye.y + dir.y * RANGE, z: cam.eye.z + dir.z * RANGE };
    var out = { act: 'shot', view: aim, hit: false, point: hit ? hit.point : null };
    // A hand throws it - the other one than last time. The web leaves its
    // wrist at the snap of the hand.
    var sh = PlayerAnim.shoot(anim), hand = sh.hand;
    shots.push(sh); out.hand = hand;
    var from = function () { return you.wrist(hand) || viewEye(); };
    var launch = now + WebShot.snap(camMode().camera) * 1000;
    later(launch, function () { WSAudio.thwip(); });
    // Where it goes (a point, or a function for a point on a villain that
    // moves on), and what happens when it gets there.
    var to = hit ? hit.point : far, land = null;
    function splat(t) { if (hit) { webs.add(hit.point, hit.normal, dist(from(), hit.point), t); fx.web(hit.point, hit.normal); } }

    if (fight) {
      var r = Fight.fire(fight, VILLAINS, shot, cam.seen), f = fight;
      out.hit = r.hit; out.kind = r.kind;
      if (r.hit && r.kind === 'villain') {
        var vid = VILLAINS[f.villain].id;
        to = onVillain(r.body, to);
        land = function (t) {
          if (fight !== f) return;
          var st = stickToVillain(r.body, from(), t);
          // Particles and a flash where it met him, and the hit-stop.
          if (st) { fx.hit(vid, st.point, st.normal, t); stopUntil = HitFx.stopUntil(t, stopUntil); }
          actors.flash(t); villains.flash(t); flash(.32); shakeAt = t; shakeAmp = SHAKE; shakeMs = SHAKE_MS;
          // Heard where it landed on him.
          WSAudio.crunch(st ? st.point : f.at);
        };
      } else if (r.hit) {
        to = r.point;
        land = function (t) {
          webs.add(r.point, back(dir), dist(from(), r.point), t, actors.thugAnchor(r.thug), .9);
          fx.web(r.point, back(dir));
          flash(.2); shakeAt = t; shakeAmp = SHAKE * (r.down ? .9 : .5); shakeMs = SHAKE_MS;
          WSAudio.crunch(r.point); if (r.down && WSAudio.impact) WSAudio.impact(r.point);
        };
      } else {
        // A miss - or a shot during his entrance, which still sticks to him.
        var onHim = r.body && onVillain(r.body, null);
        if (onHim) to = onHim;
        land = function (t) {
          if (fight !== f) return;
          var on = onHim && stickToVillain(r.body, from(), t);
          if (on) fx.web(on.point, on.normal); else splat(t);
          WSAudio.thunk(on ? on.point : hit && hit.point);
        };
      }
    } else if (range) {
      var tr = Training3D.fire(range, shot);
      out.hit = tr.hit;
      if (tr.hit && !hit) to = tr.point;
      // The web sticks to the wall or roof behind the target.
      land = function (t) {
        splat(t);
        if (tr.hit) { flash(.18); shakeAt = t; shakeAmp = SHAKE * .5; shakeMs = SHAKE_MS; WSAudio.crunch(tr.point); } else WSAudio.thunk(hit && hit.point);
      };
    } else {
      land = function (t) { splat(t); if (hit) WSAudio.thunk(hit.point); };
    }
    var ws = WebShot.shot({ from: from(), to: typeof to === 'function' ? to() : to, launch: launch });
    lines.add(ws, from, to);
    later(ws.arrive, land);
    return out;
  }
  // A web at a bomb in flight: it flies to where the bomb will be when it
  // gets there, and the bomb goes off then (Fight.shootBomb). The line
  // follows the bomb until it does.
  function shootDown(id, aim, now) {
    if (fight.mode !== 'playing' || fight.cooldownRemaining > 0) return null;
    var sh = PlayerAnim.shoot(anim), hand = sh.hand, f = fight;
    var from = function () { return you.wrist(hand) || viewEye(); };
    var launch = now + WebShot.snap(camMode().camera) * 1000;
    var guess = WebShot.shot({ from: from(), to: Fight.bombAhead(f, id, (launch - now) / 1000), launch: launch });
    var delay = (guess.arrive - now) / 1000, r = Fight.shootBomb(f, id, delay);
    if (!r.accepted) return null;
    shots.push(sh);
    later(launch, function () { WSAudio.thwip(); });
    var meet = Fight.bombAhead(f, id, delay) || r.point;
    var to = function () {
      var b = f.bombs.filter(function (q) { return q.id === id; })[0];
      return b ? { x: b.x, y: b.y, z: b.z } : popped[id] || meet;
    };
    lines.add(WebShot.shot({ from: from(), to: meet, launch: launch }), from, to);
    return { act: 'bomb', view: aim, hit: true, bomb: id, hand: hand, point: meet };
  }

  // --- swinging ---------------------------------------------------------------
  // Is a villain (his body as it was when you aimed), a thug or the
  // training target near enough the aim that it's a shot, not a swing?
  function aimed(shot, cam) {
    var tol = Swing.constants.SHOT_CONE;
    function near(sph) { var m = AimAssist.miss(shot.origin, shot.dir, sph); return m.front && m.deg <= tol && m.distance <= shot.blocked + .05; }
    if (fight && fight.mode === 'playing') {
      if (fight.phase === 'thugs') return fight.thugs.some(function (t) { return !t.down && near(Fight.thugSphere(t)); });
      var seen = cam.seen, body = seen ? seen.body : fight.body, at = seen ? seen.villain : fight.at;
      if (!at) return false;
      if (body && body.capsules && body.capsules.length) return Swing.inCone(shot.origin, shot.dir, body.capsules, tol, shot.blocked);
      var h = VILLAINS[fight.villain].height;
      return near({ x: at.x, y: at.y + h / 2, z: at.z, r: h / 2 });
    }
    return !!(range && range.target3 && near(range.target3));
  }
  // The villain's body, which a line mustn't be anchored in.
  function villainCaps() { return fight && fight.body && fight.body.capsules ? fight.body.capsules : []; }
  // A line to swing on, a zip to a roof, or letting go - and the web for it,
  // shot from the hand that will hold it.
  function swingAct(d, hit, now) {
    var out = { act: d.act, hit: false, point: hit ? hit.point : null, why: d.why };
    if (d.act === 'release') { Swing.release(swing, player); letGo(now); return out; }
    if (d.act === 'none') return out;
    var hand, to;
    if (d.act === 'attach') {
      // Hand over hand: the free hand takes the next line; from a standstill,
      // the hand on the anchor's side.
      if (swing.mode === 'swing') { hand = swing.hand === 'l' ? 'r' : 'l'; Swing.release(swing, player); }
      else { var rt = Player.right(player.yaw); hand = (d.anchor.x - player.x) * rt.x + (d.anchor.z - player.z) * rt.z < 0 ? 'l' : 'r'; }
      Swing.attach(swing, player, d.anchor, hand);
      to = d.anchor;
    } else {
      hand = 'r';
      Swing.zip(swing, player, d.perch);
      to = d.point;
    }
    letGo(now);
    out.hand = hand; out.anchor = to; out.perch = d.perch || null;
    var from = function () { return you.wrist(hand) || viewEye(); };
    var launch = now + WebShot.snap(camMode().camera) * 1000;
    later(launch, function () { WSAudio.thwip(); });
    held = WebShot.line({ from: from(), to: to, launch: launch });
    lines.add(held, from, to);
    // Where it grips the wall: a small splat and a puff.
    var n = hit.normal;
    later(held.arrive, function (t) { webs.add(to, n, dist(from(), to), t, null, .6); fx.web(to, n); });
    return out;
  }
  function letGo(now) { if (held) { WebShot.letGo(held, now); held = null; } }
  // What swing.js said happened this frame.
  function swingEvents(ev, now) {
    ev.forEach(function (e) {
      if (e.type === 'land') landed(e.at, e.speed);
      if (e.type === 'perch' && WSAudio.thud) WSAudio.thud(e.at, .35);
    });
    // A line let go of any way (Space, touching down, a perch) goes slack.
    if (held && swing.mode !== 'swing' && swing.mode !== 'zip') letGo(now);
  }
  // Touching down hard: a thud at your feet. No damage, ever.
  function landed(at, speed) {
    if (speed > 6 && WSAudio.thud) WSAudio.thud({ x: at.x, y: at.y, z: at.z }, Math.min(1, speed / 26));
  }
  // First person, fast: faint streaks rushing out from the middle of the
  // view (k 0..1), fresh every few frames.
  function speedLines(g, w, h, k, now) {
    if (!(k > .02)) return;
    var cx = w / 2, cy = h / 2, R = Math.hypot(w, h) / 2, tick = Math.floor(now / 60);
    function rnd(n) { var x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }
    g.save(); g.lineCap = 'round';
    for (var i = 0; i < 28; i++) {
      var sd = tick * 131 + i * 977, a = rnd(sd) * Math.PI * 2, r0 = R * (.5 + .35 * rnd(sd + 1)), l = R * (.1 + .22 * rnd(sd + 2)) * k;
      g.strokeStyle = 'rgba(255,255,255,' + ((.08 + .16 * rnd(sd + 3)) * k).toFixed(3) + ')';
      g.lineWidth = 1 + 1.6 * rnd(sd + 4);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * (r0 + l), cy + Math.sin(a) * (r0 + l)); g.stroke();
    }
    g.restore();
  }

  // Run fn(now) once performance.now() reaches `at` (held while paused).
  function later(at, fn) { if (fn) due.push({ at: at, fn: fn }); }
  // Where on the villain a shot that met him (Fight.fire's `body`) is, as he
  // is drawn now: a function, so a web in flight follows him. `or` if the
  // body can't say.
  function onVillain(body, or) {
    var f = fight;
    return function () {
      if (fight === f && body && body.capsule !== undefined && modelShown) {
        var st = villains.stickBody(f, body.capsule, body.t, viewEye());
        if (st) return st.point;
      }
      var bb = fight === f && !modelShown && f.at && body && body.u !== undefined && Fight.billboard(f, VILLAINS, Player.eye(player));
      if (bb) return Fight.onSprite(bb, body.u, body.v);
      return typeof or === 'function' ? or() : or || (f.at ? { x: f.at.x, y: f.at.y + 1, z: f.at.z } : viewEye());
    };
  }
  // A web where a shot met the villain (Fight.fire's `body`), placed on him
  // as he is drawn now - on the model, stuck to the bone under it - since a
  // rewound shot was judged where he was, and he has moved on since. Returns
  // where it went and the way the surface faces there, { point, normal }, or null.
  function stickToVillain(body, from, now) {
    if (!body) return null;
    if (body.capsule !== undefined && modelShown) {
      var st = villains.stickBody(fight, body.capsule, body.t, from);
      if (st) { webs.add(st.point, st.normal, dist(from, st.point), now, st.parent, st.size); return st; }
    }
    var bb = !modelShown && fight.at && Fight.billboard(fight, VILLAINS, Player.eye(player));
    if (bb && body.u !== undefined) {
      var on = Fight.onSprite(bb, body.u, body.v);
      webs.add(on, bb.normal, body.distance, now, actors.villainAnchor(), .9);
      return { point: on, normal: bb.normal };
    }
    return null;
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  function back(d) { return { x: -d.x, y: -d.y, z: -d.z }; }

  // --- sounds in the world -----------------------------------------------------
  // The villain's: what his model was told to play this frame, and his feet
  // and glider, each placed where he is (SoundCues -> WSAudio).
  function villainSounds(dt) {
    var o = cues && fight && modelShown ? SoundCues.step(cues, fight, villains.heard().play, villains.heard().speed, dt) : null;
    if (WSAudio.hum) WSAudio.hum(o && o.hum && !paused ? o.hum.at : null, o && o.hum ? o.hum.speed : 0);
    if (!o || !WSAudio.roar) return;
    o.cues.forEach(function (q) {
      if (q.name === 'roar') WSAudio.roar(q.at, q.voice, q.gain, q.delay);
      else if (q.name === 'thud') WSAudio.thud(q.at, q.gain, q.delay);
      else if (q.name === 'whoosh') WSAudio.whoosh(q.at, q.gain, q.delay);
      else if (q.name === 'step') WSAudio.step(q.at, q.gain);
      else if (q.name === 'grunt') WSAudio.grunt(q.at, q.voice, q.gain);
      else if (q.name === 'groan') WSAudio.groan(q.at, q.voice);
      else if (WSAudio[q.name]) WSAudio[q.name](q.at);
    });
  }
  // The street: you hear from where the camera is, the traffic rumbles
  // louder the closer and busier it is, and now and then a car near you
  // sounds its horn.
  function street(eye, dt) {
    if (!WSAudio.setListener) return;
    WSAudio.setListener(eye, player.yaw, player.pitch);
    WSAudio.ambience(Math.max(.001, Traffic.noise(nearCars, eye)));
    var n = 0;
    while (n < nearCars.length && nearCars[n].d < 70) n++;
    if (n && dt > 0 && Math.random() < dt / HORN_EVERY) { var car = life.carNow(Math.floor(Math.random() * n)); if (car) WSAudio.horn({ x: car.x, y: 1, z: car.z }); }
  }

  // What you are meant to be shooting at, when it is off the view: an arrow
  // at the edge of the screen pointing the way to turn (hud-view.js).
  function goal() {
    if (fight && fight.mode === 'playing') {
      if (fight.phase !== 'thugs') return fight.at && { x: fight.at.x, y: fight.at.y + VILLAINS[enc.villain].height / 2, z: fight.at.z };
      var eye = Player.eye(player), best = null;
      fight.thugs.forEach(function (t) { if (!t.down && (!best || dist(eye, t) < dist(eye, best))) best = t; });
      return best && Fight.thugSphere(best);
    }
    return range && !paused ? range.target3 : null;
  }
  // --- the HUD -----------------------------------------------------------------
  // What each part says (Hud.status), and the minimap: you, and the fights'
  // light columns while roaming, the villain in a fight, the target in
  // training. hud-view.js writes only what changed.
  function drawHud(now, eye) {
    hudView.update(Hud.status({ mode: mode, fight: fight, enc: enc, range: range, villain: fight ? VILLAINS[fight.villain] : null,
      damage: Combat.DAMAGE || 20, accuracy: range ? Training3D.accuracy(range) : 0 }));
    var marks = [], C = WorldActors.BEACON_COLORS;
    if (mode === 'roam') allSpots().forEach(function (s) { if (s.trigger) marks.push({ x: s.trigger.x, z: s.trigger.z, color: C[s.id] || '#5fe3ff', kind: 'fight' }); });
    else if (fight && fight.at && fight.mode !== 'won') marks.push({ x: fight.at.x, z: fight.at.z, color: C[VILLAINS[fight.villain].id] || '#ff6a6a', kind: 'villain' });
    else if (range && range.target3) marks.push({ x: range.target3.x, z: range.target3.z, color: '#5fe3ff', kind: 'target' });
    hudView.drawMap(Player.eye(player), player.yaw, marks, now);
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
    $('world-perf').textContent = fps.toFixed(0) + ' fps  ·  ' + world.tier.name.toUpperCase() + '  ·  ' + r.calls + ' draw calls  ·  ' +
      (r.triangles / 1000).toFixed(0) + 'k tris  ·  x ' + player.x.toFixed(0) + ' y ' + player.y.toFixed(1) + ' z ' + player.z.toFixed(0) +
      '  ·  ' + (function (n) { return n.cars + n.cabs + ' cars, ' + n.people + ' walkers'; })(life.counts()) +
      '  ·  ' + swing.mode + ' ' + Swing.speed(player).toFixed(1) + ' m/s' + (swing.mode === 'swing' ? ' line ' + swing.len.toFixed(1) + ' m' : '') +
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
    // A lock that arrives after a card went up would trap the pointer under it.
    if (locked && paused) { unlock(); return; }
    document.body.classList.toggle('world-locked', locked);
    // Esc while locked is swallowed by the browser to release the lock, so the
    // lock going away is how a pause arrives.
    if (!locked && running && !paused && !leaving) pause();
  });
  document.addEventListener('mousemove', function (e) {
    if (!locked || paused || !player || isDown() || !(e.movementX || e.movementY)) return;
    // Moving the mouse takes the look from the wrist, and puts the wrist's aim
    // in the middle, which is where it picks up again when you turn it.
    var c = ctl();
    if (c && c.source !== 'mouse') { c.source = 'mouse'; c.pos = { x: .5, y: .5 }; c.trail = []; }
    Player.look(player, -e.movementX * MOUSE_SENS, -e.movementY * MOUSE_SENS);
  });
  window.addEventListener('keydown', function (e) {
    if (!running) return;
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (paused && (e.key === 'Enter' || e.code === 'NumpadEnter') && $('settings').classList.contains('is-hidden')) {
      var first = document.querySelector('#world-card-inner button');
      if (first) { e.preventDefault(); first.click(); }
      return;
    }
    if (e.key === 'Escape' && !paused) pause();
    // menu.js recentres the aim on C; that jump must not turn the view.
    if (e.key === 'c' || e.key === 'C') rebase = true;
    // T: first person / third person.
    if (e.code === 'KeyT' && !paused) setCamera({ camera: camMode().camera === 'third' ? 'first' : 'third' });
    if (e.code === 'KeyP') { perf = !perf; show($('world-perf'), perf); frames = 0; perfAt = performance.now(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });
  $('btn-world-quit').onclick = quit;
  if ($('camera-mode')) $('camera-mode').onchange = function () { setCamera({ camera: $('camera-mode').value }); };
  if ($('camera-motion')) $('camera-motion').onchange = function () { setCamera({ cameraMotion: $('camera-motion').value }); };
  document.addEventListener('webshooter:ready', function () { setTimeout(showCamera, 0); });

  window.WorldGame = {
    start: start, quit: quit, pause: pause, resume: resume, fire: fire,
    onFrame: function (fn) { hooks.push(fn); },
    active: function () { return running; },
    paused: function () { return paused; },
    saved: function () { try { var s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.chapter ? s.chapter : 0; } catch (_) { return 0; } },
    get mode() { return mode; }, get fight() { return fight; }, get range() { return range; }, get spots() { return spots; },
    get player() { return player; }, get city() { return city; }, get world() { return world; }, get look() { return look; },
    get villains() { return villains; }, get fx() { return fx; }, get life() { return life; }, get hud() { return hudView; }, get traffic() { return traffic; },
    get you() { return you; }, get anim() { return anim; }, get view() { return view; }, setCamera: setCamera,
    get swing() { return swing; }, get held() { return held; }, get fxv() { return fxv; }, get attacks() { return attacksView; }
  };
})();

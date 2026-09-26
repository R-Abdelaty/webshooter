(function () {
  'use strict';
  // The 3D game: builds the city the first time, and runs it in one of three
  // modes - a fight (Encounters/Fight), the training range (Training3D), or
  // free roam, where light columns on the street mark where each fight
  // starts. Move walks; the wrist or the mouse looks (Look decides how); a
  // flick or a click shoots a web. The cards (INTRO, PAUSED, DEFEAT, VICTORY)
  // hold everything still while they are up. The 2D game is untouched and
  // still reachable as CLASSIC.

  var $ = function (id) { return document.getElementById(id); };
  var SEED = 20180907;             // one fixed city; change it for a different one
  var MOUSE_SENS = .0022;          // radians per pixel of mouse movement
  var RANGE = 1500;                // metres a web can reach
  var STRAND_MS = 220;             // how long the strand from the wrist to the hit shows
  var SHAKE = .012, SHAKE_MS = 260; // a hit's screen shake: radians, and how long it takes to settle
  var SAVE_KEY = 'ws.save3d.v1';
  // How long the defeat (or the villain getting away) plays before its card.
  var END_MS = { won: 1800, lost: 900 };
  var canvas = $('world-canvas'), fx = $('world-fx'), fxc = fx.getContext('2d'), cross = $('world-crosshair');
  var world = null, city = null, spots = null, player = null, webs = null, actors = null, villains = null, look = Look.create(), strands = [];
  var running = false, paused = false, locked = false, leaving = false, rebase = false, looping = false, last = 0;
  var perf = false, perfAt = 0, frames = 0, lastLook = null, pending = null;
  var mode = 'roam', fight = null, enc = null, range = null, shownEnd = null, endAt = 0, armed = false;
  var shakeAt = -1e9, shakeAmp = 0, hud = {}, hooks = [], modelShown = false, going = false;

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
    actors = WorldActors.create(world.scene, allSpots());
    // The villains' models, loaded now so each fight's is ready by its GO.
    villains = WorldVillains.create(world.scene, world);
    villains.preload();
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
    show($('world-card'), false); show($('world'), false); show($('menu'), true);
    document.dispatchEvent(new CustomEvent('webshooter:quit'));
  }

  // Put the player somewhere, facing somewhere, with a fresh view history.
  function place(v) {
    player = Player.create(v);
    player.pitch = v.pitch || 0;
    look = Look.create(); strands = []; webs.clear();
  }
  function enterRoam(fromSpawn) {
    mode = 'roam'; fight = null; enc = null; range = null;
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
    place(enc.vantage);
    save(i);
    var v = VILLAINS[enc.villain];
    card('intro', 'ENCOUNTER ' + (i + 1), v.name + '. ' + enc.intro, [['GO', 'go'], ['FREE ROAM', 'roam'], ['MENU', 'menu']]);
  }
  function enterTraining() {
    mode = 'train'; fight = null; enc = null;
    range = Training3D.start(spots.training, Date.now() & 0x7fffffff);
    place(spots.training.vantage);
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
    card('paused', 'PAUSED', mode === 'fight' ? 'The clock stops until you resume.' :
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
    return { yaw: player.yaw, pitch: player.pitch, eye: Player.eye(player), seen: fight ? Fight.snapshot(fight) : null };
  }

  function frame(now) {
    if (!running || !world) { looping = false; return; }
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
      if (fight) Fight.tick(fight, dt);
      if (range) Training3D.tick(range, dt);
      if (mode === 'roam') triggers();
    }
    var eye = Player.eye(player);
    // The villain's model: its clips move on while the fight is played, and
    // through its defeat even once the card is up. Its bones are sampled into
    // the fight now, before the camera below records what this frame shows.
    var animDt = !paused || (fight && (fight.mode === 'won' || fight.mode === 'lost')) ? dt : 0;
    modelShown = villains.update(fight, animDt, eye, now);
    ending(now);
    world.setFov(fov());
    world.update(dt, eye, player.yaw, player.pitch);
    shake(now);
    Look.record(look, deviceTime(c, now), camera());
    // Extras that draw into the world (the model viewer): (dt, now, paused).
    for (var h = 0; h < hooks.length; h++) hooks[h](paused ? 0 : dt, now, paused);
    actors.drawFight(fight, VILLAINS, eye, now, fight && fight.mode === 'won' ? Math.max(0, 1 - (now - endAt) / 800) : 1, modelShown);
    actors.drawTarget(range && range.target3, now);
    actors.showBeacons(mode === 'roam');
    cross.style.left = r.crosshair.x * 100 + '%'; cross.style.top = r.crosshair.y * 100 + '%';
    cross.classList.toggle('is-turning', r.turning);
    webs.update(now);
    world.render();
    drawStrands(now);
    drawPointer();
    drawHud();
    if (perf) readout(now, c, S);
    requestAnimationFrame(frame);
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
      card('defeat', 'DEFEAT', 'Out of time. ' + VILLAINS[enc.villain].name + ' got away.', [['RETRY', 'retry'], ['FREE ROAM', 'roam'], ['MENU', 'menu']]);
    }
    if (fight.mode === 'won') {
      var lastOne = enc.index >= 2;
      card(lastOne ? 'city-saved' : 'victory', lastOne ? 'CITY SAVED' : 'VICTORY',
        lastOne ? 'The city is safe!' : 'One villain down. The city still needs you.',
        [[lastOne ? 'REPLAY' : 'NEXT ENCOUNTER', 'next'], ['FREE ROAM', 'roam'], ['MENU', 'menu']]);
    }
  }

  function shake(now) {
    var k = Math.max(0, 1 - (now - shakeAt) / SHAKE_MS);
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
    if (!running || paused || !world || !player) return null;
    // Cooling down, or a fight not being played: the shot doesn't happen.
    if (fight && (fight.mode !== 'playing' || fight.cooldownRemaining > 0)) return null;
    if (range && range.cooldownRemaining > 0) return null;
    var c = ctl(), S = settings(), wrist = wristLooks(c);
    var view = at && p ? Look.crosshair(at, S.lookMode, wrist) : look.crosshair;
    var cam = (p && Look.cameraAt(look, Look.shotTime(p))) || camera();
    var dir = Look.ray(cam, view, world.camera.fov, world.camera.aspect);
    var hit = world.raycast(cam.eye, dir, RANGE), now = performance.now();
    var shot = { origin: cam.eye, dir: dir, blocked: hit ? hit.distance : Infinity };
    var end = hit ? hit.point : { x: cam.eye.x + dir.x * RANGE, y: cam.eye.y + dir.y * RANGE, z: cam.eye.z + dir.z * RANGE };
    var out = { view: view, hit: false, point: hit ? hit.point : null };
    WSAudio.thwip();

    if (fight) {
      var r = Fight.fire(fight, VILLAINS, shot, cam.seen);
      out.hit = r.hit; out.kind = r.kind;
      // Webs on the villain are placed on him as he is drawn now - on the
      // model, stuck to the bone under the spot - since a rewound shot was
      // judged where he was, and he has moved on since.
      var bbNow = !modelShown && fight.at && Fight.billboard(fight, VILLAINS, Player.eye(player)), st;
      if (r.hit && r.kind === 'villain') {
        st = modelShown && villains.stickSpot(fight, r.spot.name, cam.eye);
        if (st) { webs.add(st.point, st.normal, dist(cam.eye, st.point), now, st.parent, st.size); end = st.point; }
        else {
          var spot = Fight.weakSpots(fight, VILLAINS, Player.eye(player)).filter(function (w) { return w.name === r.spot.name; })[0] || r.spot;
          if (bbNow) webs.add(spot, bbNow.normal, dist(cam.eye, spot), now, actors.villainAnchor(), r.spot.r * 3.2);
          end = spot;
        }
        actors.flash(now); villains.flash(now); flash(.32); shakeAt = now; shakeAmp = SHAKE;
        WSAudio.crunch();
      } else if (r.hit) {
        webs.add(r.point, back(dir), dist(cam.eye, r.point), now, actors.thugAnchor(r.thug), .9);
        end = r.point; flash(.2); shakeAt = now; shakeAmp = SHAKE * (r.down ? .9 : .5);
        WSAudio.crunch(); if (r.down && WSAudio.impact) WSAudio.impact();
      } else {
        // A miss can still land on the villain - just not on the weak spot.
        var body = r.body;
        st = body && body.capsule !== undefined && modelShown && villains.stickBody(fight, body.capsule, body.t, cam.eye);
        if (st) { webs.add(st.point, st.normal, body.distance, now, st.parent, st.size); end = st.point; }
        else if (body && body.u !== undefined && bbNow) {
          var on = Fight.onSprite(bbNow, body.u, body.v);
          webs.add(on, bbNow.normal, body.distance, now, actors.villainAnchor());
          end = on;
        } else if (hit) webs.add(hit.point, hit.normal, hit.distance, now);
        WSAudio.thunk();
      }
    } else if (range) {
      var t = Training3D.fire(range, shot);
      out.hit = t.hit;
      // The web sticks to the wall or roof behind the target.
      if (hit) webs.add(hit.point, hit.normal, hit.distance, now);
      if (t.hit) { flash(.18); shakeAt = now; shakeAmp = SHAKE * .5; WSAudio.crunch(); end = t.point; } else WSAudio.thunk();
    } else {
      if (hit) { webs.add(hit.point, hit.normal, hit.distance, now); WSAudio.thunk(); }
    }
    strands.push({ end: { x: end.x, y: end.y, z: end.z }, time: now });
    return out;
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  function back(d) { return { x: -d.x, y: -d.y, z: -d.z }; }

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

  // What you are meant to be shooting at, when it is off the view: an arrow
  // at the edge of the screen pointing the way to turn. (Session 4 restyles
  // this with the rest of the HUD.)
  var camPos = new THREE.Vector3();
  function goal() {
    if (fight && fight.mode === 'playing') {
      if (fight.phase !== 'thugs') return fight.at && { x: fight.at.x, y: fight.at.y + VILLAINS[enc.villain].height / 2, z: fight.at.z };
      var eye = Player.eye(player), best = null;
      fight.thugs.forEach(function (t) { if (!t.down && (!best || dist(eye, t) < dist(eye, best))) best = t; });
      return best && Fight.thugSphere(best);
    }
    return range && !paused ? range.target3 : null;
  }
  function drawPointer() {
    var g = goal();
    if (!g) return;
    var e = world.project(g);
    if (e.front && e.x > .03 && e.x < .97 && e.y > .03 && e.y < .97) return;
    camPos.set(g.x, g.y, g.z).applyMatrix4(world.camera.matrixWorldInverse);
    var w = fx.clientWidth, h = fx.clientHeight, ang = Math.atan2(-camPos.y, camPos.x);
    if (Math.abs(camPos.x) < 1e-6 && Math.abs(camPos.y) < 1e-6) ang = 0;
    var dx = Math.cos(ang), dy = Math.sin(ang), m = 34;
    var k = Math.min((w / 2 - m) / Math.max(1e-6, Math.abs(dx)), (h / 2 - m) / Math.max(1e-6, Math.abs(dy)));
    var x = w / 2 + dx * k, y = h / 2 + dy * k;
    fxc.save(); fxc.translate(x, y); fxc.rotate(ang);
    fxc.fillStyle = '#ff4b4b'; fxc.strokeStyle = '#fff'; fxc.lineWidth = 2.5;
    fxc.shadowColor = 'rgba(0,0,0,.5)'; fxc.shadowBlur = 4;
    fxc.beginPath(); fxc.moveTo(16, 0); fxc.lineTo(-10, -13); fxc.lineTo(-4, 0); fxc.lineTo(-10, 13); fxc.closePath();
    fxc.fill(); fxc.stroke(); fxc.restore();
  }

  // --- the HUD -----------------------------------------------------------------
  // Only what changed is written, so the page does no layout work per frame.
  function put(id, text) { if (hud[id] !== text) { hud[id] = text; $(id).textContent = text; } }
  function bar(frac, on) {
    var w = Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10 + '%';
    if (hud.bar !== w) { hud.bar = w; $('world-barfill').style.width = w; }
    if (hud.barOn !== on) { hud.barOn = on; show($('world-bar'), on); }
  }
  function timerLow(low) { if (hud.low !== low) { hud.low = low; $('world-timer').classList.toggle('is-low', low); } }
  function drawHud() {
    if (mode === 'fight' && fight) {
      var v = VILLAINS[enc.villain];
      put('world-tag', 'ENCOUNTER ' + (enc.index + 1) + ' · ' + v.name);
      if (fight.phase === 'thugs') {
        var left = Fight.standing(fight);
        put('world-info', 'THUGS · ' + left + ' LEFT');
        bar(left / fight.thugs.length, true);
        put('world-timer', 'WAVE'); timerLow(false);
      } else if (fight.phase === 'arrive') {
        put('world-info', fight.health + ' / ' + fight.maxHealth + '  ·  GET READY');
        bar(1, true);
        put('world-timer', fight.timeLimit.toFixed(1) + 's'); timerLow(false);
      } else {
        var spot = v.targets[fight.targetIndex % v.targets.length].name, rem = Math.max(0, fight.timeLimit - fight.elapsed);
        put('world-info', fight.health + ' / ' + fight.maxHealth + (fight.mode === 'playing' ? '  ·  HIT THE ' + spot : ''));
        bar(fight.health / fight.maxHealth, true);
        put('world-timer', rem.toFixed(1) + 's'); timerLow(rem <= 10);
      }
    } else if (mode === 'train' && range) {
      var acc = Math.round(Training3D.accuracy(range) * 100);
      put('world-tag', 'TRAINING');
      put('world-info', range.hits + ' hit / ' + range.shots + ' shot  ·  ' + acc + '%  ·  BEST ' + range.best);
      bar(acc / 100, true);
      put('world-timer', 'STREAK ' + range.streak); timerLow(false);
    } else {
      put('world-tag', 'FREE ROAM');
      put('world-info', 'Walk into a light column to start a fight · Esc to pick one');
      bar(0, false);
      put('world-timer', ''); timerLow(false);
    }
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
    // A lock that arrives after a card went up would trap the pointer under it.
    if (locked && paused) { unlock(); return; }
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
    if (paused && (e.key === 'Enter' || e.code === 'NumpadEnter') && $('settings').classList.contains('is-hidden')) {
      var first = document.querySelector('#world-card-inner button');
      if (first) { e.preventDefault(); first.click(); }
      return;
    }
    if (e.key === 'Escape' && !paused) pause();
    // menu.js recentres the aim on C; that jump must not turn the view.
    if (e.key === 'c' || e.key === 'C') rebase = true;
    if (e.code === 'KeyP') { perf = !perf; show($('world-perf'), perf); frames = 0; perfAt = performance.now(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });
  $('btn-world-quit').onclick = quit;

  window.WorldGame = {
    start: start, quit: quit, pause: pause, resume: resume, fire: fire,
    onFrame: function (fn) { hooks.push(fn); },
    active: function () { return running; },
    paused: function () { return paused; },
    saved: function () { try { var s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.chapter ? s.chapter : 0; } catch (_) { return 0; } },
    get mode() { return mode; }, get fight() { return fight; }, get range() { return range; }, get spots() { return spots; },
    get player() { return player; }, get city() { return city; }, get world() { return world; }, get look() { return look; },
    get villains() { return villains; }
  };
})();

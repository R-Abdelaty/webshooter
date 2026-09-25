(function (root) {
  'use strict';
  // The menu gets the game's reticle in place of the mouse pointer, and the
  // wrist can drive it. Both share one position - the controller's - so moving
  // the mouse and turning your wrist are the same gesture as far as this is
  // concerned, and swapping between them needs no mode switch.
  //
  // The point is that the shooter is usable before a round starts: aim at a
  // button and flick to press it, exactly like shooting a weak spot.

  var el = null, aimed = null, running = false, deps = null, glow = null;

  function build() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'menu-reticle';
    el.setAttribute('aria-hidden', 'true');
    // Same shape the canvas draws in-game: a ring with a cross through it.
    el.innerHTML =
      '<svg viewBox="-24 -24 48 48" width="48" height="48">' +
      '<circle cx="0" cy="0" r="13" fill="none" stroke="#fff" stroke-width="3"/>' +
      '<path d="M-20 0H20M0 -20V20" stroke="#fff" stroke-width="3"/>' +
      '</svg>';
    document.body.appendChild(el);

    // The off-screen marker is deliberately NOT part of the reticle. The
    // reticle hides during a round, where the canvas draws its own - but the
    // aim can run off the edge just the same, and you still need telling.
    glow = document.createElement('div');
    glow.id = 'edge-glow';
    glow.setAttribute('aria-hidden', 'true');
    glow.innerHTML = ['left','right','top','bottom']
      .map(function (e) { return '<i data-edge="' + e + '"></i>'; }).join('');
    document.body.appendChild(glow);
    return el;
  }

  // Shown whenever the aim is off the screen, wherever we are - menu, card or
  // round. Hidden in flick-only mode, which hides where the aim is on purpose.
  function showGlow() {
    var c = deps.getController();
    var strips = glow.children, off, i;
    // In the 3D world, running off an edge will mean "turn" (Session 2), so
    // the marker is only shown there while its PAUSED card is up.
    var world = document.getElementById('world');
    var roaming = world && !world.classList.contains('is-hidden') && !visible();
    var hide = !c.calibrated || (c.settings || {}).aimMode === 'flick' || roaming;
    off = Controller.offscreen(c);
    for (i = 0; i < strips.length; i++) {
      var edge = strips[i].getAttribute('data-edge');
      var lit = hide ? 0 : off[edge];
      strips[i].style.opacity = lit;
      if (lit) strips[i].style.setProperty('--at',
        (edge === 'left' || edge === 'right' ? off.along.y : off.along.x) * 100 + '%');
    }
  }

  // On the menu, and on any card that interrupts a round - INTRO, PAUSED,
  // DEFEAT, VICTORY. Those have buttons to press and the canvas draws no
  // reticle while one is up (it only draws while actually playing), so this is
  // the only pointer there, and the wrist should reach it like anything else.
  function visible() {
    // Nothing to point with until the centre has been set.
    var c = deps && deps.getController();
    if (c && !c.calibrated) return false;
    // The 3D world draws its own crosshair; the reticle is only for its
    // PAUSED card.
    var world = document.getElementById('world');
    if (world && !world.classList.contains('is-hidden')) {
      var worldCard = document.getElementById('world-card');
      return !!worldCard && !worldCard.classList.contains('is-hidden');
    }
    var game = document.getElementById('game');
    if (!game || game.classList.contains('is-hidden')) return true;
    var card = document.getElementById('card');
    return !!card && !card.classList.contains('is-hidden');
  }

  // Where to DRAW it: eased between packets, a few ms behind the true aim, so it
  // moves at the display's rate instead of stepping at the packets'. A press
  // never uses this - it is given the true, pre-flick aim.
  function at() {
    var d = Controller.display(deps.getController(), performance.now());
    return { x: d.x * window.innerWidth, y: d.y * window.innerHeight };
  }

  // What a press would hit. The reticle itself must not be found here, which is
  // why it is pointer-events:none - otherwise it would shadow every button.
  function under(p) {
    var hit = document.elementFromPoint(p.x, p.y);
    while (hit && hit !== document.body) {
      if (hit.tagName === 'BUTTON' || hit.tagName === 'SELECT' || hit.tagName === 'INPUT') return hit;
      hit = hit.parentElement;
    }
    return null;
  }

  function mark(next) {
    if (next === aimed) return;
    if (aimed) aimed.classList.remove('is-aimed');
    aimed = next && !next.disabled ? next : null;
    if (aimed) aimed.classList.add('is-aimed');
  }

  function frame() {
    if (!running) return;
    showGlow();
    if (!visible()) {
      el.classList.add('is-hidden');
      document.body.classList.remove('aim-on');
      mark(null);
    } else {
      var p = at();
      el.classList.remove('is-hidden');
      document.body.classList.add('aim-on');
      el.style.transform = 'translate(' + (p.x - 24) + 'px,' + (p.y - 24) + 'px)';
      mark(under(p));
    }
    requestAnimationFrame(frame);
  }

  // Moving the mouse writes into the same position the wrist uses, so whichever
  // you touched last is simply where the reticle is.
  function onMove(e) {
    if (!visible()) return;
    var c = deps.getController();
    c.pos = { x:e.clientX / window.innerWidth, y:e.clientY / window.innerHeight };
    c.source = 'mouse';
  }

  function mount(d) {
    deps = d;
    build();
    document.addEventListener('pointermove', onMove);
    running = true;
    requestAnimationFrame(frame);
  }

  // A flick presses whatever the reticle is on. The position comes from the
  // caller because it is the pre-flick one - the snap itself must not drag the
  // aim off the button on the way past.
  function press(p) {
    if (!visible()) return false;
    var target = under({ x:p.x * window.innerWidth, y:p.y * window.innerHeight });
    if (!target || target.disabled) return false;
    if (target.tagName === 'BUTTON') { target.click(); return true; }
    target.focus();          // a select or a text field: hand it the keyboard
    return true;
  }

  var api = { mount:mount, press:press, active:visible };
  if (typeof module !== 'undefined') module.exports = api;
  root.MenuAim = api;
})(typeof window === 'undefined' ? globalThis : window);

# Web Shooter 3D — open-world plan

Turn the fixed-screen 2D weak-spot shooter in `game/` into a **first-person 3D open-world city** where you
look and aim with the wrist shooter (MPU on the ESP32) and fire with the existing flick. The work is split
into sessions; each one reads this whole file first, does only its own section, and then writes its
handoff notes in **Status** at the bottom.

## Reference

The user supplied two gameplay videos as the target look and feel. Contact sheets (12 evenly spaced frames
each) are in `docs/reference/`. Open them with the Read tool before you design anything visual.

- `video1-combat.jpg` (Marvel's Spider-Man, 2018 PS4 reveal, 55 s). A sunny Manhattan skyline with
  One World Trade in the distance; a top-down view of busy avenues with yellow cabs; street level under
  towering brownstones and glass towers; a riverfront with water and bare trees; then a **construction
  site** fight against masked thugs in black suits. The site has steel beams, scaffolding, brick stacks,
  tarps and pallets. The HUD is thin and **cyan**: a segmented health bar top-left, an objective or
  combo bar top-right, and a small square cyan **minimap bottom-left**.
- `video2-traversal.jpg` (Spider-Man web-swinging, 47 s). It opens on a skyscraper **rooftop** looking
  over a dense city that stretches to the horizon, then dives off. It swings down long straight avenues
  lined with tall brick and sandstone towers, toward a big park with **autumn trees** (Central Park
  style) and a river or bay at the edge. The sky has bright cumulus clouds, there is atmospheric haze in
  the distance, and there is a minimap bottom-right.

What we take from them: a dense grid city of varied towers, avenues with traffic, a park, a waterfront,
rooftops as vantage points, a construction-site combat arena, distance haze, a daylight sky, and a minimal
cyan HUD with a minimap. The camera is **first person** (the player's POV), not third person like the
videos.

## Fixed decisions (all sessions)

1. **Renderer: Three.js, vendored, no build step.** Use the classic (non-module) build of **r159**, which
   is the last release that ships `build/three.min.js`. Save it as `game/vendor/three.min.js` and add its
   LICENSE next to it. The page must keep working when `game/index.html` is opened **straight from disk**
   (`file://`). That is how the user runs it, and WiFi `ws://` and Web Serial both depend on it. So no ES
   modules, no import maps, no npm runtime dependencies, and plain `<script>` tags as the page already
   uses. Do not use `game/js/engine3d.js` (an old canvas-2D renderer); leave it alone.
2. **Do not touch the input pipeline's hardware side.** `controller.js`, `shooter-link.js`,
   `serial-link.js`, the centre-calibration flow and the firmware in `web_shooter/` keep working as
   they are. New code *consumes* the controller; it doesn't rewrite it. The firmware protocol
   (`aim` with `dyaw/dpitch/yaw/pitch`, `shoot` with `preYaw/prePitch`, flick exclusion) is already right
   for this. The one exception is the analog session at the end.
3. **Testable logic stays in plain UMD modules**, like `levels.js`, `combat.js` and `training.js`, with no
   Three.js inside, so `node --test game/tests/*.test.cjs` can exercise it. Rendering code can use
   Three.js. All the existing tests must keep passing. Each session adds tests for the logic it adds.
4. **The city is procedural** (boxes, instancing, canvas-generated window and brick textures). **Characters
   are real 3D models:** the villains and thugs are rigged, animated GLB models made by the user and
   processed by the pipeline in **`docs/CHARACTERS_PLAN.md`**. That plan replaces the earlier billboard
   villains and primitive thugs. Do not go back to either.
5. **Movement goes through one interface: `Move`.** `Move.vector()` returns `{x, z}` in [-1, 1] (strafe,
   forward), plus `Move.buttons()` for jump or sprint. For now only a **keyboard** source exists
   (WASD/arrows, Shift sprint, Space jump), for desk testing. The user will add an analog stick to the
   hardware later. Write **no** analog or joystick code before the analog session; just make sure a
   second source can be added without touching the game code.
6. **Performance budget:** a steady 60 fps on a laptop integrated GPU at 1080p. Use InstancedMesh or
   merged geometry for buildings, windows and trees, keep draw calls under about 300, use at most one
   shadow-casting light with a small shadow frustum that follows the player, and let fog hide the far
   plane. Add a graphics setting once there is something to scale (C4 added LOW/MED; the user removed
   HIGH as too slow).
7. **Keep the classic 2D game reachable** as **CLASSIC** in the menu until Session 4 decides with the
   user whether to remove it.
8. **Work style:** small commits with clear messages. Run the tests before every commit. Open the page in
   the built-in browser to check it renders and has no console errors. Update `game/README.md` for
   anything the player can see.

## The look model (why Session 2 is its own session)

A wrist can't turn 360°. A comfortable range is about ±80° sideways and about −40…+60° vertically, and
yaw is relative: it is integrated from the gyro and only re-anchored by *Set your centre*. A 1:1 mapping
therefore can't look behind you, and a high gain makes aiming twitchy. Session 2 builds two modes, chosen
under Settings → CONTROLLER → LOOK:

- **EDGE TURN (default, the Wii-FPS model used by Metroid Prime 3 and Red Steel).** The crosshair moves
  freely over the screen from the existing `Controller` position. Inside a central **turn box** (about
  60% × 60% of the screen) the camera stays still, so you aim the crosshair. Past the box edge the camera
  turns toward that side, at a rate that rises smoothly with how far past you are, up to a maximum of
  about 140°/s for yaw and 90°/s for pitch. Bring the wrist back inside the box and the turning stops.
  This gives unlimited turning from a limited wrist, and precise aim at the same time.
- **DIRECT.** The crosshair is fixed at the screen centre. Camera yaw is the wrist yaw times a gain (about
  2×, set by the sensitivity slider), and pitch is the absolute wrist pitch. It feels better once the
  analog stick can turn the body.
- **Mouse** always uses pointer-lock mouselook with the crosshair at the centre.

Pitch is clamped to ±75°. **Shots are raycast from where the crosshair and camera were just before the
flick**: the controller already gives the pre-flick screen position via `Controller.shot()`. Keep a short
history of camera yaw and pitch keyed by the same clock, so the ray uses the pre-flick camera too. Flick
packets must never turn the camera. **C** or *Center Aim* recentres. The off-screen edge marker from the
2D game isn't needed in 3D: in EDGE TURN, going off an edge now means "turn".

## Session 1 — 3D foundation and the city

- Vendor Three.js r159 as described in Fixed decisions. New scripts go in `game/js/world/` (for example
  `world.js` for scene, sky, lights and fog; `city.js` for procedural generation; `player.js` for the
  camera rig, movement and collision; `move.js` for the `Move` interface and its keyboard source).
- **City (seeded, deterministic):** a Manhattan-style grid of blocks and avenues, about 1.2 km × 1.2 km to
  start. Varied towers: brick walk-ups, sandstone mid-rises, glass towers and a few landmark supertalls,
  with setbacks and roof details (water tanks, AC units, parapets). Windows come from canvas-generated
  textures, with the facade material varying by building type. Add roads with lane markings, sidewalks,
  a **park** of about 3 × 6 blocks with instanced autumn trees, paths and a pond, a **waterfront** along
  one edge (animated water plane), and a **construction-site block** (steel frame, scaffolding, brick
  stacks, pallets, tarps) for Session 3's fight. Include a sky gradient with a sun and simple cloud
  sprites, plus distance fog that gives the haze in the reference.
- **Player:** a first-person rig with eye height 1.7 m, walk 6 m/s, sprint 14 m/s, gravity, jump, and
  collision against buildings and the ground (use the city's block and building footprints; a simple
  AABB push-out is fine). Spawn on a tall **rooftop** overlooking the city, like the opening of video 2.
  Mouse look uses pointer lock. Movement uses `Move` with the keyboard source.
- **Wiring:** the menu's START now starts the 3D world, and CLASSIC starts the old 2D game. Esc pauses
  (release pointer lock and show the PAUSED card), and ← MENU still quits. Draw the crosshair at the
  screen centre for now.
- **Tests:** city generation is deterministic for a seed; no building overlaps a road; the spawn point is
  on a roof; collision push-out keeps the player out of a box; `Move` combines sources and clamps to
  length 1.
- **Done when:** you can walk and look around the whole city with keyboard and mouse at 60 fps, and every
  existing wrist, menu and USB feature still works in CLASSIC.

## Session 2 — Wrist look and aim

- Implement the look model above in a testable module (for example `game/js/world/look.js`: from
  controller state, mode, dt and settings to camera yaw/pitch deltas and a crosshair screen position),
  plus the render-side glue.
- Use `Controller.display()` (the smoothed position) for the crosshair and camera. Use the true pre-flick
  aim for shots. Both are already distinguished in `controller.js`.
- Settings: add LOOK (EDGE TURN / DIRECT), TURN SPEED and FOV (60–100°, default 75). Also add, or reuse,
  a sensitivity control. Persist these the same way the existing settings persist.
- Shooting: a flick or a click raycasts from the pre-flick camera through the pre-flick crosshair. For
  now, show a web-splat decal on whatever is hit (building, ground, prop), plus the web strand from the
  bottom-right of the view to the hit point, like the 2D `drawStrand`. Reuse `audio.js` for the sound.
- The centre-calibration dialog must still come first, and must still work over the 3D view.
- **Tests:** in EDGE TURN there is no turn inside the box and the rate rises continuously past it; the
  turn stops when you come back; DIRECT maps yaw with gain and clamps pitch; a flick never changes the
  camera; the shot ray comes from the pre-flick yaw/pitch even though the camera moved afterwards.
- **Done when:** with the wrist you can sweep a full 360° in EDGE TURN, aim precisely at a window, and
  flick-fire a splat exactly where the crosshair was. Ask the user to test with the real shooter and
  tune the constants from their feedback.

## Session 3 — Villains, thugs and combat in the world

- Port the encounter flow (`levels.js`, `combat.js`) to 3D, keeping health values, 20 damage per
  weak-spot hit, cooldown, the timer and the INTRO/GO/PAUSED/DEFEAT/VICTORY cards. Keep the game rules in
  the UMD logic modules. The villain moves in 3D world space instead of in a 2D box.
- **Encounters** are placed in the world, each with a clear vantage point, because until the analog stick
  exists the player can't walk with the hardware. Starting an encounter places the player at its
  vantage point, and a keyboard player can also walk there.
  1. Green Goblin circles the rooftops on a glider path around the player's tower.
  2. Rhino charges back and forth along an avenue below a low rooftop.
  3. Venom leaps between beams in the construction site. The site also has a **wave of masked thugs**
     first (primitive humanoids in black suits with white masks, as in video 1), each knocked down by one
     or two hits.
- Villains are billboards from the existing PNGs, sized to real scale, with the weak spots from
  `villains.js` mapped onto the billboard as glowing world-space markers. The current weak spot
  highlights and advances after each hit, as in 2D. The dodge-on-shot behaviour stays.
- Hit detection: ray against the weak-spot sphere, with a small **angular aim-assist tolerance** (a
  constant, about 1.5°) because wrist aim is less precise than a mouse. Show hit and miss feedback with
  web splats, a hit flash and screen shake.
- **Training** in 3D: one target at a time on nearby rooftops and walls at mixed distances. Each new
  target is at least 30° away from the last, the 3D equivalent of the 2D rule of at least 30% of the
  screen. Keep the HUD stats.
- **Tests:** the weak spot advances on hit; a miss does no damage; the aim-assist cone accepts inside the
  tolerance and rejects outside it; encounter state survives pause; thugs must be cleared before Venom;
  training targets respect the minimum separation.
- **Done when:** all three encounters and training can be played start to finish with the wrist alone.

## Session 4 — HUD, world life and polish

- A cyan HUD in the style of video 1: health and villain bar top-left, objective and timer top-right, a
  **minimap bottom-left** (top-down city blocks, the player arrow, encounter markers), and an off-screen
  indicator at the screen edge pointing toward the current villain when it is out of view.
- World life: instanced traffic (yellow cabs and cars) looping the avenues, some pedestrians as simple
  instanced figures, drifting clouds, and a water shimmer. Keep all of it inside the draw-call budget.
- Positional audio for villains and impacts. Extend C4's LOW/MED graphics setting (`world/gfx.js`,
  which already covers shadow and pixel ratio) to draw distance and traffic density. There is no HIGH:
  the user removed it (see C4's Status entry in `docs/CHARACTERS_PLAN.md`).
- Ask the user whether to delete CLASSIC and the 2D code. Update the top-level `README.md`,
  `game/README.md` and `web_shooter/BUILD.md` for the new game.
- **Done when:** it holds 60 fps on MED on the user's laptop, and the README describes the 3D game.

## Session 5 (optional) — Web-zip traversal with the shooter

This gives the hardware-only player a way to move before the analog stick exists. When the aim ray hits a
building surface or roof edge within about 120 m and no enemy is in the aim cone, a flick **web-zips** the
player along an arc to that point (roughly 0.6–1.2 s) and perches them on the ledge or roof. Add a strand
visual, motion blur or FOV kick, and the landing sound. Fighting still takes priority: a flick with an
enemy in the aim cone (the aim-assist cone around any villain or thug body capsule, since C2 hits count
anywhere on the body) is always a shot. Add a setting to disable zipping. Tests: zip only on valid
surfaces within range, enemy-in-cone always shoots, and the landing is never inside geometry.

## Analog session (only after the stick is wired to the hardware)

- Firmware: read a 2-axis analog stick (for example a KY-023: VRx, VRy, SW) on **ADC1 pins only** (on the
  ESP32, GPIO 32–39; ADC2 doesn't work while WiFi is on). Use the pins the user actually wired. Calibrate
  centre at boot, apply a radial dead zone, and send `"jx","jy"` in [-1, 1] and `"jb"` (button) inside the
  existing `aim` packet. Add `"stick"` to `hello` capabilities. Update `BUILD.md` wiring and the sketch
  comments.
- Page: a `Move` source that reads `jx/jy` from the controller, active only when the firmware reports
  `stick`, with the stick button mapped to jump or sprint. In DIRECT look mode, optionally let the stick's
  x axis turn the body. Tests: packets with and without the stick fields, dead zone, and source merging
  with the keyboard.

## Status

_Each session appends a dated entry here: what was done, what was deliberately left, constants that need
real-hardware tuning, and anything the next session must know._

- 2026-09-25 — Plan written. Reference contact sheets saved in `docs/reference/`. No code changed yet.
- 2026-09-25 — **Session 1 done** (3D foundation and the city). 73 tests pass (55 old + 18 new in
  `game/tests/world.test.cjs`).
  - **What exists.** `game/vendor/three.min.js` is Three.js r159, unmodified; its SHA-256 and source are in
    `vendor/README.md`. It logs a deprecation `console.warn` on load, which is expected. `game/js/world/`
    holds the UMD logic modules `move.js` (the `Move` interface plus its keyboard source), `city.js`
    (seeded layout as plain data, colliders and a grid query) and `player.js` (walk/sprint/jump/gravity and
    AABB push-out). It also holds the Three.js modules `textures.js` (canvas textures), `city-mesh.js`
    (instanced meshes with world-space facade mapping), `world.js` (renderer, sky, sun, clouds, fog,
    following shadow) and `world-game.js` (page glue, exposed as `window.WorldGame` with
    `start/quit/pause/resume/active/paused/player/city/world`). START opens the city. CLASSIC is the old
    START. CONTINUE and TRAINING are still the 2D ones.
  - **City facts for later sessions.** Seed `20180907` (in `world-game.js`). x is east, z is south, y is
    up, in metres. `yaw` 0 looks north and positive yaw turns left (Three.js `rotation.y`), and `pitch` is
    clamped to ±75° in `Player.look`. The city is 1242 × 1240 m: 10 × 17 blocks, 22 m avenues along z,
    16 m streets. The river is on the west. The park is blocks i 4–6, j 2–7. The construction site is block
    i 7, j 11; `city.site.frame` gives the steel frame's grid (8 m bays, 4.2 m storeys, six storeys, with
    the top two partly open) for Venom's beams. `city.spawn` is the north-east corner of a 197.6 m roof at
    block i 0, j 12, facing north-east. Nothing within 320 m of it is taller than 110 m, except the
    landmarks: 400 m taper (i 8, j 1), 320 m deco (i 3, j 9) and 272 m slab (i 2, j 16). Backdrop buildings
    (`city.filler`) have no collision; `city.walk` bounds the player.
  - **Budget.** 32–36 draw calls including the shadow pass, about 330k triangles, one 2048² shadow map
    covering ±90 m around the player. Pixel ratio is capped so the canvas renders at most about 1920 px
    wide. The city takes well under a second to build on first START. I measured **128 fps only in the
    desktop app's narrow browser pane** (about 640 × 1330 px at DPR 1.5, on this PC's GPU). **60 fps at
    1080p on an integrated GPU is not yet verified**: ask the user to press P in a full-screen window.
    LOW/MED/HIGH is left to Session 4; the obvious levers are the shadow map size, anisotropy (4–8 now),
    `FILLER` reach, the pixel-ratio cap and MSAA.
  - **Constants to tune by feel.** `MOUSE_SENS` 0.0022 rad/px (`world-game.js`). In `player.js`: `JUMP` 6.4,
    `GRAVITY` 22, `STEP` 0.45 and walk/sprint 6/14. Haze is `FogExp2` 0.00068 (`world.js`). Lighting in
    `world.js` is hemisphere 1.35, sun 2.7 and ACES exposure 1.05.
  - **Changed outside `world/`.** `game.js` now waits for DOMContentLoaded before dispatching
    `webshooter:ready`. Cached images could finish before `menu.js` loaded, which left START disabled;
    loading Three.js made that happen. `menu-aim.js` hides the menu reticle and edge marker while roaming
    and shows them on the 3D PAUSED card. The input pipeline's hardware side is untouched.
  - **Collaborator change to know about.** While this session ran, R-Abdelaty committed `444213e fixed
    control`, which changes `controller.js` (horizontal position now comes from an anchored running yaw:
    `yawAnchor`/`xAnchor`/`xGain`), the firmware and `BUILD.md`. Session 2 builds on `controller.js`, so
    read that commit first.
  - **Not verified here.** Real pointer lock: the app's browser pane refuses it, so I checked the
    mouselook handler by faking `document.pointerLockElement`. Try it in Chrome or Edge from disk. Also
    unchecked: `file://` itself, because the pane shows `file://` pages as static snapshots. I tested over
    a throwaway local static server, and the page still loads plain `<script>` tags only. The wrist does
    nothing in the 3D world yet (Session 2).
  - **Known noise.** Console errors for `ws://webshooter.local:81` retries appear when no shooter is on the
    network. A 404 for `assets/theme.mp3` is the optional drop-in music file.
- 2026-09-26 — **Session 2 done in code; tuning on the real shooter is still to do.** 82 tests pass (73 old + 9 new in
  `game/tests/look.test.cjs`).
  - **What exists.** `game/js/world/look.js` (UMD, no Three.js) is the look model. `Look.step()` takes
    `Controller.display()`, the mode, TURN SPEED and flags (`frozen` for a flick, `hold` for a pause, `rebase` after
    **C**), and returns yaw/pitch deltas for `Player.look` plus the crosshair position. `Look.record/cameraAt` keep
    about 1 s of cameras. `Look.ray` is the shot direction. `world/webs.js` pools web-splat decals (one draw call
    each, 24 at most). `World3D` gained `raycast`, `project` and `setFov`. `world-game.js` wires it together and
    exposes `WorldGame.fire(at, p)` and `WorldGame.look`. `menu.js` sends flicks to `WorldGame.fire` while the world
    is active and unpaused. It also stores `lookMode` ('edge'/'direct'), `turnSpeed` (1) and `fov` (75, vertical) in
    `ws.settings.v2`. The PAUSED card has a SETTINGS button. The only change to `controller.js` is that
    `renderDelay` is now exported.
  - **How the pre-flick camera works.** Each frame is recorded against the *device* time whose aim it displayed:
    `now - clockOff - renderDelay`, the same clock `display()` uses. A shot looks up `p.ms - 80`, which is the
    firmware's `flickOnsetMs - PRE_FLICK_MS`, the time `preYaw/prePitch` come from. So the crosshair and the camera
    are the pair that was on screen together. A click uses the current camera and crosshair.
  - **Decisions to know about.** (1) The controller maps 250° of wrist to one screen, which puts a 60% box edge
    75° away and is too far for a wrist. EDGE TURN therefore multiplies the controller's offset from centre by
    `EDGE_GAIN_X` 2 and `EDGE_GAIN_Y` 1.3. With those, the box edge is about 37° sideways and 26° up at
    sensitivity 1. (2) DIRECT's camera is an absolute function of the controller position (yaw from the change in
    x, pitch from y), so it cannot drift. Sensitivity scales both axes. At sensitivity 1, pitch is 1:1 with the
    wrist. (3) A turn in progress is frozen while the device flags a flick, and it resumes when the flick ends.
    The few unflagged packets before the device detects the flick can still nudge an EDGE turn, but the shot
    ignores that because it uses the rewound camera. (4) Moving the mouse while pointer-locked takes the look,
    puts the wrist's aim back in the middle, and resumes from there when the wrist moves. (5) FOV is vertical,
    like Session 1's 75.
  - **Verified in the browser** with synthetic 100 Hz angle packets fed to the real controller. The measured
    turn rate matches the curve: 0 at 30° of wrist, 13°/s at 45°, 69°/s at 55°, 135°/s at 62° and 140°/s past
    it. The turn stops on return. DIRECT gives 40° of view for 20° of wrist, 25° of pitch for 25° of wrist, and
    clamps at −75°. Flagged flick packets moved nothing in either mode. A shot fired 200 ms into a fast turn used
    the camera from before the flick. Splats land under the crosshair on roofs and on facades 400 m away. The
    centre dialog covers the 3D view, and the wrist does nothing until it is confirmed. Settings persist. CLASSIC
    still plays. The console shows only the known WebSocket and `theme.mp3` noise.
  - **Not verified.** The real wrist shooter, over WiFi and over USB: only synthetic packets were fed in, so
    the "done when" (a full 360°, precise window aim, and a splat exactly where the crosshair was) still needs
    the user. The `shoot` event routing in `menu.js` is a one-line change that I haven't exercised through a
    real link. Pointer-lock mouselook still can't be checked in the app's pane.
  - **Constants to tune on the hardware.** In `look.js` (`Look.constants`): `BOX_X/BOX_Y` .3, `RAMP_X/RAMP_Y` .2,
    `CURVE` 2, `MAX_YAW` 140, `MAX_PITCH` 90, `EDGE_GAIN_X` 2, `EDGE_GAIN_Y` 1.3, `DIRECT_GAIN` 2,
    `DIRECT_PITCH_GAIN` 1 and `INSET` .02. In `webs.js`: `SIZE_PER_M` .04, `SIZE_MIN` .7, `SIZE_MAX` 14 and `LIFE`
    6000. In `world-game.js`: `RANGE` 1500 and `STRAND_MS` 220. The user-facing settings are SENSITIVITY, TURN
    SPEED and FOV.
  - **For Session 3.** A city raycast costs about 3 ms on this PC because it walks every instance of the
    instanced meshes. That's fine for one per shot. If enemies need several per frame, prefilter with
    `City.query` or test boxes directly. Aim-assist and weak-spot hits should use `Look.ray` with the rewound
    `cam` from `WorldGame.fire`, then test spheres before (or instead of) the city raycast. Splats use
    `depthWrite:false` and `renderOrder` 2, and can wrap oddly over a box corner.
- 2026-09-26 — **Session 3 done in code; still needs playing with the real shooter.** 103 tests pass (82 old
  + 21 new in `game/tests/fight.test.cjs`).
  - **What exists.** These are the UMD logic modules (no Three.js). `world/aim-assist.js` (`AimAssist`) is the
    1.5° cone: `miss` measures the angle from the sphere's edge, and `pick` takes the closest target and rejects
    one behind the city hit (`blocked`). `world/encounters.js` (`Encounters.build(city)` → `{fights, training}`)
    gives each fight and the range a vantage, a street trigger and its path data. `world/fight.js` (`Fight`) is a
    fight: its state *is* a `Combat` state, plus the 3D movers, weak spots on the sprite, the thug wave and
    `snapshot`. `world/training3d.js` (`Training3D`) keeps targets at least 30° apart. `combat.js` gained
    `clock` and `judge`, and `training.js` gained `score`, so the 3D game applies exactly the 2D rules (20
    damage, 0.35 s cooldown, 30 s, the dodge) without the 2D geometry. `villains.js` loads in node and gives
    each villain a real-scale `height` (2.4 / 2.9 / 2.5 m) and its PNG `aspect`. A test checks the aspect
    against the PNG header. The Three.js side is `world/actors.js` (sprites, weak-spot markers, thugs as
    three InstancedMeshes, light-column beacons, the training target) and the rewritten `world-game.js`.
  - **Where the fights are** (seed 20180907). Goblin: from the most open spot on the spawn roof
    (-582, 197.6, 277). He circles at 12–20 m and 3–9 m above the roof. Rhino: from the *parapet top* of a
    19.8 m roof at (-503.15, 20.9, 216), because standing back from a parapet hides the street below. He
    charges along the avenue at x -488 between z 184 and 248, ±7 m across the lanes. Venom: from a new
    shipping container in the site yard, top at (291.72, 2.75, 214), facing the frame (x 305–345,
    z 202–226). He uses 26 frame nodes within 28 m that are in view. There are 6 thugs, alternately one-hit
    and two-hit. `city.js` places the container without drawing on the random stream, so the rest of the
    city is unchanged. Training: roof (-416.4, 39.6, 216) with 32 targets on nearby walls and roofs, 16–69 m
    away. Triggers are 5 m circles on the pavement; they fire only within 1.5 m of street height, and only
    after you have stepped out of them.
  - **Menu and flow.** START opens Encounter 1's INTRO over the city: GO, FREE ROAM or MENU. VICTORY goes on
    to the next encounter; after Venom it is CITY SAVED → REPLAY. DEFEAT offers RETRY. CONTINUE starts the
    furthest encounter reached (`ws.save3d.v1`); the classic `ws.save.v1` is no longer read or written.
    TRAINING is the 3D range. CLASSIC is unchanged, except that its INTRO card now has TRAINING, which is
    where the 2D range lives now. Free roam shows a light column at each trigger, and its PAUSED card
    lists GOBLIN / RHINO / VENOM / TRAINING. Enter presses a card's first button, and flicks press card
    buttons through `MenuAim` as before.
  - **Decisions to know about.** (1) **Lag compensation.** Each recorded camera also carries
    `Fight.snapshot`, so a flick is judged against where the villain and thugs *were* when you aimed. Webs
    are then placed on the sprite as it is drawn now (by sprite u/v, or by weak-spot name). I verified this in
    the page: the Rhino moved 9.9 m and the view turned 29° after the aim, and the rewound shot hit while the
    same shot unrewound missed. (2) **Sprites tip back about their feet to face you**, not only about the
    vertical. From the Rhino's parapet (about 54° down), an upright sprite was squashed flat. `onSprite` and
    `bodyHit` follow the tilt. (3) **The sprites are data URIs** in `world/villain-sprites.js` (1.7 MB,
    generated by `node game/tools/embed-sprites.cjs`), because WebGL refuses `file://` images. (4) The 30 s
    clock starts when Venom arrives; the thug wave is untimed. (5) As in 2D, only the highlighted weak spot
    scores. At the Rhino's 25 m the weak spots are only about 2° apart, so the cone around the current one
    can take in a neighbour: aiming at the shoulder may score as the chest. That is generous, not wrong.
    (6) There is a minimal red **off-screen arrow** (`drawPointer` in `world-game.js`) pointing to the villain,
    the nearest standing thug or the training target, because the Goblin goes behind you. Session 4 should
    restyle it with the HUD, as should the plain cyan fight HUD (`#world-tag/-bar/-info/-timer`).
  - **Verified in the browser** (over a local static server; the pane is portrait, about 800 × 1047).
    Scripted aim through the real `WorldGame.fire`: the Goblin fought to VICTORY. Weak spots went CHEST → HEAD →
    SHOULDER at 20 each, and misses did nothing. The Rhino took hits. Venom appeared only after 9 hits
    cleared the 6 thugs, and his clock started then. All three are played to a win in the node tests,
    not in the page. Pause via Esc held the clock and Enter resumed it. Placing the player in the Rhino's
    column on the pavement started his INTRO at the parapet. The real walk-in with W didn't run, because
    the pane was hidden then. Training hits counted, and targets landed 38–157° apart. The centre prompt still comes first over a fight. CLASSIC and
    its training still play. Fights draw 42–46 calls at about 340k triangles. The console shows only the known
    WebSocket, Three.js deprecation and `theme.mp3` noise.
  - **Not verified.** The real shooter, over WiFi or USB. The "done when" (all three fights and training
    played start to finish with the wrist alone) needs the user; ask them to try it and tune from their
    feedback. `file://` in a real browser: the data URIs should make the sprites load, but I only tested
    over http. 60 fps at 1080p. Pointer lock. While the pane was hidden, `requestAnimationFrame` stopped
    and `visibilitychange` paused the fight, as it should. So the first START on a hidden tab only builds
    the city once the tab is shown.
  - **Constants to tune by feel.** `AimAssist.TOLERANCE_DEG` 1.5. In `Fight.constants`: `WEAK_R` .11 (of the
    height), `THUG_R` .5, `CHARGE_TURN` .6 s and `PERCH_MIN/MAX` .8–1.8 s. In `Encounters.constants`: `GLIDER`
    (R 12–20, H 3–9, `SCALE` 60), `CHARGE` (`HALF` 32, `LANE` 7, `SCALE` 64), `LEAP` (`RANGE` 28, hops 3–13 m,
    `SCALE` 50) and `THUGS`. The metres-per-second speed is `level.moveSpeed` (or `dodgeSpeed`) × `SCALE`: the
    Goblin does about 5 m/s, the Rhino 7.4 m/s and Venom 7.5 m/s, and faster while dodging. `Training3D.ANGLE`
    is 1.2°, within 0.6–1.6 m. In `world-game.js`, `SHAKE` is .012 rad over 260 ms. Villain `height` is in
    `villains.js`.
  - **For Session 4.** `WorldGame` exposes `mode`, `fight`, `range` and `spots`. The minimap can take
    encounter markers from `spots.fights[i].trigger` and `.vantage`, and beacon colours from
    `WorldActors.BEACON_COLORS`. The Venom fight's thugs add 3 draw calls (plus 3 for shadows). The goblin
    PNG includes a wooden display base, which reads as his glider disc.

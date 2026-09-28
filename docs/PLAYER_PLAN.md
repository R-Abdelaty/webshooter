# Web Shooter 3D — playable Spider-Man, swinging, and villains that fight back

The 3D city game is built (`docs/3D_PLAN.md` Sessions 1–4 and `docs/CHARACTERS_PLAN.md` C1–C4). The
villains are animated models, and a hit anywhere on the body counts. The player, though, is still a
floating camera: no body, no hands, no health. The fights are 30-second rounds against villains who
never attack. This plan turns the player into Spider-Man, adds web-swinging, and makes the fights a real
fight.

Read `docs/3D_PLAN.md` and `docs/CHARACTERS_PLAN.md` (their Fixed decisions and Status) first, then this
whole file. Each session does only its own section and appends a dated handoff entry to **Status** at the
bottom of this file.

## What the user asked for

1. **Web-swinging** like the reference video, but **without flips, spins or acrobatic animations**:
   they don't work in first person.
2. **Play as Spider-Man**, using the model the user supplied, with a setting to play in **first
   person (POV)** or as the **full character** (third person).
3. **The hands visible in POV**, with good animations for shooting webs and for swinging.
4. **A player health bar** in every fight, and **villains that attack and try to kill the player**, with
   good animations.
5. **All three villains at the same level, which is hard**, and **no timer**.

## Reference

- `docs/reference/video3-swinging.jpg` shows 12 frames of the user's swing video, from Marvel's
  Spider-Man 2 at golden hour:
  - webs attach to building walls ahead of and above him, and the line is straight and taut;
  - he swings in long pendulum arcs down the avenues and lets go near the top of the arc;
  - he carries his speed into the next web;
  - he perches on a roof edge, then dives off between the towers;
  - the camera stays behind, and slightly above, the line of travel.
  - Take the **line, arc, release, carried speed and perch** from it. Ignore the flips and body spins.
- `docs/reference/video1-combat.jpg` shows the HUD style: a cyan segmented player health bar top-left.

## The Spider-Man model (source: `game/assets-src/characters/spiderman/`)

This is `SpiderManOfficial.fbx` (Blender 2.92 FBX, 8.6 MB, tracked with Git LFS). It is a fan-made
model; keep it for personal use and don't publish it.

- **Mesh:** one mesh, `Spidey`, with 59.4k triangles; 1.8 m tall, standing on the ground. It has 9 face
  shape keys (blend shapes).
- **Materials (6):** `Suit.003`, `Mask.003`, `Metal28`, `Left.002` and `Right.002` (the lenses) and
  `_3_Web_Shooter`.
  - Textures are in the folder: `NewDiffuse.png` (8000²), `spec2.png` (8000²), `wrinkles.png` (3000²)
    and `1_-_Lentes_-_Difusse.jpg` (the lenses).
  - The FBX links only one texture, the web-shooter normal map, by an absolute path from the author's PC
    (`E:\Spider-ManAnimated\...\Web_Shooter_Normal.png`), and that file is **not** in the folder. So
    relink the rest by name, and give the web shooter a plain metal material.
  - Everything goes down to **2K WebP**. 8K textures would not load in a browser tab, let alone at 60 fps.
- **Skeleton:** 78 bones with **Mixamo names** (`mixamorig:Hips`, `Spine`/`Spine1`/`Spine2`, `Neck`,
  `Head`, `HeadTop_End`, full fingers `…Thumb1–4`, `Index1–4`, and so on, `LeftToeBase`). Mixamo clips
  therefore map by bone name, and `game/tools/blender/rhino.py`'s retarget code works on this rig as-is.
- **Embedded animation stacks (16):**
  - 4 `mixamo.com` layers (`Layer0` to `Layer0.003`) with unknown contents: render them and keep any that
    are useful;
  - `PeterParkerUpdate_TempMotion`, `ArmatureAction` and `FIGAction`: check them;
  - `CameraAction` and 8 shape-key `Calibration` takes: drop them.
- **The FBX importer sets the scene's frame rate from the file** (the Goblin's was 24). Set it back, or
  key everything consistently at the file's rate, as `rhino.py` does.

## Fixed decisions

1. **Everything in the two earlier plans still holds**: Three.js r159 classic; runs from `file://`; logic
   in UMD modules with node tests; models embedded as base64 via `build-models.cjs`; LOW/MED tiers with
   MED at 60 fps; hits anywhere on a body (no targets or weak spots); the thug wave stays switched off.
2. **CLASSIC is frozen (user decision).** Do not edit CLASSIC or anything it loads or shares:
   - `game/js/levels.js`, `combat.js`, `villains.js`, `game.js`, `training.js`, `menu-aim.js`'s CLASSIC
     behaviour, CLASSIC's CSS, or its tests;
   - CLASSIC keeps its 30-second rounds and its weak spots.
   - The 3D game gets its own rules (`world/difficulty.js`, and a 3D rules layer in `fight.js` or a new
     module). It may *call* `Combat` helpers but must not change them.
   - Every existing CLASSIC test must pass **unchanged**.
3. **One difficulty, HARD, for all three villains (user decision):**
   - the same villain HP (start at 300, i.e. 15 hits of 20);
   - player HP 100;
   - the same attack cadence (an attack every 3–5 s), damage scale (15–30 per attack) and telegraph length
     (about 0.9 s);
   - all in one place, `Difficulty.HARD`, so it can be tuned.
   - **No clock anywhere in the 3D fights:** a fight ends when the villain or the player reaches 0.
4. **Aim-and-flick swinging (user decision).** A flick (wrist) or a left click (mouse) is judged in this
   order:
   1. the aim-assist cone around any villain body capsule → **a shot** (even mid-swing; the web line you
      are hanging from stays attached);
   2. a building wall within range (about 60 m) and not below you → **attach and swing** (letting go of any
      current line first);
   3. a roof edge or top surface within range → **zip and perch**;
   4. nothing valid → **let go** of the current line (or nothing, if you're not swinging).
   - Keyboard: WASD and Space still walk and jump.
   - The **analog stick** (future session in `3D_PLAN.md`) will steer swings and walk, so all movement
     and swing steering go through `Move.vector()`. Don't read keys directly.
5. **Two render paths for the player, one model:**
   - `spiderman.glb` is the full body, for third person;
   - `spiderman_arms.glb` is an arms-and-hands mesh cut from the same model, with its own camera-space
     clips, for first person.
   - Setting **CAMERA: FIRST PERSON / THIRD PERSON** in Settings, saved in `ws.settings.v2`, and
     switchable live.
   - In first person the full body stays invisible but can still cast the player's shadow on MED.
6. **Comfort.** Swinging in first person moves the camera a lot. The FOV kick, roll into the arc,
   camera bob and speed lines are capped, and a setting **CAMERA MOTION: FULL / REDUCED** turns them
   down. No flips or spins, ever.
7. **The player's gameplay position is not its animation.** `Player`/`swing.js` own position, velocity
   and state. The models only display them. Animations never move the player (use in-place clips).

## Your part: Mixamo clips for Spider-Man

**Done on 2026-09-27.** All 13 are in `game/assets-src/characters/spiderman/`; see Status for exactly which
Mixamo animation each one is. The steps below are kept for adding more clips later.

Do this before **Session P1**. Go to mixamo.com (free Adobe account) → **Upload Character** →
`game/assets-src/characters/spiderman/SpiderManOfficial.fbx`. It already has a Mixamo skeleton, so
Mixamo should skip the markers. If it asks for them, place them.

For each animation below, search, pick one you like, tick **In Place** if the option exists, then
**Download** as **FBX Binary (.fbx), Without Skin, 30 fps**. Save it into
`game/assets-src/characters/spiderman/` with this exact name:

| save as | search Mixamo for | used for |
|---|---|---|
| `anim_idle.fbx` | "Idle" or "Fighting Idle" | standing |
| `anim_run.fbx` | "Fast Run" | running (third person) |
| `anim_jump.fbx` | "Jumping Up" | take-off |
| `anim_fall.fbx` | "Falling Idle" | in the air, not swinging |
| `anim_land.fbx` | "Falling To Landing" | landing |
| `anim_perch.fbx` | "Crouch Idle" | crouched on a roof edge |
| `anim_hang.fbx` | "Hanging Idle" | base pose for the third-person swing |
| `anim_shoot.fbx` | "Standing 1H Magic Attack" | shooting a web (a one-arm cast) |
| `anim_hit.fbx` | "Hit Reaction" | taking a hit |
| `anim_hit_big.fbx` | "Big Hit" or "Stagger" | a heavy hit |
| `anim_death.fbx` | "Dying" | death |
| `anim_dodge_l.fbx` | "Dodging" (to the left) | dodging |
| `anim_dodge_r.fbx` | "Dodging" (to the right) | dodging |

A similar animation is fine if one isn't there exactly. P1 maps whatever you downloaded.

## Session P1 — Build Spider-Man (Blender)

Needs *Your part* done. Follow the style of `game/tools/blender/` (`common.py`, `rhino.py`, `goblin.py`)
and write `game/tools/blender/spiderman.py`. It builds two models.

**`spiderman.glb` (the full body, third person):**
- Import the FBX and sort the embedded stacks as in *The Spider-Man model*. Render the unknown ones on
  a contact sheet before deciding.
- Keep the native Mixamo rig. Export at real size (1.8 m), or at native size with `scale` in the manifest.
  **Do not `transform_apply` the rig**: on the Rhino it re-derived the bone rolls and turned every clip
  90°.
- Bring the textures down to 2K WebP and relink them by name.
  - `NewDiffuse` → base colour;
  - derive roughness from `spec2` (inverted where that reads right);
  - use `wrinkles` as detail in the normal map only if it improves the look (compare renders);
  - the lenses get the lens JPG and a slight emissive sheen;
  - the web shooter gets a metal material.
  - Budget: under 45k triangles if decimation keeps the silhouette clean; otherwise keep all 59k (only one
    player is on screen). Keep the face shape keys only if the runtime will use them; otherwise drop them.
- Import the Mixamo clips under their standard names: `idle`, `run`, `jump`, `fall`, `land`, `perch`,
  `hang`, `shoot`, `hit`, `hit_big`, `death`, `dodge_l`, `dodge_r`. Also keep any useful embedded
  clips. Then run `prune_static()`. Mixamo clips carry `mixamorig:Hips` translation: strip the
  horizontal root motion from anything that should be in place.
- Also make **upper-body masks**: for `shoot`, keep only the spine and arm channels (or record in the
  manifest which bones the layer drives), so it can play over `run` or `hang`.

**`spiderman_arms.glb` (first person):**
- The same skeleton. The mesh is only the faces whose vertices are weighted to the clavicles, arms and
  hands (and the web shooters), with a clean cut at the shoulders, capped or hidden past the camera's
  near plane.
- **Camera-space clips**, scripted in Blender the way `goblin.py` scripts the Goblin's (poses in
  character terms, eased Bezier keys, per-bone delays for overlap), with the camera at the head bone
  looking down −Z. Nothing may flip or spin.
  - `fp_idle`: hands low at the frame's bottom corners, a slow breathing sway (a loop);
  - `fp_run`: a bob and alternating arm pump (a loop);
  - `fp_shoot_l` and `fp_shoot_r`: the arm snaps forward toward screen centre into the **thwip pose**
    (middle and ring fingers curled to the palm, index and pinky straight, thumb out, wrist cocked back),
    a small recoil, then back (about 0.35 s). The web leaves the wrist bone at the snap frame, which goes
    in the manifest;
  - `fp_swing_hold_l` and `fp_swing_hold_r`: the arm raised, the fist gripping the line (a loop; the
    runtime IK-aims the hand at the anchor);
  - `fp_release`: the gripping hand opens and drops back;
  - `fp_zip`: both hands on the line, pulling toward the chest;
  - `fp_hit`: both arms flinch in toward the face and back;
  - `fp_death`: the arms slump out of view.
- Manifest: add `spiderman` and `spiderman_arms` to `game/assets/models/characters.json`: file, height or
  scale, loops, the **wrist bones where webs leave** (`mixamorig:LeftHand`/`RightHand` plus an offset to
  the shooter), events (`fp_shoot_*` snap frame), and body capsules for the player (villain attacks hit
  these).
- Render contact sheets of both with `sheet.py` into `docs/reference/clips/`. Fix what looks wrong. Run
  `build-models.cjs` so both are embedded, and add them to the model viewer.
- **Done when:** both models load in the page from `file://`, every clip plays in the viewer, and the
  contact sheets look right. Show the user the sheets.

## Session P2 — The player character: POV hands, third-person body, web shots

- **`world/player-anim.js`** (logic, tested): the player's state (ground idle / walk / run by `Player`
  speed, jump, fall, land, perch, and later swing, zip, hit, dead) → which clips to play and blend, in both
  models. Web shots **alternate hands**, unless one hand is holding a swing line (then the free one shoots).
- **`world/player-view.js`** (render):
  - **POV:** the arms attached to the camera, drawn in their own pass or with their own depth so they
    never clip into walls. They're lit by the scene and get the same colour grade.
  - **Third person:** the full body at the player's position, facing the move direction on the ground
    and the aim direction while shooting. It uses the same material patches the villains get in
    `villain-view.js` (rim light, environment map), because he must not look flat next to them.
- **A third-person camera:** over the right shoulder, about 3.5 m back and 0.6 m up, pulled in when a
  building is between it and the player (sphere cast or several rays against `world.raycast`), eased
  so it doesn't pop.
  - Aim still comes from **screen centre**, and `Look` (edge turn and direct) works unchanged in both
    modes.
  - Shots and lag compensation use the camera ray as they do now. `Look.record` must record the camera
    that was used.
- **Settings:** CAMERA (FIRST PERSON / THIRD PERSON) and CAMERA MOTION (FULL / REDUCED), saved and live.
- **Web shots:** play `fp_shoot_l/r` (POV) or `shoot` as an upper-body layer (third person). The web
  strand, the overlay strand in `world-game.js`, and the `webs.js` splat's start point all leave from
  **the visible wrist**, not from the screen corner. Keep the thwip sound at the wrist.
- **Tests:** the state machine, the hand alternation, the camera pull-in maths, and settings
  persistence.
- **Done when:** in both modes you can walk, run, jump, land and shoot around the city and in all three
  fights; the hands and body animate correctly; and MED holds 60 fps.

## Session P3 — Web-swinging (this replaces 3D_PLAN's Session 5, web-zip)

- **`world/swing.js`** (logic, tested; no Three.js):
  - **Anchors.** A candidate comes from the aim ray (`world.raycast`, which already ignores traffic).
    Valid means: a building wall; within range (about 60 m); not below the player (a small margin
    allowed); not inside a villain's body. A roof top or roof edge within range means **zip**, not swing.
  - **Physics.** A pendulum rope constraint on the player's position: gravity (use `Player`'s), rope
    length set at attach, then a gentle shortening as you pass the bottom of the arc so a chain of swings
    gains height, as in the video. Speed is capped. On release you keep the tangential velocity. Add a
    small boost if you let go near the top of the forward arc, and a little air steering from
    `Move.vector()`.
  - **Collision.** Never end inside a building (reuse `Player.resolveWalls`/`support`). If the rope would
    drag you through a wall, shorten it or slide along the wall. Landings on roofs and streets do no fall
    damage.
  - **Zip.** A fast eased pull along the line to the ledge, ending **perched**: crouched on the roof
    edge, facing out.
  - **The input rules** from decision 4 go through one function, `Swing.decide(aim, state)` → `shot` /
    `attach` / `zip` / `release` / `none`, which `world-game.js` calls from both flicks and clicks.
    Fights use the same rules, so you can swing around a villain and shoot mid-swing.
- **Visuals:**
  - a taut web line from the gripping hand's wrist to the anchor (a thin lit ribbon or cylinder, with a
    little sag on attach that snaps tight);
  - **POV:** `fp_swing_hold_l/r`, the hand IK-aimed at the anchor (two-bone IK on the arm, in the view
    model's space). The camera gets an FOV kick with speed (capped), a slight roll into the arc, and speed
    lines. CAMERA MOTION: REDUCED halves or removes these.
  - **Third person:** `hang` with the gripping arm IK'd to the anchor, the body pitched along the rope,
    and legs trailing with speed. The camera lags behind the direction of travel, slightly above, like the
    video.
- **Sounds:** the thwip on attach, a creak of rope tension by load, wind by speed, and a landing thud.
- **Tests:** anchor validity cases, energy and height gain over a chain, speed cap, release momentum,
  zip ends perched on the edge, no end state inside a building, and `decide` picking a shot over an
  anchor when a villain is in the cone.
- **Done when:** you can swing down a long avenue like the reference video, chain swings for 30 s with
  the mouse and with scripted flicks without clipping into anything, zip to a roof and perch, and shoot a
  villain mid-swing. Ask the user to try it with the wrist shooter, in both camera modes.

## Session P4 — Player health, no timer, one HARD level, and the Goblin fights back

- **`world/difficulty.js`** (`Difficulty.HARD`, tested) and a **3D rules layer** (not `combat.js`; see
  decision 2):
  - villain HP from HARD for all three;
  - player HP;
  - win when the villain reaches 0, lose when the player does;
  - **no clock**;
  - 20 damage per player hit as now;
  - the dodge-on-shot behaviour kept.
  - Remove the timer from the 3D HUD and intro texts only.
- **HUD** (`hud.js`/`hud-view.js`): the **player's health top-left**, a cyan segmented bar like video 1
  that flashes on damage. The **villain's bar moves top-right**, where the clock was. Rewrite the intro
  cards: no "thirty seconds"; say he fights back.
- **Being hit and dying:**
  - POV: a red edge vignette scaled by damage, a short capped camera shake, and `fp_hit`;
  - third person: `hit` or `hit_big` layered;
  - brief invulnerability after a hit (about 0.6 s), and attacks can knock you off a swing line;
  - at 0 HP: `fp_death` or `death`, the camera slumps, then DEFEAT → RETRY (the villain's HP resets too).
- **`world/attacks.js`, the attack framework every villain uses** (logic, tested):
  - **telegraph** (about 0.9 s from HARD): a wind-up clip, a sound cue, and, when the villain is
    off-screen, a **red threat chevron** at the screen edge (reuse `Hud.edge`/`pointer`);
  - **attack**: a hit test against the player's body capsules at the moment it lands;
  - **recovery**: a window where he's open.
  - **Fairness:** never an attack without a telegraph; never two in a row from off-screen; no attack
    during his entrance.
- **The Goblin:**
  - **Pumpkin bombs:** the `attack` clip, and the bomb (`bomb.glb`) leaves `ValveBiped.Bip01_R_Hand` at
    the release frame (21), in an arc aimed at where you'll be. It explodes on contact or after a fuse:
    a radius blast with damage by distance, a flash, and a burst from `fx.js`. **A flick or click at a bomb
    in flight shoots it down** (it goes before villains in `Swing.decide`'s order, with its own small
    cone).
  - **Glider guns:** a red laser from the `Glider_Gun_L/R` bones for the telegraph, then a short burst of
    tracers at where you were. Moving or swinging out of the line dodges it.
  - **Movement:** he now **hunts you**: he follows the player around the roofs at a stand-off distance,
    instead of circling the old fixed vantage.
- **Tests:** HP rules and no clock; invulnerability; bomb flight, interception and blast falloff; the
  gun's line hit test; telegraph timing; HARD applied to all three; CLASSIC tests unchanged.
- **Done when:** the Goblin fight can be won and lost, every attack is telegraphed and can be avoided,
  and the HUD shows both bars.

## Session P5 — The Rhino and Venom fight back

- **The Rhino:**
  - **Charge:** `attack` (wind-up, with a snort), then `run` straight at your position on the ground,
    then `skid` past you. Being hit does heavy damage and knocks you back. Swing, zip or jump out of the
    way.
  - **Ram:** if you're up high (a roof or a swing line near his street), he charges the building under you.
    It's a telegraphed **quake**: a dust shake and a sound, and damage if you're still perched on that
    building within a radius when it lands.
  - **Dazed:** after a ram or a skid into a wall he plays `stun` (unused until now) and **takes double
    damage** for a short window.
  - **Stagger:** enough hits during a wind-up make him `hit_big` and cancel the attack.
- **Venom:**
  - **Pounce:** his leap arcs, now aimed at you: `leap_start`, `leap_air`, `land` next to you.
  - **Melee** combos when close (`attack`, `attack2`, `attack3`).
  - **Tentacle lash** at mid range (`tentacles`), which can pull you off a swing line.
  - He can be interrupted by hits during a wind-up (`hit_big`).
  - He keeps his perches and crawl poses when he's out of reach.
- **All three:** pressure comes from HARD's cadence. Each picks attacks by distance and your state
  (grounded, perched or swinging), with the fairness rules from P4.
- **Tests** for each villain's attack state machine, the ram quake's area, the double-damage window, and
  interrupts.
- **Done when:** each of the three fights can be won and lost with the mouse and with scripted flicks,
  every attack reads before it lands, and MED holds 60 fps. Ask the user to play all three with the wrist.

## Session P6 (optional) — Tune from the user's notes

After the user plays with the real shooter: adjust `Difficulty.HARD`, swing feel (rope shortening, boost,
speed cap, steering), the camera comfort caps, the aim-assist cones for anchors and bombs, and the
third-person camera. Only change what the notes ask for, and keep the tests passing.

## Round 2 (2026-09-28): the user's notes after playing P1–P5

The user played the result and asked for the following. **This is not one session's worth**: it's five
sessions, P7–P11 below. P6 (tuning) is folded into P7 and P8.

1. **A bug:** in POV, after dying and pressing RETRY, the character's height sinks to the ground.
2. **Stick to buildings and climb them**, with arm animations that match the climbing movement.
3. **Arms in the air don't feel alive** (in POV): add animation while jumping, falling and between swings.
4. **The Goblin's laser doesn't target me.**
5. **The graphics are not good enough.**
6. **Not hard enough:** the three villains don't target me enough and don't seem to be trying to kill me.

**What the code says about each** (read before starting; found by the planning session):
- **The RETRY bug.** On death, `player-anim.js` sends `death` and `fp_death` with `hold: true`. `rig.js` keeps a
  held one-shot until something cuts it. RETRY → `enterFight` → `place()` makes a fresh `PlayerAnim`, but **nothing
  resets the two player rigs in `WorldPlayer`** (`player-view.js`). The held `death`/`fp_death` shots most likely
  survive into the next fight: the arms stay slumped, the body lies on the floor, and the view looks like it has
  sunk. Reproduce it first (die, then RETRY, in both camera modes; compare the camera's y with `player.y +
  Player.constants.EYE`), confirm, then fix it at the root: a `WorldPlayer.reset()` that cuts every shot and
  rebases both rigs, called from `place()`. Look for any other per-life state that isn't reset (the slump,
  perch, crouch, `lines`, the camera's pull-in).
- **The laser.** `Attacks.track` eases the aim toward **your chest** at `GUN_TRACK` 2.5/s, and the beam stops
  `LASER.short` (1.2 m) short of you. In POV your chest is below and behind the view, so the beam visibly points
  under you and ends in front of you. It lags whenever you move, and the rounds go where it locked 0.9 s
  earlier.
- **Not trying to kill you.** P4 and P5 built in restraint:
  - **Cadence:** an attack every 3–5 s, plus a 0.8 s `breather` after each.
  - **Off-screen rule:** after an off-screen attack, the next waits **until he's in view**. Look away and
    he never attacks.
  - **Range:** the Goblin holds his attacks beyond `ATTACK_RANGE` 40 m.
  - **The Rhino** only rams from his street. He never leaves it to come after you, and charges only when
    you're down on it.
  - **Venom** keeps to his beams when you're out of his reach.
  - **Stagger:** 2 hits in a wind-up cancel any attack. With good aim, every attack is cancelled.
- **Graphics.** C4 measured and tuned everything on the laptop's **Intel UHD integrated GPU** and deleted
  the HIGH tier (post chain: SSAO, bloom, SMAA) because it ran at 20 fps there. The laptop also has an
  **RTX 4070 Laptop GPU**, which Chrome is probably not using. The city is procedural with flat canvas
  textures. The post chain is still in git at `b2c83db` (`world.js` `buildPost`).

### The user's part before these sessions

- **Before P8 and P10: Mixamo clips — done on 2026-09-28** (see Status). The planning session can download these into the source folders from
  the user's signed-in Mixamo tab, as it did for P1 (FBX Binary, Without Skin, 30 fps, In Place where offered,
  from X Bot):
  - `game/assets-src/characters/spiderman/`:
    - `anim_climb_up.fbx` ("Climbing Up Wall")
    - `anim_climb_down.fbx` ("Climbing Down Wall")
    - `anim_shimmy_l.fbx` ("Left Shimmy", free-hanging)
    - `anim_shimmy_r.fbx` ("Right Shimmy")
    - `anim_climb_top.fbx` ("Climbing To Top", up and over onto a standing pose)
  - `game/assets-src/characters/rhino/`:
    - `anim_throw.fbx` ("Throw Object": he picks something up and hurls it). The Rhino's rig has Mixamo
      bone names too, so this maps by name; retarget with rest-pose correction as `rhino.py` does.
- **Before P11: make Chrome use the RTX 4070.** Windows Settings → System → Display → Graphics → add Chrome
  (or find it) → Options → **High performance** (NVIDIA). Restart Chrome, open `chrome://gpu`, and check
  that the WebGL renderer names the NVIDIA GPU. Play on mains power: on battery, Chrome caps at 30 fps (P5
  saw this). Claude can't change Windows settings; this one is the user's.

## Session P7 — Fix the RETRY bug, aim the Goblin's laser at you, and make HARD actually hard

- **The RETRY bug**, as described above: reproduce, fix at the root, and add a test that a RETRY after
  dying leaves both rigs with no held shot, and the camera at `player.y + EYE` in POV.
- **The laser must visibly target you:**
  - aim at **the camera eye in POV** (and at the head or chest in third person, whichever is on screen);
  - track fast, with a small lead on your velocity;
  - lock only in the last ~0.15 s of the wind-up, and fire the rounds at the locked point with lead;
  - the beam reaches you, and in POV you see it come *at* the lens: a red glare and a dot near screen
    centre, and a red edge chevron when it's off-screen.
  - **Test:** standing still in POV, the locked aim lies within 1° of the view centre; moving at walking
    pace, the rounds pass within `GUN_R` of you unless you sidestep after the lock.
- **HARD, for real, for all three.** Rework `Difficulty.HARD` and the `Attacks` framework's restraint:
  - cadence about 1.6–2.8 s, no breather (or 0.2 s), telegraph 0.6–0.7 s (still always there);
  - `stagger` 4 hits in a wind-up (not 2);
  - invulnerability 0.4 s;
  - the Goblin's range 80 m.
  - **Off-screen attacks are allowed:** a longer telegraph (+0.5 s), the red chevron and a sound, never
    silent. Two in a row from off-screen are allowed, but the second waits until the first lands.
  - An **aggression director**: if 4 s pass with no attack or projectile heading your way, the next attack
    starts now.
  - **The Goblin:** mixes bombs and bursts (a bomb volley of 2–3 while the guns charge), dives at you
    when you're close, and punishes standing still on a roof.
  - Keep "every attack is telegraphed and avoidable" true: that is what makes it fair.
- **Prove it with bots** (node tests, plus a headless run of each fight):
  - a **passive player** (stands still, never shoots) dies within 30 s in every fight;
  - a **human-pace player** (a shot every 1.2 s, 30% misses, dodging only after a telegraph) wins the
    Goblin fight with under 60% HP left most of the time;
  - write down the measured win rates and remaining HP in Status.
- Update the intro cards (they now try to kill you) and the README.

## Session P8 — The Rhino and Venom hunt you

Needs `rhino/anim_throw.fbx`. Build it into `rhino.glb` first, as `throw`, retargeted by extending
`rhino.py`. Contact-sheet it and rebuild with `build-models.cjs`.

- **The Rhino leaves his street.**
  - He follows you along the streets (a path on the city grid, never through buildings) at a jog, and
    charges when he has a clear line.
  - When you're up high he **tears up debris and throws it**: a chunk of road or a car from the traffic
    (hide that car from `Traffic` while he holds it). The `throw` clip, an arcing projectile with lead,
    a blast like the bombs, and it can be shot to pieces in the air (the bomb rules).
  - He still rams the building you're on. The quake reach grows if you stay put.
  - He is never idle for more than 2 s while you're within 80 m.
- **Venom hunts you across the rooftops:**
  - he leaps from roof to roof toward you (`leap_*` arcs, now between buildings, with clear-arc checks);
  - he **climbs walls** to reach you with his `cling_idle`, `crawl_to_cling` and `cling_to_jump` clips. These
    are wall poses, so orient him to the wall's normal; this is what they were for;
  - he pounces from a wall;
  - he lashes more often at range, and the lash can pull you off a wall or a line;
  - he never waits on his beams while you're within 80 m.
- **Both** use P7's director and fairness rules. Update the intro cards.
- **Bots** as in P7: a passive player dies within 30 s; the human-pace win rate and HP go in Status.
- **Done when:** both fights feel like being hunted. Ask the user to play them with the wrist.

## Session P9 — Arms alive in the air (first person, and the body in third)

- **New first-person clips**, scripted in `spiderman.py` in the style of the existing `fp_*` ones (camera
  space, eased keys, overlap, no flips):
  - `fp_air`: arms out for balance, fingers spread, a slow float (a loop);
  - `fp_fall_fast`: arms swept back and streamlined (a loop);
  - `fp_jump`: a push up from the ground;
  - `fp_land`: the hands absorb the landing;
  - `fp_release_reach`: after letting go of a line, the free hand reaches ahead for the next one;
  - `fp_perch_idle`: the hands on the ledge, a slight shift.
  - Rebuild, contact-sheet, and `build-models.cjs`.
- **A procedural "alive" layer** in `player-view.js` or a new `arm-motion.js` (logic tested, no Three.js),
  added on top of any clip:
  - **inertia:** the arms lag the camera's turn and your acceleration, through a damped spring, and settle;
  - **wind flutter:** with speed, small noise on the forearms and fingers;
  - **swing counter-motion:** the free arm counterbalances with the pendulum's phase;
  - **landing dip:** scaled by the impact speed;
  - a breathing sway when idle;
  - all bounded, so the hands never cover the crosshair, and toned down by CAMERA MOTION: REDUCED.
- **`PlayerAnim`** picks `fp_air` / `fp_fall_fast` by vertical speed and `fp_jump`/`fp_land` at the
  transitions. In third person, blend `fall`/`jump` by vertical speed, and add a lean into the direction of
  travel.
- **Tests:** the spring settles, its offsets stay bounded, the clip selection by vertical speed, and REDUCED
  scales things down.

## Session P10 — Stick to buildings and climb them

Needs the Spider-Man climb clips. Build them into `spiderman.glb` as `climb_up`, `climb_down`, `shimmy_l`,
`shimmy_r` and `climb_top`, retargeted from X Bot as P1 did.

- **`world/climb.js`** (logic, tested; no Three.js), on the city's building boxes:
  - **Sticking:** you stick when you walk, jump, fall or swing into a wall, or when a flick or click hits a
    wall within 3 m. You get a wall frame (normal, up, right).
  - **Climbing:** from `Move.vector()` (W up, S down, A/D sideways; the analog stick later), at about 3 m/s up
    and 3.5 m/s sideways.
  - **Corners:** wrap round outside corners onto the next face.
  - **Top-out:** at the roof edge you climb over onto the roof (`climb_top`).
  - **Leaving:** Space jumps off the wall, away and up. A flick or click at an anchor swings from the
    wall, using `Swing.decide` as it is. S at the bottom drops you to the street.
  - Shots work from the wall.
  - Being hit hard knocks you off (P4's `knock`).
  - Never inside geometry.
- **Wrist-only players** (no stick yet): a flick at a point higher up the same wall **crawls you there**
  (a short climb, not a zip). A flick at the roof edge above climbs to the top.
- **Arms that match the climb.**
  - **POV:** new scripted clips `fp_climb_up`, `fp_climb_down`, `fp_climb_l` and `fp_climb_r`:
    hand-over-hand cycles with the palms flat to the wall and the fingers splayed. The runtime **locks the
    clip's phase to the distance climbed** (so hands never slide), and **IK plants each hand on the wall
    plane** while it's down. `fp_wall_idle` when still. The camera sits about 0.5 m off the wall, and you
    can look around (up the wall, back over your shoulder).
  - **Third person:** `climb_*` and `shimmy_*` with the rate from speed, the body aligned to the wall normal,
    and the same hand IK to the wall.
- Sounds: hand and foot slaps in time with the plants, and the thwip for a jump-off.
- **Fights:** the villains' attacks work on a wall. The Rhino's ram knocks you off the building he hits.
  Venom (P8) can climb after you.
- **Tests:** stick and unstick cases, climbing speed, corner wrapping, top-out, jump-off direction, and
  that the phase lock keeps a planted hand still to within 1 cm.
- **Done when:** in both views you can run at a building, stick, climb to the roof, wrap a corner, jump off
  into a swing, and fight from a wall.

## Session P11 — Graphics: make it look good on the RTX

Needs the user's GPU step above (Chrome on the RTX 4070, mains power).

- **Detect the GPU** (`WEBGL_debug_renderer_info`) and **add HIGH (and ULTRA if it holds 60)**, picked
  automatically on a discrete GPU. MED and LOW stay exactly as they are for integrated GPUs.
- **Bring back the post chain** from `b2c83db` (`buildPost`): GTAO or SSAO, bloom for glowing eyes, the
  laser and blasts, SMAA, and the grade. Put it back inside HIGH only.
- **Better shadows:** a larger map, or two cascades (near and far) on HIGH, and contact shadows under
  characters.
- **The city** (the biggest gap to the reference videos; see C4's notes):
  - PBR facades: normal and roughness maps generated for the canvas textures;
  - **window glass that reflects** the sky and city (PMREM environment, a fresnel mix, some lit windows);
  - varied building tops (water towers, AC units, parapets, antennas — some exist; make them read);
  - baked ambient occlusion at the building bases and in the streets;
  - kerbs, lamp posts, trees along the avenues;
  - a better sky: a sun disk, lit clouds, and aerial perspective in the fog colour toward the sun;
  - a golden-hour option like video 3.
- Check the villains and Spider-Man under the new light: rim, environment, SSS-like softening on Venom.
- **Measure in a real Chrome window on the RTX**, at 1080p and 1440p, in every fight and while swinging:
  HIGH must hold 60 fps. Compare screenshots against `docs/reference/video1-combat.jpg`, `video2-traversal.jpg`
  and `video3-swinging.jpg`, and save before/after shots.

## Status

_Each session appends a dated entry: what was done, what was deliberately left, constants to tune, and
anything the next session must know._

- 2026-09-27 — Plan written. The Spider-Man model is copied to `game/assets-src/characters/spiderman/` (FBX
  and textures; `.gitattributes` now also puts `*.jpg` there through LFS). The swing video's contact sheet
  is `docs/reference/video3-swinging.jpg`. The model was inspected read-only (above); nothing was built,
  and no game code changed. Waiting on the user's Mixamo downloads for P1.
- 2026-09-27 — **Mixamo clips downloaded** into `game/assets-src/characters/spiderman/` from the user's
  account (the user signed in themselves). They were exported as FBX Binary, Without Skin, 30 fps, from Mixamo's
  default character **X Bot**, not an upload of the Spider-Man FBX. So each file carries X Bot's **65-bone
  `mixamorig:` skeleton** (Spider-Man has 78: the same names, plus `*_End`/`*4` leaf bones). Names map one to one,
  but the rest poses may differ, so **retarget with rest-pose correction as `rhino.py` does**; don't copy local
  rotations straight across. Every file was checked: 65 bones, 315 curves, one `mixamo.com` stack, `mixamorig:Hips`
  present. Mixamo applied **In Place** where it offers it (run, jump, fall, land, shoot, hit, hit_big, death, dodges);
  still strip any leftover horizontal Hips motion.

  | file | Mixamo animation | size |
  |---|---|---|
  | `anim_idle.fbx` | Fighting Idle (boxing-style ready stance) | 530 KB |
  | `anim_run.fbx` | Fast Run [in place] | 306 KB |
  | `anim_jump.fbx` | Jumping Up (from action idle) | 348 KB |
  | `anim_fall.fbx` | Falling Idle (mid-air) | 334 KB |
  | `anim_land.fbx` | Falling To Landing | 368 KB |
  | `anim_perch.fbx` | Crouching Idle (low crouch) | 516 KB |
  | `anim_hang.fbx` | Hanging Idle (hanging by the hands, gently swaying) | 497 KB |
  | `anim_shoot.fbx` | Standing 1H Magic Attack 01 (one-handed cast forwards) | 522 KB |
  | `anim_hit.fbx` | Hit Reaction | 385 KB |
  | `anim_hit_big.fbx` | Big Hit To Head (from a straight punch) | 365 KB |
  | `anim_death.fbx` | Dying (front impact to the head, falls) | 563 KB |
  | `anim_dodge_r.fbx` | Dodging Right [in place] | 380 KB |
  | `anim_dodge_l.fbx` | Dodging Right, **mirrored** by Mixamo [in place] (a different file from `_r`) | 380 KB |
- 2026-09-27 — **Session P1 done: both Spider-Man models are built, embedded and load in the page from `file://`, and
  every clip plays in the viewer.** 178 tests pass (175 old + 3 new player tests in `rig.test.cjs`). No game code
  outside the model loaders and the viewer changed; CLASSIC is untouched. **Nothing is pushed** (the remote is public;
  see CHARACTERS_PLAN C1).
  - **Build.** `node game/tools/build-models.cjs --blender --sheets --only spiderman` runs
    `game/tools/blender/spiderman.py` (about 50 s), renders both sheets, compresses and embeds. The sources went in
    through LFS. Blender's decimate isn't bit-for-bit repeatable: a rebuild flips a few normals on the thinned lens frames
    (invisible). The committed build is kept, and the arms rebuild identically.
  - **The embedded stacks** (`docs/reference/clips/spiderman_embedded.png`) are all two frames long:
    - `Layer0`/`Layer0.001` are one static near-T-pose;
    - `CameraAction`/`FIGAction` move the armature object out of view;
    - the other twelve are the rest pose.
    None is a clip, so all are dropped. The 9 face shape keys are dropped too, with their current mix (`TopLensR` −1.01)
    baked in.
  - **`spiderman.glb`** (3.0 MB, 1.56 MB compressed):
    - **Size.** 40.1k triangles: the lens frames were thinned 18.8k → 4k and the shooters 6.9k → 2.4k, with the suit
      untouched. It is **real size (1.83 m) with no `transform_apply`**: the glTF exporter keeps the FBX armature's
      0.00168 scale on the armature node. `scale` is not needed in the manifest.
    - **Materials** (4):
      - `suit`: suit and mask merged, one UV set; the UDIM v 2..3 is shifted to 0..1;
      - `lens`: a 512 px lens texture, emissive 0.35;
      - `lens_frame`: black lacquer;
      - `web_shooter`: gunmetal.
    - **Textures.** 2K WebP. Roughness goes 0.62 → 0.30 on `spec2`'s web lines, and the normal map is the web lines as
      a height field. `wrinkles` as extra height was compared in renders and adds only blotchy bulges on the black side
      panels, so it is off (`NORMAL_WRINKLES`). Vertex colours and the extra UV sets are stripped.
    - **Clips** (13, retargeted from X Bot with rest-pose correction, as `rhino.py` does): `idle` (Fighting Idle, 3.3 s),
      `run` (0.53 s, **measured 5.7 m/s**), `jump`, `fall`, `land`, `perch`, `hang`, `shoot`, `hit` (additive through
      `Rig.ADDITIVE`), `hit_big`, `death` (4.4 s), `dodge_l`, `dodge_r`. Horizontal hips drift is removed from every clip:
      it was 9 cm on jump/land and 34 cm on death.
      - `jump` keeps its crouch and push-off but holds the hips at take-off height after the **take-off event (0.6 s)**.
      - `land` starts 2 frames before touchdown.
      - `fall` and `hang` are air poses: feet 0.3 m and 0.24 m above the origin, hang's hands at 2.3 m.
      - The unused embedded clips were dropped.
    - **Contact sheet:** `docs/reference/clips/spiderman.png`.
  - **`spiderman_arms.glb`** (2.4 MB, 1.39 MB compressed):
    - **Mesh.** 17.4k triangles: every face mostly weighted to the clavicles, arms, hands and fingers, plus the shooters,
      on the same 78-bone skeleton. The cut runs across the chest and back, behind the eye.
    - **Camera space.** An `fp_camera` root node puts the eye (between the lenses, 3 cm back) at the origin, looking
      down −Z, so P2 adds it to the camera as it is.
    - **Poses.** Written as wrist targets in camera metres with an elbow hint (two-bone IK), a finger direction and a palm
      normal (the forearm takes half the hand's roll), and finger grips (`relaxed`, `loose`, `fist`, `thwip`, `open`).
      Keys are eased Bezier, with the hand a frame behind the arm and the fingers two. The shoulder sits 16 cm behind the
      eye and the arm reaches 52 cm, so no hand can be more than about 35 cm in front of the eye.
    - **Clips:** `fp_idle` (3 s loop), `fp_run` (16 frames, as long as `run`), `fp_shoot_l/r` (snap at frame 4 = 0.133 s,
      the event), `fp_swing_hold_l/r` (loops), `fp_zip` (hold the end), `fp_hit`, `fp_death` (hold the end), and
      **`fp_release_l`/`fp_release_r`**. This plan named one `fp_release`; each hand needs its own, as with the holds.
    - **Contact sheet** from the eye at 75° and 16:9: `docs/reference/clips/spiderman_arms.png`. In the game renderer:
      `docs/reference/p1_pov_shoot.png` and `p1_pov_swing_hold.png`.
  - **Manifest** (`characters.json` → new `player` section; `Rig.validate`/`check` cover it):
    - **`spiderman`:**
      - `eye` [0, 1.715, 0.016];
      - `wrists`: each hand bone plus an offset to its shooter's centre;
      - 10 body `capsules` measured from the skinned vertices (torso 0.163 m radius, head 0.084);
      - the `jump` take-off event;
      - `speeds` `{walk: 3, run: 5.7}`. The walk speed is a guess: there is no walk clip, and loco crossfades the run
        with idle below it.
      - **`layers.upper`** (spine, neck, head and both arms) for `shoot`.
    - **`spiderman_arms`:** `space: "camera"`, `fov: 75`, the snap events, and **`layers.arm_l`/`arm_r`** for
      `fp_shoot_*` and `fp_release_*`.
    - **Layer masking.** `build-models.cjs` strips each layer clip down to its layer's bones: a sampled export writes
      every bone, at rest where it was never keyed. A test checks that the shipped clips drive only their layer.
  - **Viewer** (M, or `index.html?viewer`): the row now ends with Spider-Man and the arms at eye height. O also draws the
    wrists (orange), and **V** puts the arms on the game camera.
  - **Verified**, in headless Chrome from `file://`:
    - all 7 models load with no warnings;
    - every one of the 24 player clips takes over the pose and moves the bones;
    - the wrist points sit 0.1–1.1 cm from the web shooters' skinned centres across idle, hang, run, `fp_idle`,
      `fp_swing_hold_l` and `fp_shoot_r`;
    - on the camera, each wrist lands exactly at its pose's camera-space target (e.g. idle 0.274, −0.231, −0.299).
    The console showed only the known WebSocket and r159 noise. The app's pane stayed hidden, so the in-pane viewer
    wasn't used.
  - **Not verified.** The user's own Chrome from disk (ask them to open `game/index.html?viewer`, press V and step
    through the `fp_` clips), and fps in a fight with the player drawn (that's P2's).
  - **For P2.**
    1. **Rig has no per-bone layers yet.** Played alone, a layer clip leaves every other bone at rest: in the viewer,
       `fp_shoot_r` drops the left arm out of view. P2 must play layer clips over the base on their bones only, or as
       additive.
    2. `shoot` is Mixamo's 2.3 s cast, too long for a web shot: play its extension part faster, or crop it, and put a
       snap event on it.
    3. `jump`'s crouch is 0.6 s before take-off. For a responsive jump, start the clip about 0.35 s in.
    4. The poses are framed for FOV 75. At FOV 100 the hands look smaller and lower; scale the view model's FOV if needed.
    5. The arms are 0.2–0.35 m from the eye, beyond the 0.1 m near plane, but draw them in their own pass so walls can't
       clip them.
    6. The swing-hold arm fills about the right third of the screen. P3's IK will raise it toward the anchor.
    7. The arms carry their own copy of the 2K suit texture (about 1 MB). The runtime could share the body's.
  - **Also changed.** `common.contact_sheet` now sizes from the visible skinned vertices in the rest pose. The glTF
    importer adds a hidden 2 m bone-shape sphere, which made every figure small, so the villains' sheets will render
    larger next time. It also has a first-person view (`sheet.py --fov`).
  - **Constants to tune by eye** (all in `spiderman.py`): the poses (`IDLE`, `RUN`, `THWIP`, `RECOIL`, `HOLD`,
    `HANG_FREE`, `LET_GO`, `ZIP_REACH`, `ZIP_BACK`, `GUARD`, `SLUMP`), `GRIPS`, `SPREAD`, `TWIST`, `SNAP`, `FRAME_TRIS`,
    `SHOOTER_TRIS`, `ROUGH_SUIT`/`ROUGH_LINES`, `NORMAL_LINES`. Also the capsule radii and `speeds.walk` in the manifest.
- 2026-09-27 — **Session P2 done: you play as Spider-Man in first and third person, around the city and in all three
  fights.** 198 tests pass (178 old + 20 new in `game/tests/player.test.cjs`). No CLASSIC file or test changed, and neither
  did `menu.js` or `audio.js` (both are shared with CLASSIC). **Nothing is pushed.**
  - **What exists.**
    - Logic (UMD, tested): `world/player-anim.js` (`PlayerAnim`) and `world/player-camera.js` (`PlayerCamera`).
      - `PlayerAnim.step(a, player, dt, extra)` classifies idle/walk/run/jump/fall/land from `Player` and returns clip
        commands for both models. `extra` takes `{perched, zip, swing: 'l'|'r', hits, big, dead}`. P3 and P4 fill these in;
        today `world-game.js` passes nothing.
      - `PlayerAnim.shoot(a)` picks the hand and returns the layer clips. `PlayerAnim.face` gives the third-person facing.
      - `PlayerCamera` holds the settings (`settings/load/save`), the third-person boom (`third`), the first-person bob and
        dip (`first`), and the pull-in maths (`rayBox`, `cast`, `allowed`, `ease`).
    - Render: `world/player-view.js` (`WorldPlayer`). `WorldGame` exposes `you`, `anim`, `view` and `setCamera`.
  - **Rig changes** (`rig.js`, `characters.js`). P1's note 1 is fixed with real layers:
    - `Rig.layer` (also reached through `play` for any clip in a manifest layer) plays a clip once on its layer's bones
      only, over the base and any one-shot. There is one clip per layer; a new one replaces the old. It takes `from`/`to`
      (a stretch of the clip), `speed` and fades. `fadeOut` is in real seconds, so a sped-up clip is gone by its last frame.
    - Three's mixer averages by weight, so `Rig.layerWeight(w) = w/(1-w)` gives the layer share `w` of its bones over a
      base weighing 1. `Rig.pose` lists layers with `layer: key` and leaves them out of the base's sum.
    - One-shots take `from`, so `jump` starts 0.35 s in.
  - **The left-handed cast.** The manifest's new `mirrors: {shoot_l: 'shoot'}` builds `shoot_l` at load time (`Rig.mirror`:
    Left/Right swapped, rotations as (x, −y, −z, w), positions as (−x, y, z)). It plays on the same layer with the same
    events. Measured on this rig, a mirrored pose lands within 2.4 mm of the reflected original. If it is missing,
    `FALLBACKS` plays the right-handed `shoot`.
  - **The third-person shoot** (P1's note 2). I sampled the right hand through Mixamo's 2.3 s cast: the arm is straight out
    ahead at 1.45 s (now `events.shoot`). The game plays 1.2–1.95 s at 1.8×, so the snap comes 0.14 s after the shot.
    The first-person shot starts 0.05 s in at 1.4×, so its snap comes 60 ms after the flick.
  - **How first person is drawn.** The arms ride their own camera, a copy of the game camera at the manifest's 75° FOV, so a
    wide FOV setting doesn't shrink them. They are on layer `World3D.OVER` and drawn after the city by `world.renderOver`:
    depth cleared, no sky, no second shadow pass. The sun and hemisphere light that layer too, so the arms get the same
    light, shadow and grade.
    - The full body stays in the world with a `colorWrite: false` material, so on MED it still casts the player's shadow.
      On LOW it is hidden.
    - `you.wrist(hand)` converts the arms camera's wrist into the world point that the game camera shows on the same
      pixel. The overlay strand starts there, and splat sizes are measured from it.
  - **Third person.** The body stands at the player's feet, facing where he runs, or the aim for 0.6 s after a shot. It
    uses the villains' rim (`WorldVillains.patch`/`uniforms`, now exported, with `RIM.spiderman` toned down to .22 because
    .5 washed him out in shade) and reflects the fight's `World3D.environment`, the same texture the villains get. In roam
    and training he goes back to the studio environment (`WorldModels.studio()`).
    - The camera sits 3.5 m back, 0.6 m up and 0.55 m right of the neck (1.5 m), turning with yaw and pitch.
    - **The pull-in tests `City.query` boxes and the street directly, with five rays** (the boom's line, and 0.22 m to each
      side, above and below it). It does not use `world.raycast`, which costs about 3 ms a ray. The camera comes in at
      once and eases out at 3/s. At its minimum of 0.45 m the body is hidden (`HIDE` 0.7): backed flat against a wall you
      see from his neck. Letting the camera swing round instead is a possible refinement.
  - **Aim and lag compensation.** `camera()` now returns the camera actually used (`view.eye`), so `Look.record` and a
    click's ray both come from over the shoulder in third person. `Look` itself is unchanged in both modes.
  - **Settings.** CAMERA (First person / Third person) and CAMERA MOTION (Full / Reduced) are in the settings panel under a
    new CAMERA heading. **T** toggles CAMERA.
    - `world-game.js` binds them: it writes both into the same settings object `menu.js` saves, and through
      `PlayerCamera.save` into `ws.settings.v2`, so neither side undoes the other.
    - REDUCED removes the first-person bob (≤2.2 cm up, 1.2 cm to the side) and the landing dip (≤9 cm). P3's FOV kick,
      roll and speed lines should read the same `cameraMotion`.
  - **Measured** in headless Chrome on the **Intel UHD at 1920×1080** (1280×720 CSS at DPR 1.5), MED, over http. Each view
    was 3 × 1.5 s, looking at the fight's focus. The pre-session build (`dc09837`) came from a scratch copy.

    | view | before | first person | third person |
    |---|---|---|---|
    | spawn roof | 80/75/72 fps | 74/74/74 fps | 73/73/74 fps |
    | Goblin | 85/119/121 fps | 110/99/109 fps | 91/93/93 fps |
    | Rhino | 75/73/65 fps | 68/70/60 fps | 62/73/74 fps |
    | Venom | 93/93/68 fps | 76/85/74 fps | 85/82/84 fps |

    The player costs about 10 draw calls (82 → 92 at the spawn roof, fights 59–99) and about 100k triangles. The Rhino
    view is the tightest, at 60 once.
  - **Verified** in headless Chrome, since the app's browser pane stayed hidden. The driver is `cdp.cjs` in this session's
    scratchpad, as in S4.
    - Both models load, from **`file://`** too.
    - First person:
      - idle arms;
      - the thwip snap, alternating hands (the right hand measured moving from (0.24, −0.24) to (0.09, −0.12) m in camera
        space in 60 ms);
      - the strand leaving the visible wrist.
    - Third person:
      - idle;
      - both casts (`shoot` and the mirrored `shoot_l`);
      - running away from the camera;
      - on the street by a wall;
      - on the Rhino's parapet.
    - The state sequence from real keyboard input: walk → run (arms pump) → jump (clip from 0.35 s, then `fall`) → land →
      run → idle.
    - **All three fights won in both modes** through the real `WorldGame.fire`, with the hands alternating r/l.
    - The pull-in: backed against a wall, the camera stopped 6 cm outside it at 0.45 m with the body hidden. Turned away,
      it eased back out to 3.58 m.
    - LOW hides the first-person body. Switching CAMERA live works.
    - The console shows only the known WebSocket and r159 noise. Shots are in `docs/reference/p2_pov_shoot.png`,
      `p2_third_shoot.png` and `p2_third_street.png`.
  - **Not verified.**
    - The real shooter.
    - A real Chrome window with vsync; ask the user to press P in each fight in both modes.
    - Pointer lock.
    - The model viewer's V with the player's own arms also on the camera: two pairs of arms show, which is harmless in a
      debug tool.
  - **Known and deliberate.**
    - `WSAudio.thwip()` stays unplaced, because `audio.js` is shared with CLASSIC. In first person that is at the wrist
      anyway; in third person you hear it at the camera, 3.5 m back.
    - After a jump, the state stays `jump` until landing; the body plays `fall` under it anyway.
    - In third person the body faces where it runs, so strafing turns him sideways to the camera.
  - **Constants to tune by eye.**
    - `PlayerAnim.constants`: `IDLE_V`, `WALK_V`, `ARMS_RUN_V`, `ARMS_RATE`, `AIR_MIN`, `JUMP_VY`, `LAND_AIR`, `LAND_VY`,
      `LAND_T`, `JUMP_FROM`, `SHOOT`, `FP_SHOOT`, `AIM_HOLD`, `TURN`, `FACE_V`.
    - `PlayerCamera.constants`: `BACK`, `UP`, `SIDE`, `PIVOT`, `NEAR`, `PAD`, `PROBE`, `OUT`, `HIDE`, `BOB`, `BOB_SIDE`,
      `BOB_V`, `DIP`, `DIP_T`.
    - `RIM.spiderman` in `villain-view.js`.
  - **For P3.**
    - Pass `{swing: hand}` / `{zip: true}` / `{perched: true}` to `PlayerAnim.step`; it plays `hang`/`fp_swing_hold_*`,
      `fp_zip`, `perch`, and `fp_release_*` when a line is let go. `PlayerAnim.shoot` already uses the free hand while one
      holds a line.
    - The web line should start at `you.wrist(hand)`.
    - IK the arms on `you.arms` (bones through `rig.bone`), after `you.update`, which applies the pose.
    - `PlayerCamera.third` gives the boom; P3's lag behind the direction of travel goes there, and its comfort effects
      should read `cameraMotion`.
  - **For P4.** `you.sample()` gives the player's body capsules (third-person pose) for attack hit tests.
    `extra.hits`/`big`/`dead` already play `hit`/`hit_big`/`death` and `fp_hit`/`fp_death`.
- 2026-09-27 — **P2 follow-up from the user's first look: realistic webs, and the first-person thwip turned palm-up.**
  202 tests pass (198 + 4 new web tests in `player.test.cjs`). No CLASSIC file changed.
  - **What the user said.** In third person the webs seemed to come out of his body, and a single white line looked
    unrealistic. In first person the hand was "reversed" and should be upside down. For the web they sent a clip, a
    slow-motion Web Strike from Marvel's Spider-Man; an enhanced crop is in `docs/reference/video4-web.png`. It shows the
    web as a bundle of fine, translucent grey-white fibres: tight at the wrist, splaying into a wide fan towards the
    target, and taut.
  - **Webs are now 3D and in the world.**
    - `world/web-shot.js` (`WebShot`, UMD, tested) is the shape and timing: 15 fibres (one core, 3 faint wide "films"),
      fanning from 1.2 cm at the wrist to 6 cm per metre (6–50 cm) at the target, sagging 3.5% of the length in flight,
      flying at 280 m/s (0.05–0.15 s), holding 0.12 s and fading over 0.25 s as the tail reels into the splat. The
      ribbons face the eye and never get thinner than 1.3 px.
    - `world/web-lines.js` (`WorldWebLines`) draws up to 6 at once. Each is one mesh, depth-tested, so his arm and body
      hide the part behind them.
    - The 2D overlay strand (`drawStrands`, `STRAND_MS`) is gone. The overlay canvas still carries the off-screen arrow.
  - **Why it came out of his body, and the fix.** The overlay line was drawn over everything from the wrist's projection,
    at the moment of the click, when the casting hand was still at his chest. Now:
    - The web leaves at the snap (`WebShot.snap`: 60 ms in first person, 75 ms in third) from where the wrist is then.
      After that it is free of the hand (shot, not held), so it can't trail back into him as the arm recovers.
    - The third-person cast starts later and quicker (`SHOOT` from 1.3 s at 2×, snap at `SHOOT_SNAP` 1.45 s).
    - He turns to face a shot at `TURN_AIM` 40/s, so the casting arm points where the web goes.
  - **Impacts land with the web.** `world-game.js` keeps a small `due` queue (`later(at, fn)`, held while paused, cleared
    on `place`). The thwip plays at the snap. The splat, puff, villain particles, flash, hit-stop, shake and impact sound
    all play when the web arrives. A web to a villain follows the point on his model (`onVillain`) while it flies. The
    **rules take the shot at once**, as before: damage, cooldown and lag compensation are unchanged.
  - **The thwip is palm-up** (`spiderman.py` `THWIP`/`RECOIL`). The hand is rolled half a turn about the forearm from the
    old palm-down cast: the forearm turns over, the wrist snaps back, the fingers point down, and the palm and the web
    shooter under the wrist face the target. Only `spiderman_arms` was rebuilt (`build-models.cjs --blender --sheets
    --only spiderman`); the body's rebuild was thrown away, as P1 advised. `docs/reference/clips/spiderman_arms.png` and
    `p2_pov_shoot.png` show it.
    - **Ask the user whether this is the pose they meant.** "Upside down" could also mean palm-down with the fingers
      pointing forward. It is two vectors in `THWIP` (`f`, `n`) and a rebuild.
  - **Verified** headless: both hands in first person (palm-up snap, the fibres leaving the wrist); third person with each
    hand in flight and reeling in; a hit on Venom; all three fights won in both modes with no console errors.
    `p2_third_shoot.png` is the third-person web.
  - **Constants to tune by eye.** `WebShot.constants` (`STRANDS`, `HAZE`, `SPEED`, `TRAVEL`, `HOLD`, `FADE`, `SPREAD0`,
    `SPREAD_PER_M`, `SPREAD1`, `FAN`, `WIDTH`, `CORE`, `MIN_PX`, `HAZE_W`/`HAZE_ALPHA`, `SAG`, `WAVE`, `COLOR`, `ALPHA`,
    `GLINT`); `PlayerAnim.constants.SHOOT`, `TURN_AIM`; `THWIP` in `spiderman.py`.
  - **For P3.** A swing line is held, not shot: give it its own look rather than `WebShot`'s release and reel-in. Its fibre
    fan (`WebShot.point`) is reusable for the line.
- 2026-09-28 — **Session P3 done: web-swinging, zips and perches, in both camera modes and in the fights.** 222 tests pass
  (202 old + 20 new in `game/tests/swing.test.cjs`). No CLASSIC file or test changed; neither did `menu.js` or `audio.js`.
  **Nothing is pushed.**
  - **What exists.**
    - Logic (UMD, tested): `world/swing.js` (`Swing`).
      - `decide(aim, state)` → `shot` / `attach` / `zip` / `release` / `none`. `aim` is `{ target, hit, player, city, villains }`:
        `target` says whether a villain, a thug or the training target is near the aim; `hit` is `world.raycast`'s.
      - `classify` sorts the hit into a wall, a zip (with its perch) or nothing, with a reason: `far`, `below`, `villain`,
        `not a building`, `street`, `low`, `slope` or `no room`.
      - `attach`, `release`, `zip` and `step` run the physics. `step` returns `{ active, events }`, with events `taut`,
        `land`, `perch` and `drop`. `anim(state)` gives `PlayerAnim.step`'s extra; `airborne`, `inCone`, `cast`, `grip` and
        `speed` are helpers.
      - The state's `mode` is `none` (Player walks you, as before), `swing`, `fly` (let go), `zip` or `perch`.
    - `player-camera.js`: `swingFx` (the FOV kick, roll and speed lines, capped and eased), a trail on `third(..., {moving})`,
      and a crouch on `first(..., crouch)`. `player-anim.js` counts time on a line or a zip as time in the air, so landing
      after a swing plays `land`, and diving off a perch is a `jump`. `web-shot.js` has `WebShot.line`/`letGo`, a held line.
      `Look.ray` honours `cam.roll`. `player.js` now also exports `resolveWalls`, `ceiling` and `clampToWalk`.
    - Render: `world/swing-audio.js` (`SwingAudio`), plus changes to `player-view.js` (two-bone IK and the hang tilt),
      `web-lines.js` (held lines follow the hand) and `world-game.js`. `WorldGame` also exposes `swing`, `held` and `fxv`.
  - **How a flick or a click is judged** (`world-game.js` `fire`): the camera and aim are rewound as before, then `aimed()` asks
    whether he is within `SHOT_CONE` (4°) of the ray, using the body as it was when you aimed. If so, it is a shot, judged by
    the old rules (1.5° cone, cooldown, dodge, lag compensation). Otherwise `Swing.decide` picks a line, a zip or a release.
    The fight's cooldown gates only shots, so swinging is never blocked by it.
  - **The physics.**
    - A rope, not a rod, holding the hands (`GRIP` 2.1 m above the feet) to the anchor. It is slack when you are nearer than
      its length. When taut it projects you onto its sphere and removes the outward speed. It is integrated at 120 Hz with
      Player's gravity.
    - On attach it reels in (`REEL` 18 m/s) until the bottom of the arc is `LOW` (30%) of the anchor's height above the street.
      While your feet are within `CLEAR` of what's under you it reels in faster. Without this every arc bottomed out on the
      street.
    - The plan's "gentle shortening past the bottom" is `SHORTEN`: 22% of the length per second within `BOTTOM` of straight down,
      keeping angular momentum, and at most `PUMP_MAX` of the length. The tests check that a pendulum climbs past its start
      with it and not without it.
    - Speed is capped at 36 m/s. Letting go keeps your velocity; near the top of the forward arc you get up to `BOOST` ahead and
      `BOOST_UP`. Flight has no air brakes (Player's air control would stop you), and landing hands you back to Player.
    - A line from standing or a perch yanks you toward it, up to `YANK` (never more, however often you do it).
    - Walls push you out and take the velocity going into them, so you slide along. A wall holding you out pays the line out.
      A floor lands you. No fall damage.
  - **Decisions to know about.**
    1. **You swing where you look (`LOOK_TURN` .9 rad/s on a line, `LOOK_FLY` .5 in the air).** The level velocity turns toward the
       view's heading. The plan only had `Move.vector()` steering, which is still there (`STEER`/`FLY_STEER`), but the wrist
       alone has no stick. Without this the side-wall pendulums flung the player into the cross streets.
    2. **`SHOT_CONE` 4° for the decision, wider than the 1.5° hit cone.** Aim near him and it's a shot that can miss (so he
       still dodges, and training still counts misses), not a line to the wall behind him. A flick further off than that,
       at nothing, lets go of your line, as decision 4 says. That can drop you if you aim loosely at a villain: see P6.
    3. **Hand over hand.** On a line, the next line goes to the free hand. From standing, it goes to the hand on the anchor's
       side. Shots while on a line use the free hand (P2's rule), and the line stays attached.
    4. **The physics attaches at the flick.** The line itself leaves at the snap (60/75 ms) and flies out, so the pull is
       instant and the picture follows a moment later.
    5. **Zips.** A wall hit within `EDGE_DROP` (2.5 m) of its top is its roof edge. A top within `EDGE_SNAP` (3 m) of an edge
       snaps to that edge. The perch is centred on the parapet if one is there, otherwise just in from the edge. The zip is
       an eased quadratic Bézier (0.35–1.1 s) that comes over the edge from outside; there is no collision during it, and
       `resolveWalls` has the last word at the end. Perched, the **body** faces out (third person), and the first-person eye
       drops 0.55 m to the crouch. **The first-person camera is never turned for you**, so after a zip you look where you
       aimed. Ask the user whether they want the view turned to face out as well.
    6. **Space** lets go of a line, and dives off a perch (7 m/s forward and a jump). Walking steps off a perch.
    7. **The comfort effects.** FULL gives a kick of up to 10° (from 12 to 34 m/s), a roll of up to 4° into the arc (first
       person only), and speed lines (first person only). REDUCED halves the kick and has no roll and no lines. The roll is
       recorded with each camera, so rewound shots aim through the rolled view correctly. Third person trails your velocity
       by up to 2.2 m and rises 0.8 m at speed.
    8. **The IK** (`player-view.js`) is two-bone, on the arm's local rotations after the clip, blended in and out at `IK_EASE`.
       In first person the hand aims at the anchor as the arms' camera would show it, but never within `FP_OFF` (0.72 rad) of
       the view's centre and never far across to the other side. Aimed straight at the anchor, the arm filled the screen and
       hid its own line. In third person the body turns about the hands (`HANG` 2.15 m) so its up runs along the line, legs
       trailing (`TRAIL`), never more than `TILT_MAX` (60°) from upright.
    9. **Sound.** The thwip (`WSAudio.thwip`) plays at the snap, and `WSAudio.thud` plays on landings over 6 m/s and on
       perches. Wind by speed and the line's creak by load are `SwingAudio`, on **its own AudioContext**, because `audio.js` is
       shared with the frozen CLASSIC. It follows Settings' EFFECTS volume and mute, and stops on pause and quit.
  - **Measured** in headless Chrome on the **Intel UHD at 1920×1080, MED**, over http. Swinging down the avenue: 77–78 fps in both
    views (76–81 standing), 93–98 draw calls (76–82 standing; each line's splat and the held line add a few). In the Rhino
    fight with a line out: 88–92 fps, 57–60 calls. The only per-flick cost is the one `world.raycast` that was already there.
  - **Verified** in headless Chrome (the app's pane was hidden again), with drivers in this session's scratchpad (`cdp.cjs`,
    `chain.js`, `flick.js`, `zip.js`, `fight.js`):
    - **30 s chains down the avenue at x −488 from 40 m up, never inside a building, in both views.** By clicks through the
      real `WorldGame.fire`: about 1,000 m (first person) and 870 m (third). By **scripted flicks** (100 Hz still-wrist
      packets, flagged flick packets, then `Controller.shot` → `WorldGame.fire`, as `menu.js` does): 969 m and 616 m.
    - A zip from the street to a roof edge by flick: perched on the parapet at 28.8 m, facing out over the avenue, not
      pushed by any wall, state `perch`.
    - **Shooting the Rhino mid-swing** by flick, in both views: 20 damage from the free hand, the line still held.
    - From `file://`. The console shows only the r159 deprecation warning.
    - Shots are in `docs/reference/p3_pov_swing.png`, `p3_third_swing.png` and `p3_perch.png`.
  - **Not verified.**
    - The real wrist shooter. **Ask the user to try swinging with it in both camera modes.**
    - A real Chrome window with vsync (press P while swinging).
    - The wind and creak by ear. Their levels in `SwingAudio.constants` are guesses.
    - Pointer lock.
  - **Known and deliberate.**
    - The ±75° pitch limit means you can't aim straight down at a villain you're swinging right over.
    - Hanging still on a short line against a wall is possible; let go with Space or a flick at the sky.
    - Swinging through a fight's light column at street level in free roam starts that fight, as walking into it does.
  - **Constants to tune** (P6).
    - `Swing.constants`: `RANGE`, `BELOW`, `EDGE_DROP`, `EDGE_SNAP`, `SHOT_CONE`, `GRIP`, `LOW`, `REEL`, `CLEAR`, `CLEAR_RATE`,
      `SHORTEN`, `BOTTOM`, `PUMP_MAX`, `MAX_SPEED`, `STEER`, `FLY_STEER`, `LOOK_TURN`, `LOOK_FLY`, `BOOST`, `BOOST_UP`,
      `TOP_ARC`, `YANK`, `YANK_UP`, `ZIP_SPEED`, `ZIP_T`, `ZIP_LIFT`, `DIVE`.
    - `PlayerCamera.constants`: `KICK`, `KICK_V`/`KICK_V1`, `ROLL`, `ROLL_V`, `LINES_V`, `FX_EASE`, `LAG`, `LAG_MAX`, `LAG_UP`,
      `LAG_EASE`, `CROUCH`.
    - `player-view.js`: `TILT_MAX`, `TRAIL`, `HANG`, `IK_EASE`, `REACH`, `FP_OFF`, `FP_CROSS`.
    - `WebShot.constants`: `LINE_SPREAD`, `LINE_SAG`, `LINE_SNAP`, `LINE_RING`, `LINE_FADE`.
    - `SwingAudio.constants`.
  - **For P4.**
    - To knock the player off a line, call `Swing.release(swing, player)` (the boost only applies near the top of the arc) and
      `letGo(now)` in `world-game.js`.
    - `swing.mode` tells you whether he is grounded (`none` with `player.grounded`), `perch`, `swing`, `fly` or `zip`.
    - A bomb shot down goes before villains: add it to `aimed()`, or add a `bomb` flag that `Swing.decide` checks first.
    - The PAUSED card still says "The clock stops", and DEFEAT says "Out of time". Both are P4's to rewrite.
    - `you.sample()` gives his capsules in the hang pose while he's on a line (the drawn body, turned about the hands).
  - **For P5.** The Rhino's ram needs "perched on that building": `swing.perch` has `{x, y, z, yaw}`, and `City.query` at that
    point finds the box under it.
- 2026-09-28 — **Session P4 done: player health, no clock, one HARD level, and the Goblin fights back.** 242 tests pass (222 old,
  some 3D ones rewritten for the new rules, plus 4 new in `fight`/`hud`/`villain-anim` and 16 in the new
  `game/tests/attacks.test.cjs`). No CLASSIC file or test changed (`levels.js`, `combat.js`, `villains.js`, `game.js`,
  `training.js`, `menu-aim.js`, `menu.js`, `audio.js`, `menu.css`, `game.test.cjs`); CLASSIC still starts with its 30 seconds.
  The `game.css` edits are all in its 3D HUD section. **Nothing is pushed.**
  - **What exists.**
    - Logic (UMD, tested):
      - `world/difficulty.js` (`Difficulty.HARD`, `get`, `span`). Every number that sets how hard it is lives here: villain HP 300,
        your shot 20, player HP 100, cadence 3–5 s, damage 15–30, `big` 25, `knockOff` 22, telegraph 0.9 s, recover 0.8 s,
        invulnerable 0.6 s, first attack 1.5 s after the entrance.
      - `world/attacks.js` (`Attacks`), the framework and the Goblin's two moves.
        - The framework is `create`/`step`/`cancel`: wait → telegraph → active → recover, with the fairness rules.
        - The geometry is `segSeg`, `gap`, `hitCity` (City boxes and the street), and `standIn`, a stand-in body.
        - Bombs: `throwBomb`, `bombAt`, `stepBomb`, `blastDamage`, `push` and `aimBomb`.
        - Guns: `track`, `burst`, `stepRound`, `onLine` and `gunDamage`.
      - **The 3D rules layer is in `fight.js`.** It calls `Combat.start`/`judge` and never `Combat.clock`.
        - `Fight.start(enc, levels, diff)` sets HARD's health for all three, `s.you` (your health) and `s.timeLimit = null`.
          `elapsed` now only counts the fight proper.
        - `Fight.tick(s, dt, ctx)`: ctx is `{you, body, state, onScreen, city}`. It runs the hunt, the attacks and what's in flight.
        - The rest of the API: `Fight.hurt(s, dmg, {kind, from, push})` (with invulnerability; 0 → `lost`), `aimBomb`,
          `shootBomb`, `bombAhead` and `drain`. `drain` returns the events: `telegraph`, `throw`, `round`, `blast` and `hurt`.
        - `snapshot` now keeps the bombs, so a flick at one is lag-compensated too.
      - Also:
        - `Hud.status` puts you on the left and the villain on the right (`right.foe`), with no clock. `Hud.threat` is new.
        - `PlayerCamera`: `hurtShake`, `vignette` and `slump`.
        - `Swing.decide` checks `aim.bomb` first.
        - `VillainAnim.create(kind, clips, events)` plays `attack` on a bomb's wind-up, at the speed that puts its release frame
          (0.7 s, from the manifest) at the wind-up's end.
        - `SoundCues` no longer snorts on the Goblin's `attack`.
    - Render:
      - `world/attack-view.js` (`WorldAttacks`) draws the bombs, lasers and tracers:
        - bombs: a pool of 4 `bomb.glb` clones, tumbling, the fuse light blinking faster, with an orange glow;
        - lasers: a tapered red beam from each glider gun, stopping 1.2 m short of you, with a red dot;
        - tracers: streaks.
      - `world/attack-audio.js` (`AttackAudio`) makes the sounds, on its own AudioContext as `SwingAudio` does:
        - the guns' charge and the bomb's fizz as they wind up;
        - fuse beeps from the bomb;
        - the blast, the rounds, your hits and going down.
      - `fx.js` gains `blast` (fire, sparks, smoke, a flash capped by distance) and `muzzle`. `hitfx.js` gains `fire`/`smoke`
        and `HitFx.blast`.
      - Changes to `hud-view.js`, `index.html` (`#wh-foe`, `#world-hurt`, the new scripts), `game.css`, `villain-view.js` and
        `world-game.js`. `WorldGame.attacks` is new.
    - **Manifest.** The Goblin has a new `attacks` block: the bomb from `ValveBiped.Bip01_R_Hand`, and the guns from the glider's
      `Glider_Gun_L/R`. `villain-view.js` samples these into `fight.body.points` (`hand`, `guns`) each frame. `manifest.js`
      was regenerated (`embed-models.cjs bomb`; `bomb.js` came out byte-identical).
  - **Decisions to know about.**
    1. **The Rhino and Venom have HARD's health but no attacks yet** (`Attacks.MOVES.charge/leap` are empty; P5 fills them).
       Their fights can't be lost until then. Their intro cards say there is no clock but **don't** say they fight back, because
       they don't yet. P5 should add that line. The Goblin's card describes his attacks.
    2. **Cadence runs from the start of one attack to the start of the next.** After his entrance he waits 1.5 s.
       - While he is more than `ATTACK_RANGE` (40 m) from you, he doesn't start one: you swung away and he's closing in.
       - "Never two in a row from off-screen": if the last one started with him out of view, the next **waits until he is in
         view**. Look away forever and he never attacks again; the red chevron shows where he is.
    3. **The body attacks hit** is `you.sample()`, the player model's capsules as drawn (hanging from a line, crouched on a
       perch), in both views. `Attacks.standIn` is used until the model loads.
    4. **Bombs.**
       - Flight is 1.05–1.7 s by distance, aimed at your chest where you'll be (lead 0.8 of the flight, at most 9 m).
       - One goes off on your body, on the city or street, or at its 2.6 s fuse.
       - The blast does 30 within 1.2 m, falling to 15 at 5 m, and nothing beyond. A direct hit does 30.
       - The blast throws you (up to 8 m/s) unless you're perched or zipping.
       - A web at a bomb (its own 3° cone, judged on the snapshot) sets it to go off when the web arrives. It still blasts where it
         is, so shooting one down right next to you would hurt. It's a web shot (the cooldown applies), but not a shot at him: he
         doesn't dodge it and it isn't counted.
    5. **Guns.**
       - The laser follows your chest (eased at 2.5/s, so moving fast makes it trail) through the 0.9 s wind-up, then locks.
       - 6 rounds, 65 ms apart, at 120 m/s. A round hits if it passes within 0.22 m of your body.
       - A burst does 20, once: invulnerability swallows the other rounds.
       - Only heavy hits (≥ `knockOff`, e.g. a bomb's) knock you off a swing line, so a burst doesn't.
    6. **The Goblin hunts you.** His circuit's centre (`s.hunt`) follows you at up to 22 m/s, and its height follows yours at up to
       20 m/s. He keeps 1.5 m over any roof under him (or where he'll be in 0.5 s), rising at up to 16 m/s. The shadow box follows
       his circuit. His reflections stay the first roof's (`lightFight` runs once). He faces you while winding up and throwing.
    7. **Hit feedback.** The plan put the red vignette under POV only; it shows in third person too, because the model's flinch is
       small from 3.5 m. The shake is 0.0009 rad per point of damage, at most 0.022 rad, and halved by REDUCED. A blast that misses
       you still shakes and flashes when it's close.
    8. **Going down.**
       - Your input stops: no look, no moving, no shots or lines. A line you're on is let go.
       - The view sinks 1.15 m, tips 0.45 rad down and leans 0.12 over 1.2 s. In third person it only tips a little.
       - The death clips play. DEFEAT comes after 2.6 s. RETRY re-enters the fight with both bars full.
    9. **HUD.**
       - `SEGMENTS_MAX` is now 15, so his bar has a segment per hit. Yours has 10 segments of 10 HP.
       - Your bar flashes for 0.45 s after a hit and is red at 30% or less.
       - The clock is gone from fights; `#world-timer` still shows training's streak.
       - The PAUSED card says "The fight holds until you resume". DEFEAT says "You went down. X is still out there."
    10. **Particles now fade out within 0.5–2.5 m of the camera** (`fx.js` points shader). A blast on you filled the view with smoke.
        This applies to every particle kind.
  - **Measured** in headless Chrome on the **Intel UHD at 1920×1080, MED**, over http. The Goblin fight, looking at him, with his
    attacks going (made invulnerable so it never ended), 3 × 3 s: **first person 82/88/93 fps, third person 91/95/98**, 71–96
    draw calls (bombs and tracers add a few). P2 measured 91–121 there before attacks; this is within its noise band. It holds 60.
  - **Verified** in headless Chrome (the app's pane was hidden again). The driver is `cdp.cjs` plus `p4.js`/`snap.js`/`death.js`/
    `play.js`/`perf.js` in this session's scratchpad.
    - Every attack's pieces were seen in both views:
      - the bomb wind-up (the `attack` clip at full weight), the throw, the bomb in flight with its glow, and a blast on you;
      - the laser wind-up and the tracers;
      - the red chevron when he winds up behind you.
    - Being hit: the HUD flash, the vignette, and the `fp_hit`/`hit_big` flinches.
    - Going down: the slump, the DEFEAT card, and RETRY back to 300/100.
    - **Shooting a bomb down with the real `WorldGame.fire`**: it went off 'shot', did no damage and didn't count as a shot.
    - **Knocked off a swing line** by a heavy hit, in the Rhino's street: swing → fly, the line let go.
    - **The Goblin fight won** through `WorldGame.fire`, in both views:
      - with perfect aim in 6 s;
      - at a human pace (a shot every 1.2 s, 30% of them missed) in 34 s, with no damage taken: every bomb was shot down and
        every burst was sidestepped with the real A/D keys.
    - **Lost**, standing still.
    - The Rhino and Venom fights won at 300 HP with `timeLimit` null.
    - The Goblin followed the player to a roof 150 m away, arriving in about 8 s. He held his attacks until he was within 40 m.
    - From **`file://`**: the fight, the bomb model drawn, and the HUD.
    - The console showed only the r159 deprecation warning.
    - Shots: `docs/reference/p4_pov_bomb.png`, `p4_pov_laser.png`, `p4_pov_threat.png`, `p4_pov_down.png` and `p4_third_blast.png`.
  - **Not verified.**
    - The real wrist shooter. **Ask the user to play the Goblin with it, in both camera modes.** In particular: can a flick hit a
      bomb in flight (3° cone, 20 cm bomb with a 1.3 m glow)? Can a wind-up be read and dodged?
    - A real Chrome window with vsync (press P in the Goblin fight).
    - The new sounds by ear. `AttackAudio.constants` are guesses, and the whine, fuse, boom and hurt levels need headphones.
    - Pointer lock.
  - **Known and deliberate.**
    - The blast's flash sprite doesn't depth-test (as the hit flash didn't), so a blast behind a wall glows through it.
    - Bombs and rounds in flight vanish when he's beaten or you go down.
    - The minimap doesn't show bombs.
    - Rounds that hit the city just stop, with no spark.
  - **Constants to tune** (P6):
    - `Difficulty.HARD`;
    - `Attacks.constants`: `BOMB_T`, `BOMB_T_PER_M`, `LEAD`, `LEAD_MAX`, `FUSE`, `TOUCH`, `BLAST_R`, `BLAST_INNER`, `PUSH`,
      `BOMB_CONE`, `GUN_TRACK`, `GUN_ROUNDS`, `GUN_EVERY`, `GUN_SPEED`, `GUN_R`, `GUN_SHARE`, `PREFER`;
    - `Fight.constants`: `HUNT_SPEED`, `HUNT_EASE`, `HUNT_CLIMB`, `CLEAR`, `LOOK_AHEAD`, `LIFT_RATE`, `ATTACK_RANGE`, `CHEST`;
    - `PlayerCamera.constants`: `SHAKE_PER`, `SHAKE_MAX`, `VIGNETTE_T`, `LOW_HP`, `LOW_TINT`, `SLUMP_*`;
    - `Hud.constants`: `YOU_SEGMENT`, `HURT`, `LOW_HP`;
    - `attack-view.js`: `GLOW`, `LASER`, `TRACER`;
    - `fx.js`: `POINT_COLOR`, `MUZZLE`; `HitFx` `fire`/`smoke`/`BLAST`;
    - `END_MS.lost` in `world-game.js`.
  - **For P5.**
    - **A new move** needs three things:
      1. its name in `Attacks.MOVES[kind]`, and a weight in `PREFER` if it depends on your state;
      2. a branch in `strike()` in `fight.js` (what leaves him, and when);
      3. a hit test that calls `hurt(s, dmg, {kind, from, push})`, from `flying()` or its own step.
      The framework already gives the telegraph, cadence, off-screen rule, entrance hold and range hold. The render side reads
      `fight.attack` (`phase`, `move`, `t`, `aim`) and the fight's events.
    - `Attacks.cancel(a)` is the interrupt: it goes straight to recover. That is the stagger for Rhino/Venom. Hits during a
      wind-up are `Attacks.winding(a)` plus `s.hits` changing.
    - `ctx.state` is `ground` / `perch` / `swing` / `fly` / `zip`. `s.foe` is your last position. `hurt`'s `push` throws you and
      `knock` (≥ 22) lets go of your line. For Venom's lash, pass a damage of at least `knockOff`, or add a `knock: true` option to `hurt`.
    - Add "he fights back" to the Rhino's and Venom's intro cards, and their attack clips to `VillainAnim` (the Goblin's `attack`
      handling is the pattern), and their cues to `fightEvents` in `world-game.js`.
- 2026-09-28 — **Session P5 done: the Rhino and Venom fight back, and all three fights can be won and lost.** 263 tests pass (242 old,
  one P4 assertion rewritten because the Rhino and Venom now have moves, plus 21 in the new `game/tests/fightback.test.cjs`). No CLASSIC
  file or test changed (`levels.js`, `combat.js`, `villains.js`, `game.js`, `training.js`, `menu-aim.js`, `menu.js`, `audio.js`,
  `menu.css`, `game.test.cjs`); the `game.css` edit is one rule in its 3D HUD section. **Nothing is pushed.**
  - **What exists.**
    - `attacks.js`: the framework now takes `allow` (the moves open to him now; none means he waits, like the off-screen rule),
      `finish(a, rest)` for strikes that last as long as they last (charge, ram, pounce, combo; `activeFor` is null for those), `busy`,
      `a.clock` (seconds since the wind-up began) and Difficulty's `breather` after each recovery. `PREFER` is now per kind. New sums:
      the Rhino's `under` (the building someone stands on: its base box), `anchored`, `wallPoint`, `blocked`, `clearRun`, `rhinoBody`,
      `touches`, `quakeDamage`; Venom's `room`, `landing`, `arcClear`, `sidesteps`, `claw`/`swipeHits`, `stepLash`, `lashReach`; and
      `damage(share)`.
    - `difficulty.js`: `breather` .8, `stagger` 2, `dazed` 2.5, `dazedDamage` 2.
    - `fight.js`: the Rhino's free movement off his patrol (`m.free`; states `brace` → `charge` → `overrun` → `rest` → `return`, or
      `stun` after a crash) and `rejoin`; Venom's `pounce`, `land` onto a `spot` by you, `slam`, and holding still while busy; the
      attack driver (`allowed`, `windUp`, `stagger`, `strike`, `combo`, `swipe`, the lash's step); double damage in `fire`;
      `Fight.dazed`/`committed`; `hurt` takes `knock`. New events: `charge`, `quake`, `crash`, `pounce`, `slam`, `swipe`, `lash`,
      `stagger`. `ctx.anchor` (the swing line's anchor) is new.
    - `villain-anim.js`: the Rhino's new states; `plan()` schedules Venom's attack clips from `a.clock`; `land_heavy` after a pounce;
      `hit_big` on a stagger. `sound-cues.js`: `QUIET` (clips whose sound comes from the fight's events instead), `stun`, `land_heavy`.
    - `hud.js`: during a wind-up the objective line is a red warning of what's coming (`WARN`; a ram's and a pounce's stay until they
      land), and "is dazed · hits do double" while he is. `right.warn` → `.hud-objtext.is-warn`.
    - Render: `attack-view.js` draws the red ring (`a.zone`, clipped to the roof's footprint by a small shader) and the tentacle;
      `fx.js`/`hitfx.js` add dust (`dust`/`grit` kinds, `HitFx.dust`, `fx.dust`); `attack-audio.js` adds build-ups for the charge and
      for Venom's moves, `quake`, `crash`, `swipe`, `lash`; `world-game.js` turns the new events into sound, dust and shakes.
    - **Manifest.** Venom's strike frames are `events` (attack .33, attack2 .2, attack3 .27, tentacles .23 s), measured where the hand
      is fastest and furthest out (a scratch script sampling the GLB's bones). `land_heavy` joined `airborne.clips` (its feet start
      up). `manifest.js` was regenerated with `embed-models.cjs bomb` (`bomb.js` came out byte-identical).
  - **How each villain picks** (`allowed()` in fight.js, only worked out when an attack is due):
    - **Rhino.** You within `HIGH` (2.5 m) of his street, standing or in the air: **charge** (within 45 m, level). Higher: **ram** the
      building under you (standing or perched), or the one your line is anchored to (swinging), if its wall is within 45 m and the
      run to it is clear. In the air above a roof, or zipping: nothing, he waits. His attack range is 60 m (`RANGES.charge`).
    - **Venom** (not mid-leap, crouch or dash), by chest-to-chest distance: up to 3.2 m and standing: **combo**; 3.25–12.5 m with a
      clear line: **lash** (in the air it's the only one); 4–27 m, standing, with somewhere to land by you within 12 m of his beams
      and a clear arc: **pounce**. Otherwise he keeps leaping between his beams.
  - **The moves.**
    - Rhino **charge**: a 0.9 s wind-up braking to a stop facing you (his `attack` clip sped up to fit, a snort, a rising growl), then
      straight at where you are at the strike, up to 12 m/s, on past you until he skids to a stop. Run over: 30 (heavy, knocks you
      off a line), thrown 11 m/s ahead of him and 5 up. Once per charge.
    - Rhino **ram**: the same wind-up facing the wall, a red ring on your roof (the quake's reach, clipped to the building), then he
      runs at the wall and stops against it. The quake does 30 within 6 m of where he hit, down to 15 at 16 m, to someone standing or
      perched on that building or hanging from a line anchored to it (which also knocks them off it). Dust, a boom, and a shake felt
      within 45 m, hurt or not.
    - **Dazed**: after a ram, or running into any wall (a skid past you into a building counts), `stun` for 2.5 s and your hits do
      double. He doesn't dodge while off his patrol. Then he trots back to the nearest point of his stretch and patrols on.
    - Venom **pounce**: the wind-up is `roar`, then `leap_start` so its take-off ends it; a ring where he'll land. He comes down
      2.5 m from you (on his side first) with `land_heavy` and dust: 28, and knocked off a line, if you're still within 2.4 m of his
      chest. Down there he faces you for 3 s (`SPOT_STAY`), sidesteps if shot where there's room, then leaps back to his nearest beam.
    - Venom **combo**: three swipes 0.65 s apart (`attack` slowed so its strike frame ends the wind-up, then `attack2` and `attack3`
      timed so theirs land on their swipes); each does 20 if you're within reach of his claw (1.4 m ahead of his chest, 1 m round
      it). It stops if you get more than 4.2 m away. Invulnerability (0.6 s) is shorter than the gap, so all three can land: 60.
    - Venom **lash**: the tentacle's aim follows your chest through the wind-up (eased at 3.5/s), then shoots out at 70 m/s up to
      13 m (or the city) and back: 24, knocked off a line, and pulled 7 m/s towards him. Moving out of its line as it comes dodges it.
    - **Stagger**: 2 of your hits in one wind-up (either villain) cancel it: `hit_big`, then his recovery.
  - **Decisions to know about.**
    1. **The ram's ring is on your roof, behind you**, when you face him from the parapet. So every wind-up, for all three villains,
       also puts a red warning in the objective line ("He's ramming your building · get off it").
    2. **Venom lands 2.5 m from you, not right beside you.** At 1.6 m his model filled the view and the Intel UHD fell to 55–56 fps; at
       2.5 m it holds about 60. His claws reach 1.4 m to match, and the lash only starts past claw range, so close in it's claws.
    3. **His lash never left his beams at first**: his chest is inside the column of the node he perches on, so every line from it
       met the city. `lashReach` ignores its first 0.6 m (the pounce's arc check already did). A test covers it.
    4. Committed (winding up or striking, or the Rhino off his patrol), neither dodges your shots. That is what lets you stagger them.
    5. The Rhino doesn't hunt you as the Goblin does; out of reach he patrols, and Venom keeps to his beams (the plan's "keeps his
       perches ... when he's out of reach"). Venom's `crawl_*` clips are wall poses (C2), so they aren't used on beam tops.
  - **Measured** in headless Chrome on the **Intel UHD at 1920×1080, MED**, over http, alternating this build with the pre-session
    one (`908aad6`, served from a scratch copy), 3 × 3 s each, looking at the villain, attacks going (made invulnerable). For the
    first runs the laptop was **on battery at 5%**, and Chrome capped every view at exactly 30 fps; these numbers are from after it
    was plugged in. First person: **Goblin** 85–90 (before 81–89); **Rhino** 70–76 (before 71–75), 58–66 draw calls; **Venom** 75–79
    on his beams (before 85–88), **58–63 while he's down 2.5 m from you** (third person 61–63), 96–102 calls. Venom close up is the
    one view near 60. The new fight logic costs 0.002–0.008 ms a frame (median; under 1 ms at worst), measured in node.
  - **Verified** in headless Chrome (the app's pane was hidden again), with `cdp.cjs`, `p4.js` and `perf.js` from P4 and `p5.js`/
    `boot.sh` in this session's scratchpad:
    - the Rhino's ram (wind-up, run, quake, stun, back to patrol) and its ring on the roof; the charge on the street (the wind-up
      facing you, the red warning, the run, skidding past);
    - Venom's pounce (roar, leap, coming down in dust by you), the combo (the wind-up with "Claws · back off", the swipes landing),
      and the lash at you on a swing line, in both views;
    - **both fights won through the real `WorldGame.fire`** (a click every 0.4 s at him): the Rhino in 10 s (15 of 15 hits, both his
      rams staggered), Venom in 17 s (15 hits of 33, three wind-ups staggered, ending on CITY SAVED); and **both lost standing
      still**: the Rhino in 22 s (four quakes), Venom in 22 s (pounces and a lash), each ending on DEFEAT;
    - from **`file://`**: both fights, the models, the attacks and their rings. The console showed only the r159 deprecation warning.
    - Shots: `docs/reference/p5_rhino_ring_third.png`, `p5_rhino_charge_windup.png`, `p5_venom_pounce_air.png`, `p5_venom_slam.png`,
      `p5_venom_combo_windup.png`, `p5_venom_combo_swipe.png` (these two from before he landed 2.5 m off) and `p5_venom_lash_third.png`.
  - **Not verified.**
    - The real wrist shooter. **Ask the user to play all three fights with it, in both camera modes.** Can a wrist land two hits in a
      0.9 s wind-up? Can a ram be escaped by zipping off the roof in time? Can a pounce be read and avoided?
    - A real Chrome window with vsync (press P in each fight), on mains power.
    - The new sounds by ear.
    - Pointer lock.
  - **Known, and worth a look.**
    - Once, the headless page stopped responding while a script waited for a lash and asked for a screenshot from inside the page.
      It never happened again (several minutes more of the same fight in the page, and 120 s of it in node, found nothing), so it
      may have been the capture rather than the game. If the Venom fight ever freezes for the user, start there.
    - With perfect aim at full rate every wind-up is staggered and you're never hurt. At a human pace (P4's ran a shot every 1.2 s)
      it's much rarer. `stagger` is the lever.
    - From his vantage the Rhino only rams; he charges only once you're down on the street.
  - **Constants to tune** (P6):
    - `Difficulty.HARD`: `breather`, `stagger`, `dazed`, `dazedDamage`.
    - `Attacks.constants`: the Rhino's `HIGH`, `CHARGE_RANGE`, `RAM_RANGE`, `CHARGE_V`, `CHARGE_ACCEL`, `BRAKE`, `CHARGE_MAX`,
      `RHINO_R`, `RAM_R`/`RAM_LOW`/`RAM_TOP`/`RAM_FRONT`, `CHARGE_SHARE`, `KNOCK_V`/`KNOCK_UP`, `QUAKE_R`, `QUAKE_INNER`; Venom's
      `MELEE`, `COMBO_N`/`COMBO_GAP`/`COMBO_END`, `SWIPE_REACH`/`SWIPE_R`/`SWIPE_SHARE`, `LASH_*`, `POUNCE_*`, `HOME`; `PREFER.leap`.
    - `Fight.constants`: `RANGES`, `SPOT_STAY`, `RETURN_EASE`.
    - `VillainAnim.constants.MIN_WIND`; attack-view.js `RING`, `LASH`; `HitFx.KINDS.dust/grit` and `DUST`; `AttackAudio.constants`
      `QUAKE`, `CRASH`, `SWIPE`, `LASH`; the shake reaches in world-game.js `fightEvents`; the `WARN` texts in hud.js.
  - **For P6.** Everything the plan lists, plus: the stagger count, how far Venom lands from you (and that view's frame rate), and
    whether the Rhino should ever charge the street under his building rather than ram it.
- 2026-09-28 — **Round 2 planned** (P7–P11, above) from the user's notes after playing. The RETRY bug's likely cause and
  the reasons the villains hold back were found in the code and are written down there. Mixamo clips for climbing
  and the Rhino's throw are listed under *The user's part*; the RTX step is the user's own.
- 2026-09-28 — **Round 2's Mixamo clips downloaded** from the user's signed-in Mixamo tab, as in P1: FBX Binary, Without
  Skin, 30 fps, from **X Bot** (65-bone `mixamorig:` skeleton, so retarget with rest-pose correction). Every file was checked:
  65 bones, 315 curves, one `mixamo.com` stack, `mixamorig:Hips` present. Mixamo applied **In Place** where it offers it (the
  climbs and shimmies). **`anim_climb_top` and `anim_throw` have no in-place option, so they carry root motion.** For
  `climb_top`, the rise up and over the edge *is* the move: drive the player's position from the game, and strip or read
  the Hips path as the top-out needs. For `throw` he steps into it: strip the horizontal Hips motion.

  | file | Mixamo animation | length | size |
  |---|---|---|---|
  | `spiderman/anim_climb_up.fbx` | Climbing Up Wall [in place] | 2.0 s | 468 KB |
  | `spiderman/anim_climb_down.fbx` | Climbing Down Wall [in place] (a different file from `_up`, though the same size) | 2.0 s | 468 KB |
  | `spiderman/anim_shimmy_l.fbx` | Left Shimmy (free hanging) [in place] | 1.37 s | 400 KB |
  | `spiderman/anim_shimmy_r.fbx` | Right Shimmy (free hanging) [in place] | 1.4 s | 405 KB |
  | `spiderman/anim_climb_top.fbx` | Climbing To Top (up and over onto a standing pose) | 4.0 s | 673 KB |
  | `rhino/anim_throw.fbx` | Throw Object (picks it up and throws it) | 4.87 s | 706 KB |
- 2026-09-28 — **Session P7 done: the RETRY bug is fixed, the Goblin's laser comes at you, and HARD is hard, proved by
  bots.** 274 tests pass (263 old, some rewritten for the new rules, plus 11 new: the RETRY and `Rig.reset` tests, 5 in
  `attacks.test.cjs` for the laser, volley, dive and standing still, 2 for the director and off-screen rules, 1 on the
  stagger, and 2 bots in the new `game/tests/bots.test.cjs`). No CLASSIC file or test changed (`levels.js`, `combat.js`,
  `villains.js`, `game.js`, `training.js`, `menu-aim.js`, `menu.js`, `audio.js`, the CSS, `game.test.cjs`). The planning
  session's uncommitted Round 2 notes were committed first, on their own (`eb1fbc7`). The Round 2 Mixamo FBXs (climbs,
  shimmies, the Rhino's throw) are still untracked: they're P8's and P10's. **Nothing is pushed.**
  - **The RETRY bug, reproduced first.** In headless Chrome, driven with `cdp.cjs` and the P4/P5 helpers copied into this
    session's scratchpad, I went down in all three fights. That covered dying standing, perched, on a swing line, in the
    air, in each camera mode, twice in a row, and with synthetic wrist packets in EDGE TURN and DIRECT. Then I pressed RETRY.
    - **The camera was never the problem:** in every case it was back at `player.y + EYE` on the INTRO card and after GO.
    - **What was wrong was what the plan suspected: the two rigs kept their held `death`/`fp_death` shots.** On the INTRO
      card after RETRY, the third-person body measured **0.58 m tall** (1.79 m before dying): it was lying on the roof,
      next to a full health bar. In first person the hands were gone (slumped out of view), and on MED the body's shadow
      lay flat. It only cleared on GO, when the new `PlayerAnim` asked the rigs for their base again. That lying body is
      "the character's height sinks to the ground". (Screenshots: `r3_intro_nocard.png` before, `fix_third_1.png` after,
      in the scratchpad.)
    - **Fix, at the root.** `Rig.reset(m, base)` puts a machine back on a base at once and drops every one-shot (a held
      one too), hit and layer. `CharacterRig.reset` does that and poses the model. `WorldPlayer.reset()` resets both rigs to
      `PlayerAnim.BASE` (`loco`, `fp_idle`), and also the hang tilt and the line IK. `place()` calls it, so every new life
      (RETRY, a new fight, roaming) starts clean. `place()` also now resets `lastState` (the landing dip) and the shake.
      `PlayerCamera.slump(null)` is all zeros.
    - **Tests.** A death is played through `PlayerAnim` into both rig machines. The test checks that a new `PlayerAnim`
      alone leaves the death held (the bug), that the reset leaves no held shot on either rig, and that the new life's
      first-person eye is at `player.y + EYE`. Plus a `Rig.reset` machine test. After the fix the page measured the body at
      1.86 m on the INTRO card after RETRY, with both rigs on their base.
  - **The laser now targets you.**
    - **What it aims at.** `ctx.target` is new in `Fight.tick`: world-game.js passes your eye in first person, and your
      head in third (or your chest, if the head is off the screen).
    - **Tracking.** `GUN_TRACK` is 14/s (it was 2.5). The aim leads your velocity by the time until the rounds arrive
      (`Attacks.lead`: `GUN_LEAD` 1, at most `GUN_LEAD_MAX` 4 m).
    - **The lock** comes only in the wind-up's last `GUN_LOCK` 0.15 s, and the burst goes at the locked point.
      `fight.attack.laser = { aim, k, locked }` is what attack-view.js draws.
    - **The beam reaches you.** In first person it stops 0.6 m in front of the lens, where its dot is a small bright point
      over the gun. world-game.js adds a red lens glare there (`laserGlare`), steady once locked. The off-screen chevron
      shows while it charges.
    - **Measured in the page:** the locked aim was 0 m from the eye in first person, and on the head in third.
      `docs/reference`-style shots are `laser_pov_charge.png` and `laser_3p_locked.png` in the scratchpad.
    - **Tests:** standing still in first person, the locked aim is within 1° of your eye (seen from the gun), and it locks
      within a frame of 0.15 s before the burst. Walking steadily at 6 m/s, the burst hits. Turning back at the lock, it
      misses.
    - Each attack now carries its own wind-up length (`Attacks.windup(a)`, `a.tele`), which the clips, the sound, the ring
      and the laser use.
  - **HARD, reworked (`Difficulty.HARD`):**

    | setting | P5 | now |
    |---|---|---|
    | cadence | 3–5 s | 1.6–2.8 s |
    | breather | 0.8 s | 0.2 s |
    | telegraph | 0.9 s | 0.65 s, plus `offScreen` 0.5 s when he starts it out of view |
    | recover | 0.8 s | 0.6 s |
    | invulnerable | 0.6 s | 0.4 s |
    | firstAttack | 1.5 s | 1.2 s |
    | stagger | 2 hits | 4 hits |
    | director | none | 4 s |
    | range | 40 m (Rhino 60) | glider 80, charge 60, leap 80 m |

    `range` is now in HARD; `Fight.constants.ATTACK_RANGE`/`RANGES` are only the fallback.
    - **The framework's restraint.** Off-screen attacks are allowed: a longer wind-up, the red chevron and the sound. A
      second one from off the screen waits only until the first has landed (`ctx.inFlight`: his bombs, rounds or tentacle
      still on their way). The old rule, never two in a row off-screen, waited until he was in view, so looking away
      stopped him. **The director** (`Attacks.quiet`): 4 s with no attack and nothing in flight, and the next one starts at
      once. It counts while he closes in from out of range too.
    - **The stagger** now takes 4 hits. The web's 0.35 s cooldown lands at most 2 in an on-screen wind-up, so only an
      off-screen one (1.15 s) can be staggered. A test pins that down. That is what the plan's numbers give: with good aim
      his attacks are no longer all cancelled.
  - **The Goblin's new moves** (`Attacks.MOVES.glider` = bomb, guns, volley, dive):
    - **volley.** A bomb wind-up (the `attack` clip, the fizz), with the laser on from its start. At the strike he throws
      2–3 bombs 0.3 s apart (each after the first is a quick re-throw clip), and at 0.9 s the burst goes down the locked
      line.
    - **dive.** Within 17 m, with a clear line, he cackles (his `roar`, sped up), then swoops at 24 m/s straight through
      where your chest is, on 9 m past, levelling out 1.5 m up. He pulls out 1.5 m short of anything in the way.
      - In his path (0.6 m) it does 28, knocks you off a line and throws you along his line.
      - When it ends he takes up his circuit round you from wherever he is.
      - Tests: it hits you standing, misses a 3 m sidestep, and never goes into a building.
    - **Standing still.** Within 1.5 m of one spot on a roof (or perched) for 2 s, his next attack comes at once, and it's
      a volley or a bomb (`Fight` `s.still`).
    - **Every move keeps a telegraph.** Each has its red warning line (`Hud` `WARN`, held until it lands for the volley and
      the dive), its wind-up sound, and the chevron through the part that's still coming.
  - **Balanced by what the bots measured.** First, how the bot runs:
    - It is a node test: `bots.test.cjs` runs `Fight.tick` with you in it, a stand-in body, and your eye as the guns'
      target.
    - The human-pace bot shoots every 1.2 s with 30% missed. It moves only a reaction time (0.25–0.45 s) after a wind-up (a
      sidestep of 0.3–0.9 s). When the laser locks (its beep) it changes what it's doing: it stops if moving, and steps
      aside if not. It never shoots bombs down.
    - At first it won **1 of 40**. At 120 m/s the rounds landed about 0.13 s after the lock, which no reaction can answer,
      so 87% of bursts hit.
    - Changed:
      - `GUN_SPEED` 45 m/s: bolts you can see coming, and the lock can be answered. The lock beep now sounds at the real
        lock.
      - A bomb's blast reaches `BLAST_R` 4 m (was 5), `BLAST_INNER` 1.
      - The dive goes for where you are (`DIVE_LEAD` 0; a lead punished the sidestep everyone makes), with `DIVE_R` 0.6.
      - Tried and dropped: less bomb lead (worse: it lands where you stop), fewer bombs in a volley, and a longer lock
        (the plan says about 0.15 s).
    - Each kind of attack now lands on the bot about a quarter of the time. **Measured:**
      - **Passive** (node, 10 seeds, fight proper): Goblin 6.3–9.4 s (median 8.3), Rhino 14.2 s, Venom 7.6–8.4 s.
        **In the page**, counted from GO: Goblin 10.9 s, Rhino 18.9 s (four quakes), Venom 20.9 s.
      - **Human pace vs the Goblin** (node, 40 seeds): **won 28/40**. HP left in the wins: 1 4 5 5 6 8 12 13 15 19 20 21
        25 30 32 40 42 43 43 44 45 46 47 58 62 80 100 100 (**median 32; under 60 in 24 of 28**). Fights took 19–34 s. What
        hit it, over all 40: 85 bombs, 50 bursts, 17 dives.
      - **In the page** (real clicks through `WorldGame.fire`, real A/D keys, first person, 5 seeds): **won 5/5** with 16,
        5, 34, 44 and 12 HP left. There the 30% aimed off don't count as missed shots: `Swing.decide` turns a click aimed
        well off him into a line or a release, so they cost time instead.
  - **Intro cards and README.** All three cards say he is out to kill you. The Goblin's says to change direction when the
    laser locks, and mentions the volleys, the dive and standing still. "Two hits while he winds up stop him" is gone. The
    README's fight section describes all of it. A test checks the cards.
  - **Also fixed:** rounds and bombs outlived you. When one of them killed you, `stopAttacks` emptied the list inside the
    `filter` that then wrote the rest back.
  - **Verified** in headless Chrome from `file://` too (the Goblin fight: models, bomb, volley, guns; no console errors
    beyond the r159 deprecation). Checked by eye in screenshots:
    - the volley: two bombs in the air over the charging glare, with "Bombs and guns · keep moving";
    - the dive: the Goblin swooping, with "He's diving at you";
    - the INTRO cards (the Goblin's longer one still fits).
  - **Not verified.**
    - The real wrist shooter. **Ask the user to play all three fights with it**, in both camera modes. In particular: can
      the laser's lock be read and answered? Are dives and volleys fair? Is it now hard enough?
    - **MED at 60 fps on the Intel UHD.** Headless Chrome here now always gets the **RTX 4070** (even with
      `--force_low_power_gpu`): Windows probably sends Chrome to the NVIDIA GPU now, the user's step before P11. I didn't
      touch Windows settings. On the RTX, the Goblin fight with his attacks going ran at 232–240 fps (capped) with 77–101
      draw calls. P4 measured 71–96 calls there. Nothing new draws beyond more bombs (the same pool of 4), more tracers
      and a 2D glare.
    - The new sounds (the dive's rush, the volley's fizz and charge, the moved lock beep) by ear.
    - Pointer lock.
  - **Known, and worth a look.**
    - The Rhino and Venom get the new pace, the off-screen attacks, the director and the stagger, but not new movement:
      that is P8. A passive player dies to the Rhino only through quakes (14 s in node, 19 s in the page).
    - Venom close up was the one view near 60 fps on the Intel UHD in P5. Attacks now come more often, but nothing new is
      drawn in his fight.
    - The Goblin only dives when you're within 17 m of him; he circles at 12–20 m, so about half the time.
  - **Constants to tune.**
    - `Difficulty.HARD`, including `offScreen`, `director` and `range`.
    - `Attacks.constants`: `GUN_TRACK`, `GUN_LOCK`, `GUN_LEAD`, `GUN_LEAD_MAX`, `GUN_SPEED`; `BLAST_R`, `BLAST_INNER`;
      `VOLLEY_N`, `VOLLEY_EVERY`, `VOLLEY_CHARGE`; `DIVE_*`; `STILL_R`, `STILL_T`; `PREFER.glider`.
    - attack-view.js `LASER` (`lens`, `front`, `lensDot`), and the glare in world-game.js `laserGlare`.
  - **For P8.**
    - A new move still needs what P4's note lists. Two more things matter now:
      - While a strike's projectile is in the air, it counts as `inFlight` in `attacking()`. Add a thrown car or chunk
        there, or the off-screen rule and the director won't see it.
      - `allowed()` returning `[]` holds him even against the director. That is how the Rhino waits when he can't reach
        you, so P8's "never idle for more than 2 s within 80 m" has to come from giving him a move.
    - `bots.test.cjs`'s `run(enc, bot, seed)` and `human()` are reusable. Add the Rhino and Venom human-pace runs to it,
      and give the bot a street or roof walk, as their fights need.
  - **Follow-up (same day, the user): the bug was still there after dying and choosing FREE ROAM.** Reproduced first: after
    DEFEAT → FREE ROAM, the first-person view stayed **1.15 m below the eye, tipped 0.45 rad down and leaning 0.12**, for as
    long as you roamed (in third person, tipped down 0.18). The death slump is keyed on `deadAt`, which only `place()`
    cleared, and FREE ROAM (`enterRoam(false)`) keeps you where you stand without calling it. The per-life reset is now
    `newLife()` in world-game.js (the models, the slump, the red edge, the shake, the hit-stop, the camera state), called by
    `place()` and by `enterRoam` when it doesn't move you. The swing line, the view history and the webs stay. Verified in
    the page: after DEFEAT → FREE ROAM the camera is at `player.y + EYE` with no tip or lean in either view; FREE ROAM from
    PAUSED while on a swing line keeps the line; RETRY is unchanged. Every other way out of a fight (RETRY, NEXT, TRAINING,
    MENU then START or CONTINUE) already went through `place()`. There is no node test for this one: it is page glue in
    world-game.js, which the tests don't load; the logic it calls (`Rig.reset`, `PlayerCamera.slump(null)`) is tested.

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

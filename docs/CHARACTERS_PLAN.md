# Web Shooter 3D — real 3D characters

Session 3 of `docs/3D_PLAN.md` drew the villains as flat PNG billboards and built the thugs from
primitive boxes. That was the old plan's decision, and it does not look good enough. This plan replaces
both with **rigged, animated, textured 3D models**. The villains are based on the characters in
`game/assets/villains/` (Green Goblin, Rhino, Venom), and the thugs on the masked suits in
`docs/reference/video1-combat.jpg`.

Read `docs/3D_PLAN.md` first (Fixed decisions and Status) and then this whole file. Each session does
only its own section and appends a dated handoff entry to **Status** at the bottom of this file.

## Why primitives can never look right, and what does

Realism in a character comes from four things, and code alone can produce none of them well:

1. **Sculpted shape**: a real silhouette, muscle, armour plates and cloth folds.
2. **PBR textures**: base colour, normal and roughness/metal maps, so leather, armour, symbiote and suit
   fabric respond to light differently.
3. **A skeleton and skinning**: the body bends at real joints.
4. **Motion-captured animation**: weight, anticipation and follow-through.

The pipeline below gets (1)+(2) from an **AI image-to-3D generator**, (3)+(4) from **Mixamo** (a free
auto-rigger plus a mocap animation library), and does all the cleanup, scaling, compression and
integration in code through **headless Blender**. The last session then fixes the lighting, because a
good model under flat light still looks cheap.

Expectation: this reaches good-indie quality at the distances the fights use (the Goblin at 12–20 m, the
Rhino at about 25 m, Venom at about 20 m). It will not match the PS4 game close up, and faces are the
weakest part of AI-generated models.

## Tools

| Tool | Who | Why |
|---|---|---|
| **Blender 4.2 LTS or newer** (free) | user installs | Claude runs it headless (`blender --background --python ...`) to clean, scale, retarget and export the models. Required. |
| **Meshy** (meshy.ai) *or* **Tripo** (tripo3d.ai) account | user | image-to-3D and text-to-3D with PBR textures. The free tier is enough to start; check its licence for free-tier outputs. |
| **Mixamo** (mixamo.com, free Adobe ID) | user | auto-rig plus mocap animations |
| An image generator (ChatGPT, Gemini, or the generator's own) | user | turns the dynamic-pose PNGs into clean **T-pose** references |
| Node 24 (installed) | session | runs `esbuild` and `@gltf-transform/cli` as dev dependencies; the sessions install these |
| Git LFS (installed) | session | tracks the large source files in `game/assets-src/` |

Claude cannot sign in to Meshy, Tripo, Mixamo or Adobe for you. Generating and downloading the models is
your part; everything after the downloaded files is the sessions' part.

## Fixed decisions (character sessions)

1. **Three.js stays r159 classic, and the page still runs from `file://`.** The loaders and helpers that
   are only ES modules (GLTFLoader, SkeletonUtils, MeshoptDecoder, RoomEnvironment, the EffectComposer
   passes) are bundled **once** with esbuild into `game/vendor/three-addons.js`. It is an IIFE that
   attaches them to the existing `window.THREE`, with `three` aliased to a shim that returns
   `window.THREE`, so there is a single Three.js instance. Record the exact command and versions in
   `game/vendor/README.md`.
2. **Models ship as base64 inside script files.** WebGL can't load `file://` files, which is why the
   sprites already live in `villain-sprites.js`. So `game/tools/embed-models.cjs` turns each final `.glb`
   into `game/js/world/models/<id>.js`, which calls `WorldModels.register('<id>', '<base64>')`. The loader
   parses it with `GLTFLoader.parse`. **Only meshopt compression and WebP textures are allowed**: both
   decode without fetching a separate `.wasm` file. Draco and KTX2 are not allowed.
3. **Sources vs output.** Downloads live in `game/assets-src/characters/<id>/`, tracked with Git LFS.
   One Blender script per character, `game/tools/blender/<id>.py` (shared helpers in `common.py`),
   turns them into a game-ready `game/assets/models/<id>.glb`: real height in metres, feet on y=0, facing
   +Z, only the clips the game uses, renamed to the standard names, WebP textures. The embedded scripts
   are generated from those GLBs. **`game/assets/models/characters.json` is the runtime manifest**: for
   each model it gives the file, height, loop clips, events (the Goblin's bomb release), weak-spot bones
   with offsets and radii, body capsules, and notes on quirks. Bone names always come from it, never
   hard-coded. `game/tools/blender/sheet.py` renders a contact sheet of every clip from the exported file
   into `docs/reference/clips/<id>.png`, and `game/tools/inspect-glb.cjs` summarises a GLB. Rebuild
   and re-check a character after any change to its script.
4. **Standard clip names:** `idle`, `walk`, `run`, `dodge_l`, `dodge_r`, `hit`, `hit_big`, `attack`,
   `defeat`, plus per-character extras (`fly`, `fly_turn_l/r`, `leap_start`, `leap_air`, `land`, `roar`,
   `knockdown`, `getup`). The runtime asks for the standard names, and the manifest maps each file to one.
5. **Budgets.** Each villain has 25–40k triangles and one 2048² texture set (base colour, normal, ORM) as
   WebP. Each thug has 10–15k triangles and a 1024² set, all thugs share one skeleton and one set of clips,
   and variants change only material tint or mask texture. Fights must stay at 60 fps on MED
   (3D_PLAN decision 6). Update far or offscreen characters' mixers at a lower rate.
6. **Weak spots and hit volumes follow bones, not the sprite.** Each weak spot (CHEST, HEAD, SHOULDER) is a
   sphere attached to a bone (for example `mixamorig:Spine2`, `mixamorig:Head`, `mixamorig:RightArm`),
   with an offset and radius from the manifest. The body is a handful of bone-attached capsules. The
   logic modules stay free of Three.js: the render side samples bone world positions into plain arrays
   each frame, and `Fight.snapshot` stores those. **Lag compensation keeps working**, so a flick is still
   judged against the pose that was on screen when you aimed.
7. **Keep a fallback.** If a character's model is missing, the game still runs with the current
   billboard or primitive and logs one warning. This lets the sessions ship before every model exists.

## Your part: making the models

**The three villains are done**: the models and animations are built and checked (see Status). The rest
of this section is kept for the **thugs**, and for replacing a villain later.

**Shortcut: a model that is already rigged and animated.** A downloaded GLB that has a skeleton, its own
animations and embedded textures (as many Sketchfab game-character uploads do) skips steps 1–4 below
entirely. Put the `.glb` in the character's folder as `<id>.glb`; the textures are already inside it. Ask
a session to inspect it first, to confirm it has a skin, the animations, and a single character rather
than a scene. **Venom is already done this way**: see *Venom notes*.

**Rhino: no Mixamo needed after all.** His missing clips (run, skid, turns, hits, dodges, stun, defeat)
are retargeted from Venom's rig by `rhino.py`. If they ever look wrong on him, Mixamo clips can replace
them: upload `rhino.fbx` (it already has Mixamo bone names), raise **Character Arm-Space**, and download
FBX Binary, Without Skin, In Place.

**For a new character from scratch (the original steps):**

1. **Make a T-pose reference image.** The current PNGs won't generate well: Venom is comic art in a
   dynamic pose and the Goblin stands on a display base. Give an image generator the PNG and a prompt
   like *"Same character, full body, front view, standing in a T-pose with arms straight out and feet
   shoulder-width apart, plain white background, even studio lighting, realistic video-game character
   render."* Also make a **side** and a **back** view if you can, because multi-view input gives much
   better 3D. For the Goblin, also make his **glider** on its own: *"Green Goblin bat-wing glider, top
   and side view, plain background."*
2. **Generate the 3D model in Meshy or Tripo** with image-to-3D (multi-view if you have the views).
   Turn on **PBR textures** and the **T-pose/A-pose** option if there is one. Aim for about 30k
   triangles and 2K textures. Rotate the result and check the hands, face and back; regenerate if they
   have melted. Download it as **FBX** (for Mixamo) and **GLB** (as a backup).
3. **Rig it in Mixamo.** Upload the FBX and place the markers (chin, wrists, elbows, knees, groin). Then
   download **Character: FBX Binary, T-pose, With Skin** and save it as `model.fbx`.
4. **Download the animations** from Mixamo with that character selected. Use FBX Binary, **Without
   Skin**, 30 fps, and tick **In Place** for anything that moves. Name each file by what it is
   (`anim_run.fbx` and so on). Any similar Mixamo animation is fine; the manifest maps names.
   - **All:** idle (search *"idle"* or *"fighting idle"*), hit (*"hit reaction"*), hit_big
     (*"big hit"* or *"stagger"*), defeat (*"dying"* or *"falling back death"*), dodge_l and dodge_r
     (*"dodge"* or *"sidestep"*).
   - **Goblin:** fly (*"flying"*), and leaning versions for turning if you find them. Also attack
     (*"throw"*).
   - **Rhino:** run (*"mutant run"*), roar (*"mutant roaring"*), turn or skid (*"running turn"* or
     *"stop"*), attack (*"mutant punch"* or *"shoulder charge"*).
   - **Venom:** leap_start, leap_air and land (*"mutant jumping"*, *"jump"*, *"falling idle"*,
     *"landing"*), run, attack (*"mutant swiping"*), roar.
5. Put everything in `game/assets-src/characters/<id>/`, meaning `goblin/`, `rhino/`, `venom/`, with
   the glider as `goblin/glider.glb` (it needs no rig).

**For the thugs:** use **text-to-3D** with a prompt like *"Realistic man in a black suit, white shirt,
black tie, wearing a white porcelain skull-like mask covering the face, T-pose, video game character."*
That is the masked gang from video 1. Rig it in Mixamo the same way and download idle, walk, run, a punch
(*"punching"*), a pistol aim (*"pistol idle"*), hit, knockdown (*"knocked down"*), getup (*"getting
up"*) and defeat. Put the files in `game/assets-src/characters/thug/`. A second body type (heavier or
taller) in `thug2/` is a bonus.

When a folder is ready, tell the next session which characters are done.

## Venom notes (source: `game/assets-src/characters/venom/venom.glb`)

The user downloaded a Marvel Rivals Venom from Sketchfab: `SK_1035_1035001`, exported by Khronos glTF
Blender I/O 4.3. It is an 82.5 MB GLB, so it is tracked with Git LFS (see `.gitattributes`). Keep it for
personal use: it is a game rip, so it must not be published or redistributed.

- **Mesh.** One skinned mesh with 3 materials (Head, Body, Equip), each already PBR (base colour,
  metallic-roughness and normal). It has 49k vertices and **89.5k triangles**, and the ten embedded
  textures are 2048² PNGs (about 23 MB). It is Y-up, with the feet at y 0 and a height of **2.50 m**,
  which matches `villains.js`, so no rescale is needed. Check which way it faces: the arms reach toward
  +z (−0.39…0.74).
- **Budget exception.** Decimate to about 50k triangles if it survives with no visible damage. Otherwise
  keep more: Venom is the only villain on screen during his fight. Convert the textures to WebP; 2K for
  Body, and try 1K for Equip. Watch for an Unreal-style (DirectX, green-flipped) normal map. If the
  shading looks inside out, flip the green channel.
- **Skeleton.** 262 joints, Unreal naming: `root, pelvis, spine_01…05, neck_01/02, head,
  clavicle/upperarm/lowerarm/hand_l/r, thigh/calf/foot/ball_l/r`, plus twist, corrective (`*_Fix_*_Jnt`),
  muscle, `Jaw_Jnt` and a 23-joint tongue. Three.js skins with a bone texture, so 262 is fine. Keep all
  joints that have weights.
- **Weak-spot bones (starting values; tune in C2).** CHEST is `spine_04` (or `spine_05`), HEAD is
  `head`, and SHOULDER is `upperarm_r` near the joint. Body capsules: pelvis to spine_05, head, the
  upper and lower arms, thighs and calves.
- **Clips (190 embedded, about 21 MB of keys; keep only these).** Skip the zero-length `A1_*…A5_*` and
  `DeathPose_*`/`KnockOut_*` poses, except as noted below.

  | standard | source clip |
  |---|---|
  | `idle` | `Idle_C` |
  | `walk`, `run` | `Walk_Fwd_C`, `Run_Fwd_C` |
  | `dodge_l`, `dodge_r` | `103551_Dash_L` + `103551_Dash_L_End`, and the `_R` pair |
  | `leap_start`, `leap_air`, `land` | `Jump_Start_F_C`, `Jump_Falling_F_C`, `Jump_Land_F_C` (or `Jump_Land_C` for a heavy landing) |
  | `attack` | `103511_Attack01/02/03`, `103521_Tentacles_01` |
  | `roar` | `Fight_Start`, or `103581_Symbiote` |
  | `hit_big` | `Knockout` (0.7 s) |
  | `hit` | there is no light hit reaction. Fake one with a short additive blend of the `KnockOut_F` pose, or the start of `Giddiness`. |
  | `defeat` | `Dead_B` / `Dead_F`, held on `DeathPose_B_Heavy` |
  | extras for C2 | `Onwall_Idle`, `LowCrawl_To_Onwall`, `Onwall_To_Jump` (**cling to the steel columns** of the construction frame between leaps), `103501_LowCrawl_Idle_L/R` and `103501_LowCrawl_Move` (crouch on the beams), `103531_Descent_Start/Loop/End` (drop onto a beam from above as his entrance) |

  These clips make C2's Venom much better than planned. He can cling to columns and crawl along beams,
  not just hop between them. Use them.

## Goblin notes (source: `game/assets-src/characters/goblin/`)

The user supplied a Spider-Man (2002, Treyarch) movie-suit Goblin, a PS2-era game rip re-exported through
Source Filmmaker and Blender 3.0. Keep it for personal use; do not publish or redistribute it. It is
`goblin.fbx` (binary FBX 7400, Y-up, 1 unit = 1 m on import, but the model is about 14.9 units tall, so
**scale it to 1.85 m**) plus three 256² diffuse PNGs: `bodygoblin.png`, `glider.png` and `norman.png`.
The FBX links **no** textures; materials `goblin`, `glider` and `norman` must be hooked up by name.

- **Keep:** `base_smtmg_goblin_body.smd` (1,446 triangles) and `mask_goblin_head.smd` (560), both on
  `Goblin_ARM`. Also keep `studio_glider.smd` (1,232 triangles) on its own `Glider_ARM`, with bones
  `Glider_Side_L/R` and `Glider_Gun_L/R` for wing flex and the guns. Keep one pumpkin bomb (`Bomb`,
  `Shell`, `Ring`, `Light`, about 53k triangles together) as the `attack` projectile, **decimated to
  about 1–2k**.
- **Drop:** `mask_norman_head.smd`, the unmasked Norman head.
- **Skeleton:** 78 bones, `TreyarchBiped.Bip01_*` for the body (Pelvis, Spine01–03, Neck, Head,
  Clavicle, UpperArm, LowerArm, Thigh, Calf, Foot, Toe) and `ValveBiped.Bip01_*` for the hands and fingers,
  plus `Jaw_Lower` and `Mouth_Corner_L/R`. **No animations at all.**
- **Quality pass (Blender script):**
  - smooth shading;
  - subdivision **only if it does not blur the texture**. A full level-2 Subsurf visibly smeared the
    256² stripes; try level 1 with creases or Corrective Smooth instead, and compare renders;
  - a Principled material with metallic about 0.2, roughness from the texture's luminance, a bump from
    luminance and a light coat, for the armour sheen;
  - if `*_4x.png` versions exist beside the originals (the user may run them through Upscayl), use them.
- **Why this is acceptable:** `docs/reference/compare_gamesize.png` shows it next to Venom at real
  in-game size (a 1080p crop, 75° vertical FOV, 15 m). At about 100 px tall, the two read at similar
  quality. `compare_closeup.png` shows the gap, but the Goblin fight never gets that close.
- **Clips, keyframed by script** (`game/tools/blender/anims/goblin.py`, the `rigged` kind). He always
  stands on the glider, so no locomotion cycles are needed. Give every clip overlap and follow-through
  (offset arm and head timing, ease-in and ease-out); there must be no linear or robotic interpolation.

  | clip | motion |
  |---|---|
  | `fly` | crouched glider stance, slow bob and hip sway, cape-less breathing, looping |
  | `fly_turn_l/r` | lean into the bank, the outside arm out for balance, the glider wings flexing |
  | `attack` | reach to the belt, wind up and throw a bomb; mark the release frame for the projectile |
  | `hit` | a quick torso and head flinch, about 0.3 s, usable as an additive layer |
  | `hit_big` | a big recoil: the head snaps back and the arms fly out, then he recovers |
  | `dodge_l/r` | a hard lateral lean and duck |
  | `roar` | a taunt: arms wide, head back, jaw open (`Jaw_Lower`) |
  | `defeat` | knocked off the glider, tumbling backwards; the glider then plays its own spin-away |

  The glider gets its own clips (`glider_fly` wing flutter and `glider_spin`), driven in sync with his.
  Before handing off, render a turntable or contact sheet of each clip to `docs/reference/goblin_clips/`.

## Rhino notes (source: `game/assets-src/characters/rhino/`)

The user supplied a Marvel Strike Force Rhino, a mobile-game rip. Keep it for personal use; do not
publish or redistribute it. It is `rhino.fbx` (binary FBX 7400 from Blender 4.2, Y-up) plus a full PBR
set: `Char_Rhino_D` (base colour, 512²), `_N` (normal), `_R` (roughness), `_M` (metallic), `_AO` (all
1024²) and `_E` (emissive eyes, 512²). The FBX links D, E, N, R and M by paths from the author's PC;
**AO is not linked**. Relink them all by name, and pack AO, R and M into the glTF ORM texture.

- **Mesh:** one mesh, `Char_Rhino`, with **7,926 triangles** and one material. It is clean hard-surface
  armour with a horned helmet and the face visible, and it looks right as-is (see
  `docs/reference/lineup_closeup.png` and `lineup_gamesize.png`). **No decimation and no subdivision.**
  It is 1.4 units tall on import; **scale to `villains.js` height** (2.9 m). If that looks too big next
  to the others, try about 2.6 m and tell the user.
- **Drop** the game helper empties: `CameraPos`, `CameraAim`, `VFX_Right_Wrist*`, `Prop_Right_Wrist`
  and `CustomFootAnchor`.
- **Skeleton:** 82 bones with **Mixamo names** (`mixamorig:Hips … Head`, fingers, `ForeArmRoll`, and
  face bones `Jaw`, lips, brows, eyelids), under the root `Char_Rhino_Mesh_PREFAB` on the armature
  `ST_Ent_Rhino`. Mixamo clips therefore map by name. Still check for rest-pose and bone-roll
  differences, because this rig came through Unity. The `Jaw` bone can open his mouth for `roar`.
- **Weak-spot bones (starting values):** CHEST is `mixamorig:Spine2`, HEAD is `mixamorig:Head`, and
  SHOULDER is `mixamorig:RightArm` (the sprite's shoulder is on the image's left, his right).
- **Embedded clips (5, at 30 fps; checked in Blender, they deform cleanly: `docs/reference/rhino_clips.png`).**

  | source | length | use as |
  |---|---|---|
  | `Anim_Rhino_Shell` | 2.2 s | `idle` |
  | `Anim_Rhino_Shell_Fidget` | 4.7 s | `idle` variation |
  | `Anim_MaleBig_Entry` | 2.0 s | `roar` (the entrance at the start of the fight) |
  | `Anim_Rhino_Passive_OnStart` | 0.8 s | short taunt at each end of a charge |
  | `Anim_Rhino_Ultimate_Start` | 1.1 s | `attack`: the charge wind-up |

- **Missing from his file, now retargeted from Venom by `rhino.py`:** `run` (the charge loop), `walk`,
  `skid`, `turn_l/r`, `hit`, `hit_big`, `dodge_l/r`, `stun` and `defeat`. His own `MaleBig_Entry` turned out
  to be a drop-in landing, so it is `entrance`; `Passive_OnStart` (a flex) is `roar`.
- **Textures:** D and E are only 512². If `Char_Rhino_D_4x.png` or `Char_Rhino_E_4x.png` exist (from
  Upscayl), use them. The E map gives the cyan eye glow in `rhino.png`; C4's bloom should pick it up.

## Session C1 — Load the models into the game

The Blender side is already done: `game/tools/blender/{goblin,rhino,venom}.py` built
`game/assets/models/{goblin,glider,bomb,rhino,venom}.glb`, and `characters.json` describes them. Read the
*Status* entry for the builds before starting. C1 is the browser side.

- Bundle `game/vendor/three-addons.js` as in decision 1, and prove it loads in the page with a single
  `THREE`. It must include GLTFLoader, SkeletonUtils, MeshoptDecoder and EXT_texture_webp support.
- `game/tools/build-models.cjs` is one command that:
  - optionally re-runs the Blender scripts (`--blender`), finding Blender on PATH, then in
    `C:\Program Files\Blender Foundation\Blender *\`, then in `BLENDER_PATH`, with a clear error if it
    is missing;
  - compresses each GLB with `gltf-transform` (meshopt, prune, dedup; keep WebP) into
    `game/assets/models/dist/`. Venom is 11 MB before this, about 3 MB of it in the JSON describing
    thousands of tiny animation channels, so check that the result is a few MB;
  - runs `embed-models.cjs` on the compressed files.
- Runtime `game/js/world/characters.js`:
  - `WorldModels` loads the models and clones them with `SkeletonUtils.clone`.
  - `CharacterRig` holds an AnimationMixer with a small state machine: crossfades, one-shot clips that
    return to the base state, speed-matched walk/run blending, and an additive or upper-body layer for
    `hit` so a hit doesn't stop a run.
  - `CharacterRig` also samples the bone-attached weak spots and capsules into plain arrays.
- Pure logic goes in UMD modules with tests. That covers manifest validation, clip-name mapping and
  fallbacks, the state-machine transitions, and the weak-spot and capsule math given bone matrices as
  plain arrays.
- A debug **model viewer** (a key or a URL flag): it shows each model in the city at its real size,
  cycles its clips by name, and draws the weak-spot spheres and body capsules from `characters.json`.
  C2 tunes the weak spots with it.
- Git LFS: `.gitattributes` already tracks `game/assets-src/**` GLB, FBX and PNG. Run `git lfs install`
  if the repo needs it, and **commit the sources through LFS** (Venom's is 82 MB). The built GLBs in
  `game/assets/models/` are small enough for normal git.
- **Done when:** all five models load in the page, from `file://` too, and every clip plays in the
  viewer. Tell the user to check it from disk in Chrome, because the app's pane can't open `file://`
  pages.

## Session C2 — The three villains

- Tune `characters.json` (weak-spot offsets and radii) in the C1 viewer until the markers sit on the
  chest, head and shoulder of each actual model.
- Replace the villain billboards in the fights:
  - **Goblin** rides his glider (attached to the feet or root; it banks with the turn) and plays `fly`
    and leaning variants.
  - **Rhino** drops in with `entrance`, `roar`s, winds up with `attack`, blends `run` by speed along the
    charge, and `skid`s (or turns) at each end.
  - **Venom** hops between beams with `leap_start` → `leap_air` → `land` timed to the hop's real arc,
    lands facing the next beam, and `roar`s when he arrives.
  - All three turn to face their travel direction or the player, `dodge_l`/`dodge_r` on a shot (the
    existing dodge rule), play `hit` on a weak-spot hit and `hit_big` on the last one before defeat, and
    play `defeat` on VICTORY instead of the fade.
- Weak spots and body hits use the bone-sampled volumes, with lag compensation intact. Update the tests
  that assumed sprite u/v. The web splats now stick to the model: parent them to the nearest bone.
- Remove the billboard path from the 3D game once all three models load, keeping the logged fallback.
  CLASSIC still uses the PNGs.
- **Done when:** all three fights play start to finish with real models, with the wrist, at 60 fps on MED.
  Ask the user to play them and report anything that looks wrong.

## Session C3 — The thug gang

- Run the pipeline on `thug` (and `thug2` if present). Make at least 4 visual variants from material tint,
  mask colour or pattern, height ±6% and shoulder width. Share clips across all of them.
- Behaviour (a UMD logic module with tests; the render side only plays clips):
  - idle or patrol in small groups until the fight starts, then turn toward the player;
  - pistol thugs `aim` and fake-fire (a muzzle flash and a miss tracer, no damage to the player yet);
  - melee thugs walk or run to the edge of the container area;
  - one-hit thugs go into `knockdown` and stay down; two-hit thugs `hit` on the first, then `knockdown`,
    and some `getup` once if not webbed again within about 3 s;
  - downed thugs get webbed to the ground: a splat on the body (reuse `webs.js`).
- Performance: mixers of thugs far away or off camera update at a lower rate. Measure draw calls in the
  Venom fight and keep them within the budget.
- Replace the primitive thugs; keep the logged fallback.
- **Done when:** the Venom fight's thug wave looks like the masked-gang scene in video 1, and the frame
  rate holds.

## Session C4 — Make it look professional: lighting, materials and effects

- Colour pipeline: sRGB output, ACES (or AgX if it looks better), correct texture colour spaces, and
  PMREM **environment lighting** from the sky so metal and armour reflect the city. Add per-villain rim
  light so characters separate from busy backgrounds.
- A post chain from the bundled addons: SMAA or FXAA, subtle bloom for glowing eyes and weak spots, SSAO
  or GTAO on HIGH only, and a mild colour grade toward video 1's warm sun with cool shadows. Add a
  LOW/MED/HIGH setting (or extend the existing one) that switches these.
- Character shadows: make sure villains and thugs cast into the following shadow map at a usable
  resolution, and add blob contact shadows on LOW.
- Hit effects:
  - web-impact particles;
  - sparks on the Rhino's armour;
  - black symbiote splashes on Venom;
  - a hit-stop of a few frames on a weak-spot hit;
  - a weak-spot marker that pulses rather than a flat circle;
  - a stylised dissolve or web-wrap on defeat.
- Screenshot each fight from the vantage in the browser pane, compare against `docs/reference/`, and
  iterate. Report fps with and without the post chain.
- **Done when:** the side-by-side screenshots read as one coherent, lit game, and MED holds 60 fps.

After C4, return to `docs/3D_PLAN.md` Session 4 (HUD, world life) and Session 5. The LOW/MED/HIGH tiers
from C4 are the ones Session 4 extends.

## Status

_Each session appends a dated entry: what was done, which characters were processed, constants to tune,
and anything the next session must know._

- 2026-09-26 — Plan written. Blender is not installed yet (not on PATH or in Program Files). The GPU is an
  RTX 4070 Laptop (8 GB). No code changed yet.
- 2026-09-26 — The user supplied a rigged, animated Venom GLB. Copied to
  `game/assets-src/characters/venom/venom.glb` (uncommitted) and added LFS rules for
  `game/assets-src/**` to `.gitattributes`. Inspected it and wrote *Venom notes*. Venom needs no Meshy or
  Mixamo work; the Goblin, Rhino and thugs still do, unless similar rigged GLBs turn up.
- 2026-09-26 — Blender 5.2.2 LTS installed at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`
  (not on PATH). The user supplied a 2002 movie-suit Goblin: rigged, with no clips. Copied to
  `game/assets-src/characters/goblin/` (uncommitted). Test renders at game size and close up, next to
  Venom, are in `docs/reference/compare_*.png`. Wrote *Goblin notes* and added Session C1b (the Goblin's
  quality pass and scripted animations). He needs no Mixamo.
- 2026-09-26 — **All three villains built and checked in Blender (done in the planning session; C1b is
  folded in, and Mixamo was not needed).** Outputs are in `game/assets/models/`, with `characters.json`.
  Every clip was rendered from the *exported* file (`docs/reference/clips/<id>.png`), and all three
  together are in `docs/reference/final_lineup.png`.
  - **venom.glb** (9.9 MB before compression): 50k triangles (decimated from 89.5k); head and gear
    textures 1K, body 2K, WebP; the extra UV sets and vertex colours were stripped (GLTFLoader would
    have tinted him by COLOR_0). 28 clips. `taunt` (Fight_Start) was dropped because it is a fall-over.
    `hit` flinches toward 30% into Knockout (KnockOut_F is a lying pose). `dodge_l/r` are the dash-leap
    plus a landing, settled into idle. Static channels were pruned and linear keys thinned, but ~9,900
    channels remain, so the JSON chunk is ~3 MB of tiny accessors: C1's gltf-transform pass must fix that.
  - **rhino.glb** (1.3 MB): 7.9k triangles, full PBR (AO relinked into ORM, emissive eyes). 16 clips: 5 his
    own (`idle`, `idle_fidget`, `entrance`, `roar`, `attack`) and 11 retargeted from Venom (`run`,
    `walk`, `skid`, `turn_l/r`, `hit`, `hit_big`, `dodge_l/r`, `stun`, `defeat`) with limb-direction
    rest-pose correction and 12° of arm space. **Exported at native size (1.383 m); scale the root by
    2.0973** (`scale` in the manifest). Applying the scale in Blender re-derived this rig's bone rolls
    and rotated every clip 90°, and the glTF exporter drops the armature object's scale, so don't try
    either again. His clips are keyed at 25 fps (the importer adopts the FBX rate).
  - **goblin.glb** (1 MB) + **glider.glb** + **bomb.glb**: scaled to 1.85 m. The file's crouched glider
    stance was applied as the rest pose (the skeleton's own rest is an upright A-pose). Subdivided once
    (12k triangles), and a 1K normal and roughness map were baked from the diffuse's luminance in Cycles.
    11 scripted clips (`idle`, `fly`, `fly_turn_l/r`, `attack` with release at frame 21, `hit`,
    `hit_big`, `dodge_l/r`, `roar`, `defeat`), plus `glider_fly` and `glider_spin`. The FBX importer
    switches the scene to 24 fps; goblin.py puts it back to 30. The glider shares his origin; his feet
    sit on its top (z 0.05 vs 0.10).
  - **Not done:** the thugs (no model yet); meshopt compression and embedding (C1); weak-spot offsets
    are zeros to tune in C2.
- 2026-09-26 — The user supplied a Marvel Strike Force Rhino (from `rhino.zip`). Copied the FBX and six
  PBR maps to `game/assets-src/characters/rhino/` (uncommitted). Checked it in Blender: 7.9k clean
  triangles, a Mixamo-named rig and 5 clips that deform cleanly. Renders are in
  `docs/reference/lineup_*.png` and `rhino_clips.png`. It needs Mixamo clips (the charge `run`, skid,
  hits, dodges and defeat); the user was given the list. Venom looks like it floats in the lineup
  renders only because those test scripts placed him from his rest-pose bounds; that is not a model
  problem.
- 2026-09-26 — **Session C1 done: all five models load in the page, from `file://` too, and every clip
  plays in the viewer.** 126 tests pass (103 old + 1 in `addons.test.cjs` + 22 in `rig.test.cjs`). All the
  sources and the Blender scripts are now committed, the sources through Git LFS (`git lfs install --local`
  was run). **Nothing is pushed.** `origin` (R-Abdelaty/webshooter) is a *public* GitHub repo. Pushing would
  publish the ripped sources (LFS), the built GLBs and the embedded models, which this plan says must not be
  redistributed. Ask the user before any push; a private remote or keeping these files out of the pushed
  branch are the options.
  - **Addons.** `game/vendor/three-addons.js` (177 KB) is built by `node game/tools/build-addons.cjs` from
    `three@0.159.0` and `esbuild@0.28.2`, pinned in the new root `package.json` (`npm install` once;
    `node_modules/` is ignored). It carries GLTFLoader, SkeletonUtils, MeshoptDecoder (its WASM is inlined),
    RoomEnvironment, EffectComposer, RenderPass, ShaderPass, OutputPass, UnrealBloomPass, SMAAPass, SSAOPass
    and FXAAShader, attached to `window.THREE`. It loads right after `three.min.js`. `addons.test.cjs` loads
    both scripts the way the page does and checks they share one THREE. `npm test` runs every test.
  - **Model build.** `node game/tools/build-models.cjs [--blender] [--sheets] [--only <villain>]`. Blender is
    looked for in `BLENDER_PATH` **first**, then `PATH`, then the newest `Program Files\Blender Foundation\Blender *`.
    The plan had `BLENDER_PATH` last; an explicit setting should win. The tool's own rebuild of the Rhino was
    byte-identical to the committed GLB. Compression, before → after: Venom 9.92 → 4.58 MB (JSON 1.76 MB),
    Rhino 1.30 → 0.76, Goblin 0.97 → 0.49, glider 0.20 → 0.12, bomb 0.07 → 0.03. Plain prune + dedup +
    meshopt left Venom's JSON at 3 MB: its ~10,000 channels are real motion, not static. The passes, in order:
    1. **bake cubic tracks** to 30 fps linear keys;
    2. **drop channels on bones that move no vertex**. Bones named in the manifest always stay;
    3. **one time grid per clip** for the linear tracks, since Blender's key thinning had given every channel
       its own time accessor;
    4. prune, dedup, then meshopt `high` (quantized; quaternion filter on rotations);
    5. strip default values from the JSON.

    The dropped channels are: Venom's IK, weapon, thorn and `*_Latissimus_04` joints; the Rhino's
    brow, lid, eye and lip bones; and the Goblin's finger and toe ends, `Jaw_Lower` and `Mouth_Corner_L/R`.
    None of them have skin weights, **so the Goblin's roar never could open his jaw** (the mask isn't
    weighted to it). Measured against the uncompressed GLBs, every weighted bone in every clip lands within
    2 mm, except Venom's `hit`.
  - **Venom's `hit` had a real bug, now fixed in the build.** It was the one CUBICSPLINE clip. meshopt's
    quaternion filter mangled its tangents, and underneath that, the source file itself flips `clavicle_r`'s
    quaternion sign between two keys, so the arm snapped 169° in 1/120 s even uncompressed. The build now
    puts spline keys on one hemisphere and bakes them, and the compressed `hit` is smooth. It therefore
    differs from `assets/models/venom.glb` on purpose. The root cause is `bake(..., interp="BEZIER")` in
    `common.py`/`venom_clips.py`, which doesn't keep quaternion keys continuous. Fix it there if the Blender
    side is touched again (the Rhino retargets its `hit` from the same bake).
  - **Embedding.** `node game/tools/embed-models.cjs` writes `js/world/models/<id>.js` (7.96 MB in all;
    Venom 6.1 MB) and `js/world/models/manifest.js` (`window.CharacterManifest`, the only one in a static
    `<script>` tag). Re-run it after editing `characters.json`. `assets/models/dist/` is ignored; the scripts
    hold the same bytes. `.gitattributes` marks the generated scripts `-diff`.
  - **Runtime.** `js/world/rig.js` (`Rig`, UMD, tested) holds manifest validation and model checks, clip
    fallbacks (`Rig.FALLBACKS`), the state machine and speed blending, `Rig.updateEvery`, `Rig.sample` (bone
    matrices to plain `{spots, capsules}`) and `Rig.rayCapsule`. `js/world/characters.js` holds
    `WorldModels.load/create/setRenderer/entry/ids` and `CharacterRig`. Using them:
    - `WorldModels.setRenderer(world.renderer)` once, then `WorldModels.create('venom').then(rig => scene.add(rig.root))`.
    - `rig.play(name, {speed, fade, hold, loop, restart, cut})`.
    - `rig.setSpeed(mps)` with `rig.play('loco')`.
    - `rig.update(dt, distance, onScreen)` returns events: `end`, and `release` for the Goblin's bomb.
    - `rig.sample()` returns plain data, ready for `Fight.snapshot` (C2 stores it).
    - `rig.bone(name)` looks bones up. **GLTFLoader sanitises node names** (`mixamorig:Head` →
      `mixamorigHead`, `TreyarchBiped.Bip01_Head` → `TreyarchBipedBip01_Head`), so always look bones up
      through it with the file's name, as `characters.json` gives it.

    A model loads on first request: its script is injected, decoded and parsed. First-load times on this PC:
    Venom 143 ms, the Rhino 36, the Goblin 30. Preload during the fight's INTRO. One animation frame costs
    0.14 ms for Venom and 0.03 ms for the others. A model that fails logs one `console.warn` and rejects,
    which is the fallback hook.
  - **Decisions to know about.**
    1. The mixer never keeps time. Each frame the rig copies Rig's `{clip, t, w}` into the actions and calls
       `mixer.update(0)`. Non-additive weights always sum to 1, so the rest pose never bleeds into a
       crossfade.
    2. `hit` is additive: `makeClipAdditive` against its own first frame. A hit over a run leaves the run at
       full weight.
    3. A one-shot hands back to the base over its last 0.2 s. With `hold` (for defeat) it stays on its last
       frame until a new base is asked for. An interrupted one-shot never reports `end`. The default fades
       (0.12 s in, 0.2 s out) eat most of a short clip like Venom's `land` (0.29 s), so pass a smaller
       `fade`.
    4. **The villain materials are all metal** (metalness 1 × map), so under only the sun and hemisphere
       light the Rhino came out pitch black. `WorldModels.setRenderer` gives *their* materials a PMREM
       `RoomEnvironment` (`ENV_INTENSITY` 1); the city is untouched. C4 swaps it for the sky's environment.
    5. The manifest gained `speeds` (walk/run ground speeds: Rhino 1.8/7.4 and Venom 1.6/6.5 m/s, both
       **guesses** for C2 to tune against foot slide) and the glider's `loops`. Its `_about` now defines
       offsets: metres along the bone's own axes, rotation only, so the Rhino's 2.0973 scale doesn't stretch
       them. Radii are in metres.
  - **Model viewer** (`js/world/model-viewer.js`; **M** in the city, or `index.html?viewer`). The keys are in
    `game/README.md`. It lays the five models out on level floor, turning you if it must: the spawn corner
    faces off the roof. The Goblin rides his own glider, which spins away on `defeat`. It shows each
    model's measured standing height. In idle that is 1.84 m for the Goblin, 2.26 m for the Rhino and
    2.10 m for Venom; the brutes hunch, and their rest heights are 2.9 and 2.5 m. With all five and every
    overlay it drew 115 calls (about 60 of them debug meshes) at 75 fps in the pane. `window.ModelViewer`
    (`select`, `play`, `loco`, `layout`, `items`) lets a script drive it. `WorldGame.onFrame(fn)` is new,
    for things like it.
  - **Verified.** In the pane over http: all five models load and all 57 clips take over the pose and move
    the bones. The glider follows the Goblin's `defeat`, `H` layers the hit, `L` blends walk into run on one
    phase, and a missing model warns once. The Venom fight still starts and plays, with no model loaded
    unless the viewer asked. **From `file://` in headless Chrome** (a DevTools script driving the real
    `index.html?viewer`, 1280×800): all five load, the WebP textures decode, there are no warnings or errors,
    and a screenshot shows them rendered.
  - **Not verified.** The user's own Chrome from disk, by eye: ask them to open `game/index.html?viewer`
    and step through a few clips. Performance with models in the fights (C2) and at 1080p on an
    integrated GPU.
  - **For C2.**
    - **The weak-spot offsets are all zero** (spheres sit on the bone origins). **The capsule radii look
      too fat** on the Rhino and Venom: the green capsules swallow the whole body. Tune both in the viewer.
    - Attach the glider by adding its `root` under the Goblin's `root`, as the viewer does.
    - Spawn the bomb at `ValveBiped.Bip01_R_Hand` on the `release` event.
    - Lower Venom by ~0.85 m while his leap clips play (see his manifest notes).
- 2026-09-26 — **Session C2 done in code: all three fights use the real models and play to the end; still to be
  played with the real shooter.** 141 tests pass (126 old, several rewritten, plus `villain-anim.test.cjs`).
  - **User decision that overrides this plan: no targets on the villains.** Mid-session the user asked for no
    weak-spot markers and for a hit *anywhere* on the villain to do the damage. So in the 3D fights a shot counts
    if it meets any body capsule (torso, head, upper/lower arms and legs) or passes within the 1.5° aim-assist
    cone of one; the cone opens in 4 steps (`Fight.constants.CONE_STEPS`) so the part nearest the shot's line is
    the one hit. 20 damage, cooldown, the 30 s clock and the dodge are unchanged, and each villain still takes
    its 2D number of hits. The rings and the HUD's "HIT THE ..." are gone. `targetIndex` still counts up inside
    `Combat.judge` but nothing reads it. **CLASSIC (2D) still has its weak spots** — the user was told; ask
    before changing it. The manifest's `weakSpots` (tuned, see below) are now unused by the game; the viewer
    still draws them. Remove them, or use them for something like a head-shot bonus, if the user wants.
  - **Manifest (`characters.json`).** Weak-spot offsets/radii were measured from the skinned vertices of each part
    in the idle pose (checked in the viewer; they sat on chest, head and shoulder). Limbs are split at elbow and
    knee (10 capsules each); a capsule may take a 4th element, an `[x, y, z]` offset past its second bone (the
    head's reaches the crown); radii are measured limb thickness. `speeds` measured from the planted foot: Rhino
    1.7/5.5, Venom 1.5/5.3 m/s. New `shoulders` (upper-arm pair, all three) and `airborne` (Venom: feet, ankle
    0.17 m, the jump/descent clips). Samples now carry bone names. `Rig.rayBody`/`Rig.along` are new.
  - **Fight logic (`fight.js`).** Judged against `s.body` (bone sample) or the snapshot's, so lag compensation
    holds; the sprite path remains only as the fallback. New `arrive` phase before `villain`: an untimed
    entrance, no damage, webs still stick (`ARRIVE`: Goblin 1.7 s roar, Rhino 3.3 s drop-in + flex, Venom 3.4 s
    drop 14 m + land + roar); HUD says GET READY. `s.face` (0 = +z, positive = turning left) with turn rates;
    `s.vel`, `s.turnRate`; `s.dodge = {n, side}` ('l'/'r'/null, the side away from the shot). Rhino states
    turn → windup (first charge only) → run (ACCEL 12) → skid (DECEL 11, stops exactly at the end) → turn round
    (0.9 s, sweeping past the player). Venom: crouch 0.23 s → leap → picks the beam after at take-off and turns to
    it over the last 45% of the leap, so he lands facing it; dodge while perched = 1.8 m dash along a beam across
    his view (`perches[i].beams`, new in `encounters.js`), in the air = leaps sooner.
  - **`villain-anim.js` (new, tested)** turns fight state into clip commands (Goblin fly/fly_turn_l/r by yaw rate
    plus bank/pitch; Rhino entrance, roar, turn_l/r, attack, speed-blended loco, skid; Venom descent_start/loop/
    end, roar, leap_start at 0.6× so its take-off frame (0.14 s) lands on the crouch's end, leap_air, land 0.12 s
    before touchdown; all: hit additive, hit_big when one hit is left, dodge_l/r by side, defeat held, roar on
    time-out). `curve`/`bodyYaw`: every clip's shoulder-line yaw is sampled at load; each clip's average is taken
    out of the root's yaw, and clips that swing > 1 rad (turns, roars, dodges) follow the whole curve — Venom's
    idle stood 53° to his right, Rhino ~20°; now every clip faces within ~10° of `s.face` (measured). `lift` lowers
    Venom so his lowest ankle rides the leap arc (verified: 0.17 m above it mid-air).
  - **Render (`villain-view.js`, new).** Loads the three villains when the city is built; GO waits (button says
    LOADING…) only if a model isn't in yet. A `craft` group per villain carries position, yaw, bank; the glider is
    inside the Goblin's. Samples bones into `fight.body` before `Look.record`, so a snapshot holds the pose that
    frame shows. Hit flash on cloned materials. Defeat: the Goblin tumbles and keeps falling to the floor below,
    the glider detaches and spins away; VICTORY waits 1.8 s (DEFEAT 0.9 s) so it plays. Webs stick to the bone
    under the hit (`webs.js` now cancels a parent's scale, for the Rhino's 2.1×). The Rhino is hidden during his
    INTRO card (he drops in on GO). `villain-sprites.js` is no longer a page script: `actors.js` fetches it only
    when a model fails (verified by forcing the Rhino to fail: one warning, sprite shown, hits count).
  - **Verified** in headless Chrome on this PC's RTX 4070 (a DevTools driver in the session scratchpad, because
    the app's pane was hidden and its screenshots were cropped/stale): each fight's entrance, run/skid/turn,
    leap/land/dodge and defeat, captured as stills; all three fights won through the real `WorldGame.fire` with
    body shots; hits on torso, head, forearm and calves each do 20, a shot 3 m beside does nothing. Also from
    `file://` (Venom fight, all models load, no warnings). 1280×720: 130–164 fps, 29–60 draw calls, ~350–390k
    triangles. CLASSIC still plays with its PNGs. No console errors beyond the known Three.js deprecation.
  - **Not verified.** The real shooter (wrist aim at these sizes and speeds) — ask the user to play all three.
    60 fps on MED at 1080p on an integrated GPU (no MED tier exists yet; C4). Foot slide at the Rhino's dodge
    speed (12.8 m/s, run clip capped at 1.6×).
  - **Constants to tune by feel.** `Fight.constants`: `ARRIVE`, `TURN`, `WINDUP`, `CHARGE_TURN`, `ACCEL`,
    `DECEL`, `CROUCH`, `DASH`, `DASH_T`, `LAND_TURN`, `CONE_STEPS`. `VillainAnim.constants`: `TURN_ON/OFF`,
    `BANK`, `BANK_MAX`, `LEAP_SPEED`/`TAKEOFF`, `LAND_LEAD`, `DROP_LEAD`, `TURNING`. `villain-view.js`: `BOB`,
    `GLIDER_OFF`, `FLASH_MS`. `world-game.js`: `END_MS`. Capsule radii in the manifest set how generous a hit is.
  - **For C3/C4.** The Goblin's bomb (`attack` + `release`) is still unused; no attacks at the player exist yet.
    Rhino `stun`, `idle_fidget` and Venom's `cling_*`/`crawl_*` are unused (the crawl/cling poses are for walls,
    not beam tops). The models are dark under the current light (Rhino especially); that is C4's.

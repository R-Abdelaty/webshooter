# Web Shooter

Open `game/index.html` in a modern browser (straight from disk is fine). **START** takes you into the 3D city for the first encounter, **CONTINUE** picks up at the furthest encounter you have reached, and **TRAINING** opens target practice in the city. **CLASSIC** is the original 2D game described further down.

## The city

You start on the roof of a 196 m tower by the river, looking north-east over a Manhattan-style city about 1.2 km square: brick walk-ups, sandstone apartments, offices and glass towers with setbacks, water tanks and roof plant, three supertall landmarks, avenues with lane markings and crossings, a park of 3 × 6 blocks with autumn trees and a pond, a riverside promenade, and a construction site with a steel frame, scaffolding, brick stacks, tarps and a crane. The city beyond the edges and across the river is backdrop that fades into the haze.

| Control | Does |
| --- | --- |
| Wrist shooter | Look and aim (see LOOK below) |
| Flick | Shoot a web where the crosshair was just before the flick |
| Click the view | Take the mouse for looking (pointer lock); once it has the mouse, a click shoots. While the wrist is aiming, a click shoots straight away |
| Mouse | Look around, crosshair in the middle |
| W A S D or arrows | Walk |
| Shift | Sprint |
| Space | Jump (clears a roof parapet) |
| C | Recentre the wrist's aim |
| Esc | Pause - see the cards below |
| Enter | Press the first button on a card (GO, RESUME, RETRY...) |
| P | Frame rate, draw calls, position, and what the look is doing |
| M | Model viewer (a debug tool): see *Character models* below |

You collide with buildings, parapets, roof plant and site parts, step up kerbs, and fall off roofs (without harm). The river railing and the city edge stop you. Everything is generated from a fixed seed, so the city is the same every time. Nothing is downloaded: Three.js r159 is in `vendor/`, and all textures are drawn on canvases when the city is built. The villains are 3D models kept inside script files (see *Character models*).

### Looking with the wrist

A wrist turns about 80 degrees each way, not 360, so **Settings → CONTROLLER → LOOK** offers two ways to look around. Settings can be opened from the PAUSED card without leaving the city.

- **Edge turn** (the default, as in the Wii shooters). The crosshair follows your wrist over the screen. Inside a box covering the middle 60% of the screen the view stays still, so you aim. Push the crosshair past the box edge and the view turns that way, slowly just past the edge and up to 140 degrees a second sideways (90 up and down) at the screen edge; the crosshair turns cyan while it is turning. Bring the wrist back inside the box and the turning stops. Hold it at the edge to turn all the way round.
- **Direct.** The crosshair stays in the middle. Turning your wrist turns the view twice as far (scaled by SENSITIVITY), and tilting it up or down points the view exactly as high or low as your wrist, up to 75 degrees. This suits a stick for turning the body, which the shooter doesn't have yet.

**TURN SPEED** scales how fast Edge turn turns, **SENSITIVITY** is the same setting as in the classic game (how far the crosshair moves per degree of wrist, and Direct's turn gain), and **FOV** is the vertical field of view, 60-100 degrees (default 75). They are remembered with the other settings. Moving the mouse takes the look from the wrist; turning the wrist takes it back.

The flick itself never moves the view. The web goes where the crosshair was just before the flick, from the view as it was then - in Edge turn the view may already have turned on a little by the time the shot is detected, and the shot allows for that. A web splat sticks to whatever it hits (a wall, a roof, the street, a tree, the water) and fades after six seconds, and a strand flicks out from your wrist at the bottom right for the instant of the shot. The centre prompt works over the city as it does over the menu: until you have set your centre, the wrist does nothing.

## Fights

Three encounters, each placed somewhere in the city with a spot to fight it from, because until the shooter has a stick the wrist can't walk you anywhere. Starting one puts you there facing the action, with an **INTRO** card: **GO** starts it, **FREE ROAM** lets you wander instead, **MENU** leaves.

1. **Green Goblin** (100 HP) swoops in on his glider, taunts you, then circles the roof you start on, dipping, climbing and banking into his turns. You fight from the middle of the roof, so he goes behind you: turn with him.
2. **Rhino** (140 HP) crashes down onto the avenue below and flexes, winds up, then charges up and down it: he speeds up, swerves across the lanes, skids to a stop at each end and turns round to charge back. You perch on the parapet of a low roof above it.
3. **Venom** (180 HP) is at the construction site. First a wave of six masked thugs in black suits: half go down to one hit, half take two. Once they are all down Venom drops onto a beam from high above and roars, then leaps from beam to beam of the steel frame, crouching before each leap and landing facing the next one. You fight from a shipping container in the yard.

There are no targets on the villains: a web that hits him anywhere - body, head, arms or legs - does 20 damage, as a weak-spot hit does in the classic game. A shot that misses him does nothing. You can fire about three times a second, and you have **30 seconds**, which start once the villain has made his entrance (the HUD says GET READY until then; he can't be hurt yet). The thug wave is untimed too. Every shot at the villain, hit or miss, makes it dodge, ducking away from the shot: the Goblin veers and may reverse, the Rhino swerves (and cuts his turn short), and Venom dashes sideways along his beam, or if he is already in the air, leaps on sooner.

The villains are animated 3D models at real size, and what a shot can hit follows their limbs as they move. A shot counts if it passes within 1.5 degrees of him, since a wrist is less steady than a mouse, but not through a wall. A hit makes him flinch (and stagger on the last hit before the end), flashes the view and shakes it, and a web sticks to him and moves with him (or to the thug, who topples over); a miss leaves a web wherever it lands. When he is beaten he goes down - the Goblin is knocked off his glider, which spins away without him - before the VICTORY card comes up. When what you should be shooting at is off the screen, a red arrow at the edge points the way to turn.

As in the classic game, a flicked shot is judged where you aimed just before the flick - including where the villain was then, so a dodge that starts during the flick doesn't make you miss.

The HUD shows the encounter, the villain's health (or the thugs left) and the clock, which turns red for the last ten seconds. **Esc** pauses: RESUME, SETTINGS, FREE ROAM or MENU. Running out of time shows **DEFEAT** (RETRY); beating a villain shows **VICTORY** (NEXT ENCOUNTER), and beating Venom **CITY SAVED** (REPLAY). Every card can be pressed with a flick at the reticle, as on the menu.

**Free roam.** A coloured light column on the street marks where each fight starts: green at the foot of your starting tower (the Goblin), orange by the Rhino's building, purple at the construction site gate (Venom), and cyan at the training roof. Walk into one and its fight begins, taking you up to its spot. Esc in free roam also lists the fights to jump straight to.

## Character models

The villains are rigged, animated 3D models (see `docs/CHARACTERS_PLAN.md`). If one can't be loaded, its fight still plays with the classic game's picture of it instead, and the console says so once. You can look at the models in the city with the **model viewer**: press **M** anywhere in the 3D city, or open `index.html?viewer` to go straight there. The Green Goblin (on his glider), the glider on its own, his pumpkin bomb, the Rhino and Venom stand in a row in front of you at their real size, facing you. If there isn't level floor that way, the row forms where there is and turns you to face it. You can walk round them.

| Key | Does |
| --- | --- |
| [ ] | Pick the previous / next model |
| , . | Play its previous / next clip (one-shots repeat) |
| H | A hit, layered on whatever it is doing |
| L | Walk and run by speed: stopped, walk, between, run, faster |
| O | Body capsules (green, what a shot can hit) and the unused weak spots (coloured spheres), then weak spots only, then neither |
| / | Freeze the clips |
| M | Close (it forms again in front of you next time) |

The three villains load when the city is first built, so each fight's is ready by its GO. One that can't load is reported once in the console and left out. The models are game rips kept for personal use only; don't publish them.

**Rebuilding the models** (for developers). The source files are in `assets-src/characters/` (Git LFS). `tools/blender/<id>.py` turns each one into `assets/models/<id>.glb`, and `assets/models/characters.json` says how the game uses them. One command compresses those and writes the scripts the page loads, `js/world/models/*.js`. These hold the models as base64, because a page opened from disk can't load files.

    npm install                                     (once, in the repo root)
    node game/tools/build-models.cjs                compress and embed
    node game/tools/build-models.cjs --blender      first rebuild the GLBs in Blender
    node game/tools/build-models.cjs --sheets       also re-render docs/reference/clips/
    node game/tools/build-models.cjs --only venom   one character

Blender is found through `BLENDER_PATH`, then `PATH`, then `C:\Program Files\Blender Foundation\`. After editing only `characters.json`, run `node game/tools/embed-models.cjs`. The fallback pictures are the PNGs in `assets/villains/`, kept as data URIs in `js/world/villain-sprites.js` (fetched only if a model fails); after changing a PNG, run `node game/tools/embed-sprites.cjs`. The Three.js loaders come from `vendor/three-addons.js` (see `vendor/README.md`).

## Training (3D)

**TRAINING** puts you on a mid-height roof with targets on the walls and roofs around it, near and far (about 16 to 70 m). One target at a time: hit it and the next appears at least 30 degrees away from the last, so every one is a real re-aim. Far targets are drawn bigger so each is about the same size on screen. There is no clock and nothing to lose; the HUD shows hits, shots, accuracy, best streak and the current streak.

## Classic

Press **CLASSIC**, then **Go**. Move the mouse to aim; left-click or Space fires. Escape pauses, the **← MENU** button in the HUD quits to the menu at any time, C recentres aim, and the Controller settings provide wrist axes, inversion, sensitivity, and a visible Center Aim action. The classic INTRO card also has **TRAINING**, the classic target practice below.

The arena is fixed: `bavkghround.webp` is cover-cropped at a 72% vertical focal point. The villain stays one size and roams the arena between waypoints, breaking into a faster dodge for a moment each time you take a shot at it — so the weak spot moves and you have to track it. The background and camera stay still.

Each encounter is a **30 second** round: Green Goblin (100 HP), Rhino (140 HP), then Venom (180 HP). Difficulty comes from health and from how fast each one moves, not from the clock. Letting the timer reach zero loses the round, and the countdown in the HUD turns red for the last ten seconds. Only the villain has a health bar. Each highlighted weak-spot hit deals 20 damage.

## Setting your centre

Opening the page asks you to set a centre before anything responds to the wrist. Point the shooter at the dot in the middle of the screen, hold it still, and confirm - by flicking, by pressing Space, or by clicking the button. That pose becomes the origin: the reticle is put in the middle and every later movement is measured from there.

It has to be declared rather than measured, because a gyro reports how fast the wrist is turning and never where it is pointing. The resting reading is taken as the gyro's zero at the same time, which is the best look at its offset available - the wrist is being held still precisely then. A reading taken mid-movement is refused, so a confirm while swinging cannot bake a moving value in as the zero.

It is asked for once per visit and deliberately not remembered: the board is picked up at a different angle each time, so a stored origin would be wrong. Starting a round keeps it - it is per visit, not per round.

## After a shot

The shot lands, and the reticle goes back to, where you were aiming just before the flick. The shooter reports that itself (`preYaw`/`prePitch` in the `shoot` packet), and marks the rest of the snap so it never reaches the aim. Vertical is absolute - it is your wrist's pitch against gravity - so once the snap is over the reticle's height is simply where your wrist points again; nothing piles up over a round. It applies to a flick on the menu too, where the same gesture presses a button.

## Running off the edge

The aim is allowed to overflow past the screen edges rather than stopping dead at them. Pinning it to the screen destroyed the overshoot - your wrist kept turning, the number could not, and the way back started from the edge instead of from where the wrist actually was, so every touch of an edge shifted the middle a little further. Overflowing keeps wrist and screen in step: sweeping out past an edge and back the same amount lands on the centre again, however far past you went.

While the aim is off the screen a red marker lights the edge it went off, sliding along that edge to its other coordinate - so it shows the direction and the spot, not just that it is gone. It works on the menu, on the cards and in a round alike, and is hidden in flick-only mode, which hides where the aim is on purpose. The overflow is capped at half a screen past each edge so a long spin cannot leave you winding it back for ever.

## Aiming the menu

The menu uses the game's reticle instead of the mouse pointer, and the shooter drives it: turn your wrist to move it over a button and flick to press. The mouse still works exactly as before - both write to the same position, so whichever you moved last is where the reticle is, with no mode to switch. Whatever the reticle is resting on lifts the way a hover does, so you can see what a flick is about to press, and disabled buttons ignore it.

It stays live on the cards that interrupt a round too - INTRO, PAUSED, DEFEAT, VICTORY - so you can flick at **GO** or **Retry** without reaching for the mouse. It hides only while you are actually playing, where the canvas draws its own reticle.

## Classic training

**TRAINING** on the classic INTRO card is endless target practice on the menu artwork - no villain, no clock, nothing to lose. One target at a time; hit it and the next appears somewhere else, always at least 30% of the screen away so it is a real re-aim rather than a nudge. The HUD tracks hits, shots, accuracy and your current streak. Escape or **← MENU** leaves.

It shares the reticle, the firing path and the web splats with the encounters, so practice behaves exactly like play.

A shot leaves a white orb-web splat stuck where it landed. Webs accumulate, fade out near the end of their six seconds, and the oldest is dropped once fourteen are on screen. The outside menu uses `assets/menu-background.png`.

## Tests

From the repository root:

```sh
node --test game/tests/*.test.cjs
```

## Wrist controller

Flash `web_shooter/web_shooter.ino` to the ESP32. Wire SCL to the pin named by `PIN_SCL` and SDA to `PIN_SDA_WIRED` in the sketch (21 and 33 are tried as SDA fallbacks, and the serial log prints each pin it probes). Copy `web_shooter/secrets.example.h` to `secrets.h` for your WiFi. Keep the sensor still once it has joined the WiFi, while it calibrates the gyro - the LED blinks slowly until it has a still second.

Then connect the page to it, either way:

**Over the USB cable** (no network needed; Chrome or Edge): close the Arduino serial monitor, open Settings and press **CONNECT USB**, then pick the ESP32's port. The browser remembers it, so next time the page connects on its own; **RECONNECT** switches back to WiFi.

**Over WiFi:**

1. Open the serial monitor at 460800. The sketch prints the address to use, either `ws://192.168.x.x:81` on your WiFi or `ws://192.168.4.1:81` on its own **WEBSHOOTER** hotspot.
2. Open Settings in the game and type that address (host only — `192.168.4.1` is enough) into **SHOOTER ADDRESS**, then press **RECONNECT**. The address is remembered. `webshooter.local` also works if your machine does mDNS; `?host=192.168.4.1` in the URL overrides it for one session.
3. The status line under CONTROLLER says what is happening and what to try next.

**AIM** chooses between *Tracking* (the reticle follows your wrist) and *Flick only* (no reticle at all - the aim still follows your wrist underneath, so the web lands where you are pointing, you just cannot see where that is until you shoot).

The shooter fuses its gyro and accelerometer and sends where your forearm points: yaw (sideways, summed from every sample on the device, so a late packet loses nothing) and pitch (up and down, measured against gravity, so it cannot drift). Rolling the board on your wrist does not matter; a sideways sweep stays level. Packets come 100 times a second and the reticle is drawn between them at the display's own rate, a few milliseconds behind the true aim - shots and button presses always use the true aim. Horizontal position follows the running yaw relative to the confirmed centre. A fast flick and slow return therefore end at the same screen position when the wrist returns to the same heading. Older rate-only firmware uses a soft dead zone (`SOFT_DEAD_DPS`) to reduce tremor without cutting off small corrections.

A flick contributes nothing to the aim. The shooter flags the packets during a flick and says where you were aiming before it, and the aim is put back there when the shot lands. Older firmware that only sends rates still works: the page falls back to integrating them and guessing the flick from its speed, and says in the `D` readout that a reflash would help.

Vertical is geared about twice as high as horizontal. The gain asks for roughly 125 degrees of rotation to get from the centre of the screen to an edge, which forearm rotation covers easily but wrist extension does not - the joint only gives 55-70 degrees upward, so the top of the screen was out of reach. `VERTICAL_GAIN` in `js/controller.js` is the number to change if the top is still short.

Starting a round recentres sideways but keeps the centre pitch and what the controller has measured about the hardware. Gyro drift is tracked on the shooter itself, whenever it is at rest; press `D` in a round to see the angles it reports.

Aiming switches from mouse to wrist on its own as soon as you turn your wrist, and moving the mouse takes it back. **HORIZONTAL** and **VERTICAL** name the board axes you turn about with the board strapped on; the one left over is the axis along your forearm, and the page tells the shooter which it is when it connects. **INVERT VERTICAL** and **INVERT HORIZONTAL** flip a direction if it runs the wrong way (with current firmware, sideways is already right-is-right however the board is strapped). Center Aim (or `C`) recentres. Disconnecting keeps mouse aiming available.

Note: the page must be opened from disk or over plain `http`. A page served over `https` cannot open a `ws://` socket, and the status line will say so.

See `../web_shooter/BUILD.md` for the physical checklist.

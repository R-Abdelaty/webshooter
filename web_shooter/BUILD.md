# Web Shooter — hardware build

Wrist-mounted flick detector. An IMU on your wrist spots the snap and the
ESP32 broadcasts `aim` and `shoot` events over WiFi that the game page listens
for.

## Parts

| # | Part | Notes | ~$ |
|---|------|-------|----|
| 1 | **ESP32 dev board** (ESP32-WROOM-32, 30/38-pin DevKit) | Same board as the video. WiFi is the whole point — a plain Arduino Nano can't do this. | 6–10 |
| 1 | **MPU-6050** *(or MPU-6500 / MPU-9250 / MPU-9255)* | The blue module in the video is an MPU-9250/6500/9255. The code talks to the raw registers, so any of them work unchanged. MPU-6050 is the cheapest and is plenty. | 3–5 |
| 1 | **Half-size breadboard** (400 pt) | 830-pt full size like the video also fine, just heavier on the wrist. | 2 |
| ~8 | **Male–male jumper wires** | | 2 |
| 1 | **Power**: USB cable to a laptop, or a small USB power bank, or 18650 + TP4056 + MT3608 | Start with the USB cable — get it working before you make it wireless. | 0–8 |
| — | **Velcro strap / wide elastic band / gaffer tape** | Video uses green tape over the breadboard's sticky back. | 1 |

Total: roughly $14–24, and a starter kit probably already has the
breadboard and wires.

### Optional upgrades once it works
- **ESP32-C3 SuperMini** or **XIAO ESP32-C3** — thumbnail-sized, same code, much
  nicer on a wrist than a DevKit.
- **LiPo 500 mAh + TP4056 charger** — makes it fully untethered.
- **Second button** for a "reload"/manual-fire so you can test without flicking.

## Wiring

Everything runs at 3.3 V. Do **not** feed the IMU 5 V on a 3.3 V-only breakout;
most modules have a regulator, but 3V3 is always safe.

```
  ESP32                  MPU-6050 / 9250
  -----                  ---------------
  3V3  ----------------- VCC
  GND  ----------------- GND
  GPIO 22 -------------- SCL      (this is `PIN_SCL` in the sketch - change
                                   the constant if you move it)
  GPIO 23 -------------- SDA      (this is `PIN_SDA_WIRED`; 21 and 33 are
                                   tried as a fallback)
  GND  ----------------- AD0      (or leave AD0 unconnected -> I2C addr 0x68)
                          XDA, XCL, INT -> leave empty

```

That is the entire circuit — four wires, no resistors, nothing else.

## Build order

1. **Breadboard it flat on the desk first.** Don't strap anything to your arm
   until the serial monitor prints `SHOOT`.
2. Install the ESP32 board support: Arduino IDE → *File ▸ Preferences ▸ Additional
   Board Manager URLs* → `https://espressif.github.io/arduino-esp32/package_esp32_index.json`,
   then *Tools ▸ Boards Manager* → install **esp32** by Espressif.
3. Install the library: *Tools ▸ Manage Libraries* → search **WebSockets** →
   install the one by **Markus Sattler** (`arduinoWebSockets`). This is the only
   library the sketch needs.
4. Open `web_shooter.ino`, select *Tools ▸ Board ▸ ESP32 Dev Module*, pick the COM
   port, upload. If upload fails, hold **BOOT** while it says "Connecting…".
5. Open the serial monitor at **460800** (the speed the USB link needs; at 115200 you will only see garbage). You should see:
   - `IMU found at 0x68 on SDA=GPIO23 SCL=GPIO18, WHO_AM_I = 0x68` (whatever
     `0x70`/`0x71`/`0x73` are fine too)
   - `I2C at 400 kHz, sampling at 500 Hz` — or `100 kHz ... 250 Hz` if the
     wiring can't take the faster bus. Both work.
   - a `ws://…:81` address
   - `Hold still, calibrating gyro...`, then `still (spread ...)` and the bias
     line. The LED blinks slowly while it waits for you to hold still.
6. Flick your wrist. The onboard LED blinks and the serial monitor prints
   `{"event":"shoot",...}`.
7. Only now: strap it on. IMU near the wrist bone, board and battery further up
   the forearm so the weight isn't on the joint.

## WiFi

Credentials live in `secrets.h` next to the sketch. It is in `.gitignore`, so
your password never lands in the repo. Copy `secrets.example.h` to `secrets.h`
and fill it in. Without a `secrets.h` the sketch still builds, and runs as a
hotspot.

- Leave `WIFI_SSID_SECRET` empty and the ESP32 makes its own hotspot
  **WEBSHOOTER** (password `thwipthwip`). Good for demos away from your router.
- Fill in your home WiFi and it joins that instead, which lets the laptop
  running the game page stay online. Note: ESP32 is 2.4 GHz only — it will not
  see a 5 GHz-only network.
- Either way it is reachable at `ws://webshooter.local:81` or the printed IP.
- WiFi power save is switched off (`WiFi.setSleep(false)`) in both modes. Modem
  sleep holds packets back and releases them in bursts, which was most of the
  reticle's stutter.

## Tuning the flick

A flick is a sharp snap about **one** axis, not just "anything fast". The old
total-rotation-speed test fired on quick sideways aim swings. Every threshold
is a named constant near the top of the sketch. Set `TUNE_MODE = true`, reflash,
and it prints the detector's inputs next to each threshold 20 times a second:

```
flick=842 (on>260 off<120) rise20ms=610 (>150) g=3.41 (>0.0) gx=-842 gy=35 gz=-60 yaw=12.3 pitch=-4.1
```

| Constant | Default | What it does |
|---|---|---|
| `FLICK_AXIS` | `0` (X) | The gyro axis the snap happens about. Flick while watching `gx= gy= gz=`: the one that spikes is it |
| `FLICK_SIGN` | `0` (either) | `+1` or `-1` to accept only the direction your flick shows in TUNE_MODE, so an upward snap can't fire |
| `FLICK_ON` | 260 °/s | Rate on the flick axis to fire. Raise it if it fires while you move about, lower it if you have to snap hard |
| `FLICK_RISE_DPS` / `FLICK_RISE_MS` | 150 °/s in 20 ms | The rate must also have **risen** this fast. A flick hits full speed in ~30 ms; an aim swing takes ~100 ms to build even when it is fast. This is what stops fast aiming from firing |
| `FLICK_MIN_G` | 0 (off) | Optionally also require an acceleration spike, e.g. 2.5 g, if aiming still fires shots |
| `FLICK_OFF` | 120 °/s | Must fall below this to re-arm |
| `SHOT_COOLDOWN_MS` | 350 | Minimum time between shots. Raise it if one flick double-fires |
| `PRE_FLICK_MS` | 80 | The shot lands where you were aiming this long before the flick began |

A resting hand is under 30 °/s, a normal gesture 100–200, a real flick 600–1500.

## Tuning the aim

The board runs a Mahony filter: the gyro for rotation, the accelerometer for
which way is down. Aim comes from where the **forearm points**, its heading
round the horizon (yaw) and its elevation (pitch), not from any single gyro
axis. So rolling the board on your wrist changes nothing, and a sideways sweep
stays level.

| Constant | Default | What it does |
|---|---|---|
| `AIM_HZ` | 100 | Aim packets per second |
| `fwdAxis` | Y | Board axis that points along the forearm. The page sends it at connect (`fwd=x`, `fwd=y` or `fwd=z`), worked out from its HORIZONTAL/VERTICAL settings, so re-strapping needs no reflash |
| `MAHONY_KP` | 1.0 | How hard gravity pulls pitch back into line (~1 s). Higher corrects faster but lets arm acceleration tilt the aim |
| `ACC_GATE_G` | 0.15 g | Accelerometer correction fades out as the total acceleration leaves 1 g, and is gone during a flick |
| `MOTION_GATE_DPS` | 40 °/s | ...and fades as rotation speeds up (half strength here), so a sweep's centripetal pull can't bleed into pitch |
| `CAL_MAX_STD_DPS` / `CAL_TIMEOUT_MS` | 1 °/s, 15 s | Boot calibration retries until the gyro is this still, then gives up and uses the stillest second |
| `BIAS_STILL_DPS` / `BIAS_STILL_MS` / `BIAS_TAU_S` | 2 °/s, 1 s, 10 s | While running: once every axis has been under 2 °/s with a steady accelerometer for 1 s, the bias creeps toward the reading |

Samples are read on the IMU's data-ready flag (`INT_STATUS`), each exactly once,
and integrated with the measured time since the previous one. A slow
`webSocket.loop()` then holds the last rate across the gap instead of losing it.
The gyro DLPF is ~44 Hz; on the 6500/9250 the accelerometer gets its own ~44 Hz
filter too (`ACCEL_CONFIG2`). `Wire.setTimeOut(5)` stops a bus glitch from
freezing the loop, and if samples stop for 500 ms the IMU is re-initialised.

## What the ESP32 sends

Everything is broadcast to all WebSocket clients on port 81.

On connect:

```json
{"event":"hello","device":"webshooter","capabilities":["aim","shoot","angles"]}
```

The page reads `capabilities` to decide whether this firmware can aim. Without
`aim` the menu reports the firmware as out of date and only shots get through.
`angles` means the aim packets carry fused angles.

100 times a second (~120 bytes):

```json
{"event":"aim","seq":812,"ms":20310,"dyaw":0.420,"dpitch":-0.100,"yaw":12.30,"pitch":-4.10,"gx":-12.4,"gy":3.1,"gz":42.0}
```

| Field | Meaning |
|---|---|
| `dyaw`, `dpitch` | Degrees turned since the previous packet, summed on the device from every sample. Yaw is positive to the right, pitch positive up |
| `yaw` | Running heading, degrees. Relative (there is no compass), so it drifts slowly; that is expected. Used to resync after a gap |
| `pitch` | Elevation above the horizon, degrees. Absolute: gravity pins it, so it does not drift |
| `gx`, `gy`, `gz` | Average body rates over the interval, °/s: the debug readout, and older pages |
| `flick` | Present and `true` while a flick is in progress: shooting, not aiming |
| `seq`, `ms` | Let the page drop packets that arrive late or out of order, and spot gaps |

On every flick, **the moment it is detected**, with no wait for the peak:

```json
{"event":"shoot","seq":7,"ms":20287,"preYaw":12.10,"prePitch":-3.90}
```

`ms` is when the flick started, on the same clock as the aim packets.
`preYaw`/`prePitch` are the fused angles `PRE_FLICK_MS` before that, from a ring
buffer on the device. That is exactly where you were aiming, so the page shoots
there without rewinding anything. The aim packet just before `shoot` is the last
unflagged one; the ones after it carry `"flick":true` until the snap settles.

`PEAK_WINDOW_MS` (60 ms) later, how hard it was:

```json
{"event":"shot_info","seq":7,"dps":842,"g":3.4}
```

`ping` gets `{"event":"pong"}`. `fwd=x`, `fwd=y` or `fwd=z` sets the forearm axis.

## Connecting the game over USB (no network)

The game can read the shooter straight down the USB cable, with no WiFi
network in common — the laptop stays on its normal WiFi and keeps its internet.

1. Plug the ESP32 into the laptop. **Close the Arduino serial monitor** — only
   one program can hold the port at a time.
2. Open `game/index.html` in **Chrome or Edge** (other browsers have no Web
   Serial), from disk or `http://localhost`.
3. **SETTINGS → CONNECT USB**, and pick the ESP32's port (`CP210x`, `CH340` or
   `USB Serial`) in the browser's list. The status line should say *Connected
   over USB. Aiming and shooting.*

The browser remembers the port: next time the page opens it connects on its
own. Unplugging and plugging back in reconnects too. **RECONNECT** switches back
to WiFi.

Opening the port can restart the board on some dev boards. If it does, hold
still for a few seconds while it calibrates — the page waits for it.

How it works: the page sends `hello` down the port, and from then on the
shooter prints the same JSON packets it would send over WiFi, one per line,
between its ordinary log lines. The page pings every half second; after 3 s of
silence the shooter stops streaming, so the serial monitor is readable again.
The port runs at `SERIAL_BAUD` (460800): 100 packets a second will not fit
through 115200.

## Connecting the game over WiFi

1. Serial monitor at 460800 — the sketch prints its address on boot.
2. Open `game/index.html`, go to **SETTINGS**, and type that address into
   **SHOOTER ADDRESS**. Host only is fine (`192.168.4.1`); port 81 is assumed.
   Press **RECONNECT**. It is remembered for next time.
3. The line above the field reports the state of the link.

On the ESP32's own hotspot the address is always `192.168.4.1`. On your router
it is whatever the serial monitor printed. `webshooter.local` only works if your
machine resolves mDNS — many Windows installs do not, which is why the address
is typed rather than assumed.

The page has to be opened from disk or over plain `http`. A page served over
`https` is not allowed to open a `ws://` connection, and it fails silently.

## Playing with it

Once the page says it is aiming, set your centre (point at the dot, hold
still, flick). In the 3D city the shooter does two jobs:

- **Looking.** With **LOOK → Edge turn** (the default), the crosshair follows
  your wrist over the screen, and pushing it past the edge of the middle box
  turns the view that way, so you can turn all the way round with a wrist that
  only turns about 80 degrees each way. **Direct** turns the view with the
  wrist instead. `game/README.md` has the details.
- **Firing.** A flick shoots a web where the crosshair was just before the
  flick, from the view as it was then (the `shoot` packet's `preYaw`/`prePitch`
  and the flagged flick packets are what make that work). The flick itself
  never turns the view.

The shooter can't walk you anywhere yet (that needs the analog stick in
`docs/3D_PLAN.md`), so each fight puts you at a spot to fight it from. The
cards (GO, RETRY, and so on) are pressed with a flick at the reticle, like the
menu. CLASSIC, the original 2D game, works the same way on a fixed screen.

## Testing without the website

In any browser, open devtools console on any page and run:

```js
const ws = new WebSocket("ws://192.168.4.1:81"); // or whatever it printed
ws.onmessage = (e) => console.log(e.data);
```

Flick your wrist and the events print in the console.

## Troubleshooting

| Symptom | Cause |
|---|---|
| LED blinks fast forever at boot | IMU not found — check SDA/SCL aren't swapped, IMU has 3V3 and GND, module is fully seated in the breadboard |
| `WHO_AM_I = 0xFF` or `0x00` | Same as above. The sketch tries both addresses (0x68 and 0x69), and SDA on 23 then 21 and 33 — wired somewhere else, set `PIN_SDA_WIRED` to that pin. The serial log prints each pin it probes |
| Game says `NO SHOOTER AT ...` | Wrong address in SETTINGS, or the laptop is on a different network than the ESP32 — the serial monitor prints the right one |
| Game says `BLOCKED` | The page is being served over `https`; open `index.html` from disk or over plain `http` |
| Connected, but the reticle never moves | Old firmware — reflash. The menu says so explicitly when the device does not advertise `aim` |
| Fires constantly | `FLICK_ON` too low, or a loose IMU rattling in the breadboard |
| Fires when you aim fast | Raise `FLICK_RISE_DPS`, set `FLICK_SIGN` to your flick's direction, or set `FLICK_MIN_G` to about 2.5 |
| Never fires | Wrong `FLICK_AXIS` or `FLICK_SIGN`: watch `TUNE_MODE` while you flick. Or `FLICK_ON`/`FLICK_RISE_DPS` is too high |
| In the 3D city the view keeps turning, or won't turn far enough | Press **C** (or CENTER AIM) to recentre with the wrist pointing at the screen. Lower or raise **TURN SPEED**, or try **LOOK → Direct** |
| Reticle moves diagonally, or up/down and sideways are swapped | The game's HORIZONTAL/VERTICAL settings decide which board axis is the forearm; check them against how the board is strapped |
| Calibration keeps printing `moving` | Put the board down or hold still. After 15 s it gives up and uses the stillest second |
| Upload fails | Hold BOOT during "Connecting…", try a different USB cable (many are charge-only) |
| CONNECT USB says the port is in use | Close the Arduino serial monitor (or any other program holding the COM port) and press CONNECT USB again. The same goes the other way: uploading needs the game page closed or switched to WiFi |
| CONNECT USB opens but never says *Aiming* | Old firmware (it can't talk over USB) — reflash. Or the board is still calibrating after a restart: hold it still |
| Serial monitor shows garbage | Set it to 460800 |

# Web Shooter — hardware build

Wrist-mounted flick detector. An IMU on your wrist spots the snap, a piezo
makes the *thwip*, and the ESP32 broadcasts a `shoot` event over WiFi that the
game page will listen for later.

## Parts

| # | Part | Notes | ~$ |
|---|------|-------|----|
| 1 | **ESP32 dev board** (ESP32-WROOM-32, 30/38-pin DevKit) | Same board as the video. WiFi is the whole point — a plain Arduino Nano can't do this. | 6–10 |
| 1 | **MPU-6050** *(or MPU-6500 / MPU-9250 / MPU-9255)* | The blue module in the video is an MPU-9250/6500/9255. The code talks to the raw registers, so any of them work unchanged. MPU-6050 is the cheapest and is plenty. | 3–5 |
| 1 | **Passive piezo buzzer** (the small black cylinder) | Passive = you feed it a frequency, so you get a falling *thwip* instead of one flat beep. An active buzzer works too — flip `BUZZER_IS_ACTIVE` to `true`. | 1 |
| 1 | **Half-size breadboard** (400 pt) | 830-pt full size like the video also fine, just heavier on the wrist. | 2 |
| ~8 | **Male–male jumper wires** | | 2 |
| 1 | **Power**: USB cable to a laptop, or a small USB power bank, or 18650 + TP4056 + MT3608 | Start with the USB cable — get it working before you make it wireless. | 0–8 |
| — | **Velcro strap / wide elastic band / gaffer tape** | Video uses green tape over the breadboard's sticky back. | 1 |

Total: roughly $15–25, and a starter kit probably already has the buzzer,
breadboard and wires.

### Optional upgrades once it works
- **ESP32-C3 SuperMini** or **XIAO ESP32-C3** — thumbnail-sized, same code, much
  nicer on a wrist than a DevKit.
- **LiPo 500 mAh + TP4056 charger** — makes it fully untethered.
- **Vibration motor** on a spare GPIO through an NPN transistor, for recoil kick.
- **Second button** for a "reload"/manual-fire so you can test without flicking.

## Wiring

Everything runs at 3.3 V. Do **not** feed the IMU 5 V on a 3.3 V-only breakout;
most modules have a regulator, but 3V3 is always safe.

```
  ESP32                  MPU-6050 / 9250
  -----                  ---------------
  3V3  ----------------- VCC
  GND  ----------------- GND
  GPIO 22 -------------- SCL
  GPIO 33 -------------- SDA
  GND  ----------------- AD0      (or leave AD0 unconnected -> I2C addr 0x68)
                          XDA, XCL, INT -> leave empty

  ESP32                  Buzzer
  -----                  ------
  GPIO 25 -------------- +  (longer leg / marked pin)
  GND  ----------------- -
```

That is the entire circuit — no resistors, no transistor, nothing else. A small
piezo draws only a few mA so it can hang straight off the pin.

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
5. Open the serial monitor at **115200**. You should see:
   - `IMU WHO_AM_I = 0x68` (or `0x70`/`0x71`/`0x73` — all fine)
   - the gyro bias line
   - a `ws://…:81` address
   - one boot chirp from the buzzer
6. Flick your wrist. You get a *thwip*, the onboard LED blinks, and the serial
   monitor prints `{"event":"shoot",...}`.
7. Only now: strap it on. IMU and buzzer near the wrist bone, board and battery
   further up the forearm so the weight isn't on the joint.

## WiFi

- Leave `WIFI_SSID` empty and the ESP32 makes its own hotspot **WEBSHOOTER**
  (password `thwipthwip`). Good for demos away from your router.
- Fill in your home WiFi and it joins that instead, which lets the laptop
  running the game page stay online. Note: ESP32 is 2.4 GHz only — it will not
  see a 5 GHz-only network.
- Either way it is reachable at `ws://webshooter.local:81` or the printed IP.

## Tuning the flick

`FLICK_ON` is the one number you'll actually touch:

- Firing when you just walk around or type → **raise** it (400, 500).
- Have to snap hard enough to hurt → **lower** it (250, 200).

To pick it properly, set `TUNE_MODE = true`, reflash, and watch the `dps=`
numbers: resting hand is under 30, a normal gesture 100–200, a real flick
600–1500. Put `FLICK_ON` roughly halfway between your biggest accidental value
and your smallest deliberate flick.

`FLICK_OFF` and `SHOT_COOLDOWN_MS` stop a single flick registering three times —
raise the cooldown if one flick still double-fires.

## What the ESP32 sends

Every shot, broadcast to all WebSocket clients on port 81:

```json
{"event":"shoot","seq":7,"dps":842,"g":3.4}
```

`dps` is the peak rotation speed and `g` the acceleration, so the web page can
make a hard flick shoot a bigger web. On connect the device sends
`{"event":"hello","device":"webshooter"}`, and `ping` gets `{"event":"pong"}`.

That's the contract the game page will be built against — the site just opens a
WebSocket and draws a web each time `shoot` arrives.

## Testing without the website

In any browser, open devtools console on any page and run:

```js
const ws = new WebSocket("ws://webshooter.local:81");
ws.onmessage = (e) => console.log(e.data);
```

Flick your wrist and the events print in the console.

## Troubleshooting

| Symptom | Cause |
|---|---|
| LED blinks fast forever at boot | IMU not found — check SDA/SCL aren't swapped, IMU has 3V3 and GND, module is fully seated in the breadboard |
| `WHO_AM_I = 0xFF` or `0x00` | Same as above; also try `MPU_ADDR = 0x69` if AD0 is wired to 3V3 |
| Buzzer silent | Reversed legs, or it's an active buzzer — set `BUZZER_IS_ACTIVE = true` |
| Buzzer is one flat tone | It's an active buzzer; same fix |
| Fires constantly | `FLICK_ON` too low, or a loose IMU rattling in the breadboard |
| Never fires | `FLICK_ON` too high, or the IMU was moving during the boot calibration — hold still for the first second after reset |
| Upload fails | Hold BOOT during "Connecting…", try a different USB cable (many are charge-only) |

## Web Shooter aiming checklist

1. Wire **SDA to GPIO33** and **SCL to GPIO22**, then flash `web_shooter.ino`.
2. Keep the sensor still through startup calibration and confirm the game shows aiming support.
3. In game Settings, select Wrist, set axes/inversion for the mounting, then Center Aim.
4. Sweep slowly in each direction, flick at a weak spot, and confirm the shot uses the pre-flick reticle location.
5. Disconnect the controller and confirm mouse aiming remains available.

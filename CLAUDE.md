# Spider-Man Web Shooter Game

Recreating a project from a video ("Day 15 of Learning Electronics — LET'S MAKE
WEB SHOOTERS"): a wrist-mounted device detects a wrist flick and a web appears
on a website on the screen behind you.

## Hardware (built first, by request)

Breadboard strapped to the wrist:

- **ESP32 DevKit (WROOM-32)** — brain + WiFi
- **MPU-9250 / 6500 / 9255 IMU** (MPU-6050 works identically) — gyro detects the flick
- **Passive piezo buzzer** — the *thwip*

Wiring: IMU VCC→3V3, GND→GND, SCL→GPIO22, SDA→GPIO33, AD0→GND. Buzzer +→GPIO25, −→GND.

## Status

- `web_shooter/web_shooter.ino` — firmware. Written, **not yet compiled or flashed.**
- `web_shooter/BUILD.md` — parts list, wiring, build order, tuning, troubleshooting.
- The web game — **not started yet.** This is the next piece of work.

## The contract between firmware and web page

ESP32 runs a WebSocket server on **port 81**, reachable at `ws://webshooter.local:81`
(or its IP). It joins the WiFi in the sketch, or falls back to its own hotspot
`WEBSHOOTER` / `thwipthwip`.

On each detected flick it broadcasts:

```json
{"event":"shoot","seq":7,"dps":842,"g":3.4}
```

`dps` = peak rotation speed, `g` = peak acceleration — both there so a harder
flick can shoot a bigger web. Also sends `{"event":"hello","device":"webshooter"}`
on connect, and replies `{"event":"pong"}` to a `ping`.

The web page just opens a WebSocket and draws a web each time `shoot` arrives.

## Working notes

- User is learning electronics and wants things explained from first principles —
  beginner-level detail is welcomed, not patronising.
- Flick detection tuning lives at the top of the sketch: `FLICK_ON` (320 °/s) is
  the main knob; `TUNE_MODE = true` prints live gyro numbers for calibrating it.
- Only external library: **WebSockets** by Markus Sattler. Board: esp32 by Espressif.

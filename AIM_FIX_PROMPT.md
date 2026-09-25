# Task: make the Web Shooter aiming smooth and accurate

You are working in a repo with two parts that talk over a WebSocket:

- `web_shooter/web_shooter.ino` — ESP32 + MPU-6050/6500/9250 on I2C. Reads the IMU, sends `aim` packets (gyro rates in deg/s) at 40 Hz and a `shoot` event on a wrist flick.
- `game/js/controller.js`, `game/js/menu.js`, `game/js/shooter-link.js`, `game/js/menu-aim.js`, `game/js/game.js` — browser game. `controller.js` turns the rates into a reticle position by integrating them over time.
- Tests: `game/tests/game.test.cjs` (run with `node game/tests/game.test.cjs`). Keep them passing and update or add tests for anything you change.

Right now the reticle lags, stutters, drifts, and cross-couples: a sideways move also drifts up or down. Fix the causes listed below. Keep the existing I2C pin/address auto-detection, the WiFi/hotspot fallback, mDNS, the `hello` handshake and the heartbeat as they are. Don't rewrite things that work.

## Root causes to fix (firmware)

1. **WiFi power save adds latency spikes and bursty delivery.** Call `WiFi.setSleep(false)` after WiFi starts, in both station and AP mode. This one matters most for smoothness.

2. **The page gets rates, not motion, so any gap loses movement.** Integrate on the ESP32 instead. On every IMU sample, take the real `dt` from `micros()` and add up the rotation since the last packet. Send those accumulated angle deltas, in degrees, in each aim packet, then reset them to zero. Nothing is lost between packets that way, and dropped or late packets can't bend the path. Also send a running absolute yaw and pitch so the page can recover after a gap.

3. **Rotation isn't in a gravity-referenced frame (cross-coupling and vertical drift).** Add a lightweight sensor-fusion filter on the ESP32: Mahony or Madgwick, or a well-tuned complementary filter. Use the accelerometer for gravity and the gyro for rotation, and output:
   - `yaw`: rotation about the gravity vector (world vertical). It drifts slowly, and that's expected.
   - `pitch`: elevation relative to gravity. It's absolute, so it must not drift.
   - `dyaw`, `dpitch`: deltas since the last packet.

   Horizontal aim must use rotation about gravity, not a raw sensor axis. Then strapping the board at any roll angle still gives clean horizontal and vertical motion. Don't let accelerometer correction act during high-g moments like a flick: gate it when `|a|` is far from 1 g.

4. **The sampling loop is aliased against the IMU's own clock.** The loop gates on `micros() - lastSample < 5000`, then sets `lastSample = micros()`, so it drifts and can read the same sample twice or skip one. Either:
   - read on the data-ready flag (INT_STATUS 0x3A bit 0), or use the FIFO, or
   - raise the IMU output rate (for example SMPLRT_DIV=0 with DLPF 0x03, giving a 1 kHz internal rate) and integrate with the measured `dt` each read.

   `webSocket.loop()` and `broadcastTXT` must never stall integration. If they block, integrate with the true `dt` anyway, or drain the FIFO.

5. **Too much smoothing adds lag.** The DLPF, the ESP's EMA (`AIM_SMOOTH`) and the page's 40 ms EMA are stacked, and together with the 25 ms packet interval that's about 80–100 ms of lag. Remove the ESP-side rate EMA once you integrate angles. Keep DLPF 0x03 (≈44 Hz) or 0x02 (≈94 Hz). Raise `AIM_HZ` to 100. At 100 Hz, JSON over WebSocket is fine: keep the packet compact, around 100 bytes.

6. **False shots when aiming fast.** The flick fires when the total gyro magnitude goes over 320 deg/s, and a quick aim swing does that. Make detection specific to the gesture:
   - use the angular rate on the flick axis only (the axis and sign should be configurable constants: a downward/forward wrist snap),
   - require high angular acceleration (rate rising more than about X deg/s over about 20 ms),
   - optionally also require an accelerometer spike above about 2.5 g.

   Keep the hysteresis and the cooldown. Put every threshold in named constants with comments, and add a `TUNE_MODE` print for them.

7. **The shot is delayed 60 ms for data the game never uses.** The `shoot` packet waits `PEAK_WINDOW_MS` to report `dps`/`g`, and `game/js` never reads them. Send `shoot` at the moment the flick is detected. Include `ms` (the time the flick started) and `preYaw`/`prePitch`: the fused angles about 80 ms before the flick started, taken from a small on-device ring buffer. That tells the page exactly where the player was aiming, with no rewind guesswork. If you keep the strength fields, send them in a separate `shot_info` packet afterwards.

8. **Gyro calibration at boot doesn't check for stillness.** Measure variance during calibration and retry until the board is still, with a timeout. Run it after WiFi is up, because turning on the radio shifts the bias slightly. Also add continuous zero-rate bias tracking on the ESP: when every axis is under about 2 deg/s and the accelerometer is steady for more than 1 s, slowly adapt the bias.

9. **Robustness.** Call `Wire.setTimeout()` or the ESP32 equivalent so a bus glitch can't freeze the loop. Try 400 kHz I2C, and fall back to 100 kHz if the IMU doesn't answer. On MPU-6500/9250, also set ACCEL_CONFIG2 (0x1D) for an accelerometer DLPF of about 44 Hz: the fusion filter needs a clean accelerometer. Move the WiFi SSID and password out of the committed sketch into a `secrets.h` that's listed in `.gitignore`, and provide `secrets.example.h`.

New aim packet, for example:
`{"event":"aim","seq":N,"ms":T,"dyaw":0.42,"dpitch":-0.10,"yaw":12.3,"pitch":-4.1,"gx":..,"gy":..,"gz":..}`

Keep `gx/gy/gz` for the debug readout and for backward compatibility. Add `"capabilities":["aim","shoot","angles"]` to `hello`.

## Root causes to fix (browser: `controller.js` and callers)

10. **Use the angle deltas when the firmware reports `angles`.** Compute the position from summed `dyaw`/`dpitch`, in degrees mapped to screen fractions, instead of integrating rates with `dt`. Keep the old rate path only as a fallback for legacy firmware.

11. **Vertical should be absolute.** Pitch is gravity-referenced now, so compute `pos.y` directly as `0.5 + (pitch - centrePitch) * gainY`, where `markCentre` stores `centrePitch`. It then never drifts, and you can delete the hack in `shot()` that snaps `pos.y` back to 0.5 after every shot. That hack breaks the mapping between wrist and screen.

12. **The bias trim eats slow, precise aiming.** `trimBias` learns whenever every axis is within 25 deg/s of the bias for 0.4 s, with about a 1 s time constant. Slow fine tracking, at 5–20 deg/s, is therefore absorbed as "drift", and the reticle slows down while you're aiming. With on-device bias tracking this should go away. If you keep a page-side trim, only learn below about 3 deg/s and much more slowly.

13. **The hard dead zone kills micro-adjustments.** A 3 deg/s step to zero makes small movements feel sticky and then jumpy. Replace it with a soft dead zone or a smooth low-speed curve, for example scaling by `v²/(v²+k²)`. Or use a One-Euro filter on the position: low jitter when slow, low lag when fast. Expose `minCutoff` and `beta` as constants.

14. **Rendering stutters.** The reticle only moves when a packet arrives, so 40 Hz of packets on a 60–144 Hz display judders. In the render loop (`game.js` `drawReticle` and `menu-aim.js` `frame`), draw a display position that eases or interpolates toward the controller's target position every animation frame. For example, render about one packet interval behind and linearly interpolate between the last two samples by device timestamp. Shots and button presses must still use the true aim position, not the eased one.

15. **Flick filtering in the page has to agree with the firmware.** The page drops packets over 450 deg/s while the firmware fires at 320, and it decides using EMA-smoothed rates. Once the firmware sends pre-flick angles and marks flick packets, for example `"flick":true` in aim packets while a flick is in progress, the page should ignore aim deltas during the flick. After the shot, restore the position from `preYaw`/`prePitch`. Remove the `settleUntil`/`blocked` heuristics if they're no longer needed.

16. **Don't throw away motion after a gap.** Today `dt > 0.2` zeroes the rate and returns. With angle deltas, apply the delta. After a long gap, or when `seq` jumps, resync from absolute `yaw`/`pitch`.

## Acceptance criteria
- Holding the wrist still for 60 s: the reticle moves less than 2% of the screen width horizontally and not at all vertically.
- A sideways sweep with the board strapped at roughly a 30° roll: vertical movement is under 3% of the horizontal distance.
- Latency from wrist motion to reticle motion is at most about 30 ms, plus WiFi.
- The reticle moves smoothly at the display refresh rate, with no visible stepping.
- Fast aiming swings (up to about 400 deg/s sideways) don't fire shots. A deliberate flick always fires, and the shot lands where the reticle was just before the flick.
- The existing tests pass. Add tests for delta integration, absolute pitch, the soft dead zone or One-Euro filter, and pre-flick shot placement.
- Update the comments in the sketch and `web_shooter/BUILD.md` to describe the new protocol and tuning constants.

Work in small steps: firmware first (items 1–9), then the page (10–16). Explain each change briefly in the commit message.

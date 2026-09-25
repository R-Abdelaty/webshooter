/*
 * Web Shooter - wrist-mounted aim tracker and flick detector
 *
 * Hardware:
 *   ESP32 dev board (ESP32-WROOM-32)
 *   MPU-6050 / MPU-6500 / MPU-9250 / MPU-9255 IMU breakout  (I2C)
 *
 * Wiring:
 *   IMU VCC -> 3V3          IMU GND -> GND
 *   IMU SCL -> see PIN_SCL       IMU SDA -> see PIN_SDA_WIRED (21 and 33
 *                                     are tried as a fallback, and the serial
 *                                     log says which one answered)
 *   IMU AD0 -> GND (or leave floating -> address 0x68)
 *
 * What it does:
 *   Reads every IMU sample as it becomes ready (500 Hz at 400 kHz I2C, 250 Hz
 *   if the bus has to fall back to 100 kHz) and runs a Mahony filter on it, so
 *   the orientation is referenced to gravity rather than to the board's own
 *   axes. From that it works out where the forearm is pointing:
 *     yaw   - turning about the world vertical, positive to the right. Relative:
 *             there is no compass, so it drifts slowly. That is expected.
 *     pitch - elevation above the horizon, positive up. Absolute: gravity pins
 *             it, so it does not drift.
 *   Rotation is summed on the device between packets, so nothing is lost when
 *   the WiFi is late - the page gets angle deltas, not rates.
 *
 *   Broadcast as JSON over WebSocket (port 81) to every connected client, and
 *   down the USB cable, one packet per line, once a page there says "hello"
 *   (see SERIAL_BAUD):
 *     hello  on connect
 *     aim    AIM_HZ times a second - see broadcastAim()
 *     shoot  the instant a flick is detected - see broadcastShot()
 *     shot_info  PEAK_WINDOW_MS later, with how hard the flick was
 *   web_shooter/BUILD.md documents every field.
 *
 *   Open game/index.html and set the shooter's address in SETTINGS to play;
 *   the serial monitor prints the address to use.
 *
 * WiFi credentials live in secrets.h (not committed). Copy secrets.example.h
 * to secrets.h and fill it in. Without it the board runs as a hotspot.
 *
 * Library needed (Library Manager): "WebSockets" by Markus Sattler
 * Board needed (Boards Manager):    "esp32" by Espressif
 */

#include <Wire.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif
#ifndef WIFI_SSID_SECRET
#define WIFI_SSID_SECRET ""
#endif
#ifndef WIFI_PASS_SECRET
#define WIFI_PASS_SECRET ""
#endif

// ---------------------------------------------------------------- settings

// Set in secrets.h. An empty SSID skips joining your router and runs as a hotspot.
const char *WIFI_SSID = WIFI_SSID_SECRET;
const char *WIFI_PASS = WIFI_PASS_SECRET;

// Hotspot used when WIFI_SSID is empty or the join fails.
const char *AP_SSID = "WEBSHOOTER";
const char *AP_PASS = "thwipthwip";  // min 8 chars

const char *MDNS_NAME = "webshooter";  // -> ws://webshooter.local:81

// I2C pins. PIN_SDA_WIRED is how this build is actually wired, and it is tried
// first, on a bus nothing has touched yet - that attempt is the one most likely
// to work, so change this line if you re-wire rather than relying on the
// fallbacks. The fallbacks only exist because the wiring guide, mpu_test.ino
// and this sketch had drifted onto three different pins, and a wrong pin looks
// exactly like dead hardware: the LED blinks forever and the WiFi never even
// starts, so the game has nothing to connect to.
#define PIN_SCL 18
const uint8_t PIN_SDA_WIRED = 23;
const uint8_t SDA_FALLBACKS[] = {21, 33};
uint8_t PIN_SDA = PIN_SDA_WIRED;  // set at boot to whichever one answered

// The IMU is found at 100 kHz, because breadboard jumpers and the module's weak
// pull-ups make 400 kHz marginal, and a marginal bus doesn't read badly - it
// doesn't answer at all. Once found, 400 kHz is tried and kept only if the chip
// answers cleanly there. The faster bus is what allows the 500 Hz sample rate;
// at 100 kHz one read takes ~1.8 ms, so the rate drops to 250 Hz.
const uint32_t I2C_HZ_PROBE = 100000;
const uint32_t I2C_HZ_FAST = 400000;
// A glitch on the bus must never freeze the loop. The default is 50 ms; a
// whole read takes under 2 ms even at 100 kHz.
const uint16_t I2C_TIMEOUT_MS = 5;
#define PIN_LED 2  // onboard LED on most dev boards

// --- gesture tuning -------------------------------------------------------
// A flick is a sharp snap about ONE axis - a downward/forward wrist snap -
// not just "anything fast". Measuring total rotation speed, as this used to,
// fired on quick sideways aim swings. Set TUNE_MODE and watch which axis spikes
// when you flick; that is FLICK_AXIS.
const uint8_t FLICK_AXIS = 0;     // 0 = gyro X, 1 = Y, 2 = Z. X on the default strap
// Which direction of FLICK_AXIS counts: +1 or -1, or 0 for either. 0 is the
// safe default; set the sign your flick shows in TUNE_MODE and an upward snap
// can no longer fire.
const int8_t FLICK_SIGN = 0;
const float FLICK_ON = 320.0;     // deg/s on the flick axis - fires above this...
// ...but only if it got there FAST. A flick reaches full speed in ~30 ms; an
// aim swing takes ~100 ms to build up even when it is fast. So the rate must
// have risen by FLICK_RISE_DPS over the last FLICK_RISE_MS.
const float FLICK_RISE_DPS = 200.0;
const uint16_t FLICK_RISE_MS = 20;
// Optional: also require an acceleration spike. 0 disables it. A real flick
// is usually well past 2.5 g; set this if aiming still fires shots.
const float FLICK_MIN_G = 0.0;
const float FLICK_OFF = 120.0;    // deg/s - must fall below this to re-arm
const uint32_t SHOT_COOLDOWN_MS = 350;
const uint16_t FLICK_MAX_MS = 400; // a flick flag that never clears is a bug, not a flick
// The shot is placed where you were aiming this long before the flick started,
// taken from a ring buffer on the device - so the page needs no rewinding.
const uint16_t PRE_FLICK_MS = 80;
// How long to keep watching the swing before reporting how hard it was, in
// shot_info. The shot itself does not wait for this.
const uint16_t PEAK_WINDOW_MS = 60;

// --- aiming ---------------------------------------------------------------
// AIM_HZ packets a second, each carrying the rotation summed since the last
// one. At 100 Hz the JSON is ~130 bytes, nothing for the WiFi.
const uint8_t AIM_HZ = 100;
const float AIM_MAX_DPS = 2400.0;  // the page rejects anything over 2500

// Which body axis points along your forearm - the direction you aim with.
// 0 = X, 1 = Y, 2 = Z. The page overrides it at connect time from its
// HORIZONTAL/VERTICAL axis settings ("fwd=x|y|z"), so re-strapping the board
// needs no reflash; this is only the default before a page connects.
uint8_t fwdAxis = 1;

// --- sensor fusion (Mahony) -----------------------------------------------
// MAHONY_KP is how hard the accelerometer pulls the gyro's idea of "down"
// back onto gravity. Higher corrects drift faster but lets arm acceleration
// tilt the aim. 1.0 is a ~1 s time constant, far faster than gyro drift.
const float MAHONY_KP = 1.0;
// The accelerometer only measures gravity when the arm isn't accelerating, so
// its correction fades out as |a| leaves 1 g (0 at ACC_GATE_G away)...
const float ACC_GATE_G = 0.15;
// ...and as the rotation gets faster (half strength at MOTION_GATE_DPS). A
// sideways sweep swings the wrist on a radius, and that centripetal pull
// would otherwise bleed into pitch - the cross-coupling this fixes.
const float MOTION_GATE_DPS = 40.0;

// --- gyro bias ------------------------------------------------------------
// At boot: the gyro must be this still (std dev, every axis) to be calibrated.
const float CAL_MAX_STD_DPS = 1.0;
const float CAL_MAX_STD_G = 0.02;
const uint32_t CAL_TIMEOUT_MS = 15000;  // then use the stillest attempt
// While running: when every axis is under BIAS_STILL_DPS and the accelerometer
// is steady for BIAS_STILL_MS, the bias creeps toward the reading with time
// constant BIAS_TAU_S. Slow enough that a deliberate slow aim is not "drift".
const float BIAS_STILL_DPS = 2.0;
const float BIAS_ACC_STEADY_G = 0.03;
const uint32_t BIAS_STILL_MS = 1000;
const float BIAS_TAU_S = 10.0;

// Print the flick detector's inputs and thresholds 20 times a second so you
// can tune them for your own wrist.
const bool TUNE_MODE = false;

// --- USB link -------------------------------------------------------------
// The page can also read the shooter over the USB cable (Web Serial), with no
// network at all. The same JSON packets go down the serial port, one per line,
// but only once a page has said "hello" - otherwise 100 aim lines a second
// would bury the serial monitor. The page pings every second; after
// SERIAL_LINK_TIMEOUT_MS of silence it is assumed gone and streaming stops.
//
// 100 packets a second is ~12 KB/s, more than 115200 baud can carry, so the
// port runs faster. Set the serial monitor to the same speed.
const uint32_t SERIAL_BAUD = 460800;
const uint32_t SERIAL_LINK_TIMEOUT_MS = 3000;

// One line every two seconds saying whether the loop is still running and what
// it is sending. A serial log full of shot events cannot distinguish "the
// sketch stopped" from "you stopped flicking", and that is exactly the
// difference that matters when the game sees nothing. Set false once it works.
const bool LINK_HEARTBEAT = true;

// ---------------------------------------------------------------- IMU regs

uint8_t mpuAddr = 0x68;  // found at boot: 0x68, or 0x69 if AD0 is high
uint8_t mpuWho = 0xFF;
const uint8_t REG_SMPLRT_DIV = 0x19;
const uint8_t REG_CONFIG = 0x1A;
const uint8_t REG_GYRO_CONFIG = 0x1B;
const uint8_t REG_ACCEL_CONFIG = 0x1C;
const uint8_t REG_ACCEL_CONFIG2 = 0x1D;  // MPU-6500/9250 only
const uint8_t REG_INT_ENABLE = 0x38;
const uint8_t REG_INT_STATUS = 0x3A;
const uint8_t REG_ACCEL_XOUT_H = 0x3B;
const uint8_t REG_PWR_MGMT_1 = 0x6B;
const uint8_t REG_WHO_AM_I = 0x75;

// +/-2000 deg/s and +/-16 g - a real flick saturates anything smaller.
const float GYRO_LSB_PER_DPS = 16.4;
const float ACCEL_LSB_PER_G = 2048.0;
const float DEG = 57.2957795f;

float gyroBias[3] = {0, 0, 0};
bool busFast = false;
uint32_t samplePeriodUs = 4000;  // set by mpuConfigure from the bus speed

// ---------------------------------------------------------------- globals

WebSocketsServer webSocket(81);

bool armed = true;
bool inFlick = false;       // from detection until the flick axis settles
uint32_t lastShotMs = 0;
uint32_t shotCount = 0;
uint32_t flickOnsetMs = 0;  // last time the flick rate was below FLICK_OFF

// Held for shot_info: the peak of the swing, which comes after detection.
bool peaking = false;
uint32_t peakStartMs = 0;
float peakDps = 0;
float peakG = 0;

// Orientation, body -> world, world Z up.
float q0 = 1, q1 = 0, q2 = 0, q3 = 0;
float yawDeg = 0;     // unwrapped, positive right
float pitchDeg = 0;   // above the horizon
float prevAzimuth = 0, prevPitch = 0;
bool haveAngles = false;

// Summed since the last aim packet, then reset. dAng is body-frame rotation in
// degrees, sent divided by dT as the average rate - no EMA, no aliasing.
float dYaw = 0, dPitch = 0;
float dAng[3] = {0, 0, 0};
float dT = 0;
uint32_t lastAimMs = 0;
uint32_t aimSeq = 0;

// Sampling
uint32_t lastSampleUs = 0;
uint32_t lastPollUs = 0;
uint32_t lastFreshMs = 0;
uint32_t sampleCount = 0;

// Bias tracking
float accLP[3] = {0, 0, 1};
uint32_t stillSinceMs = 0;
bool stillRun = false;

// Ring buffers: flick rate for the rise test, angles for pre-flick aim.
const uint8_t FLICK_RING = 32;  // 64 ms at 500 Hz
struct FlickSample { uint32_t ms; float r; float g; };
FlickSample flickRing[FLICK_RING];
uint8_t flickHead = 0, flickFill = 0;

const uint8_t ANGLE_RING = 128;   // 128 x 4 ms = 512 ms of history
const uint8_t ANGLE_LOG_MS = 4;
struct AngleSample { uint32_t ms; float yaw; float pitch; };
AngleSample angleRing[ANGLE_RING];
uint8_t angleHead = 0, angleFill = 0;
uint32_t lastAngleLogMs = 0;

// USB link state
bool serialLink = false;
uint32_t lastSerialRxMs = 0;
char serialLine[48];
uint8_t serialLen = 0;

// Heartbeat counters. loopCount counts every pass of loop(), not every sample,
// because a stalled send shows up there first.
uint32_t aimSent = 0;
uint32_t loopCount = 0;
uint32_t lastBeatMs = 0;

// ---------------------------------------------------------------- I2C help

void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

uint8_t mpuRead(uint8_t reg) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((int)mpuAddr, 1);
  return Wire.available() ? Wire.read() : 0xFF;
}

void decodeMotion(const uint8_t *b, float *ax, float *ay, float *az, float *gx, float *gy, float *gz) {
  int16_t raw[7];
  for (int i = 0; i < 7; i++) raw[i] = (int16_t)((b[2 * i] << 8) | b[2 * i + 1]);
  // raw[3] is temperature - not used
  *ax = raw[0] / ACCEL_LSB_PER_G;
  *ay = raw[1] / ACCEL_LSB_PER_G;
  *az = raw[2] / ACCEL_LSB_PER_G;
  *gx = raw[4] / GYRO_LSB_PER_DPS - gyroBias[0];
  *gy = raw[5] / GYRO_LSB_PER_DPS - gyroBias[1];
  *gz = raw[6] / GYRO_LSB_PER_DPS - gyroBias[2];
}

// Reads accel (g) and gyro (deg/s, bias removed) in one burst, fresh or not.
bool mpuReadMotion(float *ax, float *ay, float *az, float *gx, float *gy, float *gz) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)mpuAddr, 14) != 14) return false;
  uint8_t b[14];
  for (int i = 0; i < 14; i++) b[i] = Wire.read();  // one per statement: order matters
  decodeMotion(b, ax, ay, az, gx, gy, gz);
  return true;
}

// The same, but starting one register earlier at INT_STATUS, whose bit 0 says
// whether this is a new sample. Reading it clears it, so every sample is seen
// exactly once - no timer on our side to drift against the IMU's own clock.
// One burst, so the flag and the data always belong together.
// Returns 1 fresh, 0 not ready yet, -1 bus error.
int mpuReadFresh(float *ax, float *ay, float *az, float *gx, float *gy, float *gz) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(REG_INT_STATUS);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom((int)mpuAddr, 15) != 15) return -1;
  uint8_t st = Wire.read();
  uint8_t b[14];
  for (int i = 0; i < 14; i++) b[i] = Wire.read();
  if (!(st & 0x01)) return 0;
  decodeMotion(b, ax, ay, az, gx, gy, gz);
  return 1;
}

// A reset in the middle of a transaction leaves the IMU still holding SDA low,
// waiting to finish sending a byte nobody is reading. That looks exactly like a
// chip that isn't there. Nine clocks on SCL walks it out of that state.
void unstickBus(uint8_t sda) {
  pinMode(sda, INPUT_PULLUP);
  pinMode(PIN_SCL, OUTPUT_OPEN_DRAIN);
  digitalWrite(PIN_SCL, HIGH);
  for (uint8_t i = 0; i < 9 && digitalRead(sda) == LOW; i++) {
    digitalWrite(PIN_SCL, LOW);
    delayMicroseconds(5);
    digitalWrite(PIN_SCL, HIGH);
    delayMicroseconds(5);
  }
  pinMode(PIN_SCL, INPUT);
}

// Hand both lines back to plain GPIO before re-assigning them. Wire.begin() on
// a different SDA can otherwise leave the driver bound to the previous pin, so
// the next candidate fails even when it is the correctly wired one - which is
// the whole reason the preferred pin is tried first, on an untouched bus.
void releaseBus(uint8_t sda) {
  Wire.end();
  pinMode(sda, INPUT);
  pinMode(PIN_SCL, INPUT);
  delay(50);
}

// An idle I2C line is held HIGH by the module's pull-up resistors. Drive it
// low, let go, and see whether anything pulls it back up. Nothing does when the
// module has no power or that wire is off - and that is a different fault from
// "the chip is there but on another pin", so it is worth telling them apart
// instead of printing one generic "check your wiring".
bool hasPullup(uint8_t pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delayMicroseconds(20);
  pinMode(pin, INPUT);  // no internal pull-up: we want to see the module's
  delayMicroseconds(100);
  return digitalRead(pin) == HIGH;
}

// Ask for WHO_AM_I directly instead of probing with an empty write: a few of
// the cheaper clones don't acknowledge a zero-length transaction at all, and
// answering the register is the thing we actually care about anyway.
bool probeAddr(uint8_t addr, uint8_t *who) {
  Wire.beginTransmission(addr);
  Wire.write(REG_WHO_AM_I);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, 1) != 1) return false;
  uint8_t v = Wire.read();
  if (v == 0x00 || v == 0xFF) return false;
  *who = v;
  return true;
}

// Twenty clean WHO_AM_I answers and a few data bursts at this speed, or it is
// not good enough.
bool busHealthyAt(uint32_t hz) {
  Wire.setClock(hz);
  delay(2);
  for (uint8_t i = 0; i < 20; i++) {
    uint8_t w = 0;
    if (!probeAddr(mpuAddr, &w) || w != mpuWho) return false;
  }
  float a, b, c, d, e, f;
  for (uint8_t i = 0; i < 5; i++)
    if (!mpuReadMotion(&a, &b, &c, &d, &e, &f)) return false;
  return true;
}

// Registers, separate from finding the chip so a stalled IMU can be
// re-initialised without probing the bus again.
void mpuConfigure() {
  mpuWrite(REG_PWR_MGMT_1, 0x80);  // reset
  delay(100);
  mpuWrite(REG_PWR_MGMT_1, 0x01);  // wake, use gyro X as clock
  delay(50);
  mpuWrite(REG_CONFIG, 0x03);        // gyro DLPF ~44 Hz, 1 kHz internal rate
  // 500 Hz on a fast bus, 250 Hz on a slow one - a read has to fit in a sample.
  uint8_t div = busFast ? 1 : 3;
  mpuWrite(REG_SMPLRT_DIV, div);
  samplePeriodUs = 1000UL * (1 + div);
  mpuWrite(REG_GYRO_CONFIG, 0x18);   // +/- 2000 deg/s
  mpuWrite(REG_ACCEL_CONFIG, 0x18);  // +/- 16 g
  // The 6050 filters the accelerometer with the CONFIG DLPF; the 6500 family
  // has its own, off by default (~460 Hz). The fusion needs a clean one.
  if (mpuWho == 0x70 || mpuWho == 0x71 || mpuWho == 0x73)
    mpuWrite(REG_ACCEL_CONFIG2, 0x03);  // accel DLPF ~44 Hz
  mpuWrite(REG_INT_ENABLE, 0x01);    // latch DATA_RDY into INT_STATUS
  delay(50);
}

bool mpuBegin() {
  // Find it, rather than assuming. Two things vary and neither is worth a
  // reflash to discover: the SDA pin, and the address - AD0 decides that, tied
  // low it is 0x68, floating or high it is 0x69, and plenty of breakouts pull
  // AD0 high on the board.
  uint8_t who = 0xFF;
  const uint8_t tryAddr[2] = {0x68, 0x69};
  const uint8_t nFallback = sizeof(SDA_FALLBACKS) / sizeof(SDA_FALLBACKS[0]);
  const uint8_t nSda = nFallback + 1;
  bool found = false;

  for (uint8_t s = 0; s < nSda && !found; s++) {
    if (s > 0) releaseBus(PIN_SDA);
    PIN_SDA = (s == 0) ? PIN_SDA_WIRED : SDA_FALLBACKS[s - 1];

    Serial.printf("  probing SDA=GPIO%d SCL=GPIO%d ... ", PIN_SDA, PIN_SCL);
    unstickBus(PIN_SDA);
    Wire.begin(PIN_SDA, PIN_SCL, I2C_HZ_PROBE);
    Wire.setTimeOut(I2C_TIMEOUT_MS);
    // The bus and the IMU both need a moment after power-up. Reading straight
    // away is the difference between this working and reporting 0xFF.
    delay(120);

    for (uint8_t i = 0; i < 2 && !found; i++) {
      mpuAddr = tryAddr[i];
      if (probeAddr(mpuAddr, &who)) found = true;
    }
    Serial.println(found ? "yes" : "nothing");
  }

  // 0x68 MPU6050, 0x70 MPU6500, 0x71 MPU9250, 0x73 MPU9255, 0x98 clone
  if (!found) {
    Serial.printf("IMU not responding on SCL=GPIO%d at SDA=%d", PIN_SCL, PIN_SDA_WIRED);
    for (uint8_t s = 0; s < nFallback; s++) Serial.printf(" or %d", SDA_FALLBACKS[s]);
    Serial.println(" (addresses 0x68 and 0x69).");

    releaseBus(PIN_SDA);
    bool sdaUp = hasPullup(PIN_SDA_WIRED);
    bool sclUp = hasPullup(PIN_SCL);
    Serial.printf("  line check: SDA(GPIO%d) %s, SCL(GPIO%d) %s\n",
                  PIN_SDA_WIRED, sdaUp ? "pulled up" : "FLAT",
                  PIN_SCL, sclUp ? "pulled up" : "FLAT");
    if (!sdaUp || !sclUp) {
      Serial.println("  A flat line is not a wrong-pin problem: nothing is pulling it");
      Serial.println("  up, so the module has no power or that wire is off. Check the");
      Serial.println("  3V3 and GND jumpers first, then reseat the module.");
    } else {
      Serial.println("  Both lines are alive, so power and the wires are fine - the");
      Serial.println("  chip just isn't answering. Run mpu_test.ino: it scans all 127");
      Serial.println("  addresses. Wired to some other pin? Set PIN_SDA_WIRED to it.");
    }
    return false;
  }
  mpuWho = who;
  Serial.printf("IMU found at 0x%02X on SDA=GPIO%d SCL=GPIO%d, WHO_AM_I = 0x%02X\n",
                mpuAddr, PIN_SDA, PIN_SCL, who);

  mpuConfigure();
  busFast = busHealthyAt(I2C_HZ_FAST);
  if (!busFast) Wire.setClock(I2C_HZ_PROBE);
  mpuConfigure();  // again, now the sample rate can match the bus
  Serial.printf("I2C at %lu kHz, sampling at %lu Hz\n",
                (unsigned long)((busFast ? I2C_HZ_FAST : I2C_HZ_PROBE) / 1000),
                (unsigned long)(1000000UL / samplePeriodUs));
  return true;
}

// Mean and spread of a second of readings, repeated until the board is
// actually still. A bias measured while it was moving is a lie that every
// later reading inherits. Runs after the WiFi is up, because switching the
// radio on shifts the bias slightly.
void calibrateGyro() {
  Serial.println("Hold still, calibrating gyro...");
  float saved[3] = {gyroBias[0], gyroBias[1], gyroBias[2]};
  gyroBias[0] = gyroBias[1] = gyroBias[2] = 0;
  float best[3] = {saved[0], saved[1], saved[2]};
  float bestStd = 1e9;
  uint32_t t0 = millis();
  const int N = 250;

  while (true) {
    double s[3] = {0, 0, 0}, s2[3] = {0, 0, 0}, sg = 0, sg2 = 0;
    int got = 0;
    for (int i = 0; i < N; i++) {
      float ax, ay, az, gx, gy, gz;
      if (mpuReadMotion(&ax, &ay, &az, &gx, &gy, &gz)) {
        float g[3] = {gx, gy, gz};
        for (int k = 0; k < 3; k++) { s[k] += g[k]; s2[k] += (double)g[k] * g[k]; }
        float m = sqrtf(ax * ax + ay * ay + az * az);
        sg += m; sg2 += (double)m * m;
        got++;
      }
      webSocket.loop();  // let a page connect meanwhile
      delay(3);
    }
    digitalWrite(PIN_LED, !digitalRead(PIN_LED));  // slow blink: hold still
    if (got < N / 2) { Serial.println("  calibration: too many failed reads"); break; }

    float worst = 0, mean[3];
    for (int k = 0; k < 3; k++) {
      mean[k] = s[k] / got;
      float var = s2[k] / got - mean[k] * mean[k];
      float sd = sqrtf(var > 0 ? var : 0);
      if (sd > worst) worst = sd;
    }
    float gm = sg / got, gvar = sg2 / got - gm * gm;
    float gsd = sqrtf(gvar > 0 ? gvar : 0);
    if (worst < bestStd) { bestStd = worst; for (int k = 0; k < 3; k++) best[k] = mean[k]; }

    if (worst < CAL_MAX_STD_DPS && gsd < CAL_MAX_STD_G) {
      Serial.printf("  still (spread %.2f deg/s, %.3f g)\n", worst, gsd);
      break;
    }
    if (millis() - t0 > CAL_TIMEOUT_MS) {
      Serial.printf("  never still enough - using the stillest second (spread %.2f deg/s)\n", bestStd);
      break;
    }
    Serial.printf("  moving (spread %.2f deg/s, %.3f g) - retrying\n", worst, gsd);
  }
  for (int k = 0; k < 3; k++) gyroBias[k] = best[k];
  digitalWrite(PIN_LED, LOW);
  Serial.printf("Gyro bias: %.2f %.2f %.2f deg/s\n", gyroBias[0], gyroBias[1], gyroBias[2]);
}

// ---------------------------------------------------------------- fusion

// Start level with the measured gravity, facing yaw 0.
void fusionInit(float ax, float ay, float az) {
  float r = atan2f(ay, az), p = atan2f(-ax, sqrtf(ay * ay + az * az));
  float cr = cosf(r / 2), sr = sinf(r / 2), cp = cosf(p / 2), sp = sinf(p / 2);
  q0 = cr * cp; q1 = sr * cp; q2 = cr * sp; q3 = -sr * sp;
}

// Mahony, 6-axis. g in deg/s, a in g. The accelerometer's pull is weighted by
// how much it can be trusted right now (see ACC_GATE_G / MOTION_GATE_DPS).
void fusionUpdate(float gx, float gy, float gz, float ax, float ay, float az, float dt) {
  gx /= DEG; gy /= DEG; gz /= DEG;
  float an = sqrtf(ax * ax + ay * ay + az * az);
  float spin = sqrtf(gx * gx + gy * gy + gz * gz) * DEG;
  float w = 1.0f - fabsf(an - 1.0f) / ACC_GATE_G;
  if (w < 0) w = 0;
  w /= 1.0f + (spin / MOTION_GATE_DPS) * (spin / MOTION_GATE_DPS);
  if (w > 0 && an > 0.01f) {
    ax /= an; ay /= an; az /= an;
    // world "up" as the current orientation sees it, in body coordinates
    float vx = 2 * (q1 * q3 - q0 * q2);
    float vy = 2 * (q0 * q1 + q2 * q3);
    float vz = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3;
    float k = MAHONY_KP * w;
    gx += k * (ay * vz - az * vy);
    gy += k * (az * vx - ax * vz);
    gz += k * (ax * vy - ay * vx);
  }
  float h = 0.5f * dt;
  float a0 = q0, a1 = q1, a2 = q2, a3 = q3;
  q0 += (-a1 * gx - a2 * gy - a3 * gz) * h;
  q1 += ( a0 * gx + a2 * gz - a3 * gy) * h;
  q2 += ( a0 * gy - a1 * gz + a3 * gx) * h;
  q3 += ( a0 * gz + a1 * gy - a2 * gx) * h;
  float n = sqrtf(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
  q0 /= n; q1 /= n; q2 /= n; q3 /= n;
}

// The forearm axis in world coordinates: a column of the rotation matrix.
void forward(float *fx, float *fy, float *fz) {
  if (fwdAxis == 0) {
    *fx = 1 - 2 * (q2 * q2 + q3 * q3); *fy = 2 * (q1 * q2 + q0 * q3); *fz = 2 * (q1 * q3 - q0 * q2);
  } else if (fwdAxis == 1) {
    *fx = 2 * (q1 * q2 - q0 * q3); *fy = 1 - 2 * (q1 * q1 + q3 * q3); *fz = 2 * (q2 * q3 + q0 * q1);
  } else {
    *fx = 2 * (q1 * q3 + q0 * q2); *fy = 2 * (q2 * q3 - q0 * q1); *fz = 1 - 2 * (q1 * q1 + q2 * q2);
  }
}

// Aim from the forearm direction, not from any one gyro axis: where it points
// round the horizon (yaw) and how far above it (pitch). Rolling the forearm
// doesn't move either, so the board can be strapped at any roll angle.
// Returns false when the forearm points nearly straight up or down, where the
// heading is meaningless.
bool readAngles(float *az, float *el) {
  float fx, fy, fz;
  forward(&fx, &fy, &fz);
  if (fz > 1) fz = 1;
  if (fz < -1) fz = -1;
  *el = asinf(fz) * DEG;
  *az = atan2f(fy, fx) * DEG;
  return fx * fx + fy * fy > 0.04f;
}

void resyncAngles() {
  readAngles(&prevAzimuth, &prevPitch);
  pitchDeg = prevPitch;
  haveAngles = true;
}

void updateAngles() {
  float az, el;
  if (readAngles(&az, &el)) {
    float d = az - prevAzimuth;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    yawDeg -= d;  // counter-clockwise from above is left, so negate for "right"
    dYaw -= d;
    prevAzimuth = az;
  }
  dPitch += el - prevPitch;
  prevPitch = pitchDeg = el;
}

// ---------------------------------------------------------------- bias

// Zero-rate drift tracking. Only ever runs while the board is plainly at rest
// on every axis and the accelerometer agrees, so it cannot eat a slow aim.
void trackBias(const float *g, float ax, float ay, float az, float dt, uint32_t now) {
  float a[3] = {ax, ay, az};
  float k = dt / 0.3f;
  float dev = 0;
  for (int i = 0; i < 3; i++) {
    accLP[i] += (a[i] - accLP[i]) * k;
    float d = fabsf(a[i] - accLP[i]);
    if (d > dev) dev = d;
  }
  bool still = dev < BIAS_ACC_STEADY_G &&
               fabsf(g[0]) < BIAS_STILL_DPS && fabsf(g[1]) < BIAS_STILL_DPS && fabsf(g[2]) < BIAS_STILL_DPS;
  if (!still) { stillRun = false; return; }
  if (!stillRun) { stillRun = true; stillSinceMs = now; return; }
  if (now - stillSinceMs < BIAS_STILL_MS) return;
  float b = dt / BIAS_TAU_S;
  for (int i = 0; i < 3; i++) gyroBias[i] += g[i] * b;  // g already has the bias removed
}

// ---------------------------------------------------------------- flick

float flickRate(const float *g) {
  float r = g[FLICK_AXIS];
  return FLICK_SIGN == 0 ? fabsf(r) : r * FLICK_SIGN;
}

void logFlick(uint32_t now, float r, float g) {
  flickRing[flickHead] = {now, r, g};
  flickHead = (flickHead + 1) % FLICK_RING;
  if (flickFill < FLICK_RING) flickFill++;
}

// How much the flick rate has risen over the last FLICK_RISE_MS, and the
// biggest |a| in that time.
void flickRise(uint32_t now, float r, float *rise, float *gPeak) {
  float base = r;
  *gPeak = 0;
  for (uint8_t i = 1; i <= flickFill; i++) {
    const FlickSample &s = flickRing[(flickHead + FLICK_RING - i) % FLICK_RING];
    if (s.g > *gPeak) *gPeak = s.g;
    base = s.r;
    if (now - s.ms >= FLICK_RISE_MS) break;
  }
  *rise = r - base;
}

void logAngles(uint32_t now) {
  if (now - lastAngleLogMs < ANGLE_LOG_MS) return;
  lastAngleLogMs = now;
  angleRing[angleHead] = {now, yawDeg, pitchDeg};
  angleHead = (angleHead + 1) % ANGLE_RING;
  if (angleFill < ANGLE_RING) angleFill++;
}

// Newest logged angles at or before "when", or the oldest there is.
void anglesAt(uint32_t when, float *yaw, float *pitch) {
  *yaw = yawDeg;
  *pitch = pitchDeg;
  for (uint8_t i = 1; i <= angleFill; i++) {
    const AngleSample &s = angleRing[(angleHead + ANGLE_RING - i) % ANGLE_RING];
    *yaw = s.yaw;
    *pitch = s.pitch;
    if ((int32_t)(when - s.ms) >= 0) break;
  }
}

// ---------------------------------------------------------------- network

// The page reads "capabilities" to decide whether this firmware can aim.
// Without it the menu says the firmware needs updating and only shots get
// through, so it has to be in the hello, not implied by aim packets.
// "angles" means aim packets carry dyaw/dpitch/yaw/pitch.
const char *HELLO =
    "{\"event\":\"hello\",\"device\":\"webshooter\","
    "\"capabilities\":[\"aim\",\"shoot\",\"angles\"]}";

// Is anybody listening, on either link?
bool anyListener() { return serialLink || webSocket.connectedClients() > 0; }

// A packet for the page, to every WebSocket client and down the USB cable.
void emit(const char *msg) {
  if (webSocket.connectedClients() > 0) webSocket.broadcastTXT(msg);
  if (serialLink) Serial.println(msg);
}

// Text from the page, over WiFi (wsNum = client) or USB (wsNum = -1).
void handleCommand(const char *s, size_t len, int wsNum) {
  auto reply = [&](const char *m) {
    if (wsNum >= 0) webSocket.sendTXT((uint8_t)wsNum, m);
    else Serial.println(m);
  };
  // "ping" gets a pong so the page can check the link.
  if (len == 4 && strncmp(s, "ping", 4) == 0) reply("{\"event\":\"pong\"}");
  // "hello" over USB: a page has opened the port and wants the stream. (Over
  // WiFi the hello is sent on connect instead.)
  if (wsNum < 0 && len == 5 && strncmp(s, "hello", 5) == 0) {
    if (!serialLink) Serial.println("usb link: page connected, streaming");
    serialLink = true;
    reply(HELLO);
  }
  // "fwd=x|y|z": which body axis points along the forearm. The page sends
  // it from its axis settings so re-strapping needs no reflash.
  if (len == 5 && strncmp(s, "fwd=", 4) == 0) {
    char c = s[4];
    if (c >= 'x' && c <= 'z' && fwdAxis != (uint8_t)(c - 'x')) {
      fwdAxis = c - 'x';
      if (haveAngles) resyncAngles();  // re-anchor so the switch is not a jump
      Serial.printf("forward axis now %c\n", c);
    }
  }
}

// Commands from a page on the USB cable, one per line. Never blocks.
void pollSerial() {
  while (Serial.available() > 0) {
    int c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLen > 0) {
        serialLine[serialLen] = 0;
        lastSerialRxMs = millis();
        handleCommand(serialLine, serialLen, -1);
        serialLen = 0;
      }
    } else if (serialLen < sizeof(serialLine) - 1) {
      serialLine[serialLen++] = (char)c;
    }
  }
  if (serialLink && millis() - lastSerialRxMs > SERIAL_LINK_TIMEOUT_MS) {
    serialLink = false;
    Serial.println("usb link: page gone, streaming stopped");
  }
}

void onWsEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t len) {
  switch (type) {
    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("client %u connected from %s\n", num, ip.toString().c_str());
      webSocket.sendTXT(num, HELLO);
      break;
    }
    case WStype_DISCONNECTED:
      Serial.printf("client %u disconnected\n", num);
      break;
    case WStype_TEXT:
      handleCommand((const char *)payload, len, num);
      break;
    default:
      break;
  }
}

void startNetwork() {
  bool joined = false;

  if (strlen(WIFI_SSID) > 0) {
    Serial.printf("Joining %s", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) {
      delay(300);
      Serial.print(".");
    }
    Serial.println();
    joined = (WiFi.status() == WL_CONNECTED);
  }

  if (joined) {
    Serial.printf("Connected. ws://%s:81\n", WiFi.localIP().toString().c_str());
  } else {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    Serial.printf("Hotspot \"%s\" (pass: %s)\n", AP_SSID, AP_PASS);
    Serial.printf("Join it, then ws://%s:81\n", WiFi.softAPIP().toString().c_str());
  }
  // Modem sleep parks the radio between beacons and releases packets in
  // bursts - that alone was most of the reticle's stutter. Off, in both modes.
  WiFi.setSleep(false);

  if (MDNS.begin(MDNS_NAME)) {
    MDNS.addService("ws", "tcp", 81);
    Serial.printf("Also reachable at ws://%s.local:81\n", MDNS_NAME);
  }

  webSocket.begin();
  webSocket.onEvent(onWsEvent);
}

float clampDps(float v) {
  if (v > AIM_MAX_DPS) return AIM_MAX_DPS;
  if (v < -AIM_MAX_DPS) return -AIM_MAX_DPS;
  return v;
}

// Sent often and quietly - deliberately not printed to serial.
//
//   dyaw, dpitch  degrees turned since the previous packet. Summed on the
//                 device from every sample, so a late packet loses nothing.
//   yaw, pitch    running totals, for resyncing after a gap. pitch is absolute.
//   gx, gy, gz    average body rates over the interval, deg/s - debug readout
//                 and older pages.
//   flick         present, true, while a flick is in progress: not aiming.
// "seq" and "ms" let the page throw away packets that arrive out of order.
void broadcastAim() {
  float inv = dT > 0 ? 1.0f / dT : 0;
  char msg[200];
  snprintf(msg, sizeof(msg),
           "{\"event\":\"aim\",\"seq\":%lu,\"ms\":%lu,\"dyaw\":%.3f,\"dpitch\":%.3f,"
           "\"yaw\":%.2f,\"pitch\":%.2f,\"gx\":%.1f,\"gy\":%.1f,\"gz\":%.1f%s}",
           (unsigned long)aimSeq, (unsigned long)millis(), dYaw, dPitch, yawDeg, pitchDeg,
           clampDps(dAng[0] * inv), clampDps(dAng[1] * inv), clampDps(dAng[2] * inv),
           inFlick ? ",\"flick\":true" : "");
  emit(msg);
}

// Sent the moment the flick is detected. "ms" is when it started, on the same
// clock as the aim packets, and preYaw/prePitch are where you were aiming
// PRE_FLICK_MS before that - the page shoots there, no rewinding needed.
void broadcastShot(float preYaw, float prePitch) {
  char msg[160];
  snprintf(msg, sizeof(msg),
           "{\"event\":\"shoot\",\"seq\":%lu,\"ms\":%lu,\"preYaw\":%.2f,\"prePitch\":%.2f}",
           (unsigned long)shotCount, (unsigned long)flickOnsetMs, preYaw, prePitch);
  emit(msg);
  if (!serialLink) Serial.println(msg);  // already on the port if streaming
}

// How hard the flick was, once the swing has peaked. Nothing waits for it.
void broadcastShotInfo(float strengthDps, float strengthG) {
  char msg[100];
  snprintf(msg, sizeof(msg), "{\"event\":\"shot_info\",\"seq\":%lu,\"dps\":%.0f,\"g\":%.1f}",
           (unsigned long)shotCount, strengthDps, strengthG);
  emit(msg);
}

// ---------------------------------------------------------------- sketch

void setup() {
  // Without a software buffer a print waits for the 128-byte hardware FIFO to
  // drain - ~3 ms per aim packet - and the sampling loop stalls behind it.
  Serial.setTxBufferSize(1024);
  Serial.begin(SERIAL_BAUD);
  delay(300);
  Serial.println("\nWeb Shooter booting");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  if (!mpuBegin()) {
    // Keep blinking so it is obvious the IMU is the problem.
    while (true) {
      digitalWrite(PIN_LED, !digitalRead(PIN_LED));
      delay(150);
    }
  }
  startNetwork();
  calibrateGyro();

  float ax, ay, az, gx, gy, gz;
  if (mpuReadMotion(&ax, &ay, &az, &gx, &gy, &gz)) {
    fusionInit(ax, ay, az);
    accLP[0] = ax; accLP[1] = ay; accLP[2] = az;
  }
  resyncAngles();
  lastSampleUs = micros();
  lastFreshMs = lastAimMs = millis();
  Serial.println("Ready - flick your wrist.");
}

// Close the current aim packet: send what has been summed, start again.
void sendAim() {
  // With nobody listening there is no point building the JSON or calling into
  // the socket at all - and it keeps the heartbeat's aimsent count honest.
  if (anyListener()) {
    aimSeq++;
    aimSent++;
    broadcastAim();
  }
  dYaw = dPitch = dT = 0;
  dAng[0] = dAng[1] = dAng[2] = 0;
}

// On a fixed schedule rather than "period since the last send", which loses
// the remainder every time and runs slow. After a stall, start again from now
// instead of firing a burst to catch up.
void sendAimIfDue(uint32_t now) {
  const uint32_t period = 1000 / AIM_HZ;
  if (now - lastAimMs < period) return;
  lastAimMs = (now - lastAimMs < 2 * period) ? lastAimMs + period : now;
  sendAim();
}

// One IMU sample, everything that depends on it.
void processSample(float ax, float ay, float az, float gx, float gy, float gz, float dt, uint32_t now) {
  float g[3] = {gx, gy, gz};
  float gmag = sqrtf(ax * ax + ay * ay + az * az);

  trackBias(g, ax, ay, az, dt, now);
  fusionUpdate(gx, gy, gz, ax, ay, az, dt);
  updateAngles();
  logAngles(now);
  for (int i = 0; i < 3; i++) dAng[i] += g[i] * dt;
  dT += dt;

  // ---- flick ----
  float r = flickRate(g), rise, gPeak;
  logFlick(now, r, gmag);
  flickRise(now, r, &rise, &gPeak);
  if (r < FLICK_OFF) flickOnsetMs = now;

  if (TUNE_MODE) {
    static uint32_t lastPrint = 0;
    if (now - lastPrint >= 50) {
      lastPrint = now;
      Serial.printf("flick=%.0f (on>%.0f off<%.0f) rise%ums=%.0f (>%.0f) g=%.2f (>%.1f) "
                    "gx=%.0f gy=%.0f gz=%.0f yaw=%.1f pitch=%.1f\n",
                    r, FLICK_ON, FLICK_OFF, FLICK_RISE_MS, rise, FLICK_RISE_DPS, gmag, FLICK_MIN_G,
                    gx, gy, gz, yawDeg, pitchDeg);
    }
  }

  if (armed && r > FLICK_ON && rise > FLICK_RISE_DPS &&
      (FLICK_MIN_G <= 0 || gPeak > FLICK_MIN_G) && now - lastShotMs > SHOT_COOLDOWN_MS) {
    digitalWrite(PIN_LED, HIGH);  // straight away, so the flick feels instant
    armed = false;
    peaking = true;
    peakStartMs = lastShotMs = now;
    shotCount++;
    peakDps = r;
    peakG = gmag;

    float py, pp;
    anglesAt(flickOnsetMs - PRE_FLICK_MS, &py, &pp);
    // Close the current aim packet first, while inFlick is still false, so
    // everything up to the shot is in unflagged packets and everything after
    // it in flagged ones.
    sendAim();
    lastAimMs = now;
    if (anyListener()) broadcastShot(py, pp);
    inFlick = true;
  }

  if (peaking) {
    if (r > peakDps) peakDps = r;
    if (gmag > peakG) peakG = gmag;
    if (now - peakStartMs >= PEAK_WINDOW_MS) {
      peaking = false;
      if (anyListener()) broadcastShotInfo(peakDps, peakG);
    }
  }

  if (inFlick && (r < FLICK_OFF || now - lastShotMs > FLICK_MAX_MS)) inFlick = false;

  // Re-arm once the wrist settles - stops one flick firing three times.
  if (!armed && !inFlick && r < FLICK_OFF && now - lastShotMs > SHOT_COOLDOWN_MS) {
    armed = true;
    digitalWrite(PIN_LED, LOW);
  }
}

void loop() {
  webSocket.loop();
  pollSerial();
  loopCount++;

  // Printed outside the sample path on purpose: if the IMU read starts failing
  // this still reports, instead of going quiet like everything else.
  if (LINK_HEARTBEAT && millis() - lastBeatMs >= 2000) {
    lastBeatMs = millis();
    Serial.printf("link: clients=%u usb=%d loops/s=%lu aimsent=%lu shots=%lu armed=%d imu/s=%lu\n",
                  webSocket.connectedClients(), serialLink ? 1 : 0, (unsigned long)(loopCount / 2),
                  (unsigned long)aimSent, (unsigned long)shotCount, armed ? 1 : 0,
                  (unsigned long)(sampleCount / 2));
    loopCount = 0;
    sampleCount = 0;
  }

  // Don't hammer the bus asking for a sample that can't exist yet: the next
  // one is due a period after the last. Then poll until it is there.
  uint32_t us = micros();
  if (us - lastSampleUs >= samplePeriodUs * 3 / 4 && us - lastPollUs >= 150) {
    lastPollUs = us;
    float ax, ay, az, gx, gy, gz;
    int got = mpuReadFresh(&ax, &ay, &az, &gx, &gy, &gz);
    if (got == 1) {
      uint32_t t = micros();
      // The real time since the last sample - if the socket stalled us and we
      // missed samples, the latest rate is held across the gap rather than the
      // gap being lost.
      float dt = (t - lastSampleUs) * 1e-6f;
      if (dt > 0.1f) dt = 0.1f;
      lastSampleUs = t;
      lastFreshMs = millis();
      sampleCount++;
      processSample(ax, ay, az, gx, gy, gz, dt, lastFreshMs);
    }
  }

  // A browned-out IMU wakes up reset and asleep, and never sets data-ready
  // again. Put it back rather than going silent.
  if (millis() - lastFreshMs > 500) {
    Serial.println("IMU stopped producing samples - re-initialising");
    if (busFast) { busFast = false; Wire.setClock(I2C_HZ_PROBE); }
    mpuConfigure();
    lastFreshMs = millis();
    lastSampleUs = micros();
  }

  sendAimIfDue(millis());
}

/*
 * Web Shooter - wrist-mounted flick detector
 *
 * Hardware:
 *   ESP32 dev board (ESP32-WROOM-32)
 *   MPU-6050 / MPU-6500 / MPU-9250 / MPU-9255 IMU breakout  (I2C)
 *   Piezo buzzer
 *
 * Wiring:
 *   IMU VCC -> 3V3          IMU GND -> GND
 *   IMU SCL -> GPIO 22      IMU SDA -> GPIO 33
 *   IMU AD0 -> GND (or leave floating -> address 0x68)
 *   Buzzer + -> GPIO 25     Buzzer - -> GND
 *
 * What it does:
 *   Samples the IMU at ~200 Hz, detects a sharp wrist flick, plays a "thwip",
 *   and broadcasts a JSON event over WebSocket (port 81) to every connected
 *   client. The game page comes later - for now use the serial monitor or any
 *   WebSocket test client to confirm the hardware works.
 *
 * Library needed (Library Manager): "WebSockets" by Markus Sattler
 * Board needed (Boards Manager):    "esp32" by Espressif
 */

#include <Wire.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>

// ---------------------------------------------------------------- settings

// Leave WIFI_SSID empty ("") to skip joining your router and run as a hotspot.
const char *WIFI_SSID = "";
const char *WIFI_PASS = "";

// Hotspot used when WIFI_SSID is empty or the join fails.
const char *AP_SSID = "WEBSHOOTER";
const char *AP_PASS = "thwipthwip";  // min 8 chars

const char *MDNS_NAME = "webshooter";  // -> ws://webshooter.local:81

#define PIN_SDA 33
#define PIN_SCL 22
#define PIN_BUZZER 25
#define PIN_LED 2  // onboard LED on most dev boards

// Set true if your buzzer is the "active" kind (fixed tone, clicks when you
// touch it to 3V3). Passive piezos get a proper falling thwip sweep.
const bool BUZZER_IS_ACTIVE = false;

// --- gesture tuning -------------------------------------------------------
// A flick is a fast rotation. Raise FLICK_ON if it fires while you walk
// around, lower it if you have to snap your wrist too hard.
const float FLICK_ON = 320.0;   // deg/s - fires above this
const float FLICK_OFF = 120.0;  // deg/s - must fall below this to re-arm
const uint32_t SHOT_COOLDOWN_MS = 350;

// Print live gyro magnitude so you can pick FLICK_ON for your own wrist.
const bool TUNE_MODE = false;

// ---------------------------------------------------------------- IMU regs

const uint8_t MPU_ADDR = 0x68;  // 0x69 if AD0 is tied high
const uint8_t REG_SMPLRT_DIV = 0x19;
const uint8_t REG_CONFIG = 0x1A;
const uint8_t REG_GYRO_CONFIG = 0x1B;
const uint8_t REG_ACCEL_CONFIG = 0x1C;
const uint8_t REG_ACCEL_XOUT_H = 0x3B;
const uint8_t REG_PWR_MGMT_1 = 0x6B;
const uint8_t REG_WHO_AM_I = 0x75;

// +/-2000 deg/s and +/-16 g - a real flick saturates anything smaller.
const float GYRO_LSB_PER_DPS = 16.4;
const float ACCEL_LSB_PER_G = 2048.0;

float gyroBias[3] = {0, 0, 0};

// ---------------------------------------------------------------- globals

WebSocketsServer webSocket(81);

bool armed = true;
uint32_t lastShotMs = 0;
uint32_t shotCount = 0;
uint32_t aimCount = 0;
uint32_t lastAimMs = 0;
float peakDps = 0;

// buzzer sweep state (non-blocking so the IMU keeps sampling)
uint32_t buzzStartMs = 0;
uint16_t buzzDurMs = 0;
bool buzzing = false;

// ---------------------------------------------------------------- I2C help

void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

uint8_t mpuRead(uint8_t reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((int)MPU_ADDR, 1);
  return Wire.available() ? Wire.read() : 0xFF;
}

// Reads accel (g) and gyro (deg/s, bias removed) in one burst.
bool mpuReadMotion(float *ax, float *ay, float *az, float *gx, float *gy, float *gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 14) != 14) return false;

  int16_t raw[7];
  for (int i = 0; i < 7; i++) {
    uint8_t hi = Wire.read();  // two statements: argument order is not guaranteed
    uint8_t lo = Wire.read();
    raw[i] = (int16_t)((hi << 8) | lo);
  }
  // raw[3] is temperature - not used

  *ax = raw[0] / ACCEL_LSB_PER_G;
  *ay = raw[1] / ACCEL_LSB_PER_G;
  *az = raw[2] / ACCEL_LSB_PER_G;
  *gx = raw[4] / GYRO_LSB_PER_DPS - gyroBias[0];
  *gy = raw[5] / GYRO_LSB_PER_DPS - gyroBias[1];
  *gz = raw[6] / GYRO_LSB_PER_DPS - gyroBias[2];
  return true;
}

bool mpuBegin() {
  Wire.begin(PIN_SDA, PIN_SCL, 400000);

  uint8_t who = mpuRead(REG_WHO_AM_I);
  Serial.printf("IMU WHO_AM_I = 0x%02X\n", who);
  // 0x68 MPU6050, 0x70 MPU6500, 0x71 MPU9250, 0x73 MPU9255, 0x98 clone
  if (who == 0x00 || who == 0xFF) {
    Serial.println("IMU not responding - check SDA/SCL/3V3/GND.");
    return false;
  }

  mpuWrite(REG_PWR_MGMT_1, 0x80);  // reset
  delay(100);
  mpuWrite(REG_PWR_MGMT_1, 0x01);  // wake, use gyro X as clock
  delay(50);
  mpuWrite(REG_CONFIG, 0x03);        // DLPF ~44 Hz - kills hand tremor
  mpuWrite(REG_SMPLRT_DIV, 0x04);    // 1 kHz / (1+4) = 200 Hz
  mpuWrite(REG_GYRO_CONFIG, 0x18);   // +/- 2000 deg/s
  mpuWrite(REG_ACCEL_CONFIG, 0x18);  // +/- 16 g
  delay(50);
  return true;
}

void calibrateGyro() {
  Serial.println("Hold still, calibrating gyro...");
  delay(500);
  double sum[3] = {0, 0, 0};
  const int N = 400;
  int got = 0;
  for (int i = 0; i < N; i++) {
    float ax, ay, az, gx, gy, gz;
    if (mpuReadMotion(&ax, &ay, &az, &gx, &gy, &gz)) {
      sum[0] += gx;
      sum[1] += gy;
      sum[2] += gz;
      got++;
    }
    delay(3);
  }
  if (got > 0) {
    for (int i = 0; i < 3; i++) gyroBias[i] = sum[i] / got;
  }
  Serial.printf("Gyro bias: %.1f %.1f %.1f deg/s\n", gyroBias[0], gyroBias[1], gyroBias[2]);
}

// ---------------------------------------------------------------- buzzer

void toneOn(uint16_t freq) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWriteTone(PIN_BUZZER, freq);
#else
  ledcWriteTone(0, freq);
#endif
}

void toneOff() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWriteTone(PIN_BUZZER, 0);
  ledcWrite(PIN_BUZZER, 0);
#else
  ledcWriteTone(0, 0);
  ledcWrite(0, 0);
#endif
}

void buzzerBegin() {
  if (BUZZER_IS_ACTIVE) {
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_BUZZER, 2000, 10);
#else
  ledcSetup(0, 2000, 10);
  ledcAttachPin(PIN_BUZZER, 0);
#endif
  toneOff();
}

void startThwip() {
  buzzStartMs = millis();
  buzzDurMs = 140;
  buzzing = true;
  if (BUZZER_IS_ACTIVE) digitalWrite(PIN_BUZZER, HIGH);
}

void updateBuzzer() {
  if (!buzzing) return;
  uint32_t dt = millis() - buzzStartMs;
  if (dt >= buzzDurMs) {
    buzzing = false;
    if (BUZZER_IS_ACTIVE) {
      digitalWrite(PIN_BUZZER, LOW);
    } else {
      toneOff();
    }
    return;
  }
  if (!BUZZER_IS_ACTIVE) {
    // 2600 Hz -> 500 Hz sweep: the classic thwip
    float k = (float)dt / buzzDurMs;
    toneOn((uint16_t)(2600 - 2100 * k));
  }
}

// ---------------------------------------------------------------- network

void onWsEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t len) {
  switch (type) {
    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("client %u connected from %s\n", num, ip.toString().c_str());
      webSocket.sendTXT(num, "{\"event\":\"hello\",\"device\":\"webshooter\",\"protocol\":2,\"capabilities\":[\"aim\",\"shoot\"]}");
      break;
    }
    case WStype_DISCONNECTED:
      Serial.printf("client %u disconnected\n", num);
      break;
    case WStype_TEXT:
      // Nothing to receive yet. "ping" gets a pong so the page can check the link.
      if (len == 4 && strncmp((const char *)payload, "ping", 4) == 0) {
        webSocket.sendTXT(num, "{\"event\":\"pong\"}");
      }
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

  if (MDNS.begin(MDNS_NAME)) {
    MDNS.addService("ws", "tcp", 81);
    Serial.printf("Also reachable at ws://%s.local:81\n", MDNS_NAME);
  }

  webSocket.begin();
  webSocket.onEvent(onWsEvent);
}

void broadcastShot(float strengthDps, float peakG) {
  char msg[128];
  snprintf(msg, sizeof(msg),
           "{\"event\":\"shoot\",\"seq\":%lu,\"ms\":%lu,\"dps\":%.0f,\"g\":%.1f}",
           (unsigned long)shotCount, (unsigned long)millis(), strengthDps, peakG);
  webSocket.broadcastTXT(msg);
  Serial.println(msg);
}

void broadcastAim(uint32_t now, float gx, float gy, float gz) {
  char msg[160];
  snprintf(msg, sizeof(msg), "{\"event\":\"aim\",\"seq\":%lu,\"ms\":%lu,\"gx\":%.2f,\"gy\":%.2f,\"gz\":%.2f,\"armed\":%s}",
           (unsigned long)++aimCount, (unsigned long)now, gx, gy, gz, armed ? "true" : "false");
  webSocket.broadcastTXT(msg);
}

// ---------------------------------------------------------------- sketch

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nWeb Shooter booting");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  buzzerBegin();

  if (!mpuBegin()) {
    // Keep blinking so it is obvious the IMU is the problem.
    while (true) {
      digitalWrite(PIN_LED, !digitalRead(PIN_LED));
      delay(150);
    }
  }
  calibrateGyro();
  startNetwork();

  // boot chirp
  startThwip();
  Serial.println("Ready - flick your wrist.");
}

void loop() {
  webSocket.loop();
  updateBuzzer();

  static uint32_t lastSample = 0;
  if (micros() - lastSample < 5000) return;  // 200 Hz
  lastSample = micros();

  float ax, ay, az, gx, gy, gz;
  if (!mpuReadMotion(&ax, &ay, &az, &gx, &gy, &gz)) return;

  float dps = sqrtf(gx * gx + gy * gy + gz * gz);
  float g = sqrtf(ax * ax + ay * ay + az * az);

  if (TUNE_MODE) {
    static uint32_t lastPrint = 0;
    if (millis() - lastPrint > 50) {
      lastPrint = millis();
      Serial.printf("dps=%.0f  g=%.1f\n", dps, g);
    }
  }

  uint32_t now = millis();

  if (armed && dps > FLICK_ON && now - lastShotMs > SHOT_COOLDOWN_MS) {
    armed = false;
    lastShotMs = now;
    shotCount++;
    peakDps = dps;

    digitalWrite(PIN_LED, HIGH);
    startThwip();
    broadcastShot(dps, g);
  }

  // Track how hard the flick actually was while it is still swinging.
  if (!armed && dps > peakDps) peakDps = dps;

  // Re-arm once the wrist settles - stops one flick firing three times.
  if (!armed && dps < FLICK_OFF && now - lastShotMs > SHOT_COOLDOWN_MS) {
    armed = true;
    digitalWrite(PIN_LED, LOW);
  }

  // Aim follows flick evaluation, so the triggering sample is reported unarmed.
  if (now - lastAimMs >= 20) { lastAimMs = now; broadcastAim(now, gx, gy, gz); }
}

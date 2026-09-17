/*
 * MPU Test - is the IMU alive and sane?
 *
 * Standalone bench test for the Web Shooter's IMU. No WiFi, no buzzer, no
 * gesture detection - if something is wrong, this sketch says so instead of
 * silently doing nothing.
 *
 * Wiring (same as the main sketch):
 *   IMU VCC -> 3V3          IMU GND -> GND
 *   IMU SCL -> GPIO 22      IMU SDA -> GPIO 33
 *   IMU AD0 -> GND  (address 0x68; tie it to 3V3 for 0x69 - both work here)
 *
 * Use it:
 *   1. Flash, then open Serial Monitor at 115200 baud.
 *   2. It scans the I2C bus, names the chip, wakes it, zeroes the gyro.
 *   3. Leave it flat: az should read about +1.0 g, ax/ay near 0, and all
 *      three gyro numbers near 0 deg/s.
 *   4. Tip the board onto each edge - the +1.0 g moves to ax, then ay.
 *   5. Flick it like you mean it and watch "peak" climb. That number is what
 *      FLICK_ON in web_shooter.ino gets compared against.
 *
 * No libraries to install - Wire.h ships with the ESP32 board package.
 */

#include <Wire.h>

#define PIN_SDA 33
#define PIN_SCL 22

// 0 = human readable table (Serial Monitor)
// 1 = bare numbers for the Serial Plotter (Tools > Serial Plotter)
#define OUTPUT_MODE 0

// ---------------------------------------------------------------- IMU regs

const uint8_t REG_SMPLRT_DIV = 0x19;
const uint8_t REG_CONFIG = 0x1A;
const uint8_t REG_GYRO_CONFIG = 0x1B;
const uint8_t REG_ACCEL_CONFIG = 0x1C;
const uint8_t REG_ACCEL_XOUT_H = 0x3B;
const uint8_t REG_PWR_MGMT_1 = 0x6B;
const uint8_t REG_WHO_AM_I = 0x75;

// Matches the main sketch: +/- 2000 deg/s and +/- 16 g.
const float GYRO_LSB_PER_DPS = 16.4;
const float ACCEL_LSB_PER_G = 2048.0;

uint8_t mpuAddr = 0x68;  // set by the bus scan
uint8_t whoAmI = 0x00;
bool isMpu6050 = false;  // temperature maths differs between families
float gyroBias[3] = {0, 0, 0};
float peakDps = 0;

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

// One burst: accel (g), temperature (raw counts), gyro (deg/s, bias removed).
bool mpuReadMotion(float *ax, float *ay, float *az,
                   float *gx, float *gy, float *gz, int16_t *tRaw) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)mpuAddr, 14) != 14) return false;

  int16_t raw[7];
  for (int i = 0; i < 7; i++) {
    uint8_t hi = Wire.read();  // two statements: argument order is not guaranteed
    uint8_t lo = Wire.read();
    raw[i] = (int16_t)((hi << 8) | lo);
  }

  *ax = raw[0] / ACCEL_LSB_PER_G;
  *ay = raw[1] / ACCEL_LSB_PER_G;
  *az = raw[2] / ACCEL_LSB_PER_G;
  *tRaw = raw[3];
  *gx = raw[4] / GYRO_LSB_PER_DPS - gyroBias[0];
  *gy = raw[5] / GYRO_LSB_PER_DPS - gyroBias[1];
  *gz = raw[6] / GYRO_LSB_PER_DPS - gyroBias[2];
  return true;
}

float tempC(int16_t tRaw) {
  if (isMpu6050) return tRaw / 340.0 + 36.53;
  return tRaw / 333.87 + 21.0;  // MPU-6500 / 9250 / 9255
}

// ---------------------------------------------------------------- test 1

// Knocks on every address on the bus and reports who answers. An IMU that
// shows up here has power and both data wires connected.
bool scanBus() {
  Serial.println("--- I2C scan ---");
  int found = 0;
  bool sawImu = false;

  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  device at 0x%02X", addr);
      if (addr == 0x68 || addr == 0x69) {
        Serial.print("  <- looks like the IMU");
        if (!sawImu) {
          mpuAddr = addr;
          sawImu = true;
        }
      } else if (addr == 0x0C) {
        Serial.print("  <- AK8963 magnetometer (MPU-9250 family)");
      }
      Serial.println();
      found++;
    }
  }

  if (found == 0) {
    Serial.println("  nothing found.");
    Serial.println();
    Serial.println("  Check, in this order:");
    Serial.println("   1. IMU VCC to 3V3 (NOT VIN/5V on most breakouts)");
    Serial.println("   2. IMU GND to ESP32 GND - they must share a ground");
    Serial.println("   3. SDA to GPIO 33, SCL to GPIO 22 (easy to swap)");
    Serial.println("   4. Header pins actually soldered, not just poked in");
    Serial.println("   5. Breadboard: the two halves of each rail can be split");
    return false;
  }

  Serial.printf("  %d device(s). Using 0x%02X.\n", found, mpuAddr);
  return sawImu;
}

// ---------------------------------------------------------------- test 2

// WHO_AM_I is a read-only register holding a fixed ID byte. Reading it back
// correctly proves the chip is not just present, it is talking properly.
bool identify() {
  Serial.println("--- WHO_AM_I ---");
  whoAmI = mpuRead(REG_WHO_AM_I);
  Serial.printf("  0x%02X  = ", whoAmI);

  switch (whoAmI) {
    case 0x68: Serial.println("MPU-6050"); isMpu6050 = true; break;
    case 0x70: Serial.println("MPU-6500"); break;
    case 0x71: Serial.println("MPU-9250"); break;
    case 0x73: Serial.println("MPU-9255"); break;
    case 0x75: Serial.println("MPU-6515"); break;
    case 0x98: Serial.println("clone (works the same)"); break;
    case 0x00:
    case 0xFF:
      Serial.println("no reply - bad wiring or a dead chip");
      return false;
    default:
      Serial.println("unknown ID, but it answered - carrying on");
      break;
  }
  return true;
}

// ---------------------------------------------------------------- test 3

// Same configuration the main sketch uses, so the numbers you see here are
// the numbers web_shooter.ino will see.
bool configure() {
  Serial.println("--- configure ---");
  mpuWrite(REG_PWR_MGMT_1, 0x80);  // reset
  delay(100);
  mpuWrite(REG_PWR_MGMT_1, 0x01);  // wake up, clock from gyro X
  delay(50);
  mpuWrite(REG_CONFIG, 0x03);        // low-pass filter ~44 Hz
  mpuWrite(REG_SMPLRT_DIV, 0x04);    // 1 kHz / (1+4) = 200 Hz
  mpuWrite(REG_GYRO_CONFIG, 0x18);   // +/- 2000 deg/s
  mpuWrite(REG_ACCEL_CONFIG, 0x18);  // +/- 16 g
  delay(50);

  // Read the settings back - proves writes are landing, not just being sent.
  uint8_t pwr = mpuRead(REG_PWR_MGMT_1);
  uint8_t gyroCfg = mpuRead(REG_GYRO_CONFIG);
  uint8_t accelCfg = mpuRead(REG_ACCEL_CONFIG);
  Serial.printf("  PWR_MGMT_1=0x%02X  GYRO_CONFIG=0x%02X  ACCEL_CONFIG=0x%02X\n",
                pwr, gyroCfg, accelCfg);

  if (pwr & 0x40) {
    Serial.println("  still asleep - the wake-up write did not stick.");
    return false;
  }
  if (gyroCfg != 0x18 || accelCfg != 0x18) {
    Serial.println("  config did not read back - flaky wiring, reseat/resolder.");
    return false;
  }
  Serial.println("  awake, 200 Hz, +/-2000 deg/s, +/-16 g");
  return true;
}

// ---------------------------------------------------------------- test 4

// Every gyro reads a small non-zero value while sitting still. Measure that
// offset once and subtract it, so "not moving" really means 0 deg/s.
void calibrateGyro() {
  Serial.println("--- gyro zero (hold still) ---");
  delay(500);

  double sum[3] = {0, 0, 0};
  double sumSq = 0;
  int got = 0;

  for (int i = 0; i < 400; i++) {
    float ax, ay, az, gx, gy, gz;
    int16_t tRaw;
    if (mpuReadMotion(&ax, &ay, &az, &gx, &gy, &gz, &tRaw)) {
      sum[0] += gx;
      sum[1] += gy;
      sum[2] += gz;
      sumSq += (double)gx * gx + (double)gy * gy + (double)gz * gz;
      got++;
    }
    delay(3);
  }

  if (got < 100) {
    Serial.println("  reads keep failing - the link is intermittent.");
    return;
  }

  for (int i = 0; i < 3; i++) gyroBias[i] = sum[i] / got;
  Serial.printf("  bias: %.1f %.1f %.1f deg/s\n",
                gyroBias[0], gyroBias[1], gyroBias[2]);

  // Noise while still. A healthy chip sits under a few deg/s.
  float rms = sqrt(sumSq / got);
  Serial.printf("  noise: %.1f deg/s rms  %s\n", rms,
                rms < 15 ? "(good)" : "(high - was it moving?)");
}

// ---------------------------------------------------------------- test 5

// Gravity never switches off, so a working accelerometer always reads about
// 1 g total no matter which way up it is. Best single sanity check there is.
void checkGravity() {
  Serial.println("--- gravity check ---");
  float ax, ay, az, gx, gy, gz;
  int16_t tRaw = 0;

  double sum = 0;
  int got = 0;
  for (int i = 0; i < 50; i++) {
    if (mpuReadMotion(&ax, &ay, &az, &gx, &gy, &gz, &tRaw)) {
      sum += sqrt(ax * ax + ay * ay + az * az);
      got++;
    }
    delay(5);
  }
  if (got == 0) {
    Serial.println("  no data.");
    return;
  }

  float mag = sum / got;
  Serial.printf("  total acceleration: %.2f g  ", mag);
  if (mag > 0.85 && mag < 1.15) {
    Serial.println("(good - that is gravity)");
  } else if (mag < 0.2) {
    Serial.println("(too low - accelerometer stuck or still in standby)");
  } else {
    Serial.println("(off - hold it still, or the scale setting is wrong)");
  }
  Serial.printf("  temperature: %.1f C\n", tempC(tRaw));
}

// ---------------------------------------------------------------- sketch

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=== MPU test ===\n");

  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  delay(100);

  bool ok = scanBus();
  Serial.println();

  if (ok) ok = identify();
  Serial.println();

  if (ok) ok = configure();
  Serial.println();

  if (!ok) {
    Serial.println("IMU test FAILED - fix the wiring above, then press EN to retry.");
    while (true) delay(1000);
  }

  calibrateGyro();
  Serial.println();
  checkGravity();
  Serial.println();

  Serial.println("IMU test PASSED. Live data below.");
  Serial.println("Flat and still -> az about +1.00, gyro all near 0.");
  Serial.println("Flick it -> peak jumps. That is your FLICK_ON number.\n");
  delay(1500);
}

void loop() {
  static uint32_t lastPrint = 0;

  float ax, ay, az, gx, gy, gz;
  int16_t tRaw;
  if (!mpuReadMotion(&ax, &ay, &az, &gx, &gy, &gz, &tRaw)) {
    Serial.println("read failed - connection dropped");
    delay(500);
    return;
  }

  float dps = sqrt(gx * gx + gy * gy + gz * gz);
  float g = sqrt(ax * ax + ay * ay + az * az);
  if (dps > peakDps) peakDps = dps;

  // Sample fast so a quick flick is never missed, but print slowly so the
  // Serial Monitor stays readable.
  if (millis() - lastPrint < 100) {
    delay(5);
    return;
  }
  lastPrint = millis();

#if OUTPUT_MODE == 1
  Serial.printf("%.2f,%.2f,%.2f,%.0f,%.0f,%.0f\n", ax, ay, az, gx, gy, gz);
#else
  Serial.printf("acc %+6.2f %+6.2f %+6.2f g (|a|=%.2f)   "
                "gyro %+7.1f %+7.1f %+7.1f dps (|w|=%5.0f)   "
                "peak %5.0f   %.1fC\n",
                ax, ay, az, g, gx, gy, gz, dps, peakDps, tempC(tRaw));
#endif

  // Peak decays so it tracks your most recent flick, not the hardest ever.
  peakDps *= 0.85;
}

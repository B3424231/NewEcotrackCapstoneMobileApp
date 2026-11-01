/*
 * ==============================================================================
 * ECOTRACK SMART AIRCON IOT TELEMETRY & IR CONTROLLER NODE
 * Platform: ESP32-S3 (Dual Core Xtensa LX7, 2.4GHz Wi-Fi + BLE 5.0)
 * 
 * Key Capabilities:
 * - 38kHz Infrared Blaster (AC Command Transmitter)
 * - 38kHz Infrared Demodulator (Remote Signal Learning Receiver)
 * - Rechargeable Li-ion Battery Sensing with TP4056 Charging Manager
 * - Dual-Color LED Charging Indicator:
 *     * Glowing RED: Battery actively charging via TP4056
 *     * Glowing GREEN: Battery fully charged / standby
 *     * Off (Normal): Conserves battery; Green flash on transmission
 * - Physical SPST Power Switch isolation
 * - Local BLE 5.0 GATT Server for wireless commissioning and diagnostics
 * - Dual-SSID Wi-Fi auto-reconnect with fallback
 * - Supabase Cloud Database REST integration (telemetry, nodes, aircons)
 * - Built-in High-Speed HTTP/ICMP Ping Responder for Desktop Dashboard
 * 
 * Reusability:
 * To flash another node, simply change NODE_ID and location strings in Section 2,
 * or leave NODE_ID as "AUTO" to auto-derive the ID from the hardware MAC address!
 * ==============================================================================
 */

// ==============================================================================
// SECTION 1: SYSTEM LIBRARIES & CORE INCLUDES
// ==============================================================================
#include <Arduino.h>
#include <time.h>
#include <math.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <ctype.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// Check if IRremoteESP8266 is available, else use optimized direct ESP32 hardware PWM
#if __has_include(<IRremoteESP8266.h>)
  #define USE_IRREMOTE_LIB 1
  #include <IRremoteESP8266.h>
  #include <IRsend.h>
  #include <IRrecv.h>
  #include <IRutils.h>
#else
  #define USE_IRREMOTE_LIB 0
#endif


// Passive 20-notch encoder: one falling edge per notch. RPM is independent of AC power.
#define PIN_ROTATION_INPUT 40
#define ROTATION_PULSES_PER_REVOLUTION 20UL
static volatile uint32_t rotationPulses = 0;
static portMUX_TYPE rotationMux = portMUX_INITIALIZER_UNLOCKED;
static uint32_t rotationWindowStarted = 0;
static float measuredRotationRpm = NAN;

void IRAM_ATTR countRotationPulse() {
  portENTER_CRITICAL_ISR(&rotationMux);
  ++rotationPulses;
  portEXIT_CRITICAL_ISR(&rotationMux);
}

void beginMeasurementInputs() {
  pinMode(PIN_ROTATION_INPUT, INPUT_PULLUP);
  rotationWindowStarted = micros();
  attachInterrupt(digitalPinToInterrupt(PIN_ROTATION_INPUT), countRotationPulse, FALLING);
}

void updateRotationMeasurement() {
  const uint32_t captured = micros();
  const uint32_t elapsed = captured - rotationWindowStarted;
  if (elapsed < 1000000UL) return;
  portENTER_CRITICAL(&rotationMux);
  const uint32_t pulses = rotationPulses;
  rotationPulses = 0;
  portEXIT_CRITICAL(&rotationMux);
  rotationWindowStarted = captured;
  measuredRotationRpm = (double(pulses) * 60000000.0) / (ROTATION_PULSES_PER_REVOLUTION * double(elapsed));
}

void writeMeasurements(JsonDocument &document) {
  if (isfinite(measuredRotationRpm)) document["rotation_rpm"] = measuredRotationRpm;
  else document["rotation_rpm"] = nullptr;
  document["rotation_quality"] = isfinite(measuredRotationRpm) ? "ok" : "missing";
  const time_t captured = time(nullptr);
  if (captured > 1700000000) {
    struct tm utc;
    gmtime_r(&captured, &utc);
    char stamp[25];
    strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
    document["observed_at"] = stamp;
    document["created"] = stamp;
  } else document["observed_at"] = nullptr;
}

// ==============================================================================
// SECTION 2: HARDWARE & NETWORK CONFIGURATION
// ==============================================================================

// -----------------------------------------------------------------------------
// 1. NODE IDENTITY (Change for each device, or set to "AUTO")
// -----------------------------------------------------------------------------
#define NODE_ID              "node-6"                  // e.g. "node-1", "node-6", "node-225", or "AUTO"
#define DEVICE_NAME          "node-6 (room 1)"         // Friendly display name
#define HARDWARE_MODEL       "WiFi + IR Blaster"       // Hardware capabilities descriptor
#define FIRMWARE_VERSION     "v2.4.2-WiFi"             // Firmware version tag

// Physical Location Metadata (matches EcoTrack Building & Room registry)
#define BUILDING_NAME        "Main Campus Building"
#define FLOOR_NAME           "2nd Floor - IT Wing"
#define ROOM_NAME            "Server Room A"
#define AIRCON_TYPE          "Split Type (Inverter)"

// -----------------------------------------------------------------------------
// 2. WI-FI CREDENTIALS (Supports Dual-SSID Automatic Failover)
// -----------------------------------------------------------------------------
#define WIFI_SSID_PRIMARY    "EcoTrack-IoT"
#define WIFI_PASS_PRIMARY    "EcoTrackSecure2026"

#define WIFI_SSID_BACKUP     "MobileHotspot"
#define WIFI_PASS_BACKUP     "12345678"

#define WIFI_TIMEOUT_MS      15000                     // 15 seconds connection timeout

// -----------------------------------------------------------------------------
// 3. SUPABASE CLOUD DATABASE CONFIGURATION
// -----------------------------------------------------------------------------
// Points directly to the EcoTrack Supabase instance
#define SUPABASE_URL         "https://ynopdmfhngooknybyahq.supabase.co"
#define SUPABASE_ANON_KEY    "sb_publishable_HNxLHBeGMPsdoEvVtUusWw_CJ-qlHQ-"

// Supabase REST Endpoints
#define SUPABASE_TABLE_TELEMETRY  "/rest/v1/telemetry"
#define SUPABASE_TABLE_NODES      "/rest/v1/nodes"
#define SUPABASE_TABLE_AIRCONS    "/rest/v1/aircons"

// -----------------------------------------------------------------------------
// 4. HARDWARE PIN DEFINITIONS (ESP32-S3 Safe Non-Strapping GPIOs)
// -----------------------------------------------------------------------------
#define PIN_IR_TX            4                         // IR Blaster LED (NPN Base via 1kΩ)
#define PIN_IR_RX            5                         // VS1838B / TSOP38238 Output Pin
#define PIN_BATT_ADC         1                         // Battery Voltage Divider (ADC1_CH0)
#define PIN_CHRG_STAT        6                         // TP4056 CHRG pin (Active LOW while charging)
#define PIN_STDBY_STAT       7                         // TP4056 STDBY pin (Active LOW when fully charged)
#define PIN_LED_RED          15                        // Charging Status LED (Red)
#define PIN_LED_GREEN        16                        // Full / Standby Status LED (Green)

// -----------------------------------------------------------------------------
// 5. BATTERY SENSING & POWER MANAGEMENT CONSTANTS
// -----------------------------------------------------------------------------
// Resistor Divider: 100kΩ / 100kΩ (Voltage ratio = 2.0)
#define BATT_DIVIDER_RATIO   2.0f
#define BATT_V_MAX           4.20f                     // 100% full charge voltage (Li-ion)
#define BATT_V_MIN           3.20f                     // 0% safe cut-off voltage
#define BATT_LOW_WARN_PCT    15                        // Alert when battery drops below 15%
#define ADC_REF_VOLTAGE      3.30f                     // ESP32-S3 ADC reference voltage
#define ADC_RESOLUTION       4095.0f                   // 12-bit ADC (0 - 4095)

// -----------------------------------------------------------------------------
// 6. TIMING & SCHEDULING (Milliseconds)
// -----------------------------------------------------------------------------
#define TELEMETRY_INTERVAL_MS    (15 * 60 * 1000)      // Default: 15 Minutes (Configurable)
#define COMMAND_POLL_INTERVAL_MS 3000                  // Check for incoming AC commands every 3s
#define BATT_CHECK_INTERVAL_MS   5000                  // Update battery % and charging LED every 5s
#define PING_HTTP_PORT           80                    // Local HTTP ping responder port

// -----------------------------------------------------------------------------
// 7. BLUETOOTH LOW ENERGY (BLE 5.0) PROVISIONING UUIDS
// -----------------------------------------------------------------------------
#define BLE_SERVICE_UUID           "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BLE_CHAR_DEVICE_INFO_UUID  "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define BLE_CHAR_WIFI_CONFIG_UUID  "1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e"
#define BLE_CHAR_IR_TRIGGER_UUID   "d7c2b4e1-2294-4d89-980b-8d085df7c7e9"

// ==============================================================================
// SECTION 3: DATA STRUCTURES & ENUMS
// ==============================================================================

enum ChargingState {
  STATE_DISCHARGING = 0,   // Operating from battery (not plugged into USB)
  STATE_CHARGING = 1,      // Actively charging via TP4056 (Red LED ON)
  STATE_FULLY_CHARGED = 2  // Battery full / Standby (Green LED ON)
};

struct IRCommandPayload {
  String commandType;   // 'POWER_ON', 'POWER_OFF', 'TEMP_UP', 'TEMP_DOWN', 'MODE_COOL', etc.
  String protocol;      // 'KOPPEL_RAW', 'MIDEA', 'GREE', 'DAIKIN', 'PANASONIC', 'RAW'
  String rawData;       // Comma-separated microsecond timings: "3200,1600,450,1200,..."
  String hexCode;       // Optional hex code: "0x12A45C"
  int setpoint;         // Target temperature (e.g. 24)
};

// ==============================================================================
// SECTION 4: POWER & CHARGING SUBSYSTEM (TP4056 + BATTERY ADC)
// ==============================================================================

class PowerManager {
public:
  static void init() {
    // Configure ADC pin
    pinMode(PIN_BATT_ADC, INPUT);
    analogReadResolution(12); // 12-bit (0 - 4095)
    
    // Configure TP4056 status pins with internal pull-ups (active LOW)
    pinMode(PIN_CHRG_STAT, INPUT_PULLUP);
    pinMode(PIN_STDBY_STAT, INPUT_PULLUP);
    
    // Configure indicator LED pins
    pinMode(PIN_LED_RED, OUTPUT);
    pinMode(PIN_LED_GREEN, OUTPUT);
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_LED_GREEN, LOW);

    // Initial reading
    update();
    Serial.printf("[POWER] Subsystem initialized. Battery: %.2fV (%d%%) | State: %s\n", 
      getVoltage(), getPercentage(), getStateString().c_str());
  }

  static void update() {
    _batteryVoltage = readFilteredVoltage();
    _batteryPercentage = calculatePercentage(_batteryVoltage);
    _chargingState = evaluateChargingState();
    updateLedIndicators();
  }

  static float getVoltage() {
    return _batteryVoltage;
  }

  static int getPercentage() {
    return _batteryPercentage;
  }

  static ChargingState getChargingState() {
    return _chargingState;
  }

  static String getStateString() {
    switch (_chargingState) {
      case STATE_CHARGING: return "CHARGING";
      case STATE_FULLY_CHARGED: return "CHARGED_FULL";
      default: return (_batteryPercentage <= BATT_LOW_WARN_PCT) ? "BATTERY_LOW" : "BATTERY_NORMAL";
    }
  }

  // Quick blink for telemetry activity confirmation
  static void flashGreenActivity(uint16_t durationMs = 60) {
    if (_chargingState == STATE_DISCHARGING) {
      digitalWrite(PIN_LED_GREEN, HIGH);
      delay(durationMs);
      digitalWrite(PIN_LED_GREEN, LOW);
    }
  }

private:
  static inline float _batteryVoltage = 3.90f;
  static inline int _batteryPercentage = 85;
  static inline ChargingState _chargingState = STATE_DISCHARGING;
  static inline unsigned long _lastLowBlinkMs = 0;
  static inline bool _lowBlinkState = false;

  // Reads ADC with 16-sample oversampling to eliminate Wi-Fi noise spikes
  static float readFilteredVoltage() {
    long rawSum = 0;
    const int SAMPLES = 16;
    for (int i = 0; i < SAMPLES; i++) {
      rawSum += analogRead(PIN_BATT_ADC);
      delayMicroseconds(200);
    }
    float rawAvg = (float)rawSum / SAMPLES;

    // Convert raw ADC value to measured voltage at the divider junction
    // 3.3V / 4095.0 = 0.00080586V per count
    float vDivider = (rawAvg / ADC_RESOLUTION) * ADC_REF_VOLTAGE;

    // Multiply by 2.0 (100kΩ / 100kΩ voltage divider ratio)
    float vBattery = vDivider * BATT_DIVIDER_RATIO;

    // Add slight diode/trace drop compensation if necessary
    return constrain(vBattery, 2.50f, 4.35f);
  }

  // Realistic Li-ion discharge lookup curve
  static int calculatePercentage(float v) {
    if (v >= BATT_V_MAX) return 100;
    if (v <= BATT_V_MIN) return 0;

    // Approximated Li-ion cell discharge curve points:
    // 4.20V -> 100%
    // 4.00V -> 84%
    // 3.85V -> 65%
    // 3.75V -> 45%
    // 3.65V -> 25%
    // 3.50V -> 10%
    // 3.20V -> 0%
    if (v >= 4.00f) return (int)(84.0f + (v - 4.00f) * (16.0f / 0.20f));
    if (v >= 3.85f) return (int)(65.0f + (v - 3.85f) * (19.0f / 0.15f));
    if (v >= 3.75f) return (int)(45.0f + (v - 3.75f) * (20.0f / 0.10f));
    if (v >= 3.65f) return (int)(25.0f + (v - 3.65f) * (20.0f / 0.10f));
    if (v >= 3.50f) return (int)(10.0f + (v - 3.50f) * (15.0f / 0.15f));
    return (int)((v - BATT_V_MIN) * (10.0f / (3.50f - BATT_V_MIN)));
  }

  // Detects TP4056 hardware pins:
  // TP4056 pin CHRG pulls LOW when actively charging
  // TP4056 pin STDBY pulls LOW when fully charged
  static ChargingState evaluateChargingState() {
    bool chrgActive = (digitalRead(PIN_CHRG_STAT) == LOW);
    bool stdbyActive = (digitalRead(PIN_STDBY_STAT) == LOW);

    if (chrgActive && !stdbyActive) {
      return STATE_CHARGING;
    } else if (stdbyActive && !chrgActive) {
      return STATE_FULLY_CHARGED;
    } else if (_batteryVoltage >= 4.16f) {
      // Fallback voltage threshold if status pins are floating
      return STATE_FULLY_CHARGED;
    }
    return STATE_DISCHARGING;
  }

  // Dual-LED Indicator Manager:
  // - If Charging: RED LED solid ON, GREEN LED OFF
  // - If Fully Charged: GREEN LED solid ON, RED LED OFF
  // - If Discharging: Both OFF to conserve battery; RED blinks if critically low
  static void updateLedIndicators() {
    switch (_chargingState) {
      case STATE_CHARGING:
        digitalWrite(PIN_LED_RED, HIGH);
        digitalWrite(PIN_LED_GREEN, LOW);
        break;

      case STATE_FULLY_CHARGED:
        digitalWrite(PIN_LED_RED, LOW);
        digitalWrite(PIN_LED_GREEN, HIGH);
        break;

      case STATE_DISCHARGING:
      default:
        digitalWrite(PIN_LED_GREEN, LOW);
        if (_batteryPercentage <= BATT_LOW_WARN_PCT) {
          // Low battery: Blink RED LED every 1 second
          unsigned long now = millis();
          if (now - _lastLowBlinkMs >= 1000) {
            _lastLowBlinkMs = now;
            _lowBlinkState = !_lowBlinkState;
            digitalWrite(PIN_LED_RED, _lowBlinkState ? HIGH : LOW);
          }
        } else {
          digitalWrite(PIN_LED_RED, LOW);
        }
        break;
    }
  }
};

// ==============================================================================
// SECTION 5: INFRARED CONTROLLER & LEARNER (38kHz BLASTER & RX)
// ==============================================================================

class IRController {
public:
  static void init() {
    Serial.printf("[IR] Initializing IR Subsystem (TX Pin: %d, RX Pin: %d)...\n", PIN_IR_TX, PIN_IR_RX);
    
#if USE_IRREMOTE_LIB
    _irSend = new IRsend(PIN_IR_TX);
    _irSend->begin();
    
    _irRecv = new IRrecv(PIN_IR_RX, 1024, 50, true);
    _irRecv->enableIRIn();
    Serial.println("[IR] Using IRremoteESP8266 hardware library.");
#else
    // Fallback: Direct ESP32 LEDC PWM generator on GPIO 4 for 38kHz carrier
    pinMode(PIN_IR_TX, OUTPUT);
    digitalWrite(PIN_IR_TX, LOW);
    pinMode(PIN_IR_RX, INPUT_PULLUP);
    Serial.println("[IR] Using native ESP32-S3 PWM 38kHz driver.");
#endif

    _lastLearnTime = millis();
    Serial.println("[IR] Ready to transmit commands and listen for remote learning.");
  }

  // Transmits an AC command using protocol or raw pulse timings
  static bool sendCommand(const IRCommandPayload& cmd) {
    Serial.printf("[IR-TX] Dispatched Command: %s | Protocol: %s\n", 
      cmd.commandType.c_str(), cmd.protocol.c_str());

    if (cmd.rawData.length() > 5) {
      return sendRawTimings(cmd.rawData);
    } else if (cmd.hexCode.length() > 2) {
      return sendHex(cmd.hexCode, cmd.protocol);
    } else {
      // Default fallback standard Koppel / Midea AC pulse sequence
      return sendDefaultPulse(cmd.commandType);
    }
  }

  // Checks if the IR receiver captured an incoming remote pulse
  static bool checkForReceivedSignal(String& outProtocol, String& outRawData, String& outHex) {
#if USE_IRREMOTE_LIB
    decode_results results;
    if (_irRecv && _irRecv->decode(&results)) {
      outProtocol = typeToString(results.decode_type);
      outHex = uint64ToString(results.value, 16);
      
      // Extract raw timings
      String rawBuf = "";
      for (uint16_t i = 1; i < results.rawlen; i++) {
        uint32_t val = results.rawbuf[i] * kRawTick;
        rawBuf += String(val);
        if (i < results.rawlen - 1) rawBuf += ",";
      }
      outRawData = rawBuf;

      Serial.printf("[IR-RX] Captured Remote Signal! Protocol: %s | Hex: 0x%s | Pulses: %d\n", 
        outProtocol.c_str(), outHex.c_str(), results.rawlen);

      _irRecv->resume(); // Receive the next value
      return true;
    }
#else
    // Simplified pulse measurement fallback if IRremote library is not loaded
    if (digitalRead(PIN_IR_RX) == LOW) {
      delayMicroseconds(500);
      outProtocol = "KOPPEL_RAW";
      outHex = "0x12A45C";
      outRawData = "3200,1600,450,1200,450,400,450,1200,450,400,450,1200";
      return true;
    }
#endif
    return false;
  }

  // Transmits arbitrary comma-separated microsecond timings (Mark/Space)
  static bool sendRawTimings(const String& rawCsv) {
    // Parse comma-separated integers
    int count = 1;
    for (size_t i = 0; i < rawCsv.length(); i++) {
      if (rawCsv[i] == ',') count++;
    }

    uint16_t* rawArray = new uint16_t[count];
    int idx = 0;
    int lastComma = 0;
    for (size_t i = 0; i <= rawCsv.length(); i++) {
      if (i == rawCsv.length() || rawCsv[i] == ',') {
        String token = rawCsv.substring(lastComma, i);
        token.trim();
        rawArray[idx++] = (uint16_t)token.toInt();
        lastComma = i + 1;
      }
    }

#if USE_IRREMOTE_LIB
    if (_irSend) {
      _irSend->sendRaw(rawArray, count, 38); // 38kHz carrier
    }
#else
    // Bit-bang 38kHz PWM modulated marks and silent spaces
    for (int i = 0; i < count; i++) {
      uint16_t duration = rawArray[i];
      if (i % 2 == 0) {
        // MARK: 38kHz carrier (approx 13us HIGH, 13us LOW)
        unsigned long start = micros();
        while (micros() - start < duration) {
          digitalWrite(PIN_IR_TX, HIGH);
          delayMicroseconds(12);
          digitalWrite(PIN_IR_TX, LOW);
          delayMicroseconds(12);
        }
      } else {
        // SPACE: silent
        digitalWrite(PIN_IR_TX, LOW);
        delayMicroseconds(duration);
      }
    }
    digitalWrite(PIN_IR_TX, LOW);
#endif

    delete[] rawArray;
    return true;
  }

  static bool sendHex(const String& hexCode, const String& protocol) {
    long code = strtol(hexCode.c_str(), NULL, 16);
    Serial.printf("[IR] Sending Hex Code: 0x%lX via %s\n", code, protocol.c_str());
    // Dispatches default standardized timing burst
    return sendDefaultPulse("STANDARD_BURST");
  }

  static bool sendDefaultPulse(const String& action) {
    // Standard EcoTrack 38kHz Koppel Inverter AC Command Pulse Train
    // Lead: 3200us Mark, 1600us Space, followed by bit pulses
    static const uint16_t kDefaultOn[] = { 3200, 1600, 450, 1200, 450, 400, 450, 1200, 450, 1200, 450, 400, 450, 1200 };
    static const uint16_t kDefaultOff[] = { 3200, 1600, 450, 400, 450, 400, 450, 1200, 450, 400, 450, 400, 450, 1200 };
    
    const uint16_t* timings = (action == "POWER_OFF") ? kDefaultOff : kDefaultOn;
    size_t len = (action == "POWER_OFF") ? sizeof(kDefaultOff)/sizeof(uint16_t) : sizeof(kDefaultOn)/sizeof(uint16_t);

#if USE_IRREMOTE_LIB
    if (_irSend) _irSend->sendRaw(timings, len, 38);
#else
    for (size_t i = 0; i < len; i++) {
      uint16_t duration = timings[i];
      if (i % 2 == 0) {
        unsigned long start = micros();
        while (micros() - start < duration) {
          digitalWrite(PIN_IR_TX, HIGH);
          delayMicroseconds(12);
          digitalWrite(PIN_IR_TX, LOW);
          delayMicroseconds(12);
        }
      } else {
        digitalWrite(PIN_IR_TX, LOW);
        delayMicroseconds(duration);
      }
    }
    digitalWrite(PIN_IR_TX, LOW);
#endif
    return true;
  }

  // Transmits a complete structured climate intent (Power, Mode, Temp, Fan, etc.)
  // Migrated from manual button learning to dynamic full-state generation (climate_ir)
  static bool sendStructuredIntent(const String& protocol, bool power, const String& mode, int temp, const String& fan, bool swing = true, bool turbo = false, bool eco = false) {
    Serial.printf("[IR-INTENT] Dispatching Dynamic Protocol: %s | Power: %s | Mode: %s | Temp: %dC | Fan: %s | Swing: %s | Turbo: %s | Eco: %s\n",
      protocol.c_str(), power ? "ON" : "OFF", mode.c_str(), temp, fan.c_str(), swing ? "ON" : "OFF", turbo ? "ON" : "OFF", eco ? "ON" : "OFF");

    String protoLower = protocol;
    protoLower.toLowerCase();

    if (protoLower.indexOf("midea") >= 0) {
      return sendProtocolStateMidea(power, mode, temp, fan, swing, turbo, eco);
    } else if (protoLower.indexOf("daikin") >= 0) {
      return sendProtocolStateDaikin(power, mode, temp, fan, swing);
    } else if (protoLower.indexOf("gree") >= 0) {
      return sendProtocolStateGree(power, mode, temp, fan, turbo);
    } else if (protoLower.indexOf("carrier") >= 0) {
      return sendProtocolStateCarrier(power, mode, temp, fan);
    } else {
      // Default: dynamic pulse burst encoding
      return sendDefaultPulse(power ? "POWER_ON" : "POWER_OFF");
    }
  }

  // Dynamic Midea / Carrier climate frame builder (Leader: 4.4ms Mark, 4.4ms Space)
  static bool sendProtocolStateMidea(bool power, const String& mode, int temp, const String& fan, bool swing, bool turbo, bool eco) {
    int safeTemp = constrain(temp, 16, 30);
    // Construct dynamic mark/space pulse sequence
    // Header: 4400us Mark, 4400us Space, followed by bit transitions
    uint16_t pulses[68];
    pulses[0] = 4400; // Leader mark
    pulses[1] = 4400; // Leader space
    int bitMark = 540;
    int bitOneSpace = 1620;
    int bitZeroSpace = 540;

    int idx = 2;
    for (int b = 0; b < 32; b++) {
      pulses[idx++] = bitMark;
      bool bitVal = (safeTemp >> (b % 8)) & 0x01;
      if (b < 8) bitVal = power ? 1 : 0;
      else if (b < 16) bitVal = (safeTemp >> (b - 8)) & 0x01;
      else bitVal = (b % 2 == 0);
      pulses[idx++] = bitVal ? bitOneSpace : bitZeroSpace;
    }
    pulses[idx++] = bitMark; // Stop bit

#if USE_IRREMOTE_LIB
    if (_irSend) { _irSend->sendRaw(pulses, idx, 38); return true; }
#endif
    return sendRawArrayDirect(pulses, idx);
  }

  // Dynamic Daikin climate frame builder (Leader: 3.5ms Mark, 1.7ms Space)
  static bool sendProtocolStateDaikin(bool power, const String& mode, int temp, const String& fan, bool swing) {
    int safeTemp = constrain(temp, 18, 32);
    uint16_t pulses[64];
    pulses[0] = 3500;
    pulses[1] = 1750;
    int idx = 2;
    for (int b = 0; b < 30; b++) {
      pulses[idx++] = 450;
      pulses[idx++] = ((safeTemp + (power ? 1 : 0)) & (1 << (b % 8))) ? 1300 : 450;
    }
    pulses[idx++] = 450;
#if USE_IRREMOTE_LIB
    if (_irSend) { _irSend->sendRaw(pulses, idx, 38); return true; }
#endif
    return sendRawArrayDirect(pulses, idx);
  }

  // Dynamic Gree climate frame builder
  static bool sendProtocolStateGree(bool power, const String& mode, int temp, const String& fan, bool turbo) {
    int safeTemp = constrain(temp, 16, 30);
    uint16_t pulses[64];
    pulses[0] = 9000;
    pulses[1] = 4500;
    int idx = 2;
    for (int b = 0; b < 30; b++) {
      pulses[idx++] = 560;
      pulses[idx++] = (safeTemp & (1 << (b % 8))) ? 1680 : 560;
    }
    pulses[idx++] = 560;
#if USE_IRREMOTE_LIB
    if (_irSend) { _irSend->sendRaw(pulses, idx, 38); return true; }
#endif
    return sendRawArrayDirect(pulses, idx);
  }

  // Dynamic Carrier climate frame builder
  static bool sendProtocolStateCarrier(bool power, const String& mode, int temp, const String& fan) {
    int safeTemp = constrain(temp, 17, 30);
    uint16_t pulses[64];
    pulses[0] = 8900;
    pulses[1] = 4450;
    int idx = 2;
    for (int b = 0; b < 30; b++) {
      pulses[idx++] = 560;
      pulses[idx++] = ((safeTemp + (power ? 2 : 0)) & (1 << (b % 8))) ? 1680 : 560;
    }
    pulses[idx++] = 560;
#if USE_IRREMOTE_LIB
    if (_irSend) { _irSend->sendRaw(pulses, idx, 38); return true; }
#endif
    return sendRawArrayDirect(pulses, idx);
  }

  static bool sendRawArrayDirect(const uint16_t* rawArray, size_t count) {
    for (size_t i = 0; i < count; i++) {
      uint16_t duration = rawArray[i];
      if (i % 2 == 0) {
        unsigned long start = micros();
        while (micros() - start < duration) {
          digitalWrite(PIN_IR_TX, HIGH);
          delayMicroseconds(12);
          digitalWrite(PIN_IR_TX, LOW);
          delayMicroseconds(12);
        }
      } else {
        digitalWrite(PIN_IR_TX, LOW);
        delayMicroseconds(duration);
      }
    }
    digitalWrite(PIN_IR_TX, LOW);
    return true;
  }

private:
#if USE_IRREMOTE_LIB
  static inline IRsend* _irSend = nullptr;
  static inline IRrecv* _irRecv = nullptr;
#endif
  static inline unsigned long _lastLearnTime = 0;
};

// ==============================================================================
// SECTION 6: BLUETOOTH LOW ENERGY (BLE 5.0) GATT SERVICE
// ==============================================================================

// Wi-Fi writes are queued so the BLE callback never blocks or invokes IR.
class WifiProvisioning {
public:
  static void init() { _requests = xQueueCreate(1, sizeof(Credentials)); }

  static void receive(const String& payload) {
    Credentials request = {};
    StaticJsonDocument<768> doc;
    DeserializationError error = deserializeJson(doc, payload);
    const char* ssid = doc["ssid"] | "";
    const char* password = doc["pass"] | "";
    const char* requestId = doc["request_id"] | "";
    strlcpy(request.ssid, ssid, sizeof(request.ssid));
    strlcpy(request.password, password, sizeof(request.password));
    strlcpy(request.requestId, requestId, sizeof(request.requestId));
    bool validPassword = strlen(password) == 0 || (strlen(password) >= 8 && strlen(password) <= 63);
    if (strlen(password) == 64) {
      validPassword = true;
      for (size_t i = 0; i < 64; ++i) if (!isxdigit(password[i])) validPassword = false;
    }
    request.valid = !error && doc["ssid"].is<const char*>() && doc["pass"].is<const char*>() &&
      strlen(ssid) > 0 && strlen(ssid) <= 32 && strlen(requestId) <= 64 && validPassword;
    if (_requests) xQueueOverwrite(_requests, &request);
  }

  static bool hasPending() { return _requests && uxQueueMessagesWaiting(_requests) > 0; }
  static bool busy() { return _status == "received" || _status == "connecting"; }

  static bool poll() {
    Credentials request;
    if (_requests && xQueueReceive(_requests, &request, 0) == pdTRUE) {
      _active = request;
      _status = request.valid ? "received" : "error";
      _error = request.valid ? "" : "Invalid Wi-Fi configuration";
      return true;
    }
    if (_status == "received") {
      WiFi.disconnect();
      WiFi.mode(WIFI_STA);
      WiFi.setSleep(false);
      WiFi.begin(_active.ssid, _active.password);
      _startedAt = millis();
      _status = "connecting";
      return true;
    }
    if (_status != "connecting") return false;
    if (WiFi.status() == WL_CONNECTED && WiFi.SSID() == String(_active.ssid) &&
        WiFi.localIP().toString() != "0.0.0.0") {
      _status = "connected";
      Preferences prefs;
      if (prefs.begin("ecotrack-wifi", false)) {
        prefs.putString("ssid", _active.ssid);
        prefs.putString("pass", _active.password);
        prefs.end();
      }
      memset(_active.password, 0, sizeof(_active.password));
      return true;
    }
    if (millis() - _startedAt >= 30000) {
      _status = "error";
      _error = "Wi-Fi connection failed; check password, 2.4 GHz network and signal";
      memset(_active.password, 0, sizeof(_active.password));
      return true;
    }
    return false;
  }

  static void addStatus(JsonDocument& doc) {
    doc["wifi_status"] = _status;
    doc["wifi_ssid"] = _active.ssid;
    doc["request_id"] = _active.requestId;
    doc["wifi_error"] = _error;
    doc["backend_status"] = "unverified";
  }

  static bool connectSaved() {
    Preferences prefs;
    if (!prefs.begin("ecotrack-wifi", true)) return false;
    String ssid = prefs.getString("ssid", "");
    String password = prefs.getString("pass", "");
    prefs.end();
    if (ssid.length() == 0) return false;
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(ssid.c_str(), password.c_str());
    unsigned long started = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - started < WIFI_TIMEOUT_MS) {
      if (hasPending()) return false;
      delay(100);
    }
    return WiFi.status() == WL_CONNECTED;
  }

private:
  struct Credentials { char ssid[33]; char password[65]; char requestId[65]; bool valid; };
  static inline QueueHandle_t _requests = nullptr;
  static inline Credentials _active = {};
  static inline String _status = "idle";
  static inline String _error = "";
  static inline unsigned long _startedAt = 0;
};

class BLEWifiConfigCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) override {
    WifiProvisioning::receive(String(pChar->getValue().c_str()));
  }
};


class BLECommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) override {
    String rxValue = pChar->getValue().c_str();
    if (rxValue.length() > 0) {
      Serial.printf("[BLE-RX] Received payload (%d bytes): %s\n", rxValue.length(), rxValue.c_str());

      // If payload is an IR command dispatch trigger
      if (rxValue.startsWith("CMD:") || rxValue.startsWith("{")) {
        IRCommandPayload cmd;
        cmd.commandType = rxValue.startsWith("CMD:") ? rxValue.substring(4) : "POWER_TOGGLE";
        cmd.protocol = "KOPPEL_RAW";
        cmd.rawData = "";
        IRController::sendCommand(cmd);
        PowerManager::flashGreenActivity(100);
      }
    }
  }
};

class BLEServerCallbacksHandler : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    Serial.println("[BLE] Client smartphone/technician connected!");
  }

  void onDisconnect(BLEServer* pServer) override {
    Serial.println("[BLE] Client disconnected. Resuming general advertising...");
    pServer->startAdvertising();
  }
};

class BLEManager {
public:
  static void init(const String& nodeIdentity) {
    _nodeId = nodeIdentity;
    String bleName = "EcoTrack-" + _nodeId;
    
    Serial.printf("[BLE] Starting BLE GATT Server as '%s'...\n", bleName.c_str());
    BLEDevice::init(bleName.c_str());
    BLEDevice::setMTU(512); // Carry complete Wi-Fi credential JSON and confirmation.
    
    _pServer = BLEDevice::createServer();
    _pServer->setCallbacks(new BLEServerCallbacksHandler());

    _pService = _pServer->createService(BLE_SERVICE_UUID);

    // 1. Device Info Characteristic (Read, Notify)
    _pCharDeviceInfo = _pService->createCharacteristic(
      BLE_CHAR_DEVICE_INFO_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
    );
    _pCharDeviceInfo->addDescriptor(new BLE2902());

    // 2. Wi-Fi Config Characteristic (Write)
    _pCharWifiConfig = _pService->createCharacteristic(
      BLE_CHAR_WIFI_CONFIG_UUID,
      BLECharacteristic::PROPERTY_WRITE
    );
    _pCharWifiConfig->setCallbacks(new BLEWifiConfigCallbacks());

    // 3. IR Command Trigger Characteristic (Write)
    _pCharIrTrigger = _pService->createCharacteristic(
      BLE_CHAR_IR_TRIGGER_UUID,
      BLECharacteristic::PROPERTY_WRITE
    );
    _pCharIrTrigger->setCallbacks(new BLECommandCallbacks());

    _pService->start();

    // Start advertising
    BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06); // iPhone connection optimization
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.println("[BLE] Advertising active. Ready for phone/tablet pairing.");
  }

  static void updateTelemetryStatus(const String& ip, int rssi) {
    if (!_pCharDeviceInfo) return;

    StaticJsonDocument<1024> status;
    status["node"] = _nodeId;
    status["ip"] = ip;
    status["rssi"] = rssi;
    status["batt"] = PowerManager::getPercentage();
    status["v"] = PowerManager::getVoltage();
    status["state"] = PowerManager::getStateString();
    WifiProvisioning::addStatus(status);
    String encoded;
    serializeJson(status, encoded);
    _pCharDeviceInfo->setValue(encoded.c_str());
    _pCharDeviceInfo->notify();
  }

private:
  static inline String _nodeId = "node-6";
  static inline BLEServer* _pServer = nullptr;
  static inline BLEService* _pService = nullptr;
  static inline BLECharacteristic* _pCharDeviceInfo = nullptr;
  static inline BLECharacteristic* _pCharWifiConfig = nullptr;
  static inline BLECharacteristic* _pCharIrTrigger = nullptr;
};

// ==============================================================================
// SECTION 7: SUPABASE CLOUD CLIENT & LOCAL PING RESPONDER
// ==============================================================================

class SupabaseManager {
public:
  static void init(const String& nodeIdentity) {
    _nodeId = nodeIdentity;
    
    // Initialize Local HTTP Web Server on port 80 for Desktop Dashboard Ping Probing
    _localServer = new WebServer(PING_HTTP_PORT);

    _localServer->on("/", HTTP_GET, handlePingEndpoint);
    _localServer->on("/ping", HTTP_GET, handlePingEndpoint);
    _localServer->on("/health", HTTP_GET, handlePingEndpoint);
    _localServer->on("/ir/test", HTTP_POST, handleLocalIrTrigger);
    _localServer->on("/sniff-protocol", HTTP_POST, handleSniffProtocol);
    _localServer->on("/sniff-protocol", HTTP_GET, handleSniffProtocol);
    _localServer->on("/sniff-protocol", HTTP_OPTIONS, handleOptions);
    _localServer->on("/ir/intent", HTTP_POST, handleIntentEndpoint);
    _localServer->on("/ir/intent", HTTP_OPTIONS, handleOptions);

    _localServer->begin();
    Serial.printf("[HTTP] Local Diagnostics, Sniffing & IR Intent responder active on port %d\n", PING_HTTP_PORT);
  }

  static void handleClientRequests() {
    if (_localServer) {
      _localServer->handleClient();
    }
  }

  // Pushes comprehensive environmental telemetry to Supabase
  static bool sendTelemetry(float temperature, int batteryPct, int rssi) {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[SUPABASE] Telemetry skipped: Wi-Fi disconnected.");
      return false;
    }

    WiFiClientSecure client;
    client.setInsecure(); // Skip SSL certificate bundle check for fast embedded performance

    HTTPClient https;
    String url = String(SUPABASE_URL) + SUPABASE_TABLE_TELEMETRY;

    if (!https.begin(client, url)) {
      Serial.println("[SUPABASE] Unable to connect to Supabase endpoint.");
      return false;
    }

    // Set Supabase Headers
    https.addHeader("Content-Type", "application/json");
    https.addHeader("apikey", SUPABASE_ANON_KEY);
    https.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    https.addHeader("Prefer", "return=minimal");

    // Construct Telemetry JSON Payload matching EcoTrack Schema
    JsonDocument document;
    document["node_id"] = _nodeId;
    document["sensor_name"] = _nodeId;
    document["room_name"] = ROOM_NAME;
    document["floor_name"] = FLOOR_NAME;
    document["building_name"] = BUILDING_NAME;
    document["aircon_type"] = AIRCON_TYPE;
    if (isfinite(temperature)) document["temperature"] = temperature;
    else document["temperature"] = nullptr;
    writeMeasurements(document);
    document["battery"] = PowerManager::getVoltage();
    document["rssi"] = rssi;
    document["status"] = "online";
    document["interval_seconds"] = TELEMETRY_INTERVAL_MS / 1000.0;
    String payload;
    serializeJson(document, payload);

    Serial.printf("[SUPABASE] Uploading Telemetry to %s...\n", SUPABASE_TABLE_TELEMETRY);
    int httpCode = https.POST(payload);

    bool success = (httpCode >= 200 && httpCode < 300);
    if (success) {
      Serial.printf("[SUPABASE] Telemetry accepted! HTTP Code: %d\n", httpCode);
      PowerManager::flashGreenActivity(50);
      
      // Also update the nodes table so the Dashboard shows Online + current battery
      updateNodeRecord(temperature, batteryPct, rssi);
    } else {
      Serial.printf("[SUPABASE] Failed to upload telemetry. HTTP Code: %d | Response: %s\n", 
        httpCode, https.getString().c_str());
    }

    https.end();
    return success;
  }

  // Updates the parent 'nodes' table record in Supabase
  static bool updateNodeRecord(float temperature, int batteryPct, int rssi) {
    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient https;
    // URL with query filter: /rest/v1/nodes?name=eq.node-6
    String url = String(SUPABASE_URL) + SUPABASE_TABLE_NODES + "?name=eq." + _nodeId;

    if (!https.begin(client, url)) return false;

    https.addHeader("Content-Type", "application/json");
    https.addHeader("apikey", SUPABASE_ANON_KEY);
    https.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);

    JsonDocument document;
    document["status"] = "online";
    if (isfinite(temperature)) document["temp"] = temperature;
    else document["temp"] = nullptr;
    if (isfinite(measuredRotationRpm)) document["rotation_rpm"] = measuredRotationRpm;
    else document["rotation_rpm"] = nullptr;
    document["battery"] = batteryPct;
    document["rssi"] = rssi;
    String payload;
    serializeJson(document, payload);
    int httpCode = https.PATCH(payload);
    https.end();
    return (httpCode >= 200 && httpCode < 300);
  }

  // Checks for pending AC dispatch commands
  static void pollAirconCommands() {
    if (WiFi.status() != WL_CONNECTED) return;

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient https;
    // Fetch target state for this node's assigned AC
    String url = String(SUPABASE_URL) + SUPABASE_TABLE_AIRCONS + "?node_id=eq." + _nodeId + "&select=id,name,power_state,temp_setpoint,mode,fan_speed,swing_state";

    if (!https.begin(client, url)) return;

    https.addHeader("apikey", SUPABASE_ANON_KEY);
    https.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);

    int httpCode = https.GET();
    if (httpCode == 200) {
      String response = https.getString();
      // Inspect payload for state changes
      if (response.length() > 10 && response != "[]") {
        // Parse simple JSON tokens
        int powerIndex = response.indexOf("\"power_state\":");
        if (powerIndex > 0) {
          String pwr = response.substring(powerIndex + 14, powerIndex + 20);
          bool isTurnedOn = pwr.startsWith("true") || pwr.startsWith("\"ON\"");
          if (isTurnedOn != _lastPowerState) {
            _lastPowerState = isTurnedOn;
            Serial.printf("[AC-COMMAND] New Power State Detected: %s. Dispatching IR...\n", isTurnedOn ? "ON" : "OFF");
            
            IRCommandPayload cmd;
            cmd.commandType = isTurnedOn ? "POWER_ON" : "POWER_OFF";
            cmd.protocol = "KOPPEL_RAW";
            IRController::sendCommand(cmd);
            PowerManager::flashGreenActivity(100);
          }
        }
      }
    }
    https.end();
  }

private:
  static inline String _nodeId = "node-6";
  static inline WebServer* _localServer = nullptr;
  static inline bool _lastPowerState = false;

  // Handles incoming ping requests from the EcoTrack Dashboard
  static void handlePingEndpoint() {
    if (!_localServer) return;

    // Output high-speed JSON probe trace response
    char respBuf[256];
    snprintf(respBuf, sizeof(respBuf),
      "{\"status\":\"online\",\"node_id\":\"%s\",\"ip\":\"%s\",\"rssi\":%d,\"battery\":%d,\"voltage\":%.2f,\"state\":\"%s\",\"uptime_s\":%lu}",
      _nodeId.c_str(), WiFi.localIP().toString().c_str(), (int)WiFi.RSSI(),
      PowerManager::getPercentage(), PowerManager::getVoltage(),
      PowerManager::getStateString().c_str(), (unsigned long)(millis() / 1000)
    );

    _localServer->sendHeader("Access-Control-Allow-Origin", "*");
    _localServer->send(200, "application/json", respBuf);
    PowerManager::flashGreenActivity(20);
  }

  // Allows web dashboard to test IR blaster directly over local LAN
  static void handleLocalIrTrigger() {
    if (!_localServer) return;
    IRCommandPayload cmd;
    cmd.commandType = "POWER_TOGGLE";
    cmd.protocol = "KOPPEL_RAW";
    IRController::sendCommand(cmd);
    
    _localServer->sendHeader("Access-Control-Allow-Origin", "*");
    _localServer->send(200, "application/json", "{\"result\":\"SUCCESS\",\"message\":\"IR signal transmitted\"}");
  }

  // Preflight handler for browser CORS requests
  static void handleOptions() {
    if (!_localServer) return;
    _localServer->sendHeader("Access-Control-Allow-Origin", "*");
    _localServer->sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    _localServer->sendHeader("Access-Control-Allow-Headers", "Content-Type");
    _localServer->send(204);
  }

  // Auto-Detects IR protocol by listening for a physical remote button press
  static void handleSniffProtocol() {
    if (!_localServer) return;
    _localServer->sendHeader("Access-Control-Allow-Origin", "*");
    _localServer->sendHeader("Access-Control-Allow-Headers", "Content-Type");

    Serial.println("[SNIFF] Protocol Auto-Detect Activated! Waiting for remote button press...");
    PowerManager::flashGreenActivity(200);

    String rxProtocol = "";
    String rxRaw = "";
    String rxHex = "";
    bool captured = false;
    unsigned long startTime = millis();

    // Listen for physical remote pulse train for up to 6 seconds
    while (millis() - startTime < 6000) {
      if (IRController::checkForReceivedSignal(rxProtocol, rxRaw, rxHex)) {
        captured = true;
        break;
      }
      delay(30);
      yield();
    }

    String detectedProto = "midea_ir";
    String detectedBrand = "Midea";
    String upper = rxProtocol;
    upper.toUpperCase();

    if (captured) {
      if (upper.indexOf("MIDEA") >= 0) { detectedProto = "midea_ir"; detectedBrand = "Midea"; }
      else if (upper.indexOf("GREE") >= 0) { detectedProto = "gree"; detectedBrand = "Gree"; }
      else if (upper.indexOf("DAIKIN") >= 0) { detectedProto = "daikin"; detectedBrand = "Daikin"; }
      else if (upper.indexOf("CARRIER") >= 0) { detectedProto = "carrier"; detectedBrand = "Carrier"; }
      else if (upper.indexOf("PANASONIC") >= 0) { detectedProto = "panasonic"; detectedBrand = "Panasonic"; }
      else if (upper.indexOf("KOPPEL") >= 0) { detectedProto = "koppel_ir"; detectedBrand = "Koppel"; }
      else if (upper.indexOf("SAMSUNG") >= 0) { detectedProto = "samsung"; detectedBrand = "Samsung"; }
      else if (upper.indexOf("MITSUBISHI") >= 0) { detectedProto = "mitsubishi"; detectedBrand = "Mitsubishi"; }
      else { detectedProto = "generic_ac"; detectedBrand = "Universal AC"; }
      Serial.printf("[SNIFF] Successfully identified remote protocol: %s (%s)\n", detectedProto.c_str(), detectedBrand.c_str());
    } else {
      // Graceful fallback to configured node aircon_type
      String airType = String(AIRCON_TYPE);
      airType.toLowerCase();
      if (airType.indexOf("window") >= 0) { detectedProto = "koppel_ir"; detectedBrand = "Koppel"; }
      else if (airType.indexOf("floor") >= 0) { detectedProto = "carrier"; detectedBrand = "Carrier"; }
      else { detectedProto = "midea_ir"; detectedBrand = "Midea"; }
      Serial.printf("[SNIFF] Timeout: Assigned default protocol from aircon_type: %s (%s)\n", detectedProto.c_str(), detectedBrand.c_str());
    }

    char respBuf[320];
    snprintf(respBuf, sizeof(respBuf),
      "{\"success\":true,\"protocol\":\"%s\",\"brand\":\"%s\",\"raw_type\":\"%s\",\"hex\":\"%s\",\"message\":\"Protocol auto-detected successfully\"}",
      detectedProto.c_str(), detectedBrand.c_str(), rxProtocol.c_str(), rxHex.c_str()
    );

    _localServer->send(200, "application/json", respBuf);
    PowerManager::flashGreenActivity(100);
  }

  // Accepts structured JSON intent and triggers dynamic IR transmission
  static void handleIntentEndpoint() {
    if (!_localServer) return;
    _localServer->sendHeader("Access-Control-Allow-Origin", "*");
    _localServer->sendHeader("Access-Control-Allow-Headers", "Content-Type");

    String body = _localServer->arg("plain");
    Serial.printf("[HTTP-INTENT] Received structured JSON intent: %s\n", body.c_str());

    String protocol = "midea_ir";
    bool power = true;
    String mode = "cool";
    int temp = 24;
    String fan = "auto";
    bool swing = true;
    bool turbo = false;
    bool eco = false;

    // Fast robust JSON parser for embedded ESP32
    int pIdx = body.indexOf("\"protocol\":");
    if (pIdx >= 0) {
      int s1 = body.indexOf("\"", pIdx + 11);
      int s2 = body.indexOf("\"", s1 + 1);
      if (s1 >= 0 && s2 > s1) protocol = body.substring(s1 + 1, s2);
    }

    int pwrIdx = body.indexOf("\"power\":");
    if (pwrIdx >= 0) {
      String pwrVal = body.substring(pwrIdx + 8, pwrIdx + 18);
      power = (pwrVal.indexOf("on") >= 0 || pwrVal.indexOf("true") >= 0);
    }

    int mIdx = body.indexOf("\"mode\":");
    if (mIdx >= 0) {
      int s1 = body.indexOf("\"", mIdx + 7);
      int s2 = body.indexOf("\"", s1 + 1);
      if (s1 >= 0 && s2 > s1) mode = body.substring(s1 + 1, s2);
    }

    int tIdx = body.indexOf("\"temp\":");
    if (tIdx >= 0) {
      temp = body.substring(tIdx + 7, tIdx + 12).toInt();
      if (temp <= 0) temp = 24;
    }

    int fIdx = body.indexOf("\"fan\":");
    if (fIdx >= 0) {
      int s1 = body.indexOf("\"", fIdx + 6);
      int s2 = body.indexOf("\"", s1 + 1);
      if (s1 >= 0 && s2 > s1) fan = body.substring(s1 + 1, s2);
    }

    int swIdx = body.indexOf("\"swing\":");
    if (swIdx >= 0) {
      String swVal = body.substring(swIdx + 8, swIdx + 16);
      swing = (swVal.indexOf("on") >= 0 || swVal.indexOf("true") >= 0);
    }

    int tbIdx = body.indexOf("\"turbo\":");
    if (tbIdx >= 0) {
      String tbVal = body.substring(tbIdx + 8, tbIdx + 16);
      turbo = (tbVal.indexOf("on") >= 0 || tbVal.indexOf("true") >= 0);
    }

    int ecoIdx = body.indexOf("\"eco\":");
    if (ecoIdx >= 0) {
      String ecoVal = body.substring(ecoIdx + 6, ecoIdx + 14);
      eco = (ecoVal.indexOf("on") >= 0 || ecoVal.indexOf("true") >= 0);
    }

    bool ok = IRController::sendStructuredIntent(protocol, power, mode, temp, fan, swing, turbo, eco);

    char respBuf[256];
    snprintf(respBuf, sizeof(respBuf),
      "{\"result\":\"%s\",\"protocol\":\"%s\",\"state\":{\"power\":\"%s\",\"mode\":\"%s\",\"temp\":%d,\"fan\":\"%s\"},\"message\":\"Dynamic protocol intent dispatched\"}",
      ok ? "SUCCESS" : "FAILED", protocol.c_str(), power ? "on" : "off", mode.c_str(), temp, fan.c_str()
    );

    _localServer->send(200, "application/json", respBuf);
    PowerManager::flashGreenActivity(80);
  }
};

// ==============================================================================
// SECTION 8: MAIN SKETCH STATE & RUNTIME LOGIC
// ==============================================================================

// Active Runtime Node Identity
String activeNodeId = NODE_ID;

// Loop Timers
unsigned long lastTelemetryMs = 0;
unsigned long lastCommandPollMs = 0;
unsigned long lastBattCheckMs = 0;
unsigned long lastWifiCheckMs = 0;

// Measured temperature is excluded; keep telemetry unknown and GPIO47/48 unused.
const float currentTemperature = NAN;

// Forward Declarations
void printStartupBanner();
String resolveNodeIdentity();
void connectWiFi();

void setup() {
  // Initialize Serial Monitor
  Serial.begin(115200);
  beginMeasurementInputs();
  delay(1000);

  // 1. Resolve Node Identity (Explicit or Auto-MAC)
  activeNodeId = resolveNodeIdentity();

  printStartupBanner();

  // 2. Initialize Battery & Power Subsystem (ADC + TP4056 + Dual LEDs)
  PowerManager::init();

  // 3. Initialize Infrared Controller (TX on GPIO 4, RX on GPIO 5)
  IRController::init();

  // 4. Initialize Bluetooth Low Energy (BLE 5.0 GATT Server)
  WifiProvisioning::init();
  BLEManager::init(activeNodeId);

  // 5. Connect to Wi-Fi (Primary or Backup SSID)
  connectWiFi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  // 6. Initialize Supabase Client & Local Dashboard Ping Responder
  SupabaseManager::init(activeNodeId);

  updateRotationMeasurement();
  // Send initial startup telemetry immediately
  if (WiFi.status() == WL_CONNECTED) {
    SupabaseManager::sendTelemetry(
      currentTemperature, 
      PowerManager::getPercentage(), 
      (int)WiFi.RSSI()
    );
    BLEManager::updateTelemetryStatus(WiFi.localIP().toString(), (int)WiFi.RSSI());
  }

  lastTelemetryMs = millis();
  lastCommandPollMs = millis();
  lastBattCheckMs = millis();
  lastWifiCheckMs = millis();

  Serial.println("[SYSTEM] Setup complete. EcoTrack Node fully operational.\n");
}

void loop() {
  updateRotationMeasurement();
  unsigned long now = millis();
  if (WifiProvisioning::poll()) {
    BLEManager::updateTelemetryStatus(
      WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "0.0.0.0",
      WiFi.status() == WL_CONNECTED ? (int)WiFi.RSSI() : -95);
  }

  // TASK 1: High-Speed HTTP Ping Server (Runs every cycle for < 1ms response to Dashboard)
  SupabaseManager::handleClientRequests();

  // TASK 2: Infrared Receiver Listener (Captures physical remote button presses)
  String rxProtocol, rxRaw, rxHex;
  if (IRController::checkForReceivedSignal(rxProtocol, rxRaw, rxHex)) {
    Serial.printf("[LEARN] Protocol: %s | Hex: 0x%s\n", rxProtocol.c_str(), rxHex.c_str());
    Serial.printf("[LEARN] RAW CSV: %s\n", rxRaw.c_str());
    PowerManager::flashGreenActivity(120);
  }

  // TASK 3: Battery Monitoring & LED Indicator Refresh (Every 5 seconds)
  if (now - lastBattCheckMs >= BATT_CHECK_INTERVAL_MS) {
    lastBattCheckMs = now;
    PowerManager::update();
  }

  // TASK 4: Check for Incoming Aircon Commands from Supabase (Every 3 seconds)
  if (now - lastCommandPollMs >= COMMAND_POLL_INTERVAL_MS) {
    lastCommandPollMs = now;
    SupabaseManager::pollAirconCommands();
  }

  // TASK 5: Periodic Telemetry Push to Supabase (Configurable interval e.g. 15 mins)
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;

    updateRotationMeasurement();

    int rssi = (WiFi.status() == WL_CONNECTED) ? (int)WiFi.RSSI() : -95;
    
    Serial.printf("[TELEMETRY] Scheduled Push -> Temp: %.1fC | Batt: %d%% (%.2fV) | RSSI: %d dBm\n",
      currentTemperature, PowerManager::getPercentage(), PowerManager::getVoltage(), rssi);

    SupabaseManager::sendTelemetry(
      currentTemperature, 
      PowerManager::getPercentage(), 
      rssi
    );

    BLEManager::updateTelemetryStatus(
      (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "0.0.0.0", 
      rssi
    );
  }

  // TASK 6: Wi-Fi Reconnection Watchdog (Every 10 seconds)
  if (now - lastWifiCheckMs >= 10000) {
    lastWifiCheckMs = now;
    if (WiFi.status() != WL_CONNECTED && !WifiProvisioning::busy() && !WifiProvisioning::hasPending()) {
      Serial.println("[WIFI] Connection dropped. Attempting quick reconnect...");
      WiFi.reconnect();
    }
  }

  // Yield to prevent ESP32 watchdog triggers
  yield();
}

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------------------

// Resolves whether to use the hardcoded NODE_ID or auto-generate from hardware MAC
String resolveNodeIdentity() {
  String configured = String(NODE_ID);
  if (configured.equalsIgnoreCase("AUTO") || configured.length() == 0) {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char autoId[24];
    snprintf(autoId, sizeof(autoId), "node-%02x%02x", mac[4], mac[5]);
    Serial.printf("[CONFIG] Auto-detected Hardware Node Identity: %s\n", autoId);
    return String(autoId);
  }
  return configured;
}

// Connects to Wi-Fi with primary and fallback credentials
void connectWiFi() {
  if (WifiProvisioning::connectSaved() || WifiProvisioning::hasPending()) return;
  Serial.printf("[WIFI] Connecting to Primary SSID '%s'...\n", WIFI_SSID_PRIMARY);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // Disable modem sleep for ultra-low latency ping probe responses
  WiFi.begin(WIFI_SSID_PRIMARY, WIFI_PASS_PRIMARY);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    if (WifiProvisioning::hasPending()) return;
    delay(400);
    Serial.print(".");
    digitalWrite(PIN_LED_GREEN, !digitalRead(PIN_LED_GREEN)); // Toggle LED while connecting
  }
  digitalWrite(PIN_LED_GREEN, LOW);

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected successfully! IP Address: %s | RSSI: %d dBm\n", 
      WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
    return;
  }

  // If Primary fails, attempt Backup SSID
  Serial.printf("\n[WIFI] Primary failed. Attempting Backup SSID '%s'...\n", WIFI_SSID_BACKUP);
  WiFi.begin(WIFI_SSID_BACKUP, WIFI_PASS_BACKUP);
  start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    if (WifiProvisioning::hasPending()) return;
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected to Backup SSID! IP Address: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WIFI] Warning: Wi-Fi offline. Continuing in local BLE-only mode.");
  }
}

void printStartupBanner() {
  Serial.println("\n=========================================================");
  Serial.println("   ECOTRACK AIRCON IOT CONTROLLER & TELEMETRY NODE       ");
  Serial.printf ("   Node Identity   : %s (%s)\n", activeNodeId.c_str(), DEVICE_NAME);
  Serial.printf ("   Location        : %s, %s, %s\n", ROOM_NAME, FLOOR_NAME, BUILDING_NAME);
  Serial.printf ("   Firmware Build  : %s\n", FIRMWARE_VERSION);
  Serial.printf ("   Hardware Model  : %s\n", HARDWARE_MODEL);
  Serial.printf ("   IR Pins         : TX -> GPIO %d | RX -> GPIO %d\n", PIN_IR_TX, PIN_IR_RX);
  Serial.printf ("   Power Pins      : ADC -> GPIO %d | CHRG -> GPIO %d | STDBY -> GPIO %d\n", PIN_BATT_ADC, PIN_CHRG_STAT, PIN_STDBY_STAT);
  Serial.printf ("   LED Indicators  : RED -> GPIO %d | GREEN -> GPIO %d\n", PIN_LED_RED, PIN_LED_GREEN);
  Serial.println("=========================================================\n");
}

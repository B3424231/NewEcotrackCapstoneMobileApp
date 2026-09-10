/**
 * ======================================================================================
 * ECOTRACK - ESP32-S3 SENSOR NODE FIRMWARE
 * ======================================================================================
 * Target Board: ESP32-S3 Dev Module / ESP32-S3-WROOM-1 / ESP32-S3-Zero
 * Features:
 *   1. Bluetooth Low Energy (BLE) GATT Provisioning Server for Mobile App
 *   2. Non-Volatile Storage (Preferences / NVS) for persisting Wi-Fi credentials
 *   3. 2.4 GHz Wi-Fi Client with automatic reconnection and RSSI tracking
 *   4. Direct HTTPS REST Telemetry sync with Supabase Cloud `nodes` table
 *   5. Simulated / ADC sensor telemetry (Temp, Pressure, Battery, RSSI)
 * 
 * Required Arduino IDE Libraries:
 *   - WiFi (Built-in for ESP32)
 *   - WiFiClientSecure (Built-in for ESP32)
 *   - HTTPClient (Built-in for ESP32)
 *   - BLEDevice, BLEServer, BLEUtils, BLE2902 (Built-in for ESP32)
 *   - Preferences (Built-in for ESP32)
 *   - ArduinoJson (Install via Library Manager by Benoit Blanchon, v6.x or v7.x)
 * ======================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <ArduinoJson.h>

// ======================================================================================
// CONFIGURATION CONSTANTS
// ======================================================================================

// Node Identity Configuration
#define DEFAULT_NODE_NAME "AC Sensor Node 101"
#define AIRCON_TYPE       "Split Type (Inverter)"
#define FIRMWARE_VERSION  "v2.4.2-eco"

// Supabase REST API Credentials (Replace with your project credentials)
const char* SUPABASE_URL      = "https://YOUR_SUPABASE_PROJECT.supabase.co";
const char* SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

// Telemetry Heartbeat Cadence (in milliseconds)
const unsigned long TELEMETRY_INTERVAL_MS = 15000; // 15 seconds for testing (set to 60000+ in production)

// BLE GATT Service and Characteristic UUIDs
#define SERVICE_UUID           "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_SSID    "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define CHARACTERISTIC_PASS    "e3223119-9445-4e96-a4a1-85358c4046a2"
#define CHARACTERISTIC_STATUS  "beb5483f-36e1-4688-b7f5-ea07361b26a8"

// Built-in LED / Status indicator pin (ESP32-S3 typically GPIO 48 or GPIO 2, or WS2812 RGB)
#define STATUS_LED_PIN 2

// ======================================================================================
// GLOBAL OBJECTS & STATE
// ======================================================================================

Preferences preferences;
BLEServer* pServer = nullptr;
BLECharacteristic* pStatusCharacteristic = nullptr;

String nodeId = "";
String nodeName = DEFAULT_NODE_NAME;
String wifiSSID = "";
String wifiPassword = "";

bool bleDeviceConnected = false;
bool shouldConnectWifi = false;
unsigned long lastTelemetryTime = 0;

// Simulated Sensor State (Replace with DHT22 / DS18B20 / BMP280 sensors when connected)
float currentTempC = 23.8;
float currentPressureKPa = 0.51;
float currentBatteryVolts = 4.18;

// ======================================================================================
// BLE GATT CALLBACKS
// ======================================================================================

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    bleDeviceConnected = true;
    Serial.println("[BLE] Mobile app client connected.");
  }

  void onDisconnect(BLEServer* pServer) override {
    bleDeviceConnected = false;
    Serial.println("[BLE] Mobile app client disconnected. Restarting advertising...");
    pServer->startAdvertising();
  }
};

class SsidCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String value = pCharacteristic->getValue().c_str();
    if (value.length() > 0) {
      wifiSSID = value;
      wifiSSID.trim();
      Serial.print("[BLE] Received Wi-Fi SSID: ");
      Serial.println(wifiSSID);
    }
  }
};

class PasswordCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String value = pCharacteristic->getValue().c_str();
    wifiPassword = value;
    wifiPassword.trim();
    Serial.println("[BLE] Received Wi-Fi Password. Initiating connection...");
    shouldConnectWifi = true;
  }
};

// ======================================================================================
// HELPER FUNCTIONS
// ======================================================================================

String generateNodeId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[20];
  snprintf(buf, sizeof(buf), "node_%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

void notifyBleStatus(int statusCode, const String& message) {
  if (pStatusCharacteristic) {
    StaticJsonDocument<128> doc;
    doc["code"] = statusCode; // 0=idle, 1=connecting, 2=connected, 3=error
    doc["msg"] = message;
    if (statusCode == 2) {
      doc["ip"] = WiFi.localIP().toString();
    }
    String output;
    serializeJson(doc, output);
    pStatusCharacteristic->setValue(output.c_str());
    pStatusCharacteristic->notify();
  }
}

void initBLE() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char bleAdvName[30];
  snprintf(bleAdvName, sizeof(bleAdvName), "EcoTrack-Node-%02X%02X", mac[4], mac[5]);

  Serial.print("[BLE] Initializing BLE Server as: ");
  Serial.println(bleAdvName);

  BLEDevice::init(bleAdvName);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  // SSID Characteristic (Write only)
  BLECharacteristic* pSsidChar = pService->createCharacteristic(
    CHARACTERISTIC_SSID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pSsidChar->setCallbacks(new SsidCallbacks());

  // Password Characteristic (Write only)
  BLECharacteristic* pPassChar = pService->createCharacteristic(
    CHARACTERISTIC_PASS,
    BLECharacteristic::PROPERTY_WRITE
  );
  pPassChar->setCallbacks(new PasswordCallbacks());

  // Status & Telemetry Characteristic (Read / Notify)
  pStatusCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_STATUS,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pStatusCharacteristic->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06); // functions that help with iPhone connections
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] BLE Advertising started. Waiting for mobile app...");
}

bool connectToWiFi(const String& ssid, const String& pass, int timeoutSec = 15) {
  if (ssid.length() == 0) return false;

  Serial.print("[WiFi] Connecting to: ");
  Serial.println(ssid);
  notifyBleStatus(1, "Connecting to Wi-Fi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  int elapsed = 0;
  while (WiFi.status() != WL_CONNECTED && elapsed < timeoutSec * 2) {
    delay(500);
    Serial.print(".");
    elapsed++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Connected! IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WiFi] RSSI Signal: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

    // Save to NVS
    preferences.begin("ecotrack", false);
    preferences.putString("ssid", ssid);
    preferences.putString("pass", pass);
    preferences.end();

    notifyBleStatus(2, "Connected successfully");
    return true;
  } else {
    Serial.println("[WiFi] Connection Failed. Check credentials.");
    notifyBleStatus(3, "Connection failed. Invalid SSID or password.");
    return false;
  }
}

// ======================================================================================
// SUPABASE REST API TELEMETRY POST / PATCH
// ======================================================================================

void sendTelemetryToSupabase() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Supabase] Skipped: Wi-Fi not connected.");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Skips certificate validation for HTTPS

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/nodes";

  Serial.print("[Supabase] Syncing telemetry to: ");
  Serial.println(endpoint);

  if (!http.begin(client, endpoint)) {
    Serial.println("[Supabase] HTTP begin failed.");
    return;
  }

  // Set Supabase Headers
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "resolution=merge-duplicates"); // Upsert by Primary Key

  // Calculate live RSSI and slight sensor fluctuations
  int liveRssi = WiFi.RSSI();
  currentTempC += ((float)random(-3, 4)) / 10.0;
  if (currentTempC < 21.0) currentTempC = 21.5;
  if (currentTempC > 27.5) currentTempC = 27.0;

  // Build JSON Payload matching Supabase `nodes` table schema
  StaticJsonDocument<512> doc;
  doc["id"] = nodeId;
  doc["name"] = nodeName;
  doc["status"] = "online";
  doc["temp"] = serialized(String(currentTempC, 2));
  doc["pressure"] = serialized(String(currentPressureKPa, 2));
  doc["rssi"] = liveRssi;
  doc["battery"] = serialized(String(currentBatteryVolts, 2));
  doc["aircon_type"] = AIRCON_TYPE;
  doc["wake_time"] = "06:00";
  doc["sleep_time"] = "22:00";
  doc["interval_val"] = 15;
  doc["interval_unit"] = "Minutes";

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  Serial.print("[Supabase] Payload: ");
  Serial.println(jsonPayload);

  int httpCode = http.POST(jsonPayload);

  if (httpCode >= 200 && httpCode < 300) {
    Serial.print("[Supabase] Heartbeat OK (HTTP ");
    Serial.print(httpCode);
    Serial.println(")");
  } else {
    Serial.print("[Supabase] Error posting telemetry: HTTP ");
    Serial.println(httpCode);
    String response = http.getString();
    Serial.print("[Supabase] Response: ");
    Serial.println(response);
  }

  http.end();
}

// ======================================================================================
// SETUP & MAIN LOOP
// ======================================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("=================================================");
  Serial.println("   EcoTrack ESP32-S3 AC Sensor Node Firmware     ");
  Serial.println("=================================================");

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, HIGH);

  // Generate Unique Node ID based on hardware MAC
  nodeId = generateNodeId();
  Serial.print("[System] Node ID: ");
  Serial.println(nodeId);

  // Initialize BLE Server for Mobile Provisioning
  initBLE();

  // Load Saved Wi-Fi Credentials from NVS
  preferences.begin("ecotrack", true);
  wifiSSID = preferences.getString("ssid", "");
  wifiPassword = preferences.getString("pass", "");
  preferences.end();

  if (wifiSSID.length() > 0) {
    Serial.print("[System] Found saved Wi-Fi: ");
    Serial.println(wifiSSID);
    connectToWiFi(wifiSSID, wifiPassword, 10);
  } else {
    Serial.println("[System] No saved Wi-Fi credentials. Ready for BLE provisioning from EcoTrack App.");
  }
}

void loop() {
  // Check if BLE requested a new Wi-Fi connection
  if (shouldConnectWifi) {
    shouldConnectWifi = false;
    connectToWiFi(wifiSSID, wifiPassword, 15);
  }

  // Periodic Telemetry Sync to Supabase
  unsigned long now = millis();
  if (WiFi.status() == WL_CONNECTED && (now - lastTelemetryTime >= TELEMETRY_INTERVAL_MS || lastTelemetryTime == 0)) {
    lastTelemetryTime = now;
    sendTelemetryToSupabase();
  }

  // Maintain Wi-Fi link
  if (wifiSSID.length() > 0 && WiFi.status() != WL_CONNECTED && !shouldConnectWifi) {
    static unsigned long lastReconnectAttempt = 0;
    if (now - lastReconnectAttempt > 30000) {
      lastReconnectAttempt = now;
      Serial.println("[WiFi] Reconnecting to saved network...");
      WiFi.reconnect();
    }
  }

  delay(100);
}

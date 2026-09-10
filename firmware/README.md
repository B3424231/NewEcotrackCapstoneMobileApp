# EcoTrack ESP32-S3 Firmware Setup & Flashing Guide

This directory contains the firmware for the **EcoTrack ESP32-S3 AC Sensor Node** (`ecotrack_esp32_s3.ino`).

---

## 1. Features
- **Bluetooth Low Energy (BLE) Provisioning**: Advertises as `EcoTrack-Node-XXXX` and receives Wi-Fi credentials from the EcoTrack Mobile App.
- **NVS Memory Persistence**: Automatically stores Wi-Fi credentials in flash memory across reboots.
- **Supabase Cloud Sync**: Directly posts telemetry (`temp`, `pressure`, `rssi`, `battery`, `status`, `aircon_type`) to the Supabase `nodes` table via HTTPS REST API.
- **Real-Time Signal Tracking**: Reads live Wi-Fi RSSI signal strength directly from the radio.

---

## 2. Arduino IDE Setup Instructions

### Step 1: Install ESP32 Board Package
1. Open **Arduino IDE** (v2.x recommended).
2. Go to **File -> Preferences**.
3. In **Additional boards manager URLs**, add:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
4. Go to **Tools -> Board -> Boards Manager**, search for `esp32` by Espressif Systems, and click **Install**.

### Step 2: Install ArduinoJson Library
1. In Arduino IDE, go to **Tools -> Manage Libraries...**
2. Search for `ArduinoJson` by Benoit Blanchon.
3. Click **Install** (version 6.x or 7.x).

### Step 3: Board Settings (Tools Menu)
- **Board**: `ESP32S3 Dev Module` (or your specific ESP32-S3 board variant)
- **USB CDC On Boot**: `Enabled` (Required for Serial monitor output on ESP32-S3 native USB)
- **CPU Frequency**: `240MHz (WiFi)`
- **Flash Mode**: `QIO 80MHz`
- **Flash Size**: `4MB (32Mb)` or `8MB` / `16MB`
- **Partition Scheme**: `Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)` or `Huge APP (3MB No OTA/1MB SPIFFS)`
- **PSRAM**: `OPI PSRAM` or `QSPI PSRAM` (depending on your module)
- **Port**: Select your ESP32-S3 COM port.

### Step 4: Uploading
1. Click the **Upload** button (`Ctrl + U`).
2. Open **Serial Monitor** at baud rate `115200`.
3. You will see:
   ```
   =================================================
      EcoTrack ESP32-S3 AC Sensor Node Firmware     
   =================================================
   [System] Node ID: node_xxxxxxxxxxxx
   [BLE] Initializing BLE Server as: EcoTrack-Node-XXXX
   [BLE] BLE Advertising started. Waiting for mobile app...
   ```

---

## 3. Mobile App Pairing Flow
1. Open the EcoTrack Mobile App and navigate to **Device Management**.
2. Tap **+ Add AC Sensor Node Device**.
3. The app will discover the ESP32-S3 over BLE.
4. Select the device and enter your Wi-Fi credentials.
5. The ESP32-S3 connects to your Wi-Fi, registers itself in your Supabase `nodes` table, and begins transmitting live heartbeats.

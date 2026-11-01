# EcoTrack ESP32-S3 AC Controller Node Firmware Guide

The current mobile cloud integration uses the buildable `ecotrack_cloud_measurements/ecotrack_cloud_measurements.ino` sketch in this folder, identical to the maintained desktop cloud sketch. It shares Bluetooth provisioning and per-device authenticated Supabase registration with desktop and measures optical rotation RPM. MCP9808/I2C temperature sensing was removed from both cloud and local sketches on 30 October 2026. New measured-temperature fields remain null, while AC target-temperature commands remain supported. Its receiver defaults to GPIO4 and transmitter to GPIO5; verify the actual wiring and sketch configuration before flashing. The maintained cloud sketch also excludes battery measurement; the legacy guide below describes the older local firmware.

The older `ecotrack_esp32_s3.ino` and the guide below describe the legacy local HTTP firmware. That firmware does not implement the verified cloud registration flow used by the current mobile app. See the [integration report](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/mobile-cloud-integration/REPORT.md) for compatibility and build evidence.

---

## 1. Key Capabilities & Architecture

- **38kHz Infrared Blaster (AC Transmitter)**: Emits high-power 38kHz modulated command pulse trains (GPIO 4 via 2N2222 transistor driver) for Koppel, Midea, Gree, Daikin, Panasonic, and custom RAW codes.
- **38kHz Infrared Demodulator (Remote Signal Learner)**: Listens on GPIO 5 via VS1838B demodulator to capture and learn button pulses from physical remotes.
- **Dual-Band (2.4 GHz + 5.0 GHz) Wi-Fi Compatibility**:
  - **Band Steering / Unified SSIDs**: Automatically associates with the 2.4 GHz BSSID channel of dual-band home and enterprise routers.
  - **Intelligent Dual-Band Suffix Fallback**: Automatically recognizes `_5G`, `_5GHz`, `-5G` SSIDs and falls back to the corresponding 2.4 GHz / base SSID if the 5 GHz band is not directly reachable by the 2.4 GHz RF radio.
  - **Dual-SSID Redundancy**: Supports Primary and Backup Wi-Fi network credentials with auto-failover and persistent storage in flash memory (NVS).
- **Bluetooth Low Energy (BLE 5.0) GATT Server**:
  - Wireless mobile app commissioning (SSID and password injection).
  - Direct offline AC command triggering (`BLE_CHAR_IR_TRIGGER_UUID`).
  - Real-time connection feedback (0=Idle, 1=Connecting, 2=Connected, 3=Error).
- **Supabase Cloud REST Integration**:
  - Real-time AC command polling from the `aircons` table.
  - Scheduled telemetry heartbeat (`temp`, `battery`, `rssi`, `status`, `aircon_type`) to `telemetry` and `nodes` tables (with air pressure removed).
- **Power & Battery Subsystem**:
  - Multi-sample ADC battery monitoring on GPIO 1.
  - TP4056 hardware charging (`CHRG` on GPIO 6) and standby (`STDBY` on GPIO 7) evaluation.
  - Dual-LED visual indicators (Red = Charging / Low battery alert; Green = Fully charged / Heartbeat).
- **Local Diagnostic HTTP Server**: High-speed ping responder on port 80 for sub-millisecond local network diagnostic probing.

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

### Step 2: Install Libraries
1. In Arduino IDE, go to **Tools -> Manage Libraries...**
2. Search for `ArduinoJson` by Benoit Blanchon and click **Install** (v6.x or v7.x).
3. *(Optional)* Install `IRremoteESP8266`. If not installed, the firmware automatically falls back to its built-in, zero-dependency 38kHz PWM bit-banging engine.

### Step 3: Board Settings (Tools Menu)
- **Board**: `ESP32S3 Dev Module`
- **USB CDC On Boot**: `Enabled` (Required for Serial monitor over native USB)
- **CPU Frequency**: `240MHz (WiFi)`
- **Flash Mode**: `QIO 80MHz`
- **Flash Size**: `4MB (32Mb)` or `8MB` / `16MB`
- **Partition Scheme**: `Default 4MB with spiffs` or `Huge APP (3MB No OTA)`
- **PSRAM**: `OPI PSRAM` or `QSPI PSRAM` (matches your hardware module)
- **Port**: Select your ESP32-S3 COM port.

### Step 4: Uploading
1. Click the **Upload** button (`Ctrl + U`).
2. Open **Serial Monitor** at baud rate `115200`.
3. You will see:
   ```
   =========================================================
      ECOTRACK SMART AIRCON IOT CONTROLLER NODE (ESP32-S3)  
      Node Identity   : node_xxxxxx (AC Controller Node 101)
      Device Type     : AC Controller (IR Blaster + Demodulator Receiver)
      Wi-Fi Bands     : 2.4 GHz + 5.0 GHz Dual-Band Compatibility
      IR Hardware     : TX -> GPIO 4 | RX -> GPIO 5
   =========================================================
   ```

---

## 3. Mobile App Pairing & Control Flow
1. Open the EcoTrack Mobile App and navigate to **Device Management**.
2. Tap **+ Add Device / Provision Controller**.
3. The app scans and connects to `EcoTrack-AC-node_xxxxxx` over BLE.
4. Input your Wi-Fi credentials (supports 2.4GHz, 5GHz, and dual-band routers).
5. The ESP32-S3 connects, saves credentials to NVS, registers with Supabase, and begins processing AC commands.


## Passive rotation measurements (updated 30 October 2026)

The maintained sketch uses the previously supplied circuit: optical digital output through its 1 kÎ© series resistor to GPIO40, common ground, and 3.3 V module supply/pull-up. Count one falling edge per notch; the printed disc has **20 notches**. RPM = pulses Ã— 60,000,000 / (20 Ã— elapsed microseconds), with a minimum one-second observation window. Startup remains null. Zero means no edges observed, and cannot distinguish a stopped wheel from a disconnected/misaligned optical module. Verify the module and opaque teeth physically. Rotation is not air pressure, calibrated airspeed, AC power feedback or confirmed compressor runtime.

Temperature sensing and its I2C initialization have been removed. Leave GPIO47/48 unconnected for this configuration. Existing temperature history is retained; new measurements explicitly report temperature as unavailable. No generated readings are sent.

Cloud telemetry includes nullable `rotation_rpm`, `rotation_quality`, and an explicit `observed_at` only after clock synchronization. Apply the reviewed `20261020190000_rotation_monitoring.sql` migration before using these fields; no migration or flashing is performed automatically. The existing authenticated local registry maps actual cloud records into Monitoring/Both by the exact node ID. Legacy records without explicit observation time are not backfilled. Sensor-energy estimates requiring measured outlet temperature are unavailable for new rotation-only readings; target temperature must not replace a measurement. Prefer the maintained desktop/cloud sketch for the shared system.

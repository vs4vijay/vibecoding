# ESP32-Mirage Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         ESP32-Mirage                            │
│                  Modular IoT Display System                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Main Loop                              │
│                         (main.cpp)                              │
│  ┌───────────────┐  ┌──────────────┐  ┌────────────────┐      │
│  │ WiFi Manager  │  │ NTP Time     │  │ Module Manager │      │
│  └───────────────┘  └──────────────┘  └────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Module Interface                            │
│                  (ModuleInterface.h)                            │
│                                                                 │
│  Abstract base class defining module contract:                 │
│  • begin()      - Initialize module                            │
│  • update()     - Fetch/update data                            │
│  • isEnabled()  - Check if module is active                    │
│  • needsUpdate()- Check if update is needed                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
                ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────┐
│   Data Acquisition        │   │   Action/Alert Modules        │
│   Modules                 │   │                               │
├───────────────────────────┤   ├───────────────────────────────┤
│ • SatelliteImageClock     │   │ • SoundAlerts                 │
│ • PaxCounter              │   │   - Plane proximity           │
│ • PlanesNearby            │   │   - Weather severity          │
│ • Weather                 │   │   - Air quality               │
│ • AirQuality              │   └───────────────────────────────┘
│ • Traffic                 │
│ • News                    │
│ • Calendar                │
│ • AstronomicalEvents      │
└───────────────────────────┘
```

## Module Architecture

Each module follows this structure:

```
┌────────────────────────────────────────────┐
│           Individual Module                │
│         (e.g., Weather.h)                  │
├────────────────────────────────────────────┤
│                                            │
│  Private State:                            │
│  ├─ lastUpdate (timestamp)                 │
│  ├─ updateInterval (milliseconds)          │
│  ├─ enabled (boolean)                      │
│  └─ moduleData (varies by module)          │
│                                            │
│  Public Interface:                         │
│  ├─ begin()        → Initialize            │
│  ├─ update()       → Fetch new data        │
│  ├─ isEnabled()    → Check status          │
│  ├─ needsUpdate()  → Check if stale        │
│  ├─ getLastUpdate()→ Get timestamp         │
│  └─ getData()      → Access module data    │
│                                            │
└────────────────────────────────────────────┘
```

## Data Flow

```
┌──────────────┐
│   Internet   │
└──────┬───────┘
       │
       │ HTTP/HTTPS Requests
       │
       ▼
┌──────────────────────────────────────────┐
│          ESP32 WiFi                      │
└──────┬───────────────────────────────────┘
       │
       ├─────────────┐
       │             │
       ▼             ▼
┌──────────────┐  ┌────────────────────┐
│ API Modules  │  │  Sensor Modules    │
│              │  │                    │
│ • Weather    │  │ • PaxCounter       │
│ • Planes     │  │   (WiFi Sniffing)  │
│ • AQI        │  │                    │
│ • News       │  └────────────────────┘
│ • Traffic    │
│ • Calendar   │
└──────┬───────┘
       │
       │ Parse & Store
       │
       ▼
┌──────────────────────────────────────────┐
│        Module Data Storage               │
│  (in-memory variables per module)        │
└──────┬───────────────────────────────────┘
       │
       │ Read Data
       │
       ▼
┌──────────────────────────────────────────┐
│      Display/Alert Logic                 │
│                                          │
│  ├─ displayInfo()                        │
│  │   └─ Format & show on TFT/Serial     │
│  │                                       │
│  └─ checkAlerts()                        │
│      └─ Trigger buzzer if needed         │
└──────┬───────────────────────────────────┘
       │
       ├──────────────┐
       │              │
       ▼              ▼
┌──────────────┐  ┌──────────────┐
│ TFT Display  │  │   Buzzer     │
│ (Visual)     │  │   (Audio)    │
└──────────────┘  └──────────────┘
```

## Configuration System

```
┌─────────────────────────────────────────────────────────┐
│                   Config.h                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  WiFi Configuration                                     │
│  ├─ WIFI_SSID                                          │
│  └─ WIFI_PASSWORD                                      │
│                                                         │
│  Location Configuration                                 │
│  ├─ LATITUDE                                           │
│  ├─ LONGITUDE                                          │
│  └─ LOCATION_NAME                                      │
│                                                         │
│  Module Enable/Disable                                  │
│  ├─ ENABLE_SATELLITE_IMAGE_CLOCK                       │
│  ├─ ENABLE_PAX_COUNTER                                 │
│  ├─ ENABLE_PLANES_NEARBY                               │
│  ├─ ENABLE_WEATHER                                     │
│  └─ ... (one per module)                               │
│                                                         │
│  Update Intervals                                       │
│  ├─ SATELLITE_IMAGE_UPDATE_INTERVAL                    │
│  ├─ PAX_COUNTER_UPDATE_INTERVAL                        │
│  └─ ... (one per module)                               │
│                                                         │
│  API Keys                                              │
│  ├─ WEATHER_API_KEY                                    │
│  ├─ AQI_API_KEY                                        │
│  └─ ... (one per API-based module)                     │
│                                                         │
│  Alert Thresholds                                       │
│  ├─ ALERT_PLANE_DISTANCE_KM                            │
│  ├─ ALERT_WEATHER_SEVERITY                             │
│  └─ ALERT_AQI_THRESHOLD                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Execution Flow

```
┌─────────────────┐
│  Power On       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  setup()        │
├─────────────────┤
│ 1. Init Serial  │
│ 2. Connect WiFi │
│ 3. Setup NTP    │
│ 4. Init Modules │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  loop() - Infinite                  │
├─────────────────────────────────────┤
│                                     │
│  ┌───────────────────────────────┐ │
│  │ For each module:              │ │
│  │                               │ │
│  │ if (needsUpdate())            │ │
│  │   ├─ Fetch new data           │ │
│  │   ├─ Update timestamp         │ │
│  │   └─ Store data               │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ Check alert conditions        │ │
│  │                               │ │
│  │ if (alert triggered)          │ │
│  │   └─ Activate buzzer          │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ Update display                │ │
│  │                               │ │
│  │ ├─ Format data                │ │
│  │ ├─ Draw to TFT                │ │
│  │ └─ Print to Serial            │ │
│  └───────────────────────────────┘ │
│                                     │
│  delay(100ms)                       │
│                                     │
│  ────────────┐                      │
│              │                      │
│              └──────────────────────┤
└─────────────────────────────────────┘
```

## Module Update Timing

```
Time ────────────────────────────────────────────────▶

PaxCounter      │─────┤│─────┤│─────┤│─────┤
(1 min)         0     60    120   180   240

PlanesNearby    │──────────┤│──────────┤│──────────┤
(30 sec)        0          30          60          90

Weather         │────────────────────────────┤
(30 min)        0                          1800

AQI             │────────────────────────────────────────────┤
(1 hour)        0                                          3600

Satellite       │────────────────────────────────────────────┤
(1 hour)        0                                          3600

Display Update  │┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤│┤
(1 sec)         (Every second)

```

## Hardware Interfaces

```
┌─────────────────────────────────────────────────────────┐
│                      ESP32                              │
│                                                         │
│  ┌──────────────┐         ┌──────────────┐            │
│  │   WiFi/BLE   │         │  SPI Master  │            │
│  │   Radio      │         │              │            │
│  └──────┬───────┘         └──────┬───────┘            │
│         │                        │                     │
└─────────┼────────────────────────┼─────────────────────┘
          │                        │
          │                        │
          │                        ▼
          │              ┌───────────────────┐
          │              │   TFT Display     │
          │              │   (SPI)           │
          │              │   • MOSI          │
          │              │   • SCK           │
          │              │   • CS            │
          │              │   • DC/RS         │
          │              │   • RST           │
          │              └───────────────────┘
          │
          ▼
┌───────────────────┐         ┌──────────────┐
│  PAX Detection    │         │   Buzzer     │
│  (WiFi Probes)    │         │  (GPIO 25)   │
└───────────────────┘         └──────────────┘
```

## Adding New Modules - Workflow

```
┌────────────────────────────────────────────────────────┐
│ Developer wants to add new feature                     │
└────────┬───────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ 1. Create module class inheriting ModuleInterface     │
│    src/modules/NewModule/NewModule.h                   │
└────────┬───────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ 2. Add configuration to include/Config.h               │
│    • ENABLE_NEW_MODULE                                 │
│    • NEW_MODULE_UPDATE_INTERVAL                        │
│    • NEW_MODULE_API_KEY (if needed)                    │
└────────┬───────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ 3. Register module in src/main.cpp                     │
│    • #include "modules/NewModule/NewModule.h"          │
│    • NewModule newModule;                              │
│    • Add to modules[] array                            │
└────────┬───────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ 4. Use module data in displayInfo()                    │
│    if (newModule.isEnabled()) {                        │
│        Serial.println(newModule.getData());            │
│    }                                                   │
└────────┬───────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ ✓ Module automatically managed by system               │
│   • Initialized in setup()                             │
│   • Updated based on interval                          │
│   • Can be enabled/disabled via config                 │
└────────────────────────────────────────────────────────┘
```

## Key Design Principles

1. **Modularity**: Each feature is independent and self-contained
2. **Configurability**: Everything can be enabled/disabled/tuned
3. **Extensibility**: Easy to add new modules without breaking existing code
4. **Minimal Dependencies**: Modules don't depend on each other
5. **Clear Interfaces**: All modules follow the same contract
6. **Fail-Safe**: If one module fails, others continue working
7. **Resource Conscious**: Manages API rate limits and memory carefully

## Directory Structure

```
ESP32-Mirage/
│
├── .github/
│   └── workflows/
│       └── platformio.yml          # CI/CD configuration
│
├── data/                            # SPIFFS filesystem data
│
├── include/
│   ├── Config.h                     # Central configuration
│   ├── ModuleInterface.h            # Base module interface
│   └── ModuleManager.h              # Module orchestration
│
├── src/
│   ├── main.cpp                     # Main application
│   └── modules/
│       ├── SatelliteImageClock/
│       ├── PaxCounter/
│       ├── PlanesNearby/
│       ├── Weather/
│       ├── AirQuality/
│       ├── Traffic/
│       ├── News/
│       ├── SoundAlerts/
│       ├── Calendar/
│       └── AstronomicalEvents/
│
├── DEVELOPER_GUIDE.md               # How to add modules
├── GETTING_STARTED.md               # Quick start guide
├── HARDWARE.md                      # Hardware setup
├── README.md                        # Main documentation
├── ESP32-Mirage.ino                 # Arduino IDE version
├── config.example.json              # Example config
└── platformio.ini                   # PlatformIO config
```

## Technology Stack

- **Platform**: ESP32 (Espressif)
- **Framework**: Arduino Core for ESP32
- **Build System**: PlatformIO / Arduino IDE
- **Networking**: WiFi (802.11 b/g/n)
- **Protocols**: HTTP/HTTPS, NTP, SPI
- **Libraries**:
  - WiFiManager (captive portal)
  - ArduinoJson (data parsing)
  - HTTPClient (API requests)
  - Adafruit GFX (display graphics)
  - TFT drivers (ST7735/ST7789)

## Future Enhancements

- Web configuration interface
- MQTT integration
- OTA updates
- Data logging to SD card
- Multi-display support
- Touch screen interface
- Battery monitoring
- Sleep modes for power saving

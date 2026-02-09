# Getting Started with ESP32-Mirage

This guide will help you get your ESP32-Mirage up and running quickly.

## Quick Start (5 minutes)

### 1. Hardware Setup
Connect your ESP32 to the TFT display:
- Connect power (3.3V and GND)
- Connect SPI pins (MOSI, SCK, CS, DC, RST)
- Optionally connect buzzer to GPIO 25

### 2. Software Setup

#### Option A: Quick Test (No API Keys)
To test the system without API keys:

1. Open `include/Config.h`
2. Set your WiFi credentials:
   ```cpp
   #define WIFI_SSID "YourWiFiName"
   #define WIFI_PASSWORD "YourPassword"
   ```
3. Disable modules that require API keys:
   ```cpp
   #define ENABLE_SATELLITE_IMAGE_CLOCK false
   #define ENABLE_WEATHER false
   #define ENABLE_AIR_QUALITY false
   #define ENABLE_TRAFFIC false
   #define ENABLE_NEWS false
   #define ENABLE_CALENDAR false
   ```
4. Leave enabled:
   ```cpp
   #define ENABLE_PAX_COUNTER true
   #define ENABLE_PLANES_NEARBY true  // OpenSky is free, no key needed
   #define ENABLE_SOUND_ALERTS true
   #define ENABLE_ASTRONOMICAL_EVENTS true
   ```

#### Option B: Full Setup (With API Keys)
To enable all features:

1. Get free API keys from:
   - OpenWeatherMap: https://openweathermap.org/api
   - WAQI (Air Quality): https://aqicn.org/api/
   - NewsAPI: https://newsapi.org/
   - Google Maps (Traffic): https://developers.google.com/maps
   
2. Add them to `include/Config.h`:
   ```cpp
   #define WEATHER_API_KEY "your_openweathermap_key"
   #define AQI_API_KEY "your_waqi_key"
   #define NEWS_API_KEY "your_newsapi_key"
   #define TRAFFIC_API_KEY "your_google_maps_key"
   ```

3. Set your location:
   ```cpp
   #define LATITUDE 37.7749
   #define LONGITUDE -122.4194
   #define LOCATION_NAME "San Francisco"
   ```

### 3. Upload and Run

Using PlatformIO:
```bash
pio run --target upload
pio device monitor
```

Using Arduino IDE:
- Open `src/main.cpp`
- Select your ESP32 board
- Click Upload
- Open Serial Monitor (115200 baud)

### 4. First Boot

On first boot:
1. If WiFi connection fails, ESP32 creates an access point named "ESP32-Mirage"
2. Connect to this AP from your phone
3. A configuration page will open automatically
4. Select your WiFi network and enter password
5. ESP32 will restart and connect to your WiFi

## Understanding the Output

The serial monitor shows:
```
╔══════════════════════════════════════╗
║      ESP32-Mirage Starting...       ║
║   Satellite Image Clock & Monitor   ║
╚══════════════════════════════════════╝

[WiFi] Connected!
[WiFi] IP Address: 192.168.1.100

[System] Starting module: SatelliteImageClock
[System] Starting module: PaxCounter
...

=== ESP32-Mirage Status ===
Time: 2024-01-15 14:30:25
PAX Count: 12
Planes Nearby: 3 (Nearest: UAL123 at 8.5 km)
Weather: 18.5°C, 65% humidity - clear sky
Air Quality: AQI 45 (Good)
===========================
```

## Customizing Update Intervals

Edit `include/Config.h` to change how often data is fetched:

```cpp
// Fast updates (more API calls, fresher data)
#define WEATHER_UPDATE_INTERVAL 900000   // 15 minutes
#define PLANES_UPDATE_INTERVAL 10000     // 10 seconds

// Slow updates (fewer API calls, conserve quota)
#define WEATHER_UPDATE_INTERVAL 3600000  // 1 hour
#define PLANES_UPDATE_INTERVAL 60000     // 1 minute
```

**Note**: Most free APIs have rate limits. Check your API provider's limits.

## Enabling/Disabling Features

Toggle features on/off in `include/Config.h`:

```cpp
// Disable a feature you don't need
#define ENABLE_TRAFFIC false

// Enable it again later
#define ENABLE_TRAFFIC true
```

Changes require re-uploading the code.

## Sound Alerts Configuration

Customize when alerts trigger:

```cpp
// Alert when plane is within 5 km
#define ALERT_PLANE_DISTANCE_KM 5.0

// Alert when AQI exceeds 150 (Unhealthy)
#define ALERT_AQI_THRESHOLD 150

// Alert on severe weather (severity 3+)
#define ALERT_WEATHER_SEVERITY 3
```

## Troubleshooting

### "Module disabled" messages
- Check that the module is enabled in `Config.h`
- Recompile and upload after changes

### "HTTP Error: 401" 
- Invalid API key
- Check that you've set the correct key in `Config.h`

### "HTTP Error: 429"
- Too many API requests (rate limited)
- Increase update intervals in `Config.h`

### WiFi won't connect
- Double-check SSID and password
- Ensure 2.4GHz WiFi (ESP32 doesn't support 5GHz)
- Connect to "ESP32-Mirage" AP to reconfigure

### Display shows nothing
- Check wiring connections
- Verify pin numbers in `Config.h` match your wiring
- Try different `DISPLAY_ROTATION` values (0, 1, 2, 3)

### No serial output
- Check baud rate is set to 115200
- Ensure USB cable supports data (not just charging)
- Press the reset button on ESP32

## Next Steps

- **Customize display**: Modify `displayInfo()` in `main.cpp`
- **Add new modules**: Follow the module template in README.md
- **Create themes**: Design custom display layouts
- **Integration**: Connect to home automation systems

## Need Help?

- Read the full [README.md](README.md)
- Check [GitHub Issues](https://github.com/vs4vijay/ESP32-Mirage/issues)
- Review module source code in `src/modules/`

Happy monitoring! 🛰️✨

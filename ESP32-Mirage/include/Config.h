#ifndef CONFIG_H
#define CONFIG_H

// WiFi Configuration
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define WIFI_TIMEOUT_MS 20000

// Display Configuration - Board-specific defaults
// These can be overridden by platformio.ini build flags

// Default ESP32-DevKit pins (if not defined by board)
#ifndef TFT_CS
#define TFT_CS 5
#endif

#ifndef TFT_RST
#define TFT_RST 17
#endif

#ifndef TFT_DC
#define TFT_DC 16
#endif

#ifndef SCREEN_WIDTH
#define SCREEN_WIDTH 240
#endif

#ifndef SCREEN_HEIGHT
#define SCREEN_HEIGHT 240
#endif

// Board-specific configurations
#if defined(BOARD_LILYGO_T_DISPLAY)
    #define BOARD_NAME "LilyGo T-Display"
    #define HAS_DISPLAY true
    #define USE_TFT_ESPI true
#elif defined(BOARD_ESP32_GEEK)
    #define BOARD_NAME "ESP32 Geek"
    #define HAS_DISPLAY true
    #define USE_TFT_ESPI true
#elif defined(BOARD_M5STACK)
    #define BOARD_NAME "M5Stack"
    #define HAS_DISPLAY true
    #define USE_M5STACK true
#elif defined(BOARD_M5STACK_CORES3)
    #define BOARD_NAME "M5Stack CoreS3"
    #define HAS_DISPLAY true
    #define USE_M5UNIFIED true
#elif defined(BOARD_M5STACK_CARDPUTER)
    #define BOARD_NAME "M5Stack Cardputer"
    #define HAS_DISPLAY true
    #define USE_M5UNIFIED true
#elif defined(BOARD_M5STICK_C_PLUS)
    #define BOARD_NAME "M5StickC Plus"
    #define HAS_DISPLAY true
    #define USE_M5STICK true
#elif defined(BOARD_M5STICK_C_PLUS2)
    #define BOARD_NAME "M5StickC Plus2"
    #define HAS_DISPLAY true
    #define USE_M5UNIFIED true
#elif defined(BOARD_ESP32DEV)
    #define BOARD_NAME "ESP32-DevKit"
    #define HAS_DISPLAY true
    #define USE_ADAFRUIT_GFX true
#else
    #define BOARD_NAME "Generic ESP32"
    #define HAS_DISPLAY true
    #define USE_ADAFRUIT_GFX true
#endif

// Module Enable/Disable Configuration
#define ENABLE_SATELLITE_IMAGE_CLOCK true
#define ENABLE_PAX_COUNTER true
#define ENABLE_PLANES_NEARBY true
#define ENABLE_WEATHER true
#define ENABLE_AIR_QUALITY true
#define ENABLE_TRAFFIC true
#define ENABLE_NEWS true
#define ENABLE_SOUND_ALERTS true
#define ENABLE_CALENDAR true
#define ENABLE_ASTRONOMICAL_EVENTS true

// Update Intervals (milliseconds)
#define SATELLITE_IMAGE_UPDATE_INTERVAL 3600000  // 1 hour
#define PAX_COUNTER_UPDATE_INTERVAL 60000        // 1 minute
#define PLANES_UPDATE_INTERVAL 30000             // 30 seconds
#define WEATHER_UPDATE_INTERVAL 1800000          // 30 minutes
#define AQI_UPDATE_INTERVAL 3600000              // 1 hour
#define TRAFFIC_UPDATE_INTERVAL 300000           // 5 minutes
#define NEWS_UPDATE_INTERVAL 3600000             // 1 hour
#define CALENDAR_UPDATE_INTERVAL 3600000         // 1 hour
#define ASTRONOMICAL_UPDATE_INTERVAL 86400000    // 24 hours

// API Configuration (user must set these)
#define SATELLITE_API_KEY ""
#define WEATHER_API_KEY ""
#define AQI_API_KEY ""
#define TRAFFIC_API_KEY ""
#define NEWS_API_KEY ""
#define CALENDAR_API_KEY ""
#define PLANES_API_KEY ""
#define ASTRONOMICAL_API_KEY ""

// Location Configuration
#define LATITUDE 0.0
#define LONGITUDE 0.0
#define LOCATION_NAME "Unknown"

// Sound Alert Configuration
#define BUZZER_PIN 25
#define ALERT_PLANE_DISTANCE_KM 5.0
#define ALERT_WEATHER_SEVERITY 3
#define ALERT_AQI_THRESHOLD 150

// Display Mode
#define DISPLAY_ROTATION 0
#define TIME_FORMAT_24H true

#endif // CONFIG_H

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <time.h>
#include "Config.h"
#include "ModuleInterface.h"
#include "modules/SatelliteImageClock/SatelliteImageClock.h"
#include "modules/PaxCounter/PaxCounter.h"
#include "modules/PlanesNearby/PlanesNearby.h"
#include "modules/Weather/Weather.h"
#include "modules/AirQuality/AirQuality.h"
#include "modules/Traffic/Traffic.h"
#include "modules/News/News.h"
#include "modules/SoundAlerts/SoundAlerts.h"
#include "modules/Calendar/Calendar.h"
#include "modules/AstronomicalEvents/AstronomicalEvents.h"

// Module instances
SatelliteImageClock satelliteImageClock;
PaxCounter paxCounter;
PlanesNearby planesNearby;
Weather weather;
AirQuality airQuality;
Traffic traffic;
News news;
SoundAlerts soundAlerts;
Calendar calendar;
AstronomicalEvents astronomicalEvents;

// Array of all modules for easy iteration
ModuleInterface* modules[] = {
    &satelliteImageClock,
    &paxCounter,
    &planesNearby,
    &weather,
    &airQuality,
    &traffic,
    &news,
    &soundAlerts,
    &calendar,
    &astronomicalEvents
};
const int moduleCount = sizeof(modules) / sizeof(modules[0]);

// Time tracking
unsigned long lastDisplayUpdate = 0;
const unsigned long displayUpdateInterval = 1000; // Update display every second

void setupWiFi() {
    Serial.println("\n[WiFi] Initializing WiFi...");
    
    WiFiManager wifiManager;
    wifiManager.setConfigPortalTimeout(180); // 3 minutes timeout
    
    // Try to connect with saved credentials or start config portal
    if (!wifiManager.autoConnect("ESP32-Mirage")) {
        Serial.println("[WiFi] Failed to connect and hit timeout");
        ESP.restart();
    }
    
    Serial.println("[WiFi] Connected!");
    Serial.print("[WiFi] IP Address: ");
    Serial.println(WiFi.localIP());
    
    // Configure NTP for time synchronization
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    Serial.println("[Time] NTP configured");
}

void setupModules() {
    Serial.println("\n[System] Initializing modules...");
    
    for (int i = 0; i < moduleCount; i++) {
        if (modules[i]->isEnabled()) {
            Serial.printf("[System] Starting module: %s\n", modules[i]->getName());
            if (modules[i]->begin()) {
                Serial.printf("[System] Module %s initialized successfully\n", 
                             modules[i]->getName());
            } else {
                Serial.printf("[System] Failed to initialize module: %s\n", 
                             modules[i]->getName());
            }
        } else {
            Serial.printf("[System] Module %s is disabled\n", modules[i]->getName());
        }
    }
    
    Serial.println("[System] All modules initialized\n");
}

void updateModules() {
    // Update all enabled modules
    for (int i = 0; i < moduleCount; i++) {
        if (modules[i]->isEnabled() && modules[i]->needsUpdate()) {
            Serial.printf("[System] Updating module: %s\n", modules[i]->getName());
            modules[i]->update();
        }
    }
    
    // Check for sound alerts based on module data
    if (soundAlerts.isEnabled()) {
        if (planesNearby.isEnabled()) {
            soundAlerts.checkPlaneProximity(planesNearby.getNearestDistance());
        }
        
        if (weather.isEnabled()) {
            // Map weather codes to severity (simplified)
            int severity = (weather.getWeatherCode() >= 200 && weather.getWeatherCode() < 300) ? 4 : 1;
            soundAlerts.checkWeatherSeverity(severity);
        }
        
        if (airQuality.isEnabled()) {
            soundAlerts.checkAQI(airQuality.getAQI());
        }
    }
}

void displayInfo() {
    // This would update the TFT display
    // For now, just print to serial
    
    if (millis() - lastDisplayUpdate < displayUpdateInterval) {
        return;
    }
    
    Serial.println("\n=== ESP32-Mirage Status ===");
    
    // Get current time
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
        char timeStr[64];
        strftime(timeStr, sizeof(timeStr), "%Y-%m-%d %H:%M:%S", &timeinfo);
        Serial.printf("Time: %s\n", timeStr);
    }
    
    // Display module information
    if (paxCounter.isEnabled()) {
        Serial.printf("PAX Count: %d\n", paxCounter.getCount());
    }
    
    if (planesNearby.isEnabled()) {
        Serial.printf("Planes Nearby: %d (Nearest: %s at %.2f km)\n", 
                     planesNearby.getPlaneCount(),
                     planesNearby.getNearestCallsign().c_str(),
                     planesNearby.getNearestDistance());
    }
    
    if (weather.isEnabled()) {
        Serial.printf("Weather: %.1f°C, %.0f%% humidity - %s\n",
                     weather.getTemperature(),
                     weather.getHumidity(),
                     weather.getDescription().c_str());
    }
    
    if (airQuality.isEnabled()) {
        Serial.printf("Air Quality: AQI %d (%s)\n",
                     airQuality.getAQI(),
                     airQuality.getCategory().c_str());
    }
    
    if (traffic.isEnabled()) {
        Serial.printf("Traffic: %s (Delay: %d min)\n",
                     traffic.getStatus().c_str(),
                     traffic.getDelayMinutes());
    }
    
    if (news.isEnabled() && news.getHeadlineCount() > 0) {
        Serial.println("Top Headline: " + news.getHeadline(0));
    }
    
    if (calendar.isEnabled() && calendar.getEventCount() > 0) {
        Serial.println("Next Event: " + calendar.getEvent(0));
    }
    
    if (astronomicalEvents.isEnabled() && astronomicalEvents.getEventCount() > 0) {
        Serial.println("Next Astronomical Event: " + astronomicalEvents.getEvent(0));
    }
    
    Serial.println("===========================\n");
    
    lastDisplayUpdate = millis();
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("\n\n");
    Serial.println("╔══════════════════════════════════════╗");
    Serial.println("║      ESP32-Mirage Starting...       ║");
    Serial.println("║   Satellite Image Clock & Monitor   ║");
    Serial.println("╚══════════════════════════════════════╝");
    Serial.println();
    
    // Display board information
    Serial.printf("[Board] Detected: %s\n", BOARD_NAME);
    #if HAS_DISPLAY
    Serial.printf("[Display] Screen: %dx%d\n", SCREEN_WIDTH, SCREEN_HEIGHT);
    #else
    Serial.println("[Display] No display (headless mode)");
    #endif
    Serial.println();
    
    // Setup WiFi
    setupWiFi();
    
    // Initialize all modules
    setupModules();
    
    Serial.println("[System] Setup complete! Starting main loop...\n");
}

void loop() {
    // Update all modules
    updateModules();
    
    // Display current information
    displayInfo();
    
    // Small delay to prevent overwhelming the system
    delay(100);
}

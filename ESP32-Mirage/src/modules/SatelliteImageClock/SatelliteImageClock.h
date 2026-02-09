#ifndef SATELLITE_IMAGE_CLOCK_H
#define SATELLITE_IMAGE_CLOCK_H

#include "ModuleInterface.h"
#include "Config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

class SatelliteImageClock : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    String imageUrl;
    
public:
    SatelliteImageClock() : 
        lastUpdate(0), 
        updateInterval(SATELLITE_IMAGE_UPDATE_INTERVAL),
        enabled(ENABLE_SATELLITE_IMAGE_CLOCK),
        imageUrl("") {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[SatelliteImageClock] Module disabled");
            return false;
        }
        Serial.println("[SatelliteImageClock] Initializing...");
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[SatelliteImageClock] Fetching satellite image...");
        
        // Fetch satellite image from API
        // This would connect to services like NASA EOSDIS, Himawari-8, or NOAA
        HTTPClient http;
        String url = "https://api.satellite-service.com/latest?lat=" + 
                     String(LATITUDE) + "&lon=" + String(LONGITUDE) + 
                     "&key=" + String(SATELLITE_API_KEY);
        
        http.begin(url);
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(1024);
            deserializeJson(doc, payload);
            imageUrl = doc["image_url"].as<String>();
            Serial.println("[SatelliteImageClock] Image URL: " + imageUrl);
        } else {
            Serial.printf("[SatelliteImageClock] HTTP Error: %d\n", httpCode);
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "SatelliteImageClock";
    }
    
    bool needsUpdate() const override {
        return enabled && (millis() - lastUpdate >= updateInterval);
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    String getImageUrl() const {
        return imageUrl;
    }
};

#endif // SATELLITE_IMAGE_CLOCK_H

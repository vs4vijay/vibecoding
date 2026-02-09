#ifndef AIR_QUALITY_H
#define AIR_QUALITY_H

#include "ModuleInterface.h"
#include "Config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

class AirQuality : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    int aqi;
    String category;
    float pm25;
    float pm10;
    
public:
    AirQuality() : 
        lastUpdate(0), 
        updateInterval(AQI_UPDATE_INTERVAL),
        enabled(ENABLE_AIR_QUALITY),
        aqi(0),
        category(""),
        pm25(0.0),
        pm10(0.0) {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[AirQuality] Module disabled");
            return false;
        }
        Serial.println("[AirQuality] Initializing...");
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[AirQuality] Fetching AQI data...");
        
        // Fetch from OpenAQ, IQAir, or similar API
        HTTPClient http;
        String url = "https://api.waqi.info/feed/geo:" + 
                     String(LATITUDE) + ";" + String(LONGITUDE) + 
                     "/?token=" + String(AQI_API_KEY);
        
        http.begin(url);
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(2048);
            deserializeJson(doc, payload);
            
            aqi = doc["data"]["aqi"];
            pm25 = doc["data"]["iaqi"]["pm25"]["v"];
            pm10 = doc["data"]["iaqi"]["pm10"]["v"];
            
            // Categorize AQI
            if (aqi <= 50) category = "Good";
            else if (aqi <= 100) category = "Moderate";
            else if (aqi <= 150) category = "Unhealthy for Sensitive";
            else if (aqi <= 200) category = "Unhealthy";
            else if (aqi <= 300) category = "Very Unhealthy";
            else category = "Hazardous";
            
            Serial.printf("[AirQuality] AQI: %d (%s), PM2.5: %.1f, PM10: %.1f\n", 
                         aqi, category.c_str(), pm25, pm10);
        } else {
            Serial.printf("[AirQuality] HTTP Error: %d\n", httpCode);
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "AirQuality";
    }
    
    bool needsUpdate() const override {
        return enabled && (millis() - lastUpdate >= updateInterval);
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    int getAQI() const {
        return aqi;
    }
    
    String getCategory() const {
        return category;
    }
    
    float getPM25() const {
        return pm25;
    }
    
    float getPM10() const {
        return pm10;
    }
};

#endif // AIR_QUALITY_H

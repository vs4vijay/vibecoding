#ifndef TRAFFIC_H
#define TRAFFIC_H

#include "ModuleInterface.h"
#include "Config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

class Traffic : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    String trafficStatus;
    int delayMinutes;
    String mainRoute;
    
public:
    Traffic() : 
        lastUpdate(0), 
        updateInterval(TRAFFIC_UPDATE_INTERVAL),
        enabled(ENABLE_TRAFFIC),
        trafficStatus("Unknown"),
        delayMinutes(0),
        mainRoute("") {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[Traffic] Module disabled");
            return false;
        }
        Serial.println("[Traffic] Initializing...");
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[Traffic] Fetching traffic data...");
        
        // Fetch from Google Maps Traffic API, TomTom, or similar
        HTTPClient http;
        String url = "https://maps.googleapis.com/maps/api/directions/json?origin=" + 
                     String(LATITUDE) + "," + String(LONGITUDE) + 
                     "&destination=" + String(LATITUDE + 0.1) + "," + String(LONGITUDE + 0.1) +
                     "&departure_time=now&traffic_model=best_guess&key=" + String(TRAFFIC_API_KEY);
        
        http.begin(url);
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(4096);
            deserializeJson(doc, payload);
            
            if (doc["status"] == "OK") {
                int duration = doc["routes"][0]["legs"][0]["duration"]["value"];
                int durationInTraffic = doc["routes"][0]["legs"][0]["duration_in_traffic"]["value"];
                
                delayMinutes = (durationInTraffic - duration) / 60;
                
                if (delayMinutes < 5) trafficStatus = "Clear";
                else if (delayMinutes < 15) trafficStatus = "Light";
                else if (delayMinutes < 30) trafficStatus = "Moderate";
                else trafficStatus = "Heavy";
                
                mainRoute = doc["routes"][0]["summary"].as<String>();
                
                Serial.printf("[Traffic] Status: %s, Delay: %d min, Route: %s\n", 
                             trafficStatus.c_str(), delayMinutes, mainRoute.c_str());
            }
        } else {
            Serial.printf("[Traffic] HTTP Error: %d\n", httpCode);
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "Traffic";
    }
    
    bool needsUpdate() const override {
        return enabled && (millis() - lastUpdate >= updateInterval);
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    String getStatus() const {
        return trafficStatus;
    }
    
    int getDelayMinutes() const {
        return delayMinutes;
    }
    
    String getMainRoute() const {
        return mainRoute;
    }
};

#endif // TRAFFIC_H

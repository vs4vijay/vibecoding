#ifndef PLANES_NEARBY_H
#define PLANES_NEARBY_H

#include "ModuleInterface.h"
#include "Config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

class PlanesNearby : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    int planeCount;
    float nearestPlaneDistance;
    String nearestPlaneCallsign;
    
public:
    PlanesNearby() : 
        lastUpdate(0), 
        updateInterval(PLANES_UPDATE_INTERVAL),
        enabled(ENABLE_PLANES_NEARBY),
        planeCount(0),
        nearestPlaneDistance(9999.9),
        nearestPlaneCallsign("") {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[PlanesNearby] Module disabled");
            return false;
        }
        Serial.println("[PlanesNearby] Initializing...");
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[PlanesNearby] Fetching nearby aircraft...");
        
        // Fetch from OpenSky Network or similar ADS-B API
        HTTPClient http;
        String url = "https://opensky-network.org/api/states/all?lamin=" + 
                     String(LATITUDE - 0.5) + "&lomin=" + String(LONGITUDE - 0.5) +
                     "&lamax=" + String(LATITUDE + 0.5) + "&lomax=" + String(LONGITUDE + 0.5);
        
        http.begin(url);
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(4096);
            deserializeJson(doc, payload);
            
            JsonArray states = doc["states"];
            planeCount = states.size();
            
            nearestPlaneDistance = 9999.9;
            for (JsonVariant state : states) {
                float lat = state[6];
                float lon = state[5];
                String callsign = state[1].as<String>();
                
                // Calculate distance using Haversine formula for accuracy
                float distance = calculateDistance(LATITUDE, LONGITUDE, lat, lon);
                
                if (distance < nearestPlaneDistance) {
                    nearestPlaneDistance = distance;
                    nearestPlaneCallsign = callsign;
                }
            }
            
            Serial.printf("[PlanesNearby] Found %d planes, nearest: %s (%.2f km)\n", 
                         planeCount, nearestPlaneCallsign.c_str(), nearestPlaneDistance);
        } else {
            Serial.printf("[PlanesNearby] HTTP Error: %d\n", httpCode);
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "PlanesNearby";
    }
    
    bool needsUpdate() const override {
        return enabled && (millis() - lastUpdate >= updateInterval);
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    int getPlaneCount() const {
        return planeCount;
    }
    
    float getNearestDistance() const {
        return nearestPlaneDistance;
    }
    
    String getNearestCallsign() const {
        return nearestPlaneCallsign;
    }
    
private:
    /**
     * Calculate distance between two GPS coordinates using Haversine formula
     * @param lat1 Latitude of first point
     * @param lon1 Longitude of first point
     * @param lat2 Latitude of second point
     * @param lon2 Longitude of second point
     * @return Distance in kilometers
     */
    float calculateDistance(float lat1, float lon1, float lat2, float lon2) {
        const float R = 6371.0; // Earth's radius in km
        
        // Convert to radians
        float dLat = (lat2 - lat1) * PI / 180.0;
        float dLon = (lon2 - lon1) * PI / 180.0;
        lat1 = lat1 * PI / 180.0;
        lat2 = lat2 * PI / 180.0;
        
        // Haversine formula
        float a = sin(dLat/2) * sin(dLat/2) +
                  cos(lat1) * cos(lat2) * 
                  sin(dLon/2) * sin(dLon/2);
        float c = 2 * atan2(sqrt(a), sqrt(1-a));
        
        return R * c;
    }
};

#endif // PLANES_NEARBY_H

#ifndef ASTRONOMICAL_EVENTS_H
#define ASTRONOMICAL_EVENTS_H

#include "ModuleInterface.h"
#include "Config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

class AstronomicalEvents : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    String upcomingEvents[3];
    String eventDates[3];
    int eventCount;
    
public:
    AstronomicalEvents() : 
        lastUpdate(0), 
        updateInterval(ASTRONOMICAL_UPDATE_INTERVAL),
        enabled(ENABLE_ASTRONOMICAL_EVENTS),
        eventCount(0) {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[AstronomicalEvents] Module disabled");
            return false;
        }
        Serial.println("[AstronomicalEvents] Initializing...");
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[AstronomicalEvents] Fetching astronomical events...");
        
        // Fetch from astronomy API (e.g., NASA API, TimeAndDate API)
        HTTPClient http;
        String url = "https://api.astronomyapi.com/api/v2/bodies/events?latitude=" + 
                     String(LATITUDE) + "&longitude=" + String(LONGITUDE) +
                     "&from_date=" + getCurrentDate() + "&to_date=" + getFutureDate(30);
        
        http.begin(url);
        http.addHeader("Authorization", "Basic " + String(ASTRONOMICAL_API_KEY));
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(4096);
            deserializeJson(doc, payload);
            
            JsonArray events = doc["data"]["events"];
            eventCount = 0;
            
            for (JsonVariant event : events) {
                if (eventCount >= 3) break;
                upcomingEvents[eventCount] = event["type"].as<String>();
                eventDates[eventCount] = event["date"].as<String>();
                eventCount++;
            }
            
            Serial.printf("[AstronomicalEvents] Found %d upcoming events\n", eventCount);
            for (int i = 0; i < eventCount; i++) {
                Serial.printf("  %d. %s on %s\n", i+1, 
                             upcomingEvents[i].c_str(), eventDates[i].c_str());
            }
        } else {
            Serial.printf("[AstronomicalEvents] HTTP Error: %d\n", httpCode);
            
            // Fallback to hardcoded known events
            eventCount = 3;
            upcomingEvents[0] = "Meteor Shower (Perseids)";
            eventDates[0] = "2024-08-12";
            upcomingEvents[1] = "Lunar Eclipse";
            eventDates[1] = "2024-09-18";
            upcomingEvents[2] = "Solar Eclipse";
            eventDates[2] = "2024-10-02";
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    String getCurrentDate() {
        // Return current date in YYYY-MM-DD format
        struct tm timeinfo;
        if (!getLocalTime(&timeinfo)) {
            return "2024-01-01"; // Fallback if time not available
        }
        
        char buffer[11];
        strftime(buffer, sizeof(buffer), "%Y-%m-%d", &timeinfo);
        return String(buffer);
    }
    
    String getFutureDate(int daysAhead) {
        // Return date N days ahead in YYYY-MM-DD format
        struct tm timeinfo;
        if (!getLocalTime(&timeinfo)) {
            return "2024-01-31"; // Fallback if time not available
        }
        
        // Add days (simplified, doesn't handle month/year boundaries perfectly)
        time_t now = mktime(&timeinfo);
        now += daysAhead * 86400; // 86400 seconds per day
        struct tm* future = localtime(&now);
        
        char buffer[11];
        strftime(buffer, sizeof(buffer), "%Y-%m-%d", future);
        return String(buffer);
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "AstronomicalEvents";
    }
    
    bool needsUpdate() const override {
        return enabled && (millis() - lastUpdate >= updateInterval);
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    int getEventCount() const {
        return eventCount;
    }
    
    String getEvent(int index) const {
        if (index >= 0 && index < eventCount) {
            return upcomingEvents[index];
        }
        return "";
    }
    
    String getEventDate(int index) const {
        if (index >= 0 && index < eventCount) {
            return eventDates[index];
        }
        return "";
    }
};

#endif // ASTRONOMICAL_EVENTS_H

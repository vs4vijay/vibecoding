#ifndef CALENDAR_H
#define CALENDAR_H

#include "ModuleInterface.h"
#include "Config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

class Calendar : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    String events[5];
    String eventTimes[5];
    int eventCount;
    
public:
    Calendar() : 
        lastUpdate(0), 
        updateInterval(CALENDAR_UPDATE_INTERVAL),
        enabled(ENABLE_CALENDAR),
        eventCount(0) {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[Calendar] Module disabled");
            return false;
        }
        Serial.println("[Calendar] Initializing...");
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[Calendar] Fetching upcoming events...");
        
        // Note: Google Calendar API requires OAuth 2.0, not simple API key
        // This is a placeholder implementation. For production, use OAuth 2.0 flow
        // or consider using IFTTT/Zapier webhooks as an alternative
        HTTPClient http;
        
        // This will fail with simple API key - OAuth 2.0 required
        String url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?key=" + 
                     String(CALENDAR_API_KEY) + "&timeMin=" + getCurrentTimeISO() +
                     "&maxResults=5&orderBy=startTime&singleEvents=true";
        
        http.begin(url);
        // Note: Proper implementation needs OAuth 2.0 Bearer token, not API key
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(8192);
            deserializeJson(doc, payload);
            
            JsonArray items = doc["items"];
            eventCount = 0;
            
            for (JsonVariant item : items) {
                if (eventCount >= 5) break;
                events[eventCount] = item["summary"].as<String>();
                eventTimes[eventCount] = item["start"]["dateTime"].as<String>();
                eventCount++;
            }
            
            Serial.printf("[Calendar] Fetched %d upcoming events\n", eventCount);
            for (int i = 0; i < eventCount; i++) {
                Serial.printf("  %d. %s at %s\n", i+1, events[i].c_str(), eventTimes[i].c_str());
            }
        } else {
            Serial.printf("[Calendar] HTTP Error: %d\n", httpCode);
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    String getCurrentTimeISO() {
        // Get current time in ISO 8601 format (RFC 3339)
        struct tm timeinfo;
        if (!getLocalTime(&timeinfo)) {
            return "2024-01-01T00:00:00Z"; // Fallback if time not available
        }
        
        char buffer[25];
        strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
        return String(buffer);
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "Calendar";
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
            return events[index];
        }
        return "";
    }
    
    String getEventTime(int index) const {
        if (index >= 0 && index < eventCount) {
            return eventTimes[index];
        }
        return "";
    }
};

#endif // CALENDAR_H

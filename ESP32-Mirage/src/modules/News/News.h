#ifndef NEWS_H
#define NEWS_H

#include "ModuleInterface.h"
#include "Config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

class News : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    String headlines[5];
    int headlineCount;
    
public:
    News() : 
        lastUpdate(0), 
        updateInterval(NEWS_UPDATE_INTERVAL),
        enabled(ENABLE_NEWS),
        headlineCount(0) {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[News] Module disabled");
            return false;
        }
        Serial.println("[News] Initializing...");
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[News] Fetching news headlines...");
        
        // Fetch from NewsAPI or similar service
        HTTPClient http;
        String url = "https://newsapi.org/v2/top-headlines?country=us&apiKey=" + 
                     String(NEWS_API_KEY);
        
        http.begin(url);
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(8192);
            deserializeJson(doc, payload);
            
            JsonArray articles = doc["articles"];
            headlineCount = 0;
            
            for (JsonVariant article : articles) {
                if (headlineCount >= 5) break;
                headlines[headlineCount] = article["title"].as<String>();
                headlineCount++;
            }
            
            Serial.printf("[News] Fetched %d headlines\n", headlineCount);
            for (int i = 0; i < headlineCount; i++) {
                Serial.printf("  %d. %s\n", i+1, headlines[i].c_str());
            }
        } else {
            Serial.printf("[News] HTTP Error: %d\n", httpCode);
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "News";
    }
    
    bool needsUpdate() const override {
        return enabled && (millis() - lastUpdate >= updateInterval);
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    int getHeadlineCount() const {
        return headlineCount;
    }
    
    String getHeadline(int index) const {
        if (index >= 0 && index < headlineCount) {
            return headlines[index];
        }
        return "";
    }
};

#endif // NEWS_H

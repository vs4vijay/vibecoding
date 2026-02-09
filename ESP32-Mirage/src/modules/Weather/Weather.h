#ifndef WEATHER_H
#define WEATHER_H

#include "ModuleInterface.h"
#include "Config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

class Weather : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    float temperature;
    float humidity;
    String description;
    int weatherCode;
    String forecast[3]; // 3-day forecast
    
public:
    Weather() : 
        lastUpdate(0), 
        updateInterval(WEATHER_UPDATE_INTERVAL),
        enabled(ENABLE_WEATHER),
        temperature(0.0),
        humidity(0.0),
        description(""),
        weatherCode(0) {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[Weather] Module disabled");
            return false;
        }
        Serial.println("[Weather] Initializing...");
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[Weather] Fetching weather data...");
        
        // Fetch from OpenWeatherMap or similar API
        HTTPClient http;
        String url = "https://api.openweathermap.org/data/2.5/weather?lat=" + 
                     String(LATITUDE) + "&lon=" + String(LONGITUDE) + 
                     "&appid=" + String(WEATHER_API_KEY) + "&units=metric";
        
        http.begin(url);
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(2048);
            deserializeJson(doc, payload);
            
            temperature = doc["main"]["temp"];
            humidity = doc["main"]["humidity"];
            description = doc["weather"][0]["description"].as<String>();
            weatherCode = doc["weather"][0]["id"];
            
            Serial.printf("[Weather] Temp: %.1f°C, Humidity: %.0f%%, Desc: %s\n", 
                         temperature, humidity, description.c_str());
            
            // Fetch forecast
            fetchForecast();
        } else {
            Serial.printf("[Weather] HTTP Error: %d\n", httpCode);
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    void fetchForecast() {
        HTTPClient http;
        String url = "https://api.openweathermap.org/data/2.5/forecast?lat=" + 
                     String(LATITUDE) + "&lon=" + String(LONGITUDE) + 
                     "&appid=" + String(WEATHER_API_KEY) + "&units=metric&cnt=3";
        
        http.begin(url);
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(4096);
            deserializeJson(doc, payload);
            
            JsonArray list = doc["list"];
            for (int i = 0; i < 3 && i < list.size(); i++) {
                forecast[i] = list[i]["weather"][0]["description"].as<String>();
            }
            
            Serial.println("[Weather] Forecast fetched");
        }
        
        http.end();
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "Weather";
    }
    
    bool needsUpdate() const override {
        return enabled && (millis() - lastUpdate >= updateInterval);
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    float getTemperature() const {
        return temperature;
    }
    
    float getHumidity() const {
        return humidity;
    }
    
    String getDescription() const {
        return description;
    }
    
    int getWeatherCode() const {
        return weatherCode;
    }
    
    String getForecast(int index) const {
        if (index >= 0 && index < 3) {
            return forecast[index];
        }
        return "";
    }
};

#endif // WEATHER_H

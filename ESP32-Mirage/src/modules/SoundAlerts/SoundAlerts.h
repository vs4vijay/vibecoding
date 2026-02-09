#ifndef SOUND_ALERTS_H
#define SOUND_ALERTS_H

#include "ModuleInterface.h"
#include "Config.h"

class SoundAlerts : public ModuleInterface {
private:
    unsigned long lastUpdate;
    bool enabled;
    bool planeAlertActive;
    bool weatherAlertActive;
    bool aqiAlertActive;
    unsigned long beepStartTime;
    bool beeping;
    
    void beep(int duration) {
        if (!enabled) return;
        
        // Non-blocking beep using tone without delay
        tone(BUZZER_PIN, 1000);
        beepStartTime = millis();
        beeping = true;
        // Note: Call stopBeepIfNeeded() in update() or main loop
    }
    
    void stopBeepIfNeeded() {
        if (beeping && (millis() - beepStartTime >= 200)) {
            noTone(BUZZER_PIN);
            beeping = false;
        }
    }
    
public:
    SoundAlerts() : 
        lastUpdate(0),
        enabled(ENABLE_SOUND_ALERTS),
        planeAlertActive(false),
        weatherAlertActive(false),
        aqiAlertActive(false),
        beepStartTime(0),
        beeping(false) {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[SoundAlerts] Module disabled");
            return false;
        }
        Serial.println("[SoundAlerts] Initializing...");
        pinMode(BUZZER_PIN, OUTPUT);
        return true;
    }
    
    void update() override {
        // Sound alerts are triggered by other modules, not on a schedule
        // Stop beep if duration has elapsed
        stopBeepIfNeeded();
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "SoundAlerts";
    }
    
    bool needsUpdate() const override {
        return false; // Event-driven, not time-based
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    void checkPlaneProximity(float distance) {
        if (!enabled) return;
        
        if (distance < ALERT_PLANE_DISTANCE_KM && !planeAlertActive) {
            Serial.printf("[SoundAlerts] ALERT: Plane nearby (%.2f km)\n", distance);
            beep(200);
            planeAlertActive = true;
        } else if (distance >= ALERT_PLANE_DISTANCE_KM) {
            planeAlertActive = false;
        }
    }
    
    void checkWeatherSeverity(int severity) {
        if (!enabled) return;
        
        if (severity >= ALERT_WEATHER_SEVERITY && !weatherAlertActive) {
            Serial.printf("[SoundAlerts] ALERT: Severe weather (severity %d)\n", severity);
            beep(300);
            weatherAlertActive = true;
        } else if (severity < ALERT_WEATHER_SEVERITY) {
            weatherAlertActive = false;
        }
    }
    
    void checkAQI(int aqi) {
        if (!enabled) return;
        
        if (aqi >= ALERT_AQI_THRESHOLD && !aqiAlertActive) {
            Serial.printf("[SoundAlerts] ALERT: Poor air quality (AQI %d)\n", aqi);
            beep(500);
            aqiAlertActive = true;
        } else if (aqi < ALERT_AQI_THRESHOLD) {
            aqiAlertActive = false;
        }
    }
    
    void playAlertSound(const char* alertType) {
        if (!enabled) return;
        
        Serial.printf("[SoundAlerts] Playing alert: %s\n", alertType);
        beep(150);
    }
};

#endif // SOUND_ALERTS_H

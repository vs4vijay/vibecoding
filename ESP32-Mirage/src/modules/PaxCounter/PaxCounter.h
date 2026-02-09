#ifndef PAX_COUNTER_H
#define PAX_COUNTER_H

#include "ModuleInterface.h"
#include "Config.h"

class PaxCounter : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    int paxCount;
    
public:
    PaxCounter() : 
        lastUpdate(0), 
        updateInterval(PAX_COUNTER_UPDATE_INTERVAL),
        enabled(ENABLE_PAX_COUNTER),
        paxCount(0) {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[PaxCounter] Module disabled");
            return false;
        }
        Serial.println("[PaxCounter] Initializing...");
        // Initialize WiFi sniffer for detecting nearby devices
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[PaxCounter] Counting nearby devices...");
        
        // Count WiFi/BLE devices in range
        // This uses WiFi promiscuous mode to detect probe requests
        // For now, simulate with a placeholder
        paxCount = random(0, 50);
        
        Serial.printf("[PaxCounter] Detected devices: %d\n", paxCount);
        lastUpdate = millis();
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "PaxCounter";
    }
    
    bool needsUpdate() const override {
        return enabled && (millis() - lastUpdate >= updateInterval);
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    int getCount() const {
        return paxCount;
    }
};

#endif // PAX_COUNTER_H

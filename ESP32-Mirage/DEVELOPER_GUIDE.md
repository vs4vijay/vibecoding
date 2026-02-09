# Developer Guide - Adding New Modules

This guide explains how to create new modules for ESP32-Mirage.

## Module Architecture

Each module in ESP32-Mirage:
- Inherits from `ModuleInterface`
- Is self-contained and independent
- Can be enabled/disabled via configuration
- Manages its own update schedule
- Provides data through public getter methods

## Creating a New Module

### Step 1: Create Module Files

Create a new directory and header file:
```
src/modules/YourModule/
└── YourModule.h
```

### Step 2: Implement the Module Class

```cpp
#ifndef YOUR_MODULE_H
#define YOUR_MODULE_H

#include "ModuleInterface.h"
#include "Config.h"
#include <HTTPClient.h>
#include <ArduinoJson.h>

class YourModule : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    // Your module's data members
    String data;
    
public:
    YourModule() : 
        lastUpdate(0), 
        updateInterval(YOUR_MODULE_UPDATE_INTERVAL),
        enabled(ENABLE_YOUR_MODULE),
        data("") {}
    
    bool begin() override {
        if (!enabled) {
            Serial.println("[YourModule] Module disabled");
            return false;
        }
        Serial.println("[YourModule] Initializing...");
        // Initialize your module here
        return true;
    }
    
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        Serial.println("[YourModule] Updating data...");
        
        // Fetch data from API or sensor
        HTTPClient http;
        String url = "https://api.example.com/data";
        
        http.begin(url);
        int httpCode = http.GET();
        
        if (httpCode == 200) {
            String payload = http.getString();
            DynamicJsonDocument doc(1024);
            deserializeJson(doc, payload);
            
            data = doc["field"].as<String>();
            Serial.printf("[YourModule] Data: %s\n", data.c_str());
        } else {
            Serial.printf("[YourModule] HTTP Error: %d\n", httpCode);
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    bool isEnabled() const override {
        return enabled;
    }
    
    const char* getName() const override {
        return "YourModule";
    }
    
    bool needsUpdate() const override {
        return enabled && (millis() - lastUpdate >= updateInterval);
    }
    
    unsigned long getLastUpdate() const override {
        return lastUpdate;
    }
    
    // Public getters for your module's data
    String getData() const {
        return data;
    }
};

#endif // YOUR_MODULE_H
```

### Step 3: Add Configuration

Add configuration options to `include/Config.h`:

```cpp
// Module Enable/Disable
#define ENABLE_YOUR_MODULE true

// Update Interval
#define YOUR_MODULE_UPDATE_INTERVAL 300000  // 5 minutes

// API Configuration
#define YOUR_MODULE_API_KEY ""

// Module-specific settings
#define YOUR_MODULE_SETTING_1 "value"
```

### Step 4: Register the Module

In `src/main.cpp`, add:

```cpp
// 1. Include the header
#include "modules/YourModule/YourModule.h"

// 2. Create an instance
YourModule yourModule;

// 3. Add to the modules array
ModuleInterface* modules[] = {
    &satelliteImageClock,
    &paxCounter,
    // ... other modules ...
    &yourModule  // Add your module here
};
```

### Step 5: Use Module Data

Access your module's data in the `displayInfo()` function:

```cpp
void displayInfo() {
    // ... existing code ...
    
    if (yourModule.isEnabled()) {
        Serial.println("Your Module Data: " + yourModule.getData());
    }
}
```

### Step 6: Optional - Add Sound Alerts

If your module should trigger alerts:

```cpp
void updateModules() {
    // ... existing code ...
    
    // Check for your module's alert conditions
    if (soundAlerts.isEnabled() && yourModule.isEnabled()) {
        if (yourModule.shouldAlert()) {
            soundAlerts.playAlertSound("YourModule");
        }
    }
}
```

## Module Best Practices

### 1. Error Handling
Always handle API failures gracefully:

```cpp
void update() override {
    if (!enabled || !needsUpdate()) return;
    
    HTTPClient http;
    http.begin(url);
    http.setTimeout(10000); // 10 second timeout
    
    int httpCode = http.GET();
    
    if (httpCode == 200) {
        // Success
    } else if (httpCode == 429) {
        Serial.println("[YourModule] Rate limited, backing off");
        updateInterval *= 2; // Exponential backoff
    } else {
        Serial.printf("[YourModule] Error: %d\n", httpCode);
    }
    
    http.end();
    lastUpdate = millis();
}
```

### 2. Memory Management
Be mindful of ESP32's limited memory:

```cpp
// Good: Use appropriate buffer sizes
DynamicJsonDocument doc(1024); // Only what you need

// Bad: Excessive allocation
DynamicJsonDocument doc(16384); // Wasteful
```

### 3. Update Intervals
Choose appropriate intervals:

```cpp
// Frequently changing data
#define STOCK_PRICES_INTERVAL 60000  // 1 minute

// Slowly changing data
#define MOON_PHASE_INTERVAL 86400000 // 24 hours

// Rate-limited APIs
#define LIMITED_API_INTERVAL 3600000 // 1 hour
```

### 4. Serial Logging
Use consistent logging format:

```cpp
Serial.println("[ModuleName] Starting operation...");
Serial.printf("[ModuleName] Value: %d\n", value);
Serial.println("[ModuleName] ✓ Success");
Serial.println("[ModuleName] ✗ Failed");
```

### 5. Configuration Validation
Validate configuration in `begin()`:

```cpp
bool begin() override {
    if (!enabled) return false;
    
    if (strlen(YOUR_MODULE_API_KEY) == 0) {
        Serial.println("[YourModule] ERROR: API key not set");
        return false;
    }
    
    if (LATITUDE == 0.0 && LONGITUDE == 0.0) {
        Serial.println("[YourModule] WARNING: Location not set");
    }
    
    return true;
}
```

## Example Modules

### Simple Sensor Module

```cpp
class TemperatureSensor : public ModuleInterface {
private:
    float temperature;
    const int sensorPin = 34;
    
public:
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        int rawValue = analogRead(sensorPin);
        temperature = (rawValue / 4095.0) * 100.0; // Convert to temp
        
        lastUpdate = millis();
    }
    
    float getTemperature() const { return temperature; }
};
```

### API-based Module

```cpp
class CryptoPrices : public ModuleInterface {
private:
    float bitcoinPrice;
    
public:
    void update() override {
        if (!enabled || !needsUpdate()) return;
        
        HTTPClient http;
        http.begin("https://api.coindesk.com/v1/bpi/currentprice.json");
        
        if (http.GET() == 200) {
            DynamicJsonDocument doc(2048);
            deserializeJson(doc, http.getString());
            bitcoinPrice = doc["bpi"]["USD"]["rate_float"];
        }
        
        http.end();
        lastUpdate = millis();
    }
    
    float getBitcoinPrice() const { return bitcoinPrice; }
};
```

## Testing Your Module

1. **Enable only your module** initially to isolate issues
2. **Monitor serial output** for errors
3. **Check memory usage**: `ESP.getFreeHeap()`
4. **Test failure scenarios**: Disconnect WiFi, use invalid API keys
5. **Verify update timing**: Ensure proper intervals

## Common Issues

### Module Not Updating
- Check `isEnabled()` returns true
- Verify `needsUpdate()` logic
- Ensure WiFi is connected before HTTP requests

### Memory Issues
- Reduce JSON buffer sizes
- Use `StaticJsonDocument` when size is known
- Clear string buffers after use

### API Rate Limiting
- Increase `updateInterval`
- Implement exponential backoff
- Cache responses when possible

## Contributing Your Module

When contributing a new module:

1. Document API requirements in README
2. Provide example configuration
3. Include error handling
4. Add comments explaining complex logic
5. Test with and without API keys
6. Submit a pull request with:
   - Module code
   - Configuration updates
   - Documentation updates
   - Example usage

## Resources

- [ESP32 Arduino Core Documentation](https://docs.espressif.com/projects/arduino-esp32/)
- [ArduinoJson Library](https://arduinojson.org/)
- [HTTPClient Documentation](https://github.com/espressif/arduino-esp32/tree/master/libraries/HTTPClient)

## Questions?

Open an issue on GitHub with the `question` label or check existing modules for examples.

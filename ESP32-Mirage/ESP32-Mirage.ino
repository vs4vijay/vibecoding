// ESP32-Mirage - Arduino Sketch Version
// For Arduino IDE users who prefer a single .ino file
// 
// NOTE: For full project with modular structure, use PlatformIO
// This file is a simplified version for quick testing

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ===== CONFIGURATION =====
// WiFi Settings
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Location Settings
#define LATITUDE 37.7749
#define LONGITUDE -122.4194

// Module Enable/Disable
#define ENABLE_PLANES true
#define ENABLE_WEATHER true

// API Keys
const char* WEATHER_API_KEY = "YOUR_OPENWEATHERMAP_KEY";

// Update Intervals (milliseconds)
#define PLANES_UPDATE_INTERVAL 30000   // 30 seconds
#define WEATHER_UPDATE_INTERVAL 1800000 // 30 minutes

// ===== GLOBAL VARIABLES =====
unsigned long lastPlanesUpdate = 0;
unsigned long lastWeatherUpdate = 0;

int planeCount = 0;
float nearestPlaneDistance = 9999.9;
String nearestPlaneCallsign = "";

float temperature = 0.0;
float humidity = 0.0;
String weatherDescription = "";

// ===== SETUP =====
void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("\n\n=================================");
    Serial.println("   ESP32-Mirage - Arduino Demo");
    Serial.println("=================================\n");
    
    // Connect to WiFi
    setupWiFi();
    
    // Setup NTP time
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    Serial.println("[Time] NTP configured\n");
    
    Serial.println("[System] Setup complete!\n");
}

// ===== MAIN LOOP =====
void loop() {
    // Update planes data
    if (ENABLE_PLANES && (millis() - lastPlanesUpdate >= PLANES_UPDATE_INTERVAL)) {
        updatePlanes();
        lastPlanesUpdate = millis();
    }
    
    // Update weather data
    if (ENABLE_WEATHER && (millis() - lastWeatherUpdate >= WEATHER_UPDATE_INTERVAL)) {
        updateWeather();
        lastWeatherUpdate = millis();
    }
    
    // Display information
    displayInfo();
    
    delay(5000); // Update display every 5 seconds
}

// ===== WIFI SETUP =====
void setupWiFi() {
    Serial.print("[WiFi] Connecting to ");
    Serial.println(WIFI_SSID);
    
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WiFi] Connected!");
        Serial.print("[WiFi] IP Address: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\n[WiFi] Connection failed!");
    }
}

// ===== UPDATE PLANES =====
void updatePlanes() {
    Serial.println("[Planes] Fetching nearby aircraft...");
    
    HTTPClient http;
    String url = "https://opensky-network.org/api/states/all?lamin=" + 
                 String(LATITUDE - 0.5) + "&lomin=" + String(LONGITUDE - 0.5) +
                 "&lamax=" + String(LATITUDE + 0.5) + "&lomax=" + String(LONGITUDE + 0.5);
    
    http.begin(url);
    int httpCode = http.GET();
    
    if (httpCode == 200) {
        String payload = http.getString();
        DynamicJsonDocument doc(4096);
        DeserializationError error = deserializeJson(doc, payload);
        
        if (!error) {
            JsonArray states = doc["states"];
            planeCount = states.size();
            nearestPlaneDistance = 9999.9;
            
            for (JsonVariant state : states) {
                if (!state[6].isNull() && !state[5].isNull()) {
                    float lat = state[6];
                    float lon = state[5];
                    String callsign = state[1].as<String>();
                    callsign.trim();
                    
                    // Calculate distance (simplified)
                    float distance = sqrt(pow(lat - LATITUDE, 2) + pow(lon - LONGITUDE, 2)) * 111.0;
                    
                    if (distance < nearestPlaneDistance) {
                        nearestPlaneDistance = distance;
                        nearestPlaneCallsign = callsign;
                    }
                }
            }
            
            Serial.printf("[Planes] Found %d planes\n", planeCount);
        } else {
            Serial.printf("[Planes] JSON parse error: %s\n", error.c_str());
        }
    } else {
        Serial.printf("[Planes] HTTP Error: %d\n", httpCode);
    }
    
    http.end();
}

// ===== UPDATE WEATHER =====
void updateWeather() {
    Serial.println("[Weather] Fetching weather data...");
    
    HTTPClient http;
    String url = "https://api.openweathermap.org/data/2.5/weather?lat=" + 
                 String(LATITUDE) + "&lon=" + String(LONGITUDE) + 
                 "&appid=" + String(WEATHER_API_KEY) + "&units=metric";
    
    http.begin(url);
    int httpCode = http.GET();
    
    if (httpCode == 200) {
        String payload = http.getString();
        DynamicJsonDocument doc(2048);
        DeserializationError error = deserializeJson(doc, payload);
        
        if (!error) {
            temperature = doc["main"]["temp"];
            humidity = doc["main"]["humidity"];
            weatherDescription = doc["weather"][0]["description"].as<String>();
            
            Serial.println("[Weather] Data fetched successfully");
        } else {
            Serial.printf("[Weather] JSON parse error: %s\n", error.c_str());
        }
    } else {
        Serial.printf("[Weather] HTTP Error: %d\n", httpCode);
    }
    
    http.end();
}

// ===== DISPLAY INFO =====
void displayInfo() {
    Serial.println("\n========== ESP32-Mirage Status ==========");
    
    // Display time
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
        char timeStr[64];
        strftime(timeStr, sizeof(timeStr), "%Y-%m-%d %H:%M:%S", &timeinfo);
        Serial.printf("📅 Time: %s\n", timeStr);
    }
    
    // Display planes info
    if (ENABLE_PLANES && planeCount > 0) {
        Serial.printf("✈️  Planes Nearby: %d\n", planeCount);
        Serial.printf("   Nearest: %s (%.2f km)\n", 
                     nearestPlaneCallsign.c_str(), nearestPlaneDistance);
    }
    
    // Display weather info
    if (ENABLE_WEATHER && temperature != 0.0) {
        Serial.printf("🌤️  Weather: %.1f°C, %.0f%% humidity\n", temperature, humidity);
        Serial.printf("   Conditions: %s\n", weatherDescription.c_str());
    }
    
    Serial.println("==========================================\n");
}

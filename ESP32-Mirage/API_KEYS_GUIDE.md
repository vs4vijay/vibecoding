# API Keys Setup Guide

This guide helps you obtain and configure API keys for ESP32-Mirage modules.

## Overview

| Module | API Provider | Free Tier | Registration Required |
|--------|-------------|-----------|----------------------|
| Weather | OpenWeatherMap | ✅ Yes (60 calls/min) | Yes |
| AirQuality | WAQI | ✅ Yes (1000 calls/day) | Yes |
| News | NewsAPI | ✅ Yes (100 calls/day) | Yes |
| Traffic | Google Maps | ⚠️ Limited ($200 credit) | Yes + Credit Card |
| PlanesNearby | OpenSky Network | ✅ Yes (unlimited) | No |
| Calendar | Google Calendar | ✅ Yes | Yes + OAuth |
| Astronomical | NASA API | ✅ Yes | Yes |

## Quick Setup (5 minutes)

For a quick test, get these **free, no-credit-card** APIs:

1. **OpenWeatherMap** (Weather)
2. **WAQI** (Air Quality)
3. **NewsAPI** (News)
4. **OpenSky Network** (Planes - no key needed!)

## Detailed Setup Instructions

### 1. OpenWeatherMap (Weather Module)

**Cost**: Free (60 calls/minute)

**Steps**:
1. Go to https://openweathermap.org/api
2. Click "Sign Up" (top right)
3. Fill in your details and verify email
4. Go to https://home.openweathermap.org/api_keys
5. Your default API key is shown
6. Copy the key

**Add to Config.h**:
```cpp
#define WEATHER_API_KEY "your_key_here"
```

**Rate Limits**:
- Free: 60 calls/minute, 1,000,000 calls/month
- ESP32-Mirage default: 2 calls/hour (well within limits)

**Test URL**:
```
https://api.openweathermap.org/data/2.5/weather?lat=37.7749&lon=-122.4194&appid=YOUR_KEY
```

---

### 2. WAQI (Air Quality Module)

**Cost**: Free (1000 calls/day)

**Steps**:
1. Go to https://aqicn.org/api/
2. Click "Request a Token"
3. Fill in the form (name, email, website/project description)
4. Check your email for the token
5. Copy the token

**Add to Config.h**:
```cpp
#define AQI_API_KEY "your_token_here"
```

**Rate Limits**:
- Free: 1000 requests/day
- ESP32-Mirage default: 24 calls/day (1 per hour)

**Test URL**:
```
https://api.waqi.info/feed/geo:37.7749;-122.4194/?token=YOUR_TOKEN
```

---

### 3. NewsAPI (News Module)

**Cost**: Free (100 requests/day)

**Steps**:
1. Go to https://newsapi.org/
2. Click "Get API Key"
3. Fill in your details
4. Verify your email
5. Find your API key on the dashboard
6. Copy the key

**Add to Config.h**:
```cpp
#define NEWS_API_KEY "your_key_here"
```

**Rate Limits**:
- Free Developer: 100 requests/day
- ESP32-Mirage default: 24 calls/day (1 per hour)

**Note**: Developer plan only allows requests from localhost or from your development environment. For production, you may need a paid plan.

**Test URL**:
```
https://newsapi.org/v2/top-headlines?country=us&apiKey=YOUR_KEY
```

---

### 4. OpenSky Network (Planes Module)

**Cost**: Completely Free, No Registration

**Steps**:
1. No steps needed! API is open and free

**Add to Config.h**:
```cpp
// No key needed
#define PLANES_API_KEY ""
```

**Rate Limits**:
- Anonymous: 400 credits per day (enough for continuous use)
- Registered: Unlimited (optional registration for more quota)

**Test URL**:
```
https://opensky-network.org/api/states/all?lamin=37.2&lomin=-122.9&lamax=38.2&lomax=-121.9
```

**Optional Registration** (for more credits):
1. Go to https://opensky-network.org/
2. Sign up (free)
3. Use HTTP Basic Auth in your requests

---

### 5. Google Maps (Traffic Module)

**Cost**: ⚠️ Free $200/month credit (requires credit card)

**Steps**:
1. Go to https://console.cloud.google.com/
2. Create a new project
3. Enable "Directions API"
4. Go to "Credentials"
5. Create API Key
6. Restrict the key to "Directions API"
7. Copy the key

**Add to Config.h**:
```cpp
#define TRAFFIC_API_KEY "your_key_here"
```

**Rate Limits**:
- Free: $200 credit/month
- Directions API: $5 per 1000 calls
- ESP32-Mirage default: ~145 calls/day = ~$22/month (exceeds free tier!)

**⚠️ Warning**: Monitor your usage carefully! Consider disabling this module or increasing the update interval to save costs.

**Recommended Settings**:
```cpp
#define TRAFFIC_UPDATE_INTERVAL 3600000  // 1 hour (24 calls/day = $3.50/month)
```

**Test URL**:
```
https://maps.googleapis.com/maps/api/directions/json?origin=37.7749,-122.4194&destination=37.8,-122.4&key=YOUR_KEY
```

---

### 6. Google Calendar (Calendar Module)

**Cost**: Free

**Setup Complexity**: ⚠️ Advanced (OAuth required)

**Steps**:
1. Go to https://console.cloud.google.com/
2. Create a new project
3. Enable "Google Calendar API"
4. Create OAuth 2.0 credentials
5. Download credentials JSON
6. Use a library to handle OAuth flow

**Note**: This is more complex than other APIs. Consider using:
- IFTTT to sync calendar to a simpler API
- Or using a Google Apps Script to create a simpler endpoint

**Alternative**: Implement a webhook that receives calendar updates from IFTTT or Zapier.

---

### 7. NASA API (Astronomical Events)

**Cost**: Free

**Steps**:
1. Go to https://api.nasa.gov/
2. Click "Get API Key"
3. Fill in your details
4. Your API key is shown immediately
5. Copy the key

**Add to Config.h**:
```cpp
#define ASTRONOMICAL_API_KEY "your_key_here"
```

**Rate Limits**:
- Default: 1000 requests/day
- ESP32-Mirage default: 1 call/day

**Test URL**:
```
https://api.nasa.gov/planetary/apod?api_key=YOUR_KEY
```

**Alternative Free APIs**:
- AstronomyAPI.com (free tier available)
- timeanddate.com (no API, but has data pages)

---

## Satellite Image Sources

The Satellite Image Clock module requires a satellite imagery service:

### Option 1: NASA EOSDIS (Free)
1. Go to https://urs.earthdata.nasa.gov/users/new
2. Register (free)
3. Apply for GIBS API access
4. Use WMTS endpoints

### Option 2: Himawari-8 (Free, Japan region)
- Direct URL patterns available
- No registration needed
- Real-time images of Asia/Pacific

### Option 3: NOAA GOES (Free, Americas)
- https://www.goes.noaa.gov/
- Real-time images of Americas
- No API key needed

**Example Implementation**:
```cpp
// Himawari-8 example (no key needed)
String url = "https://himawari8.nict.go.jp/img/D531106/latest.json";
```

---

## Security Best Practices

### Don't Commit API Keys!

**❌ Bad**:
```cpp
#define WEATHER_API_KEY "abc123xyz789"  // Visible in GitHub!
```

**✅ Good - Method 1: Separate File (Not Committed)**:
```cpp
// In Config.h:
#include "secrets.h"  // This file is in .gitignore

// In secrets.h (gitignored):
#define WEATHER_API_KEY "abc123xyz789"
```

**✅ Good - Method 2: Environment Variables**:
```cpp
#define WEATHER_API_KEY ""  // Set via compiler flags
```

### Protect Your Keys

1. **Never share** your API keys publicly
2. **Add `secrets.h` to `.gitignore`**
3. **Use API key restrictions** when available
4. **Monitor usage** to detect key theft
5. **Rotate keys** periodically

### Key Restrictions

For Google APIs:
- Restrict to specific APIs
- Restrict to specific domains/IPs
- Set daily limits

For other APIs:
- Use the least privileged access
- Set up usage alerts

---

## Configuration Template

Create a `secrets.h` file (add to .gitignore):

```cpp
#ifndef SECRETS_H
#define SECRETS_H

// WiFi
#define WIFI_SSID "YourWiFiName"
#define WIFI_PASSWORD "YourWiFiPassword"

// Location
#define LATITUDE 37.7749
#define LONGITUDE -122.4194

// API Keys
#define WEATHER_API_KEY "your_openweathermap_key"
#define AQI_API_KEY "your_waqi_token"
#define NEWS_API_KEY "your_newsapi_key"
#define TRAFFIC_API_KEY "your_google_maps_key"
#define SATELLITE_API_KEY "your_nasa_key"
#define CALENDAR_API_KEY "your_google_calendar_key"
#define ASTRONOMICAL_API_KEY "your_astronomy_key"

#endif
```

Then in `Config.h`:
```cpp
#include "secrets.h"
```

---

## Troubleshooting API Issues

### HTTP 401 Unauthorized
- API key is invalid or not set
- Check for typos in key
- Verify key is activated (some need 10-30 mins after creation)

### HTTP 403 Forbidden
- API key restrictions are blocking your request
- You're exceeding rate limits
- Service requires additional permissions

### HTTP 429 Too Many Requests
- You've hit the rate limit
- Increase `UPDATE_INTERVAL` in Config.h
- Wait and try again later
- Consider upgrading to paid tier

### HTTP 500 Server Error
- Problem on the API provider's side
- Try again later
- Check provider's status page

### Connection Timeouts
- Check your internet connection
- Increase timeout in HTTPClient
- API might be down temporarily

---

## Cost Estimation

With default settings:

| Module | Calls/Day | Monthly Cost |
|--------|-----------|--------------|
| Weather | 48 | Free |
| AirQuality | 24 | Free |
| News | 24 | Free |
| Traffic | 288 | ~$43/mo ⚠️ |
| Planes | 2,880 | Free |
| Calendar | 24 | Free |
| Astronomical | 1 | Free |

**Total**: ~$43/month (only if Traffic is enabled with default settings)

**Recommendation**: Disable Traffic or set to update every 1-2 hours to stay free.

---

## Alternative: Self-Hosted APIs

For more control and privacy, consider:

1. **Home Assistant** - Can aggregate many data sources
2. **Node-RED** - Create custom API endpoints
3. **InfluxDB + Grafana** - Store and visualize data
4. **MQTT Broker** - Real-time data updates

---

## Questions?

- Check the API provider's documentation
- Look at module source code for example usage
- Open an issue on GitHub
- Check existing issues for solutions

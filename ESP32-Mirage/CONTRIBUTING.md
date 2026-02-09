# Contributing to ESP32-Mirage

First off, thank you for considering contributing to ESP32-Mirage! It's people like you that make ESP32-Mirage such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by respect and professionalism. Please be kind and courteous to everyone.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title**
* **Describe the exact steps to reproduce the problem**
* **Provide specific examples**
* **Describe the behavior you observed and what you expected**
* **Include screenshots if possible**
* **Include your hardware setup** (ESP32 model, display type, etc.)
* **Include your configuration** (without API keys!)
* **Include the ESP32 debug output** from serial monitor

**Bug Report Template:**
```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Configure with '...'
2. Enable module '....'
3. Observe '....'

**Expected behavior**
What you expected to happen.

**Hardware:**
- ESP32 Model: [e.g., ESP32-DevKitC]
- Display: [e.g., ST7789 240x240]
- PlatformIO/Arduino IDE version: [e.g., PlatformIO 6.1.0]

**Serial Output:**
```
[paste serial monitor output here]
```

**Additional context**
Any other information about the problem.
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title**
* **Provide a detailed description** of the suggested enhancement
* **Provide specific examples** to demonstrate the steps or point out where the enhancement would be useful
* **Explain why this enhancement would be useful** to most ESP32-Mirage users

### Pull Requests

* Fill in the required template
* Follow the coding style used throughout the project
* Include screenshots and animated GIFs in your pull request whenever possible
* Document new code with clear comments
* End all files with a newline
* Test your changes thoroughly

## Development Process

### Setting Up Development Environment

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR-USERNAME/ESP32-Mirage.git
   cd ESP32-Mirage
   ```

2. **Install PlatformIO**
   - VS Code: Install PlatformIO IDE extension
   - CLI: `pip install platformio`

3. **Create a new branch**
   ```bash
   git checkout -b feature/my-new-feature
   ```

### Coding Standards

#### General Guidelines

* **Code Style**: Follow existing code style in the project
* **Comments**: Write clear comments for complex logic
* **Naming Conventions**:
  - Classes: `PascalCase` (e.g., `WeatherModule`)
  - Variables: `camelCase` (e.g., `updateInterval`)
  - Constants: `UPPER_SNAKE_CASE` (e.g., `API_TIMEOUT`)
  - Private members: prefix with underscore (optional)

#### Module Development Guidelines

When creating a new module:

1. **Use the ModuleInterface**
   ```cpp
   class YourModule : public ModuleInterface {
       // Implementation
   };
   ```

2. **Follow the module pattern**
   - Private: `lastUpdate`, `updateInterval`, `enabled`, data members
   - Public: interface methods + data getters

3. **Handle errors gracefully**
   - Check API responses
   - Log errors with module name prefix
   - Don't crash the entire system

4. **Be memory conscious**
   - Use appropriate JSON buffer sizes
   - Free resources when done
   - Test memory usage with `ESP.getFreeHeap()`

5. **Document your module**
   - Add comments explaining what it does
   - Document API requirements
   - Provide configuration examples

#### Example Module Structure

```cpp
#ifndef YOUR_MODULE_H
#define YOUR_MODULE_H

#include "ModuleInterface.h"
#include "Config.h"

/**
 * Brief description of what this module does
 * 
 * This module fetches X from Y API and provides Z functionality.
 * Requires API key from: https://example.com/api
 */
class YourModule : public ModuleInterface {
private:
    unsigned long lastUpdate;
    unsigned long updateInterval;
    bool enabled;
    // Your data members
    
public:
    YourModule() : 
        lastUpdate(0), 
        updateInterval(YOUR_MODULE_UPDATE_INTERVAL),
        enabled(ENABLE_YOUR_MODULE) {}
    
    /**
     * Initialize the module
     * @return true if successful, false otherwise
     */
    bool begin() override {
        // Implementation
    }
    
    /**
     * Update module data
     * Fetches new data from API/sensor
     */
    void update() override {
        // Implementation
    }
    
    // ... other interface methods ...
    
    /**
     * Get module data
     * @return The current data value
     */
    String getData() const {
        return data;
    }
};

#endif // YOUR_MODULE_H
```

### Testing

Before submitting a pull request:

1. **Test compilation**
   ```bash
   pio run
   ```

2. **Test on actual hardware** if possible
   - Upload to ESP32
   - Monitor serial output
   - Verify all features work
   - Check memory usage

3. **Test with different configurations**
   - Module enabled/disabled
   - Different update intervals
   - With/without API keys

4. **Test error scenarios**
   - No internet connection
   - Invalid API keys
   - API rate limiting

### Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line

**Examples:**
```
Add Weather module with forecast support

- Implement OpenWeatherMap API integration
- Add 3-day forecast functionality
- Include temperature, humidity, and conditions
- Add configuration for API key

Fixes #123
```

### Pull Request Process

1. **Update documentation** for any changed functionality
2. **Update the README.md** if you add a module or feature
3. **Update DEVELOPER_GUIDE.md** if you change the module structure
4. **Add your module to the modules array** in main.cpp
5. **Test thoroughly** before submitting
6. **Create pull request** with clear description:
   - What does this PR do?
   - Why is this change needed?
   - How has it been tested?
   - Screenshots (if applicable)

## What to Contribute

### High Priority

* **New modules** (see below for ideas)
* **Bug fixes**
* **Documentation improvements**
* **Hardware compatibility** (test with different ESP32 boards/displays)
* **Code optimization** (memory, performance)

### Module Ideas

We'd love to see these modules:

* **StockPrices**: Real-time stock market data
* **CryptoPrices**: Cryptocurrency prices
* **SolarMonitor**: Solar panel monitoring
* **SmartHome**: Home Assistant integration
* **SportScores**: Live sports scores
* **PublicTransit**: Real-time transit arrivals
* **EnergyPrices**: Electricity pricing
* **RadiationMonitor**: Radiation levels
* **SeismicActivity**: Earthquake monitoring
* **SpaceWeather**: Solar activity, ISS position
* **LocalEvents**: Events from Eventbrite/Meetup
* **PackageTracking**: Delivery tracking
* **GarageStatus**: Garage door sensor
* **PlantMonitor**: Soil moisture, growth tracking

### Medium Priority

* **Web interface** for configuration
* **OTA updates**
* **MQTT support**
* **Multiple display themes**
* **Touch screen support**
* **Data logging** to SD card or cloud
* **Battery monitoring**
* **Power saving modes**

### Good First Issues

Looking to make your first contribution? Look for issues labeled `good first issue`:

* Documentation improvements
* Example configurations
* Simple bug fixes
* Code cleanup
* Adding comments

## Recognition

Contributors will be:
* Listed in the README.md
* Mentioned in release notes
* Given credit in commit messages

## Questions?

* Open an issue with the `question` label
* Check existing documentation
* Look at similar modules for examples

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Thank You!

Your contributions make open source projects like ESP32-Mirage possible. We appreciate your time and effort! 🎉

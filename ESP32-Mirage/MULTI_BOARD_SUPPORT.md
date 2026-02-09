# Multi-Board Support

ESP32-Mirage now supports multiple ESP32-based boards out of the box. Each board has been pre-configured with the appropriate display and pin settings.

## Supported Boards

### 1. Generic ESP32-DevKit (`esp32dev`)
- **Board**: ESP32-DevKitC or compatible
- **Display**: External ST7735/ST7789 TFT
- **Screen**: 240x240 pixels
- **Default Pins**:
  - TFT_CS: GPIO 5
  - TFT_RST: GPIO 17
  - TFT_DC: GPIO 16
  - MOSI: GPIO 23
  - SCK: GPIO 18

**Build command**: `pio run -e esp32dev`

### 2. LilyGo T-Display (`lilygo-t-display`)
- **Board**: LilyGo TTGO T-Display ESP32
- **Display**: Built-in ST7789 TFT
- **Screen**: 240x135 pixels
- **Features**: Built-in display, USB-C, compact design
- **Default Pins**:
  - TFT_CS: GPIO 5
  - TFT_RST: GPIO 23
  - TFT_DC: GPIO 16
  - TFT_BL: GPIO 4 (backlight)

**Build command**: `pio run -e lilygo-t-display`

### 3. ESP32 Geek (`esp32-geek`)
- **Board**: Waveshare ESP32-Geek
- **Display**: Built-in ST7789 TFT
- **Screen**: 240x240 pixels
- **Chip**: ESP32-C3
- **Features**: Built-in display, WS2812 LED, USB-C
- **Default Pins**:
  - TFT_CS: GPIO 10
  - TFT_RST: GPIO 9
  - TFT_DC: GPIO 8
  - TFT_BL: GPIO 18 (backlight)

**Build command**: `pio run -e esp32-geek`

### 4. M5Stack Core/Core2 (`m5stack-core-esp32`)
- **Board**: M5Stack Basic/Core/Core2
- **Display**: Built-in ILI9342C TFT
- **Screen**: 320x240 pixels
- **Features**: Integrated display, buttons, speaker, IMU, battery
- **Library**: M5Stack library handles pin configuration

**Build command**: `pio run -e m5stack-core-esp32`

### 5. M5Stack CoreS3 (`m5stack-cores3`)
- **Board**: M5Stack CoreS3
- **Display**: Built-in ILI9342C TFT with touch
- **Screen**: 320x240 pixels
- **Chip**: ESP32-S3
- **Features**: Touch screen, improved performance, USB-C
- **Library**: M5Unified library handles pin configuration

**Build command**: `pio run -e m5stack-cores3`

### 6. M5Stack Cardputer (`m5stack-cardputer`)
- **Board**: M5Stack Cardputer
- **Display**: Built-in ST7789 TFT
- **Screen**: 240x135 pixels
- **Chip**: ESP32-S3
- **Features**: Full keyboard, compact design, USB-C
- **Library**: M5Unified library handles pin configuration

**Build command**: `pio run -e m5stack-cardputer`

### 7. M5StickC Plus (`m5stick-c-plus`)
- **Board**: M5StickC Plus
- **Display**: Built-in ST7789 TFT
- **Screen**: 240x135 pixels
- **Features**: Ultra-compact, built-in battery, IMU
- **Library**: M5StickCPlus library handles pin configuration

**Build command**: `pio run -e m5stick-c-plus`

### 8. M5StickC Plus2 (`m5stick-c-plus2`)
- **Board**: M5StickC Plus2
- **Display**: Built-in ST7789 TFT
- **Screen**: 240x135 pixels
- **Features**: Improved version of Plus, better battery, USB-C
- **Library**: M5Unified library (modern unified API for newer M5Stack devices)
- **Note**: Uses M5Unified instead of a dedicated M5StickCPlus2 library

**Build command**: `pio run -e m5stick-c-plus2`

## Building for Multiple Boards

### Build All Boards
```bash
pio run
```

### Build Specific Board
```bash
pio run -e <board-name>
```

### Upload to Specific Board
```bash
pio run -e <board-name> -t upload
```

## Board Selection in Code

The firmware automatically detects which board it's running on based on compile-time flags. The `Config.h` file contains board-specific configurations:

```cpp
#if defined(BOARD_LILYGO_T_DISPLAY)
    #define BOARD_NAME "LilyGo T-Display"
    #define USE_TFT_ESPI true
#elif defined(BOARD_M5STACK)
    #define BOARD_NAME "M5Stack"
    #define USE_M5STACK true
// ... etc
#endif
```

## Custom Pin Configuration

If you need to customize pins for a specific board:

1. Edit `platformio.ini` and modify the build flags:
```ini
[env:my-custom-board]
board = esp32dev
build_flags = 
    ${env.build_flags}
    -DBOARD_MY_CUSTOM
    -DTFT_CS=5
    -DTFT_DC=16
    -DTFT_RST=17
```

2. Add corresponding configuration in `include/Config.h`:
```cpp
#elif defined(BOARD_MY_CUSTOM)
    #define BOARD_NAME "My Custom Board"
    #define HAS_DISPLAY true
    #define USE_ADAFRUIT_GFX true
#endif
```

## CI/CD Support

The project includes GitHub Actions workflows that automatically build firmware for all supported boards:

- **pr-gate.yml**: Validates builds on pull requests
- **ci.yml**: Continuous integration on push to main/develop branches
- **release.yml**: Creates releases with firmware for all boards

Each workflow uploads firmware artifacts that can be downloaded and flashed to your device.

## Flashing Pre-built Firmware

### Download Firmware
1. Go to [GitHub Actions](https://github.com/vs4vijay/ESP32-Mirage/actions) or [Releases](https://github.com/vs4vijay/ESP32-Mirage/releases)
2. Download the `.bin` file for your board

### Flash Using esptool.py
```bash
pip install esptool
esptool.py --port /dev/ttyUSB0 write_flash 0x0 firmware.bin
```

### Flash Using ESP32 Flash Tool (Windows)
1. Download [ESP32 Flash Download Tool](https://www.espressif.com/en/support/download/other-tools)
2. Load the `.bin` file at address `0x0000`
3. Select your COM port
4. Click "Start"

## Troubleshooting

### Board Not Detected
- Ensure the correct USB driver is installed (CP210x or CH340)
- Check that the board is in bootloader mode (some boards require holding BOOT while pressing RESET)

### Display Not Working
- Verify the board definition matches your hardware
- Check that the display library is compatible
- For custom boards, verify pin configurations

### Build Errors
- Run `pio pkg update` to update libraries
- Clear build cache: `pio run -t clean`
- Check that you have the latest PlatformIO Core: `pio upgrade`

## Adding New Board Support

To add support for a new board:

1. Add a new environment in `platformio.ini`:
```ini
[env:my-new-board]
board = <platformio-board-id>
build_flags = 
    ${env.build_flags}
    -DBOARD_MY_NEW_BOARD
    -DTFT_CS=<cs-pin>
    -DTFT_DC=<dc-pin>
    -DTFT_RST=<rst-pin>
lib_deps = 
    ${env.lib_deps}
    <additional-libraries>
```

2. Add board detection in `include/Config.h`:
```cpp
#elif defined(BOARD_MY_NEW_BOARD)
    #define BOARD_NAME "My New Board"
    #define HAS_DISPLAY true
    #define USE_ADAFRUIT_GFX true  // or USE_TFT_ESPI, etc.
#endif
```

3. Update the CI/CD workflows to include the new board in the matrix

4. Test the build: `pio run -e my-new-board`

5. Submit a pull request with your changes!

## Board Comparison

| Board | Chip | Screen | Size | Battery | Keyboard | Price |
|-------|------|--------|------|---------|----------|-------|
| ESP32-DevKit | ESP32 | External | Large | No | No | $ |
| LilyGo T-Display | ESP32 | 240x135 | Medium | Optional | No | $$ |
| ESP32 Geek | ESP32-C3 | 240x240 | Small | No | No | $$ |
| M5Stack Core | ESP32 | 320x240 | Medium | Yes | No | $$$ |
| M5Stack CoreS3 | ESP32-S3 | 320x240 (touch) | Medium | Yes | No | $$$$ |
| M5Stack Cardputer | ESP32-S3 | 240x135 | Small | Yes | Yes | $$$ |
| M5StickC Plus | ESP32 | 240x135 | Tiny | Yes | No | $$ |
| M5StickC Plus2 | ESP32 | 240x135 | Tiny | Yes | No | $$ |

## Resources

- [PlatformIO Boards](https://docs.platformio.org/en/latest/boards/)
- [ESP32 Pinout Reference](https://randomnerdtutorials.com/esp32-pinout-reference-gpios/)
- [M5Stack Docs](https://docs.m5stack.com/)
- [LilyGo T-Display](https://github.com/Xinyuan-LilyGO/TTGO-T-Display)

## Support

For board-specific questions or issues, please check:
1. The board manufacturer's documentation
2. [GitHub Issues](https://github.com/vs4vijay/ESP32-Mirage/issues)
3. [PlatformIO Community](https://community.platformio.org/)

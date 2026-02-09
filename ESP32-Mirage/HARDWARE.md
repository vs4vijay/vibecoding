# Hardware Setup Guide

## Required Components

### Essential Components
1. **ESP32 Development Board** (1x)
   - ESP32-DevKitC V4 (recommended)
   - ESP32-WROOM-32 
   - Or any compatible ESP32 board with WiFi

2. **TFT Display** (1x)
   - ST7735 (128x160 or 160x128)
   - ST7789 (240x240 or 240x320) - Recommended
   - ILI9341 (240x320)
   
3. **Power Supply**
   - USB power (5V, minimum 500mA)
   - Or external 5V power supply

### Optional Components
4. **Buzzer/Piezo Speaker** (1x)
   - For sound alerts
   - 3.3V compatible passive buzzer

5. **Enclosure**
   - 3D printed case (STL files available in `/hardware` folder)
   - Or any suitable project box

6. **Miscellaneous**
   - Jumper wires
   - Breadboard (for prototyping)
   - USB cable (Micro-USB or USB-C depending on your ESP32 board)

## Pin Connections

### ESP32 to TFT Display (SPI)

| ESP32 Pin | TFT Pin | Function | Notes |
|-----------|---------|----------|-------|
| GPIO 23   | MOSI    | Data Out | SPI Master Out Slave In |
| GPIO 18   | SCK     | Clock    | SPI Clock |
| GPIO 5    | CS      | Chip Select | Can be changed in Config.h |
| GPIO 16   | DC/RS   | Data/Command | Can be changed in Config.h |
| GPIO 17   | RST     | Reset    | Can be changed in Config.h |
| 3.3V      | VCC     | Power    | **Important: Use 3.3V** |
| GND       | GND     | Ground   | Common ground |
| GPIO 19   | MISO    | Data In  | Optional, for touch screen |

**Important Notes:**
- Always use 3.3V for TFT power unless your display specifically requires 5V
- Some displays have onboard voltage regulators and can accept 5V
- Check your display's datasheet before connecting

### Optional: Buzzer Connection

| ESP32 Pin | Buzzer Pin | Notes |
|-----------|------------|-------|
| GPIO 25   | Positive (+) | Can be changed in Config.h |
| GND       | Negative (-) | Common ground |

## Wiring Diagrams

### Basic Setup (ESP32 + TFT)

```
                           ESP32-DevKitC
                      ┌─────────────────────┐
                      │                     │
                      │   ┌─────────────┐   │
                      │   │   ESP32     │   │
                      │   │   WROOM-32  │   │
                      │   └─────────────┘   │
                      │                     │
    3.3V ────────────┤ 3V3             5V  ├──────── USB 5V
    GND ─────────────┤ GND            GND  ├──────── GND
                      │                     │
    MOSI ────────────┤ GPIO23 (MOSI)       │
    SCK ─────────────┤ GPIO18 (SCK)        │
    CS ──────────────┤ GPIO5               │
    DC ──────────────┤ GPIO16              │
    RST ─────────────┤ GPIO17              │
                      │                     │
    Buzzer+ ─────────┤ GPIO25              │
                      │                     │
                      └─────────────────────┘
                      
                      ST7789 TFT Display
                      ┌─────────────────┐
                      │                 │
    VCC ─────────────┤ VCC    (3.3V)   │
    GND ─────────────┤ GND             │
    MOSI ────────────┤ SDA/MOSI        │
    SCK ─────────────┤ SCL/SCK         │
    CS ──────────────┤ CS              │
    DC ──────────────┤ DC/RS           │
    RST ─────────────┤ RST             │
                      │                 │
                      └─────────────────┘
```

### Full Setup with Buzzer

```
    ESP32               TFT Display         Buzzer
     │                      │                  │
     ├──── 3.3V ──────────→ VCC               │
     ├──── GND ────────────→ GND ─────────────→ (-)
     │                      │                  │
     ├──── GPIO23 ─────────→ MOSI              │
     ├──── GPIO18 ─────────→ SCK               │
     ├──── GPIO5 ──────────→ CS                │
     ├──── GPIO16 ─────────→ DC                │
     ├──── GPIO17 ─────────→ RST               │
     │                                          │
     └──── GPIO25 ────────────────────────────→ (+)
```

## Display Options

### Recommended: ST7789 240x240

**Pros:**
- Perfect square display
- Great resolution
- Good library support
- Easy to find

**Cons:**
- More expensive than ST7735

### Budget Option: ST7735 128x160

**Pros:**
- Very affordable
- Lower power consumption
- Good library support

**Cons:**
- Smaller resolution
- Less screen real estate

### Large Option: ILI9341 240x320

**Pros:**
- Larger display area
- High resolution
- Touch screen available

**Cons:**
- More expensive
- Higher power consumption

## Power Considerations

### Power Requirements
- **ESP32**: ~80-260mA (average ~160mA with WiFi)
- **TFT Display**: ~20-100mA (depends on brightness and content)
- **Buzzer**: ~5-30mA (when active)
- **Total**: ~200-400mA typical

### Power Options

1. **USB Power (Recommended for development)**
   - Connect via USB cable
   - Most convenient for programming and debugging
   - Provides 500mA minimum

2. **Battery Power**
   - LiPo battery (3.7V) with voltage regulator
   - 18650 battery holder with boost converter
   - For portable applications

3. **External Power Supply**
   - 5V DC adapter (minimum 1A recommended)
   - For permanent installations

## Assembly Instructions

### Breadboard Prototype

1. **Place ESP32** on breadboard
2. **Connect power rails**: 3.3V and GND
3. **Connect display** using jumper wires according to pin table
4. **Connect buzzer** to GPIO25 and GND
5. **Double-check connections** before powering on
6. **Upload code** via USB

### Permanent Installation

1. **Solder header pins** to ESP32 if not pre-soldered
2. **Solder wires** to TFT display pins
3. **Use heat shrink tubing** on exposed connections
4. **Mount in enclosure** with standoffs or hot glue
5. **Create cable management** to prevent shorts
6. **Test thoroughly** before closing enclosure

## Troubleshooting Hardware

### Display Not Working

**Check:**
- ✓ Power connections (3.3V to VCC, GND to GND)
- ✓ SPI connections (MOSI, SCK, CS, DC, RST)
- ✓ Display type in code matches actual display
- ✓ Display orientation setting
- ✓ Brightness (some displays are very dim by default)

**Test:**
- Upload a simple display test sketch
- Check with multimeter for 3.3V at display VCC
- Try different display libraries

### ESP32 Not Connecting

**Check:**
- ✓ USB cable supports data (not just charging)
- ✓ Correct COM port selected
- ✓ Press and hold BOOT button during upload
- ✓ Drivers installed for CH340 or CP2102 chip

### Buzzer Not Working

**Check:**
- ✓ Buzzer polarity (+ to GPIO25, - to GND)
- ✓ Sound alerts enabled in Config.h
- ✓ Buzzer is "active" type (passive buzzers need PWM)
- ✓ Volume (some buzzers are quiet)

### Random Resets

**Possible causes:**
- Insufficient power supply
- Poor connections
- WiFi interference
- Display drawing too much current

**Solutions:**
- Use better power supply (1A+)
- Add capacitor across power rails (100µF)
- Shorten wire lengths
- Check for shorts

## Safety Considerations

⚠️ **Important Safety Notes:**

1. **Never exceed voltage ratings**
   - ESP32: 3.3V logic, 5V power input
   - TFT: Check datasheet (usually 3.3V)

2. **Prevent shorts**
   - Insulate all connections
   - Use heat shrink or electrical tape
   - Mount securely in enclosure

3. **Heat management**
   - ESP32 can get warm during WiFi use
   - Ensure adequate ventilation
   - Don't cover in enclosed spaces

4. **ESD protection**
   - Handle boards by edges
   - Use ESD-safe workspace when possible
   - Ground yourself before handling

## 3D Printing Files

Check the `/hardware` folder for:
- Enclosure STL files
- Mounting brackets
- Display bezels
- Stand designs

## Bill of Materials (BOM)

| Item | Quantity | Est. Price (USD) | Notes |
|------|----------|------------------|-------|
| ESP32-DevKitC | 1 | $6-10 | Core controller |
| ST7789 240x240 Display | 1 | $8-15 | Main display |
| Passive Buzzer | 1 | $1-2 | Optional |
| Jumper Wires | 10 | $2-5 | Pack of 40+ |
| USB Cable | 1 | $3-5 | Micro-USB or USB-C |
| **Total** | - | **$20-37** | Without enclosure |

Prices are approximate and vary by supplier and location.

## Recommended Suppliers

- **AliExpress**: Cheapest, longer shipping
- **Amazon**: Fast shipping, higher prices
- **Adafruit**: Quality components, educational resources
- **SparkFun**: Quality components, good support
- **Banggood**: Good balance of price and shipping

## Next Steps

After assembly:
1. Follow the [Getting Started Guide](GETTING_STARTED.md)
2. Upload and test the code
3. Configure your modules
4. Enjoy your ESP32-Mirage!

## Need Help?

- Post photos in GitHub Issues
- Join discussions
- Check existing issues for similar problems

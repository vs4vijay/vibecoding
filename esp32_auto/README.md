# ESP32 Wireless Android Auto Dongle

An ESP32-based implementation of a Wireless Android Auto dongle that bridges USB connection from a car headunit with WiFi/Bluetooth connection to an Android phone.

## Overview

This project implements a minimal version of the Wireless Android Auto dongle functionality using ESP32-S3. It provides:

- WiFi hotspot for phone connection
- Bluetooth advertising and pairing
- USB OTG device mode (Android Accessory protocol)
- Data proxy between USB and WiFi networks

## Hardware Requirements

- **ESP32-S3** development board with USB OTG support
- USB data cable for connecting to car headunit
- Power source (can be powered from car's USB port)

## Features

### Phase 1 & 2 (Completed Implementation)
- ✅ Complete ESP-IDF project structure
- ✅ WiFi hotspot setup (SSID: ESP32-AA-Dongle, Password: ConnectAAWirelessDongle)
- ✅ BLE advertising and device discovery
- ✅ USB OTG device mode framework for ESP32-S3
- ✅ Android Open Accessory (AOA) protocol implementation
- ✅ WiFi-to-USB data proxy with TCP server on port 5277
- ✅ Protocol Buffers for structured communication
- ✅ Connection strategy management (Phone First, USB First, Dongle Mode)

### Phase 3 (In Progress)
- 🔄 ESP32-S3 USB register-level programming
- 🔄 AOA protocol negotiation with Android devices
- 🔄 Real-time data forwarding optimization
- 🔄 Performance tuning for Android Auto bandwidth

### Phase 4 (Future)
- 📋 Full Android Auto compatibility testing
- 📋 Audio/video stream optimization
- 📋 Advanced error handling and recovery
- 📋 Configuration management via web interface
- 📋 Multiple device support

## Building and Flashing

### Prerequisites
- ESP-IDF v5.0 or later
- ESP32-S3 development board
- USB-C cable for programming

### Build Instructions

1. Clone this repository:
```bash
git clone <repository-url>
cd esp32_wireless_dongle
```

2. Set up ESP-IDF environment:
```bash
source /path/to/esp-idf/export.sh
```

3. Configure the project (optional):
```bash
idf.py menuconfig
```

4. Build and flash:
```bash
idf.py build flash monitor
```

## Usage

1. **Power on** the ESP32-S3 device
2. **Connect** to WiFi hotspot "ESP32-AA-Dongle" with password "ConnectAAWirelessDongle"
3. **Pair** with Bluetooth device "ESP32-AA-Dongle"
4. **Connect** ESP32 to car headunit via USB
5. **Android Auto** should start wirelessly

## Configuration

The device can be configured via compile-time settings in `sdkconfig.defaults`:

- **WiFi SSID/Password**: Network hotspot configuration
- **Bluetooth**: BLE advertising settings
- **Connection Strategy**: How to initiate connections
- **Performance**: Memory and processing parameters

## Development Status

This is an **early-stage proof of concept** implementation. The current version provides:

- ✅ Working WiFi hotspot
- ✅ Bluetooth advertising
- ⚠️ USB OTG (framework only)
- ⚠️ AOA protocol (simulated)
- ⚠️ Data proxy (framework only)

### Known Limitations

1. **USB OTG**: ESP32-S3 USB device mode requires direct register programming (framework implemented)
2. **Memory Constraints**: 512KB SRAM may be insufficient for high-bandwidth operations
3. **Performance**: USB Full-Speed (12 Mbps) vs Raspberry Pi High-Speed (480 Mbps)
4. **AOA Protocol**: Framework implemented, needs device-specific testing
5. **Real-time Constraints**: ESP32 FreeRTOS may introduce latency for video streams

## Technical Architecture

```
┌─────────────────────────────────────┐
│           Main Application          │
├─────────────────────────────────────┤
│ WiFi │ Bluetooth │ USB │ AOA │ Proxy │
├─────────────────────────────────────┤
│          FreeRTOS Kernel           │
├─────────────────────────────────────┤
│         ESP32-S3 Hardware          │
└─────────────────────────────────────┘
```

### Key Components

- **main.cpp**: Application entry point and connection management
- **wifi_hotspot.cpp**: WiFi AP configuration and management
- **bluetooth_manager.cpp**: BLE advertising and device discovery
- **aoa_protocol.cpp**: Android Open Accessory protocol implementation
- **usb_gadget.cpp**: USB OTG device mode management
- **proxy_handler.cpp**: Data forwarding between interfaces

## Contributing

This project is experimental and designed for learning ESP32 development and understanding Android Auto protocols. Contributions welcome for:

- USB OTG implementation
- AOA protocol completion
- Performance optimization
- Testing and debugging

## License

This project follows the same license as the original Wireless Android Auto Dongle project.

## Disclaimer

This is an experimental implementation. It may not work with all Android phones or car headunits. Use at your own risk.
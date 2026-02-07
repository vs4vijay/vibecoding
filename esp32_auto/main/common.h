#pragma once

#include <stdint.h>
#include <stdbool.h>

// Android Open Accessory Protocol constants
#define AOA_VID                    0x18D1
#define AOA_PID_ACCESSORY          0x2D00
#define AOA_PID_ACCESSORY_ADB      0x2D01

// AOA Control Commands
#define AOA_CMD_GET_PROTOCOL        51
#define AOA_CMD_SEND_STRING         52
#define AOA_CMD_START_ACCESSORY     53
#define AOA_CMD_REGISTER_HID        54
#define AOA_CMD_UNREGISTER_HID      55
#define AOA_CMD_SET_HID_REPORT_DESC 56
#define AOA_CMD_SEND_HID_EVENT      57
#define AOA_CMD_AUDIO_SUPPORT       58

// AOA String IDs
#define AOA_STRING_MANUFACTURER     0
#define AOA_STRING_MODEL            1
#define AOA_STRING_DESCRIPTION      2
#define AOA_STRING_VERSION          3
#define AOA_STRING_URI              4
#define AOA_STRING_SERIAL           5

// USB Configuration
#define USB_CONFIG_POWER_MA         500
#define USB_EP_SIZE                 64

// Connection Strategy
typedef enum {
    CONNECTION_STRATEGY_DONGLE_MODE = 0,
    CONNECTION_STRATEGY_PHONE_FIRST = 1,
    CONNECTION_STRATEGY_USB_FIRST = 2
} connection_strategy_t;

// Device Information
typedef struct {
    char manufacturer[256];
    char model[256];
    char description[256];
    char version[256];
    char uri[256];
    char serial[256];
} device_info_t;

// Status codes
typedef enum {
    STATUS_OK = 0,
    STATUS_ERROR_INIT = -1,
    STATUS_ERROR_CONNECTION = -2,
    STATUS_ERROR_PROTOCOL = -3,
    STATUS_ERROR_MEMORY = -4
} status_t;
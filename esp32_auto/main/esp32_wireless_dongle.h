#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// USB Device configuration
#define USB_VID_GOOGLE           0x18D1
#define USB_PID_ANDROID_ACCESSORY 0x2D00
#define USB_PID_ANDROID_ACCESSORY_ADB 0x2D01

// Android Open Accessory Protocol commands
#define AOA_CMD_START_ACCESSORY         51
#define AOA_CMD_SEND_STRING             52
#define AOA_CMD_GET_PROTOCOL             53
#define AOA_CMD_REGISTER_HID            54
#define AOA_CMD_UNREGISTER_HID          55
#define AOA_CMD_SET_HID_REPORT_DESC      56
#define AOA_CMD_SEND_HID_EVENT          57
#define AOA_CMD_AUDIO_SUPPORT           58

// AOA String indices
#define AOA_STRING_MANUFACTURER         0
#define AOA_STRING_MODEL                1
#define AOA_STRING_DESCRIPTION          2
#define AOA_STRING_VERSION              3
#define AOA_STRING_URI                   4
#define AOA_STRING_SERIAL               5

// USB Configuration
#define USB_MAX_POWER_MA                500
#define USB_BULK_EP_SIZE                 64

typedef struct {
    uint16_t vid;
    uint16_t pid;
    bool is_accessory_mode;
} usb_device_info_t;

typedef struct {
    uint8_t manufacturer[256];
    uint8_t model[256];
    uint8_t description[256];
    uint8_t version[256];
    uint8_t uri[256];
    uint8_t serial[256];
} aoa_device_info_t;

// USB Gadget Functions
esp_err_t usb_gadget_init(void);
esp_err_t usb_gadget_deinit(void);
esp_err_t usb_set_device_descriptor(uint16_t vid, uint16_t pid);
esp_err_t usb_get_connected_device_info(usb_device_info_t *info);

// AOA Protocol Functions
esp_err_t aoa_init(void);
esp_err_t aoa_start_accessory_mode(void);
esp_err_t aoa_set_device_info(const aoa_device_info_t *device_info);
bool aoa_is_accessory_mode(void);

// USB Data Transfer Functions
esp_err_t usb_bulk_transfer_in(uint8_t *data, size_t length, size_t *transferred);
esp_err_t usb_bulk_transfer_out(uint8_t *data, size_t length, size_t *transferred);

#ifdef __cplusplus
}
#endif
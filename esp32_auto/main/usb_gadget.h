#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

// USB Device configuration
#define USB_VID_GOOGLE           0x18D1
#define USB_PID_ANDROID_ACCESSORY 0x2D00
#define USB_PID_ANDROID_ACCESSORY_ADB 0x2D01

// USB Configuration
#define USB_MAX_POWER_MA                500
#define USB_BULK_EP_SIZE                 64
#define USB_CONTROL_EP_SIZE              64

// USB Endpoint Addresses
#define USB_EP0_ADDR                     0x00
#define USB_EP1_IN_ADDR                 0x81
#define USB_EP1_OUT_ADDR                0x01

// USB Request Types
#define USB_REQ_TYPE_STANDARD          (0x00 << 5)
#define USB_REQ_TYPE_CLASS             (0x01 << 5)
#define USB_REQ_TYPE_VENDOR            (0x02 << 5)
#define USB_REQ_TYPE_RECIPIENT_DEVICE   0x00
#define USB_REQ_TYPE_RECIPIENT_INTERFACE 0x01
#define USB_REQ_TYPE_RECIPIENT_ENDPOINT  0x02

// USB Standard Requests
#define USB_REQ_GET_STATUS              0x00
#define USB_REQ_CLEAR_FEATURE           0x01
#define USB_REQ_SET_FEATURE            0x03
#define USB_REQ_SET_ADDRESS           0x05
#define USB_REQ_GET_DESCRIPTOR        0x06
#define USB_REQ_SET_DESCRIPTOR        0x07
#define USB_REQ_GET_CONFIGURATION     0x08
#define USB_REQ_SET_CONFIGURATION     0x09
#define USB_REQ_GET_INTERFACE         0x0A
#define USB_REQ_SET_INTERFACE         0x0B
#define USB_REQ_SYNCH_FRAME          0x0C

// USB Descriptor Types
#define USB_DESC_TYPE_DEVICE           0x01
#define USB_DESC_TYPE_CONFIGURATION    0x02
#define USB_DESC_TYPE_STRING           0x03
#define USB_DESC_TYPE_INTERFACE        0x04
#define USB_DESC_TYPE_ENDPOINT         0x05

typedef struct {
    uint16_t vid;
    uint16_t pid;
    bool is_accessory_mode;
    bool is_connected;
    uint8_t device_address;
} usb_device_info_t;

typedef struct {
    uint8_t bLength;
    uint8_t bDescriptorType;
    uint16_t bcdUSB;
    uint8_t bDeviceClass;
    uint8_t bDeviceSubClass;
    uint8_t bDeviceProtocol;
    uint8_t bMaxPacketSize0;
    uint16_t idVendor;
    uint16_t idProduct;
    uint16_t bcdDevice;
    uint8_t iManufacturer;
    uint8_t iProduct;
    uint8_t iSerialNumber;
    uint8_t bNumConfigurations;
} __attribute__((packed)) usb_device_descriptor_t;

typedef struct {
    uint8_t bLength;
    uint8_t bDescriptorType;
    uint16_t wTotalLength;
    uint8_t bNumInterfaces;
    uint8_t bConfigurationValue;
    uint8_t iConfiguration;
    uint8_t bmAttributes;
    uint8_t bMaxPower;
} __attribute__((packed)) usb_config_descriptor_t;

typedef struct {
    uint8_t bLength;
    uint8_t bDescriptorType;
    uint8_t bInterfaceNumber;
    uint8_t bAlternateSetting;
    uint8_t bNumEndpoints;
    uint8_t bInterfaceClass;
    uint8_t bInterfaceSubClass;
    uint8_t bInterfaceProtocol;
    uint8_t iInterface;
} __attribute__((packed)) usb_interface_descriptor_t;

typedef struct {
    uint8_t bLength;
    uint8_t bDescriptorType;
    uint8_t bEndpointAddress;
    uint8_t bmAttributes;
    uint16_t wMaxPacketSize;
    uint8_t bInterval;
} __attribute__((packed)) usb_endpoint_descriptor_t;

// USB Gadget Functions
esp_err_t usb_gadget_init(void);
esp_err_t usb_gadget_deinit(void);
esp_err_t usb_set_device_descriptor(uint16_t vid, uint16_t pid);
esp_err_t usb_get_connected_device_info(usb_device_info_t *info);
esp_err_t usb_bulk_transfer(uint8_t endpoint, uint8_t *data, size_t length, size_t *transferred);
esp_err_t usb_control_transfer(uint8_t bmRequestType, uint8_t bRequest, uint16_t wValue, 
                            uint16_t wIndex, uint8_t *data, size_t length, size_t *transferred);

// ESP32-S3 USB OTG Low-level Functions
esp_err_t usb_otg_init_peripheral(void);
esp_err_t usb_otg_set_address(uint8_t address);
esp_err_t usb_otg_configure_endpoints(void);
esp_err_t usb_otg_ep_write(uint8_t ep_num, uint8_t *data, size_t length);
esp_err_t usb_otg_ep_read(uint8_t ep_num, uint8_t *data, size_t length, size_t *received);
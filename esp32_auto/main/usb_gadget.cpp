#include "esp_log.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "soc/usb_periph.h"
#include "hal/usb_hal.h"
#include "hal/gpio_hal.h"
#include "usb_gadget.h"
#include "esp32_usb_otg.h"
#include "common.h"

static const char *TAG = "USB_GADGET";

// USB Hardware Context
static usb_hal_context_t g_usb_hal = {0};
static bool g_usb_initialized = false;
static bool g_device_configured = false;
static bool g_endpoint_configured = false;

// Device state
static usb_device_info_t g_device_info = {
    .vid = USB_VID_GOOGLE,
    .pid = USB_PID_ANDROID_ACCESSORY,
    .is_accessory_mode = false,
    .is_connected = false,
    .device_address = 0
};

// USB Device Descriptor
static const usb_device_descriptor_t g_device_desc = {
    .bLength = sizeof(usb_device_descriptor_t),
    .bDescriptorType = USB_DESC_TYPE_DEVICE,
    .bcdUSB = 0x0200,                    // USB 2.0
    .bDeviceClass = 0x00,                 // Use class from interface
    .bDeviceSubClass = 0x00,
    .bDeviceProtocol = 0x00,
    .bMaxPacketSize0 = USB_CONTROL_EP_SIZE,
    .idVendor = USB_VID_GOOGLE,
    .idProduct = USB_PID_ANDROID_ACCESSORY,
    .bcdDevice = 0x0100,                  // Version 1.0
    .iManufacturer = 1,
    .iProduct = 2,
    .iSerialNumber = 3,
    .bNumConfigurations = 1
};

// USB Configuration Descriptor
static const usb_config_descriptor_t g_config_desc = {
    .bLength = sizeof(usb_config_descriptor_t),
    .bDescriptorType = USB_DESC_TYPE_CONFIGURATION,
    .wTotalLength = sizeof(usb_config_descriptor_t) + 2 * sizeof(usb_interface_descriptor_t) + 2 * sizeof(usb_endpoint_descriptor_t),
    .bNumInterfaces = 2,
    .bConfigurationValue = 1,
    .iConfiguration = 0,
    .bmAttributes = 0x80,                 // Bus-powered
    .bMaxPower = (USB_MAX_POWER_MA >> 1)  // 2mA units
};

// USB Interface Descriptors
static const usb_interface_descriptor_t g_interface0_desc = {
    .bLength = sizeof(usb_interface_descriptor_t),
    .bDescriptorType = USB_DESC_TYPE_INTERFACE,
    .bInterfaceNumber = 0,
    .bAlternateSetting = 0,
    .bNumEndpoints = 2,
    .bInterfaceClass = 0xFF,              // Vendor-specific
    .bInterfaceSubClass = 0xFF,
    .bInterfaceProtocol = 0x00,
    .iInterface = 0
};

static const usb_interface_descriptor_t g_interface1_desc = {
    .bLength = sizeof(usb_interface_descriptor_t),
    .bDescriptorType = USB_DESC_TYPE_INTERFACE,
    .bInterfaceNumber = 1,
    .bAlternateSetting = 0,
    .bNumEndpoints = 2,
    .bInterfaceClass = 0xFF,              // Vendor-specific (Android Accessory)
    .bInterfaceSubClass = 0xFF,
    .bInterfaceProtocol = 0x00,
    .iInterface = 0
};

// USB Endpoint Descriptors
static const usb_endpoint_descriptor_t g_ep1_in_desc = {
    .bLength = sizeof(usb_endpoint_descriptor_t),
    .bDescriptorType = USB_DESC_TYPE_ENDPOINT,
    .bEndpointAddress = USB_EP1_IN_ADDR,
    .bmAttributes = 0x02,                 // Bulk
    .wMaxPacketSize = USB_BULK_EP_SIZE,
    .bInterval = 0
};

static const usb_endpoint_descriptor_t g_ep1_out_desc = {
    .bLength = sizeof(usb_endpoint_descriptor_t),
    .bDescriptorType = USB_DESC_TYPE_ENDPOINT,
    .bEndpointAddress = USB_EP1_OUT_ADDR,
    .bmAttributes = 0x02,                 // Bulk
    .wMaxPacketSize = USB_BULK_EP_SIZE,
    .bInterval = 0
};

static const usb_endpoint_descriptor_t g_ep2_in_desc = {
    .bLength = sizeof(usb_endpoint_descriptor_t),
    .bDescriptorType = USB_DESC_TYPE_ENDPOINT,
    .bEndpointAddress = 0x82,
    .bmAttributes = 0x02,                 // Bulk
    .wMaxPacketSize = USB_BULK_EP_SIZE,
    .bInterval = 0
};

static const usb_endpoint_descriptor_t g_ep2_out_desc = {
    .bLength = sizeof(usb_endpoint_descriptor_t),
    .bDescriptorType = USB_DESC_TYPE_ENDPOINT,
    .bEndpointAddress = 0x02,
    .bmAttributes = 0x02,                 // Bulk
    .wMaxPacketSize = USB_BULK_EP_SIZE,
    .bInterval = 0
};

// String descriptors
static const char *g_string_manufacturer = "DIY Wireless Dongle";
static const char *g_string_product = "ESP32 AA Dongle";
static const char *g_string_serial = "ESP32AA001";

esp_err_t usb_otg_init_peripheral(void) {
    ESP_LOGI(TAG, "Initializing ESP32-S3 USB OTG peripheral mode");
    
    // Initialize the ESP32-S3 USB OTG hardware
    esp_err_t ret = esp32_usb_otg_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize ESP32 USB OTG: %s", esp_err_to_name(ret));
        return ret;
    }
    
    // Configure for device mode
    ret = esp32_usb_otg_set_device_mode();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to set device mode: %s", esp_err_to_name(ret));
        return ret;
    }
    
    // Configure control endpoint (EP0)
    ret = esp32_usb_otg_configure_endpoint(0, true, 64, DEPCTL_EPTYPE_CTRL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure EP0: %s", esp_err_to_name(ret));
        return ret;
    }
    
    ret = esp32_usb_otg_configure_endpoint(0, false, 64, DEPCTL_EPTYPE_CTRL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure EP0: %s", esp_err_to_name(ret));
        return ret;
    }
    
    // Enable control endpoint
    ret = esp32_usb_otg_enable_endpoint(0, true);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to enable EP0 IN: %s", esp_err_to_name(ret));
        return ret;
    }
    
    ret = esp32_usb_otg_enable_endpoint(0, false);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to enable EP0 OUT: %s", esp_err_to_name(ret));
        return ret;
    }
    
    ESP_LOGI(TAG, "USB OTG peripheral initialized successfully");
    return ESP_OK;
}

esp_err_t usb_otg_set_address(uint8_t address) {
    ESP_LOGI(TAG, "Setting USB address: %d", address);
    
    esp_err_t ret = esp32_usb_otg_set_address(address);
    if (ret == ESP_OK) {
        g_device_info.device_address = address;
    }
    
    return ret;
}

esp_err_t usb_otg_configure_endpoints(void) {
    ESP_LOGI(TAG, "Configuring USB endpoints");
    
    // Configure data endpoints (EP1 IN/OUT) for bulk transfers
    esp_err_t ret;
    
    // EP1 IN (for data to host)
    ret = esp32_usb_otg_configure_endpoint(1, true, 64, DEPCTL_EPTYPE_BULK);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure EP1 IN: %s", esp_err_to_name(ret));
        return ret;
    }
    
    // EP1 OUT (for data from host)
    ret = esp32_usb_otg_configure_endpoint(1, false, 64, DEPCTL_EPTYPE_BULK);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure EP1 OUT: %s", esp_err_to_name(ret));
        return ret;
    }
    
    // Enable endpoints
    ret = esp32_usb_otg_enable_endpoint(1, true);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to enable EP1 IN: %s", esp_err_to_name(ret));
        return ret;
    }
    
    ret = esp32_usb_otg_enable_endpoint(1, false);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to enable EP1 OUT: %s", esp_err_to_name(ret));
        return ret;
    }
    
    g_endpoint_configured = true;
    ESP_LOGI(TAG, "USB endpoints configured successfully");
    return ESP_OK;
}

esp_err_t usb_otg_ep_write(uint8_t ep_num, uint8_t *data, size_t length) {
    if (data == NULL || length == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    
    ESP_LOGD(TAG, "Writing %d bytes to EP %d", length, ep_num);
    
    uint16_t transferred = 0;
    esp_err_t ret = esp32_usb_otg_write_endpoint(ep_num, data, length, &transferred);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to write to EP %d: %s", ep_num, esp_err_to_name(ret));
        return ret;
    }
    
    if (transferred != length) {
        ESP_LOGW(TAG, "Partial write to EP %d: %d/%d bytes", ep_num, transferred, length);
    }
    
    return ESP_OK;
}

esp_err_t usb_otg_ep_read(uint8_t ep_num, uint8_t *data, size_t length, size_t *received) {
    if (data == NULL || received == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    
    ESP_LOGD(TAG, "Reading from EP %d", ep_num);
    
    uint16_t bytes_read = 0;
    esp_err_t ret = esp32_usb_otg_read_endpoint(ep_num, data, length, &bytes_read);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read from EP %d: %s", ep_num, esp_err_to_name(ret));
        return ret;
    }
    
    *received = bytes_read;
    ESP_LOGD(TAG, "Read %d bytes from EP %d", bytes_read, ep_num);
    
    return ESP_OK;
}

esp_err_t usb_gadget_init(void) {
    ESP_LOGI(TAG, "Initializing USB Gadget");
    
    if (g_usb_initialized) {
        ESP_LOGW(TAG, "USB already initialized");
        return ESP_OK;
    }
    
    esp_err_t ret = usb_otg_init_peripheral();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize USB OTG peripheral");
        return ret;
    }
    
    g_usb_initialized = true;
    g_device_configured = false;
    g_endpoint_configured = false;
    g_device_info.is_connected = false;
    
    ESP_LOGI(TAG, "USB Gadget initialized successfully");
    return ESP_OK;
}

esp_err_t usb_gadget_deinit(void) {
    ESP_LOGI(TAG, "Deinitializing USB Gadget");
    
    if (!g_usb_initialized) {
        return ESP_OK;
    }
    
    // Disable USB peripheral
    usb_hal_deinit(&g_usb_hal);
    periph_module_disable(PERIPH_USB_MODULE);
    
    g_usb_initialized = false;
    g_device_configured = false;
    g_endpoint_configured = false;
    g_device_info.is_connected = false;
    
    ESP_LOGI(TAG, "USB Gadget deinitialized");
    return ESP_OK;
}

esp_err_t usb_set_device_descriptor(uint16_t vid, uint16_t pid) {
    ESP_LOGI(TAG, "Setting USB device descriptor: VID=0x%04X, PID=0x%04X", vid, pid);
    
    // Update device info
    g_device_info.vid = vid;
    g_device_info.pid = pid;
    g_device_info.is_accessory_mode = (pid == USB_PID_ANDROID_ACCESSORY || pid == USB_PID_ANDROID_ACCESSORY_ADB);
    
    // TODO: Update hardware descriptors
    // This requires reprogramming descriptor memory
    
    return ESP_OK;
}

esp_err_t usb_get_connected_device_info(usb_device_info_t *info) {
    if (info == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    
    // For device mode, we're the accessory, so we return our own info
    memcpy(info, &g_device_info, sizeof(usb_device_info_t));
    
    return ESP_OK;
}

esp_err_t usb_bulk_transfer(uint8_t endpoint, uint8_t *data, size_t length, size_t *transferred) {
    if (data == NULL || transferred == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    
    if (!g_usb_initialized || !g_endpoint_configured) {
        return ESP_ERR_INVALID_STATE;
    }
    
    uint8_t ep_num = endpoint & 0x7F;
    
    if (endpoint & 0x80) {  // IN endpoint
        return usb_otg_ep_write(ep_num, data, length);
    } else {  // OUT endpoint
        return usb_otg_ep_read(ep_num, data, length, transferred);
    }
}

esp_err_t usb_control_transfer(uint8_t bmRequestType, uint8_t bRequest, uint16_t wValue, 
                            uint16_t wIndex, uint8_t *data, size_t length, size_t *transferred) {
    ESP_LOGD(TAG, "Control transfer: Type=0x%02X, Req=0x%02X, Val=0x%04X, Idx=0x%04X, Len=%d", 
             bmRequestType, bRequest, wValue, wIndex, length);
    
    if (transferred != NULL) {
        *transferred = 0;
    }
    
    // Handle standard requests
    if ((bmRequestType & 0x60) == USB_REQ_TYPE_STANDARD) {
        switch (bRequest) {
            case USB_REQ_GET_DESCRIPTOR:
                ESP_LOGI(TAG, "GET_DESCRIPTOR request");
                // TODO: Handle descriptor requests
                break;
                
            case USB_REQ_SET_ADDRESS:
                ESP_LOGI(TAG, "SET_ADDRESS request: %d", wValue);
                return usb_otg_set_address((uint8_t)wValue);
                
            case USB_REQ_SET_CONFIGURATION:
                ESP_LOGI(TAG, "SET_CONFIGURATION request: %d", wValue);
                g_device_configured = (wValue > 0);
                if (g_device_configured) {
                    return usb_otg_configure_endpoints();
                }
                break;
                
            default:
                ESP_LOGW(TAG, "Unhandled standard request: 0x%02X", bRequest);
                break;
        }
    }
    
    // Handle vendor-specific requests (AOA protocol)
    if ((bmRequestType & 0x60) == USB_REQ_TYPE_VENDOR) {
        ESP_LOGI(TAG, "Vendor-specific request: 0x%02X", bRequest);
        // TODO: Handle AOA protocol requests
    }
    
    return ESP_OK;
}
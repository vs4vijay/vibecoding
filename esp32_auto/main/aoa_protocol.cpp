#include "esp_log.h"
#include "string.h"
#include "common.h"
#include "usb_gadget.h"

static const char *TAG = "AOA_PROTOCOL";

// AOA Protocol State
typedef enum {
    AOA_STATE_DISCONNECTED = 0,
    AOA_STATE_CONNECTED,
    AOA_STATE_DETECTING,
    AOA_STATE_NEGOTIATING,
    AOA_STATE_SENDING_STRINGS,
    AOA_STATE_STARTING_ACCESSORY,
    AOA_STATE_ACCESSORY_MODE
} aoa_state_t;

static aoa_state_t g_aoa_state = AOA_STATE_DISCONNECTED;
static bool g_is_accessory_mode = false;
static device_info_t g_current_device_info = {0};
static uint16_t g_aoa_protocol_version = 0;

// Default device information
static const device_info_t g_default_device_info = {
    .manufacturer = "DIY Wireless Dongle",
    .model = "ESP32-AA-Dongle",
    .description = "ESP32 Wireless Android Auto Dongle",
    .version = "1.0",
    .uri = "https://github.com/user/esp32-wireless-dongle",
    .serial = "ESP32AA001"
};

// AOA Control Request Functions
static status_t aoa_handle_get_protocol(uint16_t *protocol_version);
static status_t aoa_handle_send_string(uint8_t string_index, const char *string);
static status_t aoa_handle_start_accessory(void);
static status_t aoa_send_string(uint8_t string_index, const char *string);

status_t aoa_init(void) {
    ESP_LOGI(TAG, "Initializing Android Open Accessory Protocol");
    
    g_aoa_state = AOA_STATE_DISCONNECTED;
    g_is_accessory_mode = false;
    g_aoa_protocol_version = 0;
    
    // Set default device information
    memcpy(&g_current_device_info, &g_default_device_info, sizeof(device_info_t));
    
    ESP_LOGI(TAG, "AOA protocol initialized");
    return STATUS_OK;
}

static status_t aoa_handle_get_protocol(uint16_t *protocol_version) {
    ESP_LOGI(TAG, "AOA_GET_PROTOCOL request");
    
    if (g_aoa_state == AOA_STATE_CONNECTED) {
        g_aoa_state = AOA_STATE_NEGOTIATING;
    }
    
    // We support AOA protocol version 2
    *protocol_version = 2;
    g_aoa_protocol_version = 2;
    
    ESP_LOGI(TAG, "AOA protocol version %d negotiated", *protocol_version);
    return STATUS_OK;
}

static status_t aoa_handle_send_string(uint8_t string_index, const char *string) {
    ESP_LOGI(TAG, "AOA_SEND_STRING request: index=%d, string='%s'", string_index, string ? string : "");
    
    if (g_aoa_state != AOA_STATE_NEGOTIATING && g_aoa_state != AOA_STATE_SENDING_STRINGS) {
        if (g_aoa_state == AOA_STATE_CONNECTED) {
            g_aoa_state = AOA_STATE_NEGOTIATING;
        }
    }
    
    if (g_aoa_state == AOA_STATE_NEGOTIATING) {
        g_aoa_state = AOA_STATE_SENDING_STRINGS;
    }
    
    const char *supported_strings[] = {
        g_current_device_info.manufacturer,
        g_current_device_info.model,
        g_current_device_info.description,
        g_current_device_info.version,
        g_current_device_info.uri,
        g_current_device_info.serial
    };
    
    if (string_index < 6 && string != NULL) {
        // Update our device info with received string (if valid)
        if (string_index < 6) {
            // For now, we just log it, but we could update the device info
            ESP_LOGI(TAG, "String %d updated: %s", string_index, string);
        }
    }
    
    return STATUS_OK;
}

static status_t aoa_handle_start_accessory(void) {
    ESP_LOGI(TAG, "AOA_START_ACCESSORY request");
    
    if (g_aoa_state == AOA_STATE_SENDING_STRINGS) {
        g_aoa_state = AOA_STATE_STARTING_ACCESSORY;
        
        // Switch to accessory mode
        status_t ret = aoa_start_accessory_mode();
        if (ret != STATUS_OK) {
            ESP_LOGE(TAG, "Failed to start accessory mode");
            return ret;
        }
        
        g_aoa_state = AOA_STATE_ACCESSORY_MODE;
        ESP_LOGI(TAG, "Successfully transitioned to accessory mode");
    } else {
        ESP_LOGW(TAG, "AOA_START_ACCESSORY received in invalid state: %d", g_aoa_state);
    }
    
    return STATUS_OK;
}

static status_t aoa_send_string(uint8_t string_index, const char *string) {
    if (string == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    ESP_LOGD(TAG, "Sending string %d: %s", string_index, string);
    
    size_t string_len = strlen(string);
    if (string_len > 255) {
        string_len = 255;  // Limit string length
    }
    
    // Send control transfer with string data
    size_t transferred;
    esp_err_t ret = usb_control_transfer(
        USB_REQ_TYPE_VENDOR | USB_REQ_TYPE_RECIPIENT_DEVICE,
        AOA_CMD_SEND_STRING,
        string_index,
        0,
        (uint8_t*)string,
        string_len,
        &transferred
    );
    
    return (ret == ESP_OK) ? STATUS_OK : STATUS_ERROR_CONNECTION;
}

status_t aoa_start_accessory_mode(void) {
    ESP_LOGI(TAG, "Starting Android Accessory Mode");
    ESP_LOGI(TAG, "Device: %s %s", g_current_device_info.manufacturer, g_current_device_info.model);
    ESP_LOGI(TAG, "Description: %s", g_current_device_info.description);
    ESP_LOGI(TAG, "Version: %s", g_current_device_info.version);
    
    // Change USB PID to accessory mode
    status_t ret = usb_set_device_descriptor(AOA_VID, AOA_PID_ACCESSORY);
    if (ret != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to set accessory PID");
        return ret;
    }
    
    g_is_accessory_mode = true;
    ESP_LOGI(TAG, "Android Accessory Mode activated");
    
    return STATUS_OK;
}

status_t aoa_set_device_info(const device_info_t *device_info) {
    if (device_info == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    ESP_LOGI(TAG, "Setting device info:");
    ESP_LOGI(TAG, "  Manufacturer: %s", device_info->manufacturer);
    ESP_LOGI(TAG, "  Model: %s", device_info->model);
    ESP_LOGI(TAG, "  Description: %s", device_info->description);
    ESP_LOGI(TAG, "  Version: %s", device_info->version);
    ESP_LOGI(TAG, "  URI: %s", device_info->uri);
    ESP_LOGI(TAG, "  Serial: %s", device_info->serial);
    
    memcpy(&g_current_device_info, device_info, sizeof(device_info_t));
    
    return STATUS_OK;
}

bool aoa_is_accessory_mode(void) {
    return g_is_accessory_mode;
}

aoa_state_t aoa_get_state(void) {
    return g_aoa_state;
}

status_t aoa_handle_control_request(uint8_t bmRequestType, uint8_t bRequest, 
                                 uint16_t wValue, uint16_t wIndex, 
                                 uint8_t *data, size_t length) {
    // Check if this is an AOA vendor request
    if ((bmRequestType & 0x60) != USB_REQ_TYPE_VENDOR) {
        return STATUS_ERROR_PROTOCOL;  // Not an AOA request
    }
    
    ESP_LOGI(TAG, "AOA control request: 0x%02X, wValue=%d, wIndex=%d", bRequest, wValue, wIndex);
    
    switch (bRequest) {
        case AOA_CMD_GET_PROTOCOL:
            if (data && length >= 2) {
                uint16_t protocol;
                status_t ret = aoa_handle_get_protocol(&protocol);
                data[0] = protocol & 0xFF;
                data[1] = (protocol >> 8) & 0xFF;
                return ret;
            }
            break;
            
        case AOA_CMD_SEND_STRING:
            return aoa_handle_send_string((uint8_t)wIndex, (const char*)data);
            
        case AOA_CMD_START_ACCESSORY:
            return aoa_handle_start_accessory();
            
        case AOA_CMD_REGISTER_HID:
            ESP_LOGD(TAG, "AOA_REGISTER_HID not implemented");
            break;
            
        case AOA_CMD_UNREGISTER_HID:
            ESP_LOGD(TAG, "AOA_UNREGISTER_HID not implemented");
            break;
            
        case AOA_CMD_SET_HID_REPORT_DESC:
            ESP_LOGD(TAG, "AOA_SET_HID_REPORT_DESC not implemented");
            break;
            
        case AOA_CMD_SEND_HID_EVENT:
            ESP_LOGD(TAG, "AOA_SEND_HID_EVENT not implemented");
            break;
            
        case AOA_CMD_AUDIO_SUPPORT:
            ESP_LOGD(TAG, "AOA_AUDIO_SUPPORT not implemented");
            break;
            
        default:
            ESP_LOGW(TAG, "Unknown AOA request: 0x%02X", bRequest);
            break;
    }
    
    return STATUS_ERROR_PROTOCOL;
}

status_t aoa_negotiate_accessory_mode(void) {
    ESP_LOGI(TAG, "Starting AOA accessory mode negotiation");
    
    if (g_aoa_state != AOA_STATE_CONNECTED) {
        ESP_LOGE(TAG, "Device not connected, cannot negotiate");
        return STATUS_ERROR_CONNECTION;
    }
    
    g_aoa_state = AOA_STATE_DETECTING;
    
    // Step 1: Send GET_PROTOCOL request
    size_t transferred;
    esp_err_t ret = usb_control_transfer(
        USB_REQ_TYPE_VENDOR | USB_REQ_TYPE_RECIPIENT_DEVICE | 0x80,  // IN transfer
        AOA_CMD_GET_PROTOCOL,
        0,
        0,
        (uint8_t*)&g_aoa_protocol_version,
        2,
        &transferred
    );
    
    if (ret != ESP_OK || transferred != 2) {
        ESP_LOGE(TAG, "Failed to get AOA protocol version");
        g_aoa_state = AOA_STATE_CONNECTED;
        return STATUS_ERROR_CONNECTION;
    }
    
    ESP_LOGI(TAG, "AOA protocol version: %d", g_aoa_protocol_version);
    
    if (g_aoa_protocol_version < 1) {
        ESP_LOGE(TAG, "Device does not support AOA protocol");
        g_aoa_state = AOA_STATE_CONNECTED;
        return STATUS_ERROR_PROTOCOL;
    }
    
    g_aoa_state = AOA_STATE_SENDING_STRINGS;
    
    // Step 2: Send device strings
    const char *strings[] = {
        g_current_device_info.manufacturer,
        g_current_device_info.model,
        g_current_device_info.description,
        g_current_device_info.version,
        g_current_device_info.uri,
        g_current_device_info.serial
    };
    
    for (int i = 0; i < 6; i++) {
        status_t ret = aoa_send_string(i, strings[i]);
        if (ret != STATUS_OK) {
            ESP_LOGE(TAG, "Failed to send string %d", i);
            g_aoa_state = AOA_STATE_CONNECTED;
            return ret;
        }
        vTaskDelay(pdMS_TO_TICKS(10));  // Small delay between strings
    }
    
    g_aoa_state = AOA_STATE_STARTING_ACCESSORY;
    
    // Step 3: Send START_ACCESSORY request
    ret = usb_control_transfer(
        USB_REQ_TYPE_VENDOR | USB_REQ_TYPE_RECIPIENT_DEVICE,
        AOA_CMD_START_ACCESSORY,
        0,
        0,
        NULL,
        0,
        &transferred
    );
    
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start accessory mode");
        g_aoa_state = AOA_STATE_CONNECTED;
        return STATUS_ERROR_CONNECTION;
    }
    
    // If we get here, accessory mode should be active
    g_aoa_state = AOA_STATE_ACCESSORY_MODE;
    g_is_accessory_mode = true;
    
    ESP_LOGI(TAG, "Successfully entered Android Accessory Mode");
    return STATUS_OK;
}
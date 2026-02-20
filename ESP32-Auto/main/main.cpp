#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_bt_device.h"
#include "esp_gap_bt_api.h"
#include "esp_a2dp_api.h"
#include "esp_avrc_api.h"
#include "driver/usb_serial_jtag.h"

#include "common.h"
#include "usb_gadget.h"
#include "aoa_protocol.h"
#include "wifi_hotspot.h"
#include "bluetooth_manager.h"
#include "proxy_handler.h"

static const char *TAG = "ESP32_AUTO";

// Global connection strategy
static connection_strategy_t g_connection_strategy = CONNECTION_STRATEGY_PHONE_FIRST;

// Event group for status synchronization
static EventGroupHandle_t g_event_group;
static const int CONNECTED_EVENT = BIT0;
static const int AOA_READY_EVENT = BIT1;
static const int WIFI_READY_EVENT = BIT2;
static const int BT_READY_EVENT = BIT3;

// Device information for AOA
static device_info_t g_device_info = {
    .manufacturer = "ESP32 Wireless",
    .model = "ESP32-Auto",
    .description = "ESP32 Wireless Android Auto Adapter",
    .version = "1.0",
    .uri = "https://github.com/user/esp32-auto",
    .serial = "ESP32-AUTO-001"
};

// Function prototypes
static status_t init_nvs(void);
static status_t init_wifi(void);
static status_t init_bluetooth(void);
static status_t init_usb(void);
static void wait_for_connections(void);
static status_t start_accessory_mode(void);

static status_t init_nvs(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    return (ret == ESP_OK) ? STATUS_OK : STATUS_ERROR_INIT;
}

static status_t init_wifi(void) {
    ESP_LOGI(TAG, "Initializing WiFi");
    
    status_t ret = wifi_hotspot_init();
    if (ret != STATUS_OK) return ret;
    
    ret = wifi_hotspot_start("ESP32-Auto", "ESP32AutoConnect");
    if (ret != STATUS_OK) return ret;
    
    ESP_LOGI(TAG, "WiFi hotspot started");
    xEventGroupSetBits(g_event_group, WIFI_READY_EVENT);
    return STATUS_OK;
}

static status_t init_bluetooth(void) {
    ESP_LOGI(TAG, "Initializing Bluetooth");
    
    status_t ret = bluetooth_init();
    if (ret != STATUS_OK) return ret;
    
    ret = bluetooth_start_advertising();
    if (ret != STATUS_OK) return ret;
    
    ESP_LOGI(TAG, "Bluetooth initialized and advertising");
    xEventGroupSetBits(g_event_group, BT_READY_EVENT);
    return STATUS_OK;
}

static status_t init_usb(void) {
    ESP_LOGI(TAG, "Initializing USB");
    
    status_t ret = usb_gadget_init();
    if (ret != STATUS_OK) {
        ESP_LOGW(TAG, "USB gadget initialization failed, some features may not work");
        // Continue without USB for now
        ret = STATUS_OK;
    }
    
    ret = aoa_init();
    if (ret != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to initialize AOA protocol");
        return ret;
    }
    
    // Set device information for AOA
    ret = aoa_set_device_info(&g_device_info);
    if (ret != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to set device info");
        return ret;
    }
    
    ESP_LOGI(TAG, "USB and AOA initialized");
    xEventGroupSetBits(g_event_group, AOA_READY_EVENT);
    return STATUS_OK;
}

static void wait_for_connections(void) {
    ESP_LOGI(TAG, "Waiting for connections based on strategy: %d", g_connection_strategy);
    
    switch (g_connection_strategy) {
        case CONNECTION_STRATEGY_PHONE_FIRST:
            ESP_LOGI(TAG, "Waiting for phone connection first...");
            // Wait for WiFi and Bluetooth to be ready
            xEventGroupWaitBits(g_event_group, WIFI_READY_EVENT | BT_READY_EVENT, 
                               pdTRUE, pdTRUE, portMAX_DELAY);
            break;
            
        case CONNECTION_STRATEGY_USB_FIRST:
            ESP_LOGI(TAG, "Waiting for USB connection first...");
            xEventGroupWaitBits(g_event_group, AOA_READY_EVENT, 
                               pdTRUE, pdTRUE, portMAX_DELAY);
            break;
            
        case CONNECTION_STRATEGY_DONGLE_MODE:
            ESP_LOGI(TAG, "Dongle mode - waiting for all connections...");
            xEventGroupWaitBits(g_event_group, WIFI_READY_EVENT | BT_READY_EVENT | AOA_READY_EVENT,
                               pdTRUE, pdTRUE, portMAX_DELAY);
            break;
    }
}

static status_t start_accessory_mode(void) {
    ESP_LOGI(TAG, "Starting Android Accessory Mode");
    ESP_LOGI(TAG, "Device: %s %s", g_device_info.manufacturer, g_device_info.model);
    ESP_LOGI(TAG, "Description: %s", g_device_info.description);
    
    // Set device info for AOA
    status_t ret = aoa_set_device_info(&g_device_info);
    if (ret != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to set device info");
        return ret;
    }
    
    // Start accessory mode
    ret = aoa_start_accessory_mode();
    if (ret != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to start accessory mode");
        return ret;
    }
    
    // Start proxy server
    ret = proxy_start();
    if (ret != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to start proxy");
        return ret;
    }
    
    ESP_LOGI(TAG, "Android Accessory Mode and proxy started");
    return STATUS_OK;
}

extern "C" void app_main(void) {
    ESP_LOGI(TAG, "ESP32 Auto Wireless Android Adapter starting...");
    
    // Create event group
    g_event_group = xEventGroupCreate();
    
    // Initialize all subsystems
    if (init_nvs() != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to initialize NVS");
        return;
    }
    
    if (init_wifi() != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to initialize WiFi");
        return;
    }
    
    if (init_bluetooth() != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to initialize Bluetooth");
        return;
    }
    
    if (init_usb() != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to initialize USB");
        return;
    }
    
    // Initialize proxy handler
    if (proxy_init() != STATUS_OK) {
        ESP_LOGE(TAG, "Failed to initialize proxy");
        return;
    }
    
    // Main connection loop
    while (1) {
        wait_for_connections();
        
        if (start_accessory_mode() == STATUS_OK) {
            ESP_LOGI(TAG, "Accessory mode active - ready for proxy");
            
            // Stay in accessory mode
            xEventGroupWaitBits(g_event_group, CONNECTED_EVENT, 
                               pdTRUE, pdTRUE, portMAX_DELAY);
        } else {
            ESP_LOGE(TAG, "Failed to start accessory mode, retrying...");
            vTaskDelay(pdMS_TO_TICKS(2000));
        }
    }
}
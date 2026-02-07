#include "esp_log.h"
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_bt_device.h"
#include "esp_gap_bt_api.h"
#include "esp_gap_ble_api.h"
#include "esp_bluedroid.h"
#include "common.h"

static const char *TAG = "BLUETOOTH_MANAGER";
static bool g_is_bluetooth_active = false;
static bool g_is_advertising = false;

static void gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param) {
    switch (event) {
        case ESP_GAP_BLE_ADV_DATA_SET_COMPLETE_EVT:
            ESP_LOGI(TAG, "Advertisement data set complete");
            break;
            
        case ESP_GAP_BLE_SCAN_START_COMPLETE_EVT:
            ESP_LOGI(TAG, "BLE scan start complete");
            break;
            
        case ESP_GAP_BLE_ADV_START_COMPLETE_EVT:
            g_is_advertising = (param->adv_start_cmpl.status == ESP_BT_STATUS_SUCCESS);
            ESP_LOGI(TAG, "BLE advertising %s", g_is_advertising ? "started" : "failed to start");
            break;
            
        case ESP_GAP_BLE_ADV_STOP_COMPLETE_EVT:
            g_is_advertising = false;
            ESP_LOGI(TAG, "BLE advertising stopped");
            break;
            
        case ESP_GAP_BLE_UPDATE_CONN_PARAMS_EVT:
            ESP_LOGI(TAG, "BLE connection parameters updated");
            break;
            
        default:
            ESP_LOGD(TAG, "Unhandled GAP BLE event: %d", event);
            break;
    }
}

status_t bluetooth_init(void) {
    ESP_LOGI(TAG, "Initializing Bluetooth");
    
    esp_err_t ret;
    
    // Release classic BT memory if allocated
    ret = esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "Failed to release classic BT memory: %s", esp_err_to_name(ret));
    }
    
    // Initialize BT controller
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ret = esp_bt_controller_init(&bt_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize BT controller: %s", esp_err_to_name(ret));
        return STATUS_ERROR_INIT;
    }
    
    // Enable BLE mode
    ret = esp_bt_controller_enable(ESP_BT_MODE_BLE);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to enable BLE mode: %s", esp_err_to_name(ret));
        return STATUS_ERROR_INIT;
    }
    
    // Initialize Bluedroid
    ret = esp_bluedroid_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize Bluedroid: %s", esp_err_to_name(ret));
        return STATUS_ERROR_INIT;
    }
    
    ret = esp_bluedroid_enable();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to enable Bluedroid: %s", esp_err_to_name(ret));
        return STATUS_ERROR_INIT;
    }
    
    // Register GAP callback
    ret = esp_ble_gap_register_callback(gap_event_handler);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to register GAP callback: %s", esp_err_to_name(ret));
        return STATUS_ERROR_INIT;
    }
    
    // Set device name
    ret = esp_bt_dev_set_device_name("ESP32-AA-Dongle");
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to set device name: %s", esp_err_to_name(ret));
        return STATUS_ERROR_INIT;
    }
    
    g_is_bluetooth_active = true;
    ESP_LOGI(TAG, "Bluetooth initialized successfully");
    
    return STATUS_OK;
}

status_t bluetooth_start_advertising(void) {
    if (!g_is_bluetooth_active) {
        ESP_LOGE(TAG, "Bluetooth not initialized");
        return STATUS_ERROR_INIT;
    }
    
    if (g_is_advertising) {
        ESP_LOGW(TAG, "Already advertising");
        return STATUS_OK;
    }
    
    ESP_LOGI(TAG, "Starting Bluetooth advertising");
    
    // Set advertisement data
    esp_ble_adv_data_t adv_data = {
        .set_scan_rsp = false,
        .include_name = true,
        .include_txpower = true,
        .min_interval = 0x20,    // 20ms
        .max_interval = 0x40,    // 40ms
        .appearance = 0x00,
        .manufacturer_len = 0,
        .p_manufacturer_data = NULL,
        .service_data_len = 0,
        .p_service_data = NULL,
        .service_uuid_len = 0,
        .p_service_uuid = NULL,
        .flag = (ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT),
    };
    
    esp_err_t ret = esp_ble_gap_config_adv_data(&adv_data);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to set advertisement data: %s", esp_err_to_name(ret));
        return STATUS_ERROR_CONNECTION;
    }
    
    // Set scan response data
    esp_ble_adv_data_t scan_rsp_data = {
        .set_scan_rsp = true,
        .include_name = true,
        .include_txpower = false,
        .min_interval = 0,
        .max_interval = 0,
        .appearance = 0x00,
        .manufacturer_len = 0,
        .p_manufacturer_data = NULL,
        .service_data_len = 0,
        .p_service_data = NULL,
        .service_uuid_len = 0,
        .p_service_uuid = NULL,
        .flag = 0,
    };
    
    ret = esp_ble_gap_config_adv_data(&scan_rsp_data);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to set scan response data: %s", esp_err_to_name(ret));
        return STATUS_ERROR_CONNECTION;
    }
    
    // Set advertising parameters
    esp_ble_adv_params_t adv_params = {
        .adv_int_min = 0x20,      // 20ms
        .adv_int_max = 0x40,      // 40ms
        .adv_type = ADV_TYPE_IND,
        .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
        .peer_addr_type = BLE_ADDR_TYPE_PUBLIC,
        .channel_map = ADV_CHNL_ALL,
        .adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
    };
    
    ret = esp_ble_gap_start_advertising(&adv_params);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start advertising: %s", esp_err_to_name(ret));
        return STATUS_ERROR_CONNECTION;
    }
    
    ESP_LOGI(TAG, "Bluetooth advertising started");
    return STATUS_OK;
}

status_t bluetooth_stop_advertising(void) {
    if (!g_is_advertising) {
        return STATUS_OK;
    }
    
    ESP_LOGI(TAG, "Stopping Bluetooth advertising");
    
    esp_err_t ret = esp_ble_gap_stop_advertising();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to stop advertising: %s", esp_err_to_name(ret));
        return STATUS_ERROR_CONNECTION;
    }
    
    g_is_advertising = false;
    ESP_LOGI(TAG, "Bluetooth advertising stopped");
    
    return STATUS_OK;
}

status_t bluetooth_deinit(void) {
    ESP_LOGI(TAG, "Deinitializing Bluetooth");
    
    if (g_is_advertising) {
        bluetooth_stop_advertising();
    }
    
    esp_bluedroid_disable();
    esp_bluedroid_deinit();
    esp_bt_controller_disable();
    esp_bt_controller_deinit();
    
    g_is_bluetooth_active = false;
    g_is_advertising = false;
    
    ESP_LOGI(TAG, "Bluetooth deinitialized");
    return STATUS_OK;
}

bool bluetooth_is_active(void) {
    return g_is_bluetooth_active;
}

bool bluetooth_is_advertising(void) {
    return g_is_advertising;
}
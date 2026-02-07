#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "common.h"

static const char *TAG = "ESP32_WIFI_HOTSPOT";
static esp_netif_t *g_ap_netif = NULL;
static bool g_is_hotspot_active = false;

static void wifi_event_handler(void* arg, esp_event_base_t event_base,
                               int32_t event_id, void* event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_AP_STACONNECTED) {
        wifi_event_ap_staconnected_t* event = (wifi_event_ap_staconnected_t*) event_data;
        ESP_LOGI(TAG, "Station "MACSTR" joined, AID=%d",
                 MAC2STR(event->mac), event->aid);
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_AP_STADISCONNECTED) {
        wifi_event_ap_stadisconnected_t* event = (wifi_event_ap_stadisconnected_t*) event_data;
        ESP_LOGI(TAG, "Station "MACSTR" left, AID=%d",
                 MAC2STR(event->mac), event->aid);
    }
}

status_t wifi_hotspot_init(void) {
    ESP_LOGI(TAG, "Initializing WiFi Hotspot");
    
    esp_err_t ret;
    
    // Initialize network interface
    ret = esp_netif_init();
    if (ret != ESP_OK) return STATUS_ERROR_INIT;
    
    // Create default event loop
    ret = esp_event_loop_create_default();
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Failed to create event loop: %s", esp_err_to_name(ret));
        return STATUS_ERROR_INIT;
    }
    
    // Create default AP netif
    g_ap_netif = esp_netif_create_default_wifi_ap();
    if (g_ap_netif == NULL) {
        ESP_LOGE(TAG, "Failed to create default AP netif");
        return STATUS_ERROR_INIT;
    }
    
    // Initialize WiFi
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ret = esp_wifi_init(&cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize WiFi: %s", esp_err_to_name(ret));
        return STATUS_ERROR_INIT;
    }
    
    // Register event handler
    ret = esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to register event handler: %s", esp_err_to_name(ret));
        return STATUS_ERROR_INIT;
    }
    
    ESP_LOGI(TAG, "WiFi hotspot initialized successfully");
    return STATUS_OK;
}

status_t wifi_hotspot_start(const char *ssid, const char *password) {
    if (g_is_hotspot_active) {
        ESP_LOGW(TAG, "Hotspot already active");
        return STATUS_OK;
    }
    
    ESP_LOGI(TAG, "Starting WiFi hotspot");
    ESP_LOGI(TAG, "SSID: %s", ssid ? ssid : "ESP32-AA-Dongle");
    
    esp_err_t ret;
    
    // Set WiFi mode to AP
    ret = esp_wifi_set_mode(WIFI_MODE_AP);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to set WiFi mode: %s", esp_err_to_name(ret));
        return STATUS_ERROR_CONNECTION;
    }
    
    // Configure AP
    wifi_config_t ap_config = {
        .ap = {
            .ssid_len = 0,
            .channel = 1,
            .max_connection = 1,
            .authmode = WIFI_AUTH_WPA_WPA2_PSK,
            .pmf_cfg = {
                .required = false,
            },
        }
    };
    
    // Copy SSID
    if (ssid) {
        strncpy((char*)ap_config.ap.ssid, ssid, sizeof(ap_config.ap.ssid) - 1);
        ap_config.ap.ssid_len = strlen(ssid);
    } else {
        strcpy((char*)ap_config.ap.ssid, "ESP32-AA-Dongle");
        ap_config.ap.ssid_len = strlen("ESP32-AA-Dongle");
    }
    
    // Copy password
    if (password && strlen(password) >= 8) {
        strcpy((char*)ap_config.ap.password, password);
    } else {
        strcpy((char*)ap_config.ap.password, "ConnectAAWirelessDongle");
    }
    
    ret = esp_wifi_set_config(WIFI_IF_AP, &ap_config);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to set WiFi config: %s", esp_err_to_name(ret));
        return STATUS_ERROR_CONNECTION;
    }
    
    // Start WiFi
    ret = esp_wifi_start();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start WiFi: %s", esp_err_to_name(ret));
        return STATUS_ERROR_CONNECTION;
    }
    
    g_is_hotspot_active = true;
    
    // Get and print IP info
    esp_netif_ip_info_t ip_info;
    ret = esp_netif_get_ip_info(g_ap_netif, &ip_info);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "Hotspot started successfully");
        ESP_LOGI(TAG, "IP Address: "IPSTR, IP2STR(&ip_info.ip));
        ESP_LOGI(TAG, "Netmask: "IPSTR, IP2STR(&ip_info.netmask));
        ESP_LOGI(TAG, "Gateway: "IPSTR, IP2STR(&ip_info.gw));
    }
    
    return STATUS_OK;
}

status_t wifi_hotspot_stop(void) {
    if (!g_is_hotspot_active) {
        return STATUS_OK;
    }
    
    ESP_LOGI(TAG, "Stopping WiFi hotspot");
    
    esp_err_t ret = esp_wifi_stop();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to stop WiFi: %s", esp_err_to_name(ret));
        return STATUS_ERROR_CONNECTION;
    }
    
    g_is_hotspot_active = false;
    ESP_LOGI(TAG, "WiFi hotspot stopped");
    
    return STATUS_OK;
}

bool wifi_hotspot_is_active(void) {
    return g_is_hotspot_active;
}